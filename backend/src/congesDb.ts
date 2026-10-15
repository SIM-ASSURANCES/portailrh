// Congés — application en base (Lot 3a, 2026-10-15). Toujours dans la transaction de l'appelant.
//
// Les règles sont dans `congesCalcul.ts` (jours, exercice, solde) et `circuitAbsence.ts` (qui décide, quelle transition) :
// ce fichier ne fait que LIRE le contexte et ÉCRIRE le résultat, avec les garanties du plan de fusion :
//   - B4 : chaque changement de statut est un `updateMany` conditionné au statut lu, sous un verrou de ligne sur la
//     demande (`SELECT … FOR UPDATE`) ; le débit du solde est conditionnel (`soldeRestant >= n`) ;
//   - I1 : la référence est calculée sous un verrou consultatif du mois, dans la transaction de création ;
//   - I3 : les plages d'absence autorisée portent `demandeCongeId` ; l'annulation les supprime par cette clé ;
//   - B7 : la date d'embauche est obligatoire pour un congé déductible, jamais de repli sur `createdAt`.
// Un refus métier en cours d'écriture est une `RefusAbsence` : la transaction est annulée en entier
// (`transactionAbsence`), aucune écriture partielle ne subsiste.

import { prisma } from "./prisma";
import type { Prisma } from "./generated/prisma/client";
import type { StatutDemandeConge } from "./generated/prisma/enums";
import {
  ACTION_HISTORIQUE_ABSENCE,
  PERMISSION_DG_ABSENCE,
  PERMISSION_ETAPE_RH_ABSENCE,
  decideurPourStatutAbsence,
  destinatairesEtapeAbsence,
  nettoyerMotifAbsence,
  resoudreParcoursAbsence,
  transitionAbsence,
  type ActeurAbsence,
  type ActionCircuitAbsence,
  type ContexteCircuitAbsence,
  type EffetTransitionAbsence,
  type NatureAbsence,
  type ParcoursAbsence,
  type StatutCircuitAbsence,
} from "./circuitAbsence";
import {
  MAX_JOURS_PERIODE,
  ajouterJours,
  MESSAGE_DATE_EMBAUCHE_MANQUANTE,
  calculerNbJours,
  comparerJours,
  dateFinPourJours,
  exerciceDuDebit,
  formatJourCivil,
  jourCivilDepuisColonneDate,
  colonneDateDepuisJourCivil,
  messageSoldeInsuffisant,
  parseJourCivil,
  planifierDebit,
  premierChevauchement,
  verifierAnciennete,
  calculerExercice,
  type DecompteJours,
  type JourCivil,
} from "./congesCalcul";
import { validerPieces, type PieceEntree } from "./congesPieces";

export type Db = Prisma.TransactionClient;

/** Refus métier levé PENDANT une transaction : tout ce qui a été écrit avant est annulé. */
export class RefusAbsence extends Error {
  constructor(
    message: string,
    readonly champ?: string
  ) {
    super(message);
    this.name = "RefusAbsence";
  }
}

export type ResultatAbsence<T> = { ok: true; valeur: T } | { ok: false; erreur: string; champ?: string };

/** Exécute `fn` dans une transaction ; un `RefusAbsence` annule tout et revient en `{ ok: false }`. */
export async function transactionAbsence<T>(fn: (tx: Db) => Promise<T>): Promise<ResultatAbsence<T>> {
  try {
    const valeur = await prisma.$transaction(fn, { maxWait: 10_000, timeout: 30_000 });
    return { ok: true, valeur };
  } catch (e) {
    if (e instanceof RefusAbsence) return { ok: false, erreur: e.message, champ: e.champ };
    throw e;
  }
}

async function verrouiller(db: Db, cle: string): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${cle})::bigint)`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Références (I1)
// ---------------------------------------------------------------------------------------------------------------------

/** `CNG-AAAAMM-NNNN` / `PRM-AAAAMM-NNNN`, calculée SOUS VERROU dans la transaction de création. */
export async function genererReferenceAbsence(db: Db, nature: NatureAbsence, maintenant: Date): Promise<string> {
  const prefixe = nature === "CONGE" ? "CNG" : "PRM";
  const mois = `${maintenant.getFullYear()}${String(maintenant.getMonth() + 1).padStart(2, "0")}`;
  const debut = `${prefixe}-${mois}-`;
  await verrouiller(db, `reference:${prefixe}-${mois}`);
  const existantes =
    nature === "CONGE"
      ? await db.demandeConge.findMany({ where: { reference: { startsWith: debut } }, select: { reference: true } })
      : await db.demandePermission.findMany({ where: { reference: { startsWith: debut } }, select: { reference: true } });
  let max = 0;
  for (const { reference } of existantes) {
    const n = Number(reference.slice(debut.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${debut}${String(max + 1).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Contexte du circuit (qui décide, maintenant)
// ---------------------------------------------------------------------------------------------------------------------

/** Comptes ACTIFS dont le RÔLE porte la permission (jamais une délégation : ces permissions ne se délèguent pas). */
export async function comptesActifsAvecPermission(db: Db, cle: string): Promise<string[]> {
  const comptes = await db.user.findMany({
    where: { isActive: true, role: { permissions: { some: { permission: { key: cle } } } } },
    select: { id: true },
  });
  return comptes.map((c) => c.id);
}

export async function chargerContexteCircuit(db: Db, demandeurId: string, nature: NatureAbsence): Promise<ContexteCircuitAbsence> {
  const [demandeur, comptesRH, comptesDG] = await Promise.all([
    db.user.findUnique({
      where: { id: demandeurId },
      select: { service: { select: { name: true, responsableId: true, responsable: { select: { isActive: true } } } } },
    }),
    comptesActifsAvecPermission(db, PERMISSION_ETAPE_RH_ABSENCE[nature]),
    comptesActifsAvecPermission(db, PERMISSION_DG_ABSENCE),
  ]);
  const s = demandeur?.service ?? null;
  return {
    demandeurId,
    service: s ? { name: s.name, responsableId: s.responsableId, responsableActif: s.responsable?.isActive ?? false } : null,
    comptesRH,
    comptesDG,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Jours fériés, plages
// ---------------------------------------------------------------------------------------------------------------------

/** Jours fériés de la table `JourFerie` dans la période (jour civil local, comme le reste du module). */
export async function lireJoursFeries(db: Db, debut: JourCivil, fin: JourCivil): Promise<JourCivil[]> {
  const d = parseJourCivil(debut);
  const f = parseJourCivil(fin);
  if (!d || !f) return [];
  const feries = await db.jourFerie.findMany({
    where: { date: { gte: d, lte: new Date(f.getFullYear(), f.getMonth(), f.getDate(), 23, 59, 59, 999) } },
    select: { date: true },
  });
  return feries.map((j) => formatJourCivil(j.date));
}

/** Une plage d'absence autorisée par jour de la période (le Pointage ne lit rien d'autre d'un congé), liées à la demande. */
async function creerPlagesConge(db: Db, p: { userId: string; demandeId: string; reference: string; jours: readonly JourCivil[] }) {
  const data = p.jours.map((jour) => {
    const d = parseJourCivil(jour)!;
    return {
      userId: p.userId,
      date: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
      heureDebut: "00:00",
      heureFin: "23:59",
      source: "CONGE" as const,
      description: `Congé ${p.reference}`,
      demandeCongeId: p.demandeId,
    };
  });
  if (data.length > 0) await db.plageAbsenceAutorisee.createMany({ data });
}

// ---------------------------------------------------------------------------------------------------------------------
// Solde
// ---------------------------------------------------------------------------------------------------------------------

function typeDeductible(t: { nonDeductibleSolde: boolean; nbJoursDefaut: number }): boolean {
  return !t.nonDeductibleSolde && t.nbJoursDefaut > 0;
}

/** Ligne de solde de l'exercice, créée (dotation complète du type) si elle n'existe pas encore. Sûre en concurrence. */
export async function assurerSoldeExercice(
  db: Db,
  p: { userId: string; typeCongeId: string; nbJoursDefaut: number; exercice: { exercice: number; debut: JourCivil; fin: JourCivil } }
) {
  const cle = { userId: p.userId, typeCongeId: p.typeCongeId, exercice: p.exercice.exercice };
  await db.soldeConge.createMany({
    data: [
      {
        ...cle,
        soldeInitial: p.nbJoursDefaut,
        soldeRestant: p.nbJoursDefaut,
        dateDebutExercice: colonneDateDepuisJourCivil(p.exercice.debut),
        dateFinExercice: colonneDateDepuisJourCivil(p.exercice.fin),
      },
    ],
    skipDuplicates: true,
  });
  return db.soldeConge.findUniqueOrThrow({
    where: { userId_typeCongeId_exercice: cle },
  });
}

/** Solde de l'exercice qui contient les jours du congé, ou le refus (date d'embauche absente, deux exercices). */
async function soldeDuConge(
  db: Db,
  p: { userId: string; type: { id: string; nbJoursDefaut: number }; dateEmbauche: JourCivil | null; decompte: DecompteJours }
) {
  if (!p.dateEmbauche) throw new RefusAbsence(MESSAGE_DATE_EMBAUCHE_MANQUANTE);
  const ex = exerciceDuDebit(p.decompte.joursDecomptes, p.dateEmbauche);
  if (!ex.ok) throw new RefusAbsence(ex.erreur);
  const solde = await db.soldeConge.findUnique({
    where: { userId_typeCongeId_exercice: { userId: p.userId, typeCongeId: p.type.id, exercice: ex.exercice.exercice } },
  });
  return { exercice: ex.exercice, solde };
}

// ---------------------------------------------------------------------------------------------------------------------
// Contrôles communs à la soumission, à la resoumission et au congé d'office
// ---------------------------------------------------------------------------------------------------------------------

export interface DemandeCongeEntree {
  typeCongeId: string;
  dateDebut: JourCivil;
  dateFin: JourCivil;
  motif: string;
  interimaire?: string | null;
  piecesJointes?: readonly PieceEntree[];
}

interface CongePrepare {
  type: NonNullable<Awaited<ReturnType<Db["typeConge"]["findUnique"]>>>;
  dateEmbauche: JourCivil | null;
  dateDebut: JourCivil;
  dateFin: JourCivil;
  decompte: DecompteJours;
  motif: string;
  interimaire: string | null;
  pieces: PieceEntree[];
}

export const MOTIF_CONGE_MIN = 5;
export const MOTIF_CONGE_MAX = 500;

async function preparerConge(
  db: Db,
  p: { userId: string; entree: DemandeCongeEntree; exclureDemandeId?: string; ignorerAnciennete?: boolean; maintenant: Date }
): Promise<CongePrepare> {
  const { entree } = p;
  const user = await db.user.findUnique({ where: { id: p.userId }, select: { isActive: true, dateEmbauche: true } });
  if (!user || !user.isActive) throw new RefusAbsence("Compte introuvable ou désactivé.");
  const dateEmbauche = user.dateEmbauche ? jourCivilDepuisColonneDate(user.dateEmbauche) : null;

  if (!parseJourCivil(entree.dateDebut)) throw new RefusAbsence("Date de début invalide.", "dateDebut");
  if (!parseJourCivil(entree.dateFin)) throw new RefusAbsence("Date de fin invalide.", "dateFin");
  if (comparerJours(entree.dateFin, entree.dateDebut) < 0) {
    throw new RefusAbsence("La date de fin ne peut pas être antérieure à la date de début.", "dateFin");
  }

  const motif = nettoyerMotifAbsence(entree.motif ?? "");
  if (motif.length < MOTIF_CONGE_MIN) throw new RefusAbsence(`Le motif doit comporter au moins ${MOTIF_CONGE_MIN} caractères.`, "motif");
  if (motif.length > MOTIF_CONGE_MAX) throw new RefusAbsence(`Le motif ne doit pas dépasser ${MOTIF_CONGE_MAX} caractères.`, "motif");
  const interimaire = nettoyerMotifAbsence(entree.interimaire ?? "").slice(0, 120) || null;

  const piecesOk = validerPieces(entree.piecesJointes ? [...entree.piecesJointes] : []);
  if (!piecesOk.ok) throw new RefusAbsence(piecesOk.erreur, "piecesJointes");

  const type = await db.typeConge.findUnique({ where: { id: entree.typeCongeId } });
  if (!type || !type.isActive) throw new RefusAbsence("Type de congé invalide ou inactif.", "typeCongeId");

  // Ancienneté exigée par le type (article 13 : 6 mois) : jamais de repli sur la date de création du compte.
  if (!p.ignorerAnciennete) {
    const anc = verifierAnciennete({ dateEmbauche, moisRequis: type.ancienneteMinimumMois, reference: entree.dateDebut });
    if (!anc.eligible) throw new RefusAbsence(anc.erreur, "typeCongeId");
  }

  // Durée fixée par le type (permission exceptionnelle) : la date de fin est calculée, pas saisie.
  let dateFin = entree.dateFin;
  const feriesLarges = await lireJoursFeries(db, entree.dateDebut, ajouterJours(entree.dateDebut, MAX_JOURS_PERIODE * 2));
  if (type.categorie === "PERMISSION_EXCEPTIONNELLE") {
    dateFin = dateFinPourJours({ debut: entree.dateDebut, nbJours: type.nbJoursDefaut, decompte: type.decompteType, joursFeries: feriesLarges });
  }

  let decompte: DecompteJours;
  try {
    decompte = calculerNbJours({ debut: entree.dateDebut, fin: dateFin, decompte: type.decompteType, joursFeries: feriesLarges });
  } catch {
    throw new RefusAbsence(`La période ne peut pas dépasser ${MAX_JOURS_PERIODE} jours.`, "dateFin");
  }
  if (decompte.nbJours <= 0) throw new RefusAbsence("La période sélectionnée ne comporte aucun jour décomptable.", "dateDebut");

  if ((type.categorie === "PERMISSION_EXCEPTIONNELLE" || type.justificatifObligatoire) && piecesOk.pieces.length === 0) {
    throw new RefusAbsence(
      type.categorie === "PERMISSION_EXCEPTIONNELLE"
        ? "Règlement interne (article 13) : une pièce justificative est obligatoire pour cet événement."
        : `Une pièce justificative est obligatoire pour le type « ${type.label} ».`,
      "piecesJointes"
    );
  }

  return { type, dateEmbauche, dateDebut: entree.dateDebut, dateFin, decompte, motif, interimaire, pieces: piecesOk.pieces };
}

/** Chevauchement avec un autre congé en cours ou validé, ou une permission approuvée / en cours. */
async function controlerChevauchement(db: Db, p: { userId: string; debut: JourCivil; fin: JourCivil; exclureDemandeId?: string }) {
  const existants = await db.demandeConge.findMany({
    where: {
      userId: p.userId,
      statut: { in: ["EN_ATTENTE_RESPONSABLE", "EN_ATTENTE_RH", "VALIDEE"] },
      dateDebut: { lte: colonneDateDepuisJourCivil(p.fin) },
      dateFin: { gte: colonneDateDepuisJourCivil(p.debut) },
      ...(p.exclureDemandeId ? { id: { not: p.exclureDemandeId } } : {}),
    },
    select: { id: true, reference: true, dateDebut: true, dateFin: true },
  });
  const periodes = existants.map((e) => ({ id: e.id, debut: jourCivilDepuisColonneDate(e.dateDebut), fin: jourCivilDepuisColonneDate(e.dateFin) }));
  const conflit = premierChevauchement({ debut: p.debut, fin: p.fin }, periodes);
  if (conflit) {
    const ref = existants.find((e) => e.id === conflit.id)?.reference ?? "";
    throw new RefusAbsence(`Une demande de congé en cours ou validée couvre déjà cette période (${ref}).`, "dateDebut");
  }
  const permissions = await db.demandePermission.count({
    where: {
      userId: p.userId,
      statut: { in: ["EN_ATTENTE_RESPONSABLE", "EN_ATTENTE_RH", "APPROUVEE"] },
      date: { gte: colonneDateDepuisJourCivil(p.debut), lte: colonneDateDepuisJourCivil(p.fin) },
    },
  });
  if (permissions > 0) {
    throw new RefusAbsence("Une permission d'absence existe déjà sur cette période : annulez-la d'abord.", "dateDebut");
  }
}

/** Solde suffisant pour un congé déductible (vérifié à la demande ; le débit réel est conditionnel, à l'accord). */
async function controlerSolde(db: Db, p: { userId: string; prepare: CongePrepare }) {
  const { type, dateEmbauche, decompte } = p.prepare;
  if (!typeDeductible(type)) return;
  const { solde } = await soldeDuConge(db, { userId: p.userId, type, dateEmbauche, decompte });
  const plan = planifierDebit({
    nonDeductible: false,
    nbJoursDefaut: type.nbJoursDefaut,
    soldeRestant: solde ? solde.soldeRestant : null,
    nbJours: decompte.nbJours,
  });
  if (!plan.suffisant) throw new RefusAbsence(messageSoldeInsuffisant(plan), "dateFin");
}

async function noterHistorique(
  db: Db,
  p: { nature: NatureAbsence; demandeId: string; action: string; detail: string; userId: string }
) {
  await db.historiqueEntry.create({
    data: { entity: p.nature === "CONGE" ? "DemandeConge" : "DemandePermission", entityId: p.demandeId, action: p.action, detail: p.detail, userId: p.userId },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Soumission
// ---------------------------------------------------------------------------------------------------------------------

export interface SoumissionConge {
  id: string;
  reference: string;
  statut: StatutCircuitAbsence;
  nbJours: number;
  /** Comptes à prévenir (le responsable, ou la RH, ou le DG) : calculés avec le contexte lu dans la transaction. */
  destinataires: string[];
  libelleType: string;
}

export async function soumettreConge(db: Db, p: { userId: string; entree: DemandeCongeEntree; maintenant: Date }): Promise<SoumissionConge> {
  await verrouiller(db, `conge-utilisateur:${p.userId}`);
  const prepare = await preparerConge(db, { userId: p.userId, entree: p.entree, maintenant: p.maintenant });
  await controlerChevauchement(db, { userId: p.userId, debut: prepare.dateDebut, fin: prepare.dateFin });
  await controlerSolde(db, { userId: p.userId, prepare });

  const ctx = await chargerContexteCircuit(db, p.userId, "CONGE");
  const parcours = resoudreParcoursAbsence(ctx);
  if (!parcours.ok) throw new RefusAbsence(parcours.erreur);

  const reference = await genererReferenceAbsence(db, "CONGE", p.maintenant);
  const demande = await db.demandeConge.create({
    data: {
      reference,
      dateDebut: colonneDateDepuisJourCivil(prepare.dateDebut),
      dateFin: colonneDateDepuisJourCivil(prepare.dateFin),
      nbJours: prepare.decompte.nbJours,
      motif: prepare.motif,
      interimaire: prepare.interimaire,
      statut: parcours.premierStatut,
      etapeResponsableRequise: parcours.etapeResponsable.requise,
      etapeDepuis: p.maintenant,
      userId: p.userId,
      typeCongeId: prepare.type.id,
      piecesJointes: { create: prepare.pieces.map((x) => ({ url: x.url, nomFichier: x.nomFichier ?? null })) },
    },
  });
  await noterHistorique(db, {
    nature: "CONGE",
    demandeId: demande.id,
    action: ACTION_HISTORIQUE_ABSENCE.SOUMETTRE,
    detail: `${reference} : ${prepare.type.label}, ${prepare.decompte.nbJours} jour(s) du ${prepare.dateDebut} au ${prepare.dateFin}.`,
    userId: p.userId,
  });
  return {
    id: demande.id,
    reference,
    statut: parcours.premierStatut,
    nbJours: prepare.decompte.nbJours,
    destinataires: destinatairesEtapeAbsence(parcours.premierStatut, ctx),
    libelleType: prepare.type.label,
  };
}

/**
 * Le demandeur renvoie sa demande après une demande de modification : mêmes contrôles qu'à la soumission, le circuit
 * repart de la première étape applicable (parcours recalculé), les décisions précédentes sont effacées (l'historique
 * les garde).
 */
export async function resoumettreConge(
  db: Db,
  p: { demandeId: string; acteurId: string; entree: DemandeCongeEntree; maintenant: Date }
): Promise<SoumissionConge> {
  await db.$executeRaw`SELECT id FROM "DemandeConge" WHERE id = ${p.demandeId} FOR UPDATE`;
  const demande = await db.demandeConge.findUnique({ where: { id: p.demandeId } });
  if (!demande) throw new RefusAbsence("Demande introuvable.");
  await verrouiller(db, `conge-utilisateur:${demande.userId}`);

  const ctx = await chargerContexteCircuit(db, demande.userId, "CONGE");
  const parcours = resoudreParcoursAbsence(ctx);
  if (!parcours.ok) throw new RefusAbsence(parcours.erreur);
  const r = transitionAbsence({
    nature: "CONGE",
    statut: demande.statut,
    action: { type: "RESOUMETTRE", premierStatut: parcours.premierStatut },
    acteur: { id: p.acteurId, rolePermissions: [] },
    demandeurId: demande.userId,
    decideur: null,
  });
  if (!r.ok) throw new RefusAbsence(r.erreur);

  const prepare = await preparerConge(db, { userId: demande.userId, entree: p.entree, exclureDemandeId: demande.id, maintenant: p.maintenant });
  await controlerChevauchement(db, { userId: demande.userId, debut: prepare.dateDebut, fin: prepare.dateFin, exclureDemandeId: demande.id });
  await controlerSolde(db, { userId: demande.userId, prepare });

  const { count } = await db.demandeConge.updateMany({
    where: { id: demande.id, statut: "MODIFICATION_DEMANDEE" },
    data: {
      statut: parcours.premierStatut,
      etapeResponsableRequise: parcours.etapeResponsable.requise,
      etapeDepuis: p.maintenant,
      dernierRappelAt: null,
      dateDebut: colonneDateDepuisJourCivil(prepare.dateDebut),
      dateFin: colonneDateDepuisJourCivil(prepare.dateFin),
      nbJours: prepare.decompte.nbJours,
      motif: prepare.motif,
      interimaire: prepare.interimaire,
      typeCongeId: prepare.type.id,
      motifModification: null,
      approuveParId: null,
      approuveAt: null,
    },
  });
  if (count === 0) throw new RefusAbsence("Cette demande a déjà été traitée.");
  // Les nouvelles pièces s'ajoutent aux précédentes (jamais effacées en silence).
  const existantes = new Set((await db.pieceJointeConge.findMany({ where: { demandeCongeId: demande.id }, select: { url: true } })).map((x) => x.url));
  const nouvelles = prepare.pieces.filter((x) => !existantes.has(x.url));
  if (nouvelles.length > 0) {
    await db.pieceJointeConge.createMany({ data: nouvelles.map((x) => ({ demandeCongeId: demande.id, url: x.url, nomFichier: x.nomFichier ?? null })) });
  }
  await noterHistorique(db, {
    nature: "CONGE",
    demandeId: demande.id,
    action: ACTION_HISTORIQUE_ABSENCE.RESOUMETTRE,
    detail: `${demande.reference} renvoyée : ${prepare.type.label}, ${prepare.decompte.nbJours} jour(s) du ${prepare.dateDebut} au ${prepare.dateFin}.`,
    userId: p.acteurId,
  });
  return {
    id: demande.id,
    reference: demande.reference,
    statut: parcours.premierStatut,
    nbJours: prepare.decompte.nbJours,
    destinataires: destinatairesEtapeAbsence(parcours.premierStatut, ctx),
    libelleType: prepare.type.label,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Décision, annulation
// ---------------------------------------------------------------------------------------------------------------------

export interface DecisionConge {
  id: string;
  reference: string;
  demandeurId: string;
  libelleType: string;
  ancienStatut: StatutCircuitAbsence;
  statut: StatutCircuitAbsence;
  effet: EffetTransitionAbsence;
  viaRepli: boolean;
  motif?: string;
  /** Comptes à prévenir de l'étape suivante (vide si la demande n'attend plus rien). */
  destinatairesSuivants: string[];
  nbJours: number;
  dateDebut: JourCivil;
  dateFin: JourCivil;
}

/** Debit du solde et plages, à l'accord d'un congé (dans la transaction de la décision). */
async function accorderEffets(db: Db, demande: DemandeCongeAvecType): Promise<{ soldeCongeId: string | null; joursDebites: number }> {
  const debut = jourCivilDepuisColonneDate(demande.dateDebut);
  const fin = jourCivilDepuisColonneDate(demande.dateFin);
  const feries = await lireJoursFeries(db, debut, fin);
  const decompte = calculerNbJours({ debut, fin, decompte: demande.typeConge.decompteType, joursFeries: feries });

  let soldeCongeId: string | null = null;
  let joursDebites = 0;
  if (typeDeductible(demande.typeConge)) {
    const user = await db.user.findUnique({ where: { id: demande.userId }, select: { dateEmbauche: true } });
    const dateEmbauche = user?.dateEmbauche ? jourCivilDepuisColonneDate(user.dateEmbauche) : null;
    if (!dateEmbauche) throw new RefusAbsence(MESSAGE_DATE_EMBAUCHE_MANQUANTE);
    // Exercice des jours du congé ; si la période n'a plus aucun jour décompté, celui du premier jour.
    const ex = decompte.joursDecomptes.length > 0 ? exerciceDuDebit(decompte.joursDecomptes, dateEmbauche) : null;
    if (ex && !ex.ok) throw new RefusAbsence(ex.erreur);
    const exercice = ex && ex.ok ? ex.exercice : calculerExercice(dateEmbauche, debut);
    const solde = await assurerSoldeExercice(db, {
      userId: demande.userId,
      typeCongeId: demande.typeCongeId,
      nbJoursDefaut: demande.typeConge.nbJoursDefaut,
      exercice,
    });
    // Débit conditionnel : deux accords simultanés ne peuvent pas faire passer le solde sous zéro.
    const { count } = await db.soldeConge.updateMany({
      where: { id: solde.id, soldeRestant: { gte: demande.nbJours } },
      data: { soldeRestant: { decrement: demande.nbJours } },
    });
    if (count === 0) {
      throw new RefusAbsence(`Solde insuffisant : ${solde.soldeRestant} jour(s) restant(s) pour l'exercice ${exercice.exercice}, ${demande.nbJours} demandé(s).`);
    }
    soldeCongeId = solde.id;
    joursDebites = demande.nbJours;
  }
  await creerPlagesConge(db, { userId: demande.userId, demandeId: demande.id, reference: demande.reference, jours: decompte.jours });
  return { soldeCongeId, joursDebites };
}

type DemandeCongeAvecType = Prisma.DemandeCongeGetPayload<{ include: { typeConge: true } }>;

/** Annulation d'un congé accordé : le solde débité est recrédité (la même ligne), les plages supprimées par clé. */
async function defaireEffets(db: Db, demande: DemandeCongeAvecType): Promise<void> {
  if (demande.soldeCongeId && demande.joursDebites > 0) {
    await db.soldeConge.update({ where: { id: demande.soldeCongeId }, data: { soldeRestant: { increment: demande.joursDebites } } });
  }
  await db.plageAbsenceAutorisee.deleteMany({ where: { demandeCongeId: demande.id } });
}

export async function deciderConge(
  db: Db,
  p: {
    demandeId: string;
    acteur: ActeurAbsence;
    action: Exclude<ActionCircuitAbsence, { type: "RESOUMETTRE" }>;
    /** L'acteur porte `conges.annuler` (annule même après le début). */
    peutAnnulerApresDebut: boolean;
    maintenant: Date;
  }
): Promise<DecisionConge> {
  // Verrou de ligne : deux décisions simultanées sur la même demande s'enchaînent, la seconde voit le nouveau statut.
  await db.$executeRaw`SELECT id FROM "DemandeConge" WHERE id = ${p.demandeId} FOR UPDATE`;
  const demande = await db.demandeConge.findUnique({ where: { id: p.demandeId }, include: { typeConge: true } });
  if (!demande) throw new RefusAbsence("Demande introuvable.");

  const ctx = await chargerContexteCircuit(db, demande.userId, "CONGE");
  const decideur = decideurPourStatutAbsence(demande.statut, ctx);
  const aujourdhui = formatJourCivil(p.maintenant);
  const r = transitionAbsence({
    nature: "CONGE",
    statut: demande.statut,
    action: p.action,
    acteur: p.acteur,
    demandeurId: demande.userId,
    decideur,
    adebute: comparerJours(aujourdhui, jourCivilDepuisColonneDate(demande.dateDebut)) >= 0,
    peutAnnulerApresDebut: p.peutAnnulerApresDebut,
  });
  if (!r.ok) throw new RefusAbsence(r.erreur);

  // Effets d'abord (débit conditionnel) : un refus annule toute la transaction, statut compris.
  let effets: { soldeCongeId: string | null; joursDebites: number } | null = null;
  if (r.effet === "ACCORDER") effets = await accorderEffets(db, demande);
  if (r.effet === "DEFAIRE_ACCORD") await defaireEffets(db, demande);

  const data: Prisma.DemandeCongeUpdateManyMutationInput & Record<string, unknown> = { statut: r.statut as StatutDemandeConge, etapeDepuis: p.maintenant, dernierRappelAt: null };
  if (r.etape === "RESPONSABLE") {
    data.approuveParId = p.acteur.id;
    data.approuveAt = p.maintenant;
  } else if (r.etape === "RH") {
    data.valideParId = p.acteur.id;
    data.valideAt = p.maintenant;
  }
  if (r.statut === "REJETEE") data.motifRejet = r.motif ?? null;
  if (r.statut === "MODIFICATION_DEMANDEE") data.motifModification = r.motif ?? null;
  if (r.statut === "ANNULEE") {
    data.motifAnnulation = r.motif ?? null;
    data.annuleParId = p.acteur.id;
    data.annuleAt = p.maintenant;
  }
  if (effets) {
    data.soldeCongeId = effets.soldeCongeId;
    data.joursDebites = effets.joursDebites;
  }
  const { count } = await db.demandeConge.updateMany({ where: { id: demande.id, statut: demande.statut }, data });
  if (count === 0) throw new RefusAbsence("Cette demande a déjà été traitée.");

  const action =
    p.action.type === "APPROUVER"
      ? r.statut === "EN_ATTENTE_RH"
        ? ACTION_HISTORIQUE_ABSENCE.APPROUVER_RESPONSABLE
        : r.viaRepli
          ? ACTION_HISTORIQUE_ABSENCE.ACCORDER_PAR_REPLI
          : ACTION_HISTORIQUE_ABSENCE.ACCORDER
      : p.action.type === "REJETER"
        ? ACTION_HISTORIQUE_ABSENCE.REJETER
        : p.action.type === "DEMANDER_MODIFICATION"
          ? ACTION_HISTORIQUE_ABSENCE.DEMANDER_MODIFICATION
          : ACTION_HISTORIQUE_ABSENCE.ANNULER;
  await noterHistorique(db, {
    nature: "CONGE",
    demandeId: demande.id,
    action,
    detail: `${demande.reference} : ${demande.statut} → ${r.statut}${r.motif ? `. Motif : ${r.motif}` : ""}${r.viaRepli ? " (étape responsable remplacée : responsable indisponible)." : ""}`,
    userId: p.acteur.id,
  });

  return {
    id: demande.id,
    reference: demande.reference,
    demandeurId: demande.userId,
    libelleType: demande.typeConge.label,
    ancienStatut: demande.statut,
    statut: r.statut,
    effet: r.effet,
    viaRepli: r.viaRepli === true,
    motif: r.motif,
    destinatairesSuivants: destinatairesEtapeAbsence(r.statut, ctx),
    nbJours: demande.nbJours,
    dateDebut: jourCivilDepuisColonneDate(demande.dateDebut),
    dateFin: jourCivilDepuisColonneDate(demande.dateFin),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Congé d'office (RH)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Congé accordé d'office par la RH : aucun circuit, mais mêmes contrôles de période et de solde, et jamais pour
 * soi-même (personne ne décide sa propre demande). Débit et plages comme à un accord.
 */
export async function accorderCongeOffice(
  db: Db,
  p: { acteurId: string; userId: string; entree: DemandeCongeEntree; maintenant: Date }
): Promise<{ id: string; reference: string; nbJours: number; libelleType: string }> {
  if (p.acteurId === p.userId) throw new RefusAbsence("Vous ne pouvez pas vous accorder un congé d'office.");
  await verrouiller(db, `conge-utilisateur:${p.userId}`);
  const prepare = await preparerConge(db, { userId: p.userId, entree: p.entree, ignorerAnciennete: true, maintenant: p.maintenant });
  await controlerChevauchement(db, { userId: p.userId, debut: prepare.dateDebut, fin: prepare.dateFin });
  await controlerSolde(db, { userId: p.userId, prepare });

  const reference = await genererReferenceAbsence(db, "CONGE", p.maintenant);
  const demande = await db.demandeConge.create({
    data: {
      reference,
      dateDebut: colonneDateDepuisJourCivil(prepare.dateDebut),
      dateFin: colonneDateDepuisJourCivil(prepare.dateFin),
      nbJours: prepare.decompte.nbJours,
      motif: prepare.motif,
      interimaire: prepare.interimaire,
      statut: "VALIDEE",
      etapeResponsableRequise: false,
      etapeDepuis: p.maintenant,
      valideParId: p.acteurId,
      valideAt: p.maintenant,
      userId: p.userId,
      typeCongeId: prepare.type.id,
      piecesJointes: { create: prepare.pieces.map((x) => ({ url: x.url, nomFichier: x.nomFichier ?? null })) },
    },
    include: { typeConge: true },
  });
  const effets = await accorderEffets(db, demande);
  if (effets.soldeCongeId) {
    await db.demandeConge.update({ where: { id: demande.id }, data: { soldeCongeId: effets.soldeCongeId, joursDebites: effets.joursDebites } });
  }
  await noterHistorique(db, {
    nature: "CONGE",
    demandeId: demande.id,
    action: ACTION_HISTORIQUE_ABSENCE.CONGE_OFFICE,
    detail: `${reference} accordé d'office : ${prepare.type.label}, ${prepare.decompte.nbJours} jour(s) du ${prepare.dateDebut} au ${prepare.dateFin}.`,
    userId: p.acteurId,
  });
  return { id: demande.id, reference, nbJours: prepare.decompte.nbJours, libelleType: prepare.type.label };
}

// ---------------------------------------------------------------------------------------------------------------------
// Soldes, dates d'embauche
// ---------------------------------------------------------------------------------------------------------------------

export const MOTIF_AJUSTEMENT_MIN = 5;

/** Ajustement manuel d'un solde (RH) : positif ajoute, négatif retire sans jamais passer sous zéro. Tracé. */
export async function ajusterSolde(
  db: Db,
  p: { soldeCongeId: string; montant: number; motif: string; acteurId: string }
): Promise<{ soldeRestant: number }> {
  if (!Number.isInteger(p.montant) || p.montant === 0) throw new RefusAbsence("Le montant de l'ajustement doit être un entier non nul.", "montant");
  if (Math.abs(p.montant) > 365) throw new RefusAbsence("Ajustement excessif (365 jours au plus).", "montant");
  const motif = nettoyerMotifAbsence(p.motif);
  if (motif.length < MOTIF_AJUSTEMENT_MIN) throw new RefusAbsence(`Le motif doit comporter au moins ${MOTIF_AJUSTEMENT_MIN} caractères.`, "motif");

  const { count } = await db.soldeConge.updateMany({
    where: { id: p.soldeCongeId, ...(p.montant < 0 ? { soldeRestant: { gte: -p.montant } } : {}) },
    data: { soldeRestant: { increment: p.montant } },
  });
  if (count === 0) throw new RefusAbsence("Solde introuvable ou insuffisant pour ce retrait.", "montant");
  await db.ajustementSolde.create({ data: { soldeCongeId: p.soldeCongeId, montant: p.montant, motif, effectueParId: p.acteurId } });
  const solde = await db.soldeConge.findUniqueOrThrow({ where: { id: p.soldeCongeId }, select: { soldeRestant: true, userId: true } });
  await db.historiqueEntry.create({
    data: {
      entity: "SoldeConge",
      entityId: p.soldeCongeId,
      action: ACTION_HISTORIQUE_ABSENCE.AJUSTER_SOLDE,
      detail: `Ajustement de ${p.montant > 0 ? "+" : ""}${p.montant} jour(s) (solde : ${solde.soldeRestant}). Motif : ${motif}`,
      userId: p.acteurId,
    },
  });
  return { soldeRestant: solde.soldeRestant };
}

/**
 * Crée la ligne de solde de l'exercice en cours pour chaque compte actif ayant une date d'embauche et chaque type
 * déductible. Sans effet sur les lignes qui existent (jamais de remise à zéro). Retourne le nombre de lignes créées.
 */
export async function initialiserSoldesExercice(db: Db, p: { reference: JourCivil; acteurId: string }): Promise<{ utilisateurs: number; soldesCrees: number }> {
  const [types, users] = await Promise.all([
    db.typeConge.findMany({ where: { isActive: true, nonDeductibleSolde: false, nbJoursDefaut: { gt: 0 } } }),
    db.user.findMany({ where: { isActive: true, dateEmbauche: { not: null } }, select: { id: true, dateEmbauche: true } }),
  ]);
  let soldesCrees = 0;
  for (const u of users) {
    const exercice = calculerExercice(jourCivilDepuisColonneDate(u.dateEmbauche!), p.reference);
    for (const t of types) {
      const { count } = await db.soldeConge.createMany({
        data: [
          {
            userId: u.id,
            typeCongeId: t.id,
            exercice: exercice.exercice,
            soldeInitial: t.nbJoursDefaut,
            soldeRestant: t.nbJoursDefaut,
            dateDebutExercice: colonneDateDepuisJourCivil(exercice.debut),
            dateFinExercice: colonneDateDepuisJourCivil(exercice.fin),
          },
        ],
        skipDuplicates: true,
      });
      soldesCrees += count;
    }
  }
  await db.historiqueEntry.create({
    data: {
      entity: "SoldeConge",
      entityId: "exercice",
      action: "initialisation_soldes",
      detail: `Soldes de l'exercice en cours initialisés pour ${users.length} compte(s) : ${soldesCrees} ligne(s) créée(s).`,
      userId: p.acteurId,
    },
  });
  return { utilisateurs: users.length, soldesCrees };
}

/** Date d'embauche d'un compte (RH). Les soldes déjà créés ne sont pas touchés ; les congés suivants suivent la nouvelle date. */
export async function modifierDateEmbauche(db: Db, p: { userId: string; date: JourCivil | null; acteurId: string }): Promise<void> {
  if (p.date !== null) {
    if (!parseJourCivil(p.date)) throw new RefusAbsence("Date d'embauche invalide.", "date");
    if (comparerJours(p.date, formatJourCivil(new Date())) > 0) throw new RefusAbsence("La date d'embauche ne peut pas être dans le futur.", "date");
    if (comparerJours(p.date, "1970-01-01") < 0) throw new RefusAbsence("Date d'embauche invalide.", "date");
  }
  const avant = await db.user.findUnique({ where: { id: p.userId }, select: { dateEmbauche: true, fullName: true } });
  if (!avant) throw new RefusAbsence("Compte introuvable.");
  await db.user.update({ where: { id: p.userId }, data: { dateEmbauche: p.date ? colonneDateDepuisJourCivil(p.date) : null } });
  await db.historiqueEntry.create({
    data: {
      entity: "User",
      entityId: p.userId,
      action: "modification_date_embauche",
      detail: `Date d'embauche de ${avant.fullName} : ${avant.dateEmbauche ? jourCivilDepuisColonneDate(avant.dateEmbauche) : "non renseignée"} → ${p.date ?? "non renseignée"}.`,
      userId: p.acteurId,
    },
  });
}

export type { ParcoursAbsence };

// Réutilisés par la couche des permissions d'absence (`permissionsDb.ts`) : même verrou consultatif, même historique.
export const verrouillerAbsence = verrouiller;
export const noterHistoriqueAbsence = noterHistorique;
