// Congés — application en base (module simplifié, 2026-10-19). Toujours dans la transaction de l'appelant.
//
// Les règles sont dans `congesCalcul.ts` (jours ouvrés, chevauchement) et `circuitConge.ts` (qui décide, quelle transition) :
// ce fichier ne fait que LIRE le contexte et ÉCRIRE le résultat, avec ces garanties :
//   - chaque changement de statut est un `updateMany` conditionné au statut lu, sous un verrou de ligne sur la demande
//     (`SELECT … FOR UPDATE`) puis le verrou du collaborateur (ordre constant : ligne, collaborateur, référence) ;
//   - la référence est calculée sous un verrou consultatif du mois, dans la transaction de création ;
//   - R10 : à la soumission une plage d'absence autorisée par jour de la période est posée `provisoire` (la journée n'est jamais
//     une absence), elle devient définitive à la validation, est supprimée au refus, à l'annulation, et remplacée à la resoumission.
// Un refus métier en cours d'écriture est une `RefusConge` : la transaction est annulée en entier (`transactionConge`),
// aucune écriture partielle ne subsiste.

import { prisma } from "./prisma";
import type { Prisma } from "./generated/prisma/client";
import type { NatureConge, StatutDemandeConge } from "./generated/prisma/enums";
import { dateDebutAbsences } from "./absencesDebut";
import {
  ACTION_HISTORIQUE_CONGE,
  MOTIF_CONGE_MAX,
  MOTIF_CONGE_MIN,
  PERMISSION_DG_CONGE,
  PERMISSION_ETAPE_RH_CONGE,
  STATUTS_CONGE_OCCUPANT_LA_PERIODE,
  controlerObservationRH,
  decideurPourStatutConge,
  destinatairesEtapeConge,
  nettoyerMotifConge,
  resoudreParcoursConge,
  transitionConge,
  type ActeurConge,
  type ContexteCircuitConge,
  type StatutCircuitConge,
} from "./circuitConge";
import {
  ajouterJours,
  colonneDateDepuisJourCivil,
  comparerJours,
  decompterJours,
  formatJourCivil,
  jourCivilDepuisColonneDate,
  MAX_JOURS_PERIODE,
  parseJourCivil,
  premierChevauchement,
  type DecompteJours,
  type JourCivil,
} from "./congesCalcul";
import { refusDateDebutPassee } from "./congesPasse";

export type Db = Prisma.TransactionClient;

/** Refus métier levé PENDANT une transaction : tout ce qui a été écrit avant est annulé. */
export class RefusConge extends Error {
  constructor(
    message: string,
    readonly champ?: string
  ) {
    super(message);
    this.name = "RefusConge";
  }
}

export type ResultatConge<T> = { ok: true; valeur: T } | { ok: false; erreur: string; champ?: string };

/** Exécute `fn` dans une transaction ; un `RefusConge` annule tout et revient en `{ ok: false }`. */
export async function transactionConge<T>(fn: (tx: Db) => Promise<T>): Promise<ResultatConge<T>> {
  try {
    const valeur = await prisma.$transaction(fn, { maxWait: 10_000, timeout: 30_000 });
    return { ok: true, valeur };
  } catch (e) {
    if (e instanceof RefusConge) return { ok: false, erreur: e.message, champ: e.champ };
    throw e;
  }
}

async function verrouiller(db: Db, cle: string): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${cle})::bigint)`;
}

/**
 * Verrou UNIQUE par collaborateur : protège le contrôle de chevauchement contre deux soumissions simultanées (dont une saisie
 * de la RH pour le même salarié). À prendre AVANT tout contrôle de chevauchement et toute écriture qui change ce qu'il lit.
 */
export async function verrouillerCongeUtilisateur(db: Db, userId: string): Promise<void> {
  await verrouiller(db, `conge-utilisateur:${userId}`);
}

async function verrouillerLigneDemande(db: Db, demandeId: string): Promise<void> {
  await db.$executeRaw`SELECT id FROM "DemandeConge" WHERE id = ${demandeId} FOR UPDATE`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Références
// ---------------------------------------------------------------------------------------------------------------------

/** `CNG-AAAAMM-NNNN`, calculée SOUS VERROU dans la transaction de création. */
export async function genererReferenceConge(db: Db, maintenant: Date): Promise<string> {
  const mois = `${maintenant.getFullYear()}${String(maintenant.getMonth() + 1).padStart(2, "0")}`;
  const debut = `CNG-${mois}-`;
  await verrouiller(db, `reference:CNG-${mois}`);
  const existantes = await db.demandeConge.findMany({ where: { reference: { startsWith: debut } }, select: { reference: true } });
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

export async function chargerContexteCircuit(db: Db, demandeurId: string): Promise<ContexteCircuitConge> {
  const [demandeur, comptesRH, comptesDG] = await Promise.all([
    db.user.findUnique({
      where: { id: demandeurId },
      select: { service: { select: { name: true, responsableId: true, responsable: { select: { isActive: true } } } } },
    }),
    comptesActifsAvecPermission(db, PERMISSION_ETAPE_RH_CONGE),
    comptesActifsAvecPermission(db, PERMISSION_DG_CONGE),
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
// Jours fériés, plages d'absence autorisée (R10)
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
export async function creerPlagesConge(
  db: Db,
  p: { userId: string; demandeId: string; reference: string; jours: readonly JourCivil[]; provisoire: boolean }
): Promise<void> {
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
      provisoire: p.provisoire,
    };
  });
  if (data.length > 0) await db.plageAbsenceAutorisee.createMany({ data });
}

/**
 * Supprime les plages de la demande (par clé, jamais par plage de dates ni par texte). `aPartirDe` : seulement celles de ce jour
 * et des suivants (annulation d'un congé commencé : les jours déjà vécus restent couverts). Renvoie le nombre supprimé.
 */
export async function supprimerPlages(db: Db, p: { demandeId: string; aPartirDe?: JourCivil }): Promise<number> {
  const debut = p.aPartirDe ? parseJourCivil(p.aPartirDe) : null;
  const { count } = await db.plageAbsenceAutorisee.deleteMany({
    where: { demandeCongeId: p.demandeId, ...(debut ? { date: { gte: debut } } : {}) },
  });
  return count;
}

/** Resoumission : les plages de l'ancienne période sont remplacées par celles de la nouvelle, de nouveau provisoires. */
export async function remplacerPlages(
  db: Db,
  p: { userId: string; demandeId: string; reference: string; jours: readonly JourCivil[]; provisoire: boolean }
): Promise<void> {
  await supprimerPlages(db, { demandeId: p.demandeId });
  await creerPlagesConge(db, p);
}

/** Validation : les plages provisoires de la demande deviennent définitives. */
async function validerPlages(db: Db, demandeId: string): Promise<void> {
  await db.plageAbsenceAutorisee.updateMany({ where: { demandeCongeId: demandeId }, data: { provisoire: false } });
}

// ---------------------------------------------------------------------------------------------------------------------
// Contrôles communs à la soumission, à la resoumission et à la saisie RH
// ---------------------------------------------------------------------------------------------------------------------

export interface EntreeConge {
  nature: NatureConge;
  motif: string;
  dateDebut: JourCivil;
  dateFin: JourCivil;
}

interface CongePrepare {
  nature: NatureConge;
  motif: string;
  dateDebut: JourCivil;
  dateFin: JourCivil;
  decompte: DecompteJours;
}

const NATURES: readonly NatureConge[] = ["CONGE", "PERMISSION_EXCEPTIONNELLE"];

/**
 * R1 à R4 : nature, motif nettoyé (3 à 500 caractères), période en jours entiers (début ≤ fin, jamais dans le passé, 366 jours au
 * plus) et au moins un jour ouvré. Aucune exception pour la RH : pas de date passée non plus à la saisie (R3).
 */
async function preparerConge(db: Db, p: { userId: string; entree: EntreeConge; maintenant: Date }): Promise<CongePrepare> {
  const { entree } = p;
  const user = await db.user.findUnique({ where: { id: p.userId }, select: { isActive: true } });
  if (!user || !user.isActive) throw new RefusConge("Compte introuvable ou désactivé.");

  if (!NATURES.includes(entree.nature)) throw new RefusConge("Nature de la demande invalide.", "nature");
  if (!parseJourCivil(entree.dateDebut)) throw new RefusConge("Date de début invalide.", "dateDebut");
  if (!parseJourCivil(entree.dateFin)) throw new RefusConge("Date de fin invalide.", "dateFin");
  if (comparerJours(entree.dateFin, entree.dateDebut) < 0) {
    throw new RefusConge("La date de fin ne peut pas être antérieure à la date de début.", "dateFin");
  }
  const passe = refusDateDebutPassee(entree.dateDebut, formatJourCivil(p.maintenant));
  if (passe) throw new RefusConge(passe, "dateDebut");
  if (comparerJours(entree.dateFin, ajouterJours(entree.dateDebut, MAX_JOURS_PERIODE - 1)) > 0) {
    throw new RefusConge(`La période ne peut pas dépasser ${MAX_JOURS_PERIODE} jours.`, "dateFin");
  }

  const motif = nettoyerMotifConge(entree.motif ?? "");
  if (motif.length < MOTIF_CONGE_MIN) throw new RefusConge(`Le motif doit comporter au moins ${MOTIF_CONGE_MIN} caractères.`, "motif");
  if (motif.length > MOTIF_CONGE_MAX) throw new RefusConge(`Le motif ne doit pas dépasser ${MOTIF_CONGE_MAX} caractères.`, "motif");

  const feries = await lireJoursFeries(db, entree.dateDebut, entree.dateFin);
  const decompte = decompterJours({ debut: entree.dateDebut, fin: entree.dateFin, joursFeries: feries });
  if (decompte.nbJoursOuvres <= 0) throw new RefusConge("La période sélectionnée ne comporte aucun jour ouvré.", "dateDebut");

  return { nature: entree.nature, motif, dateDebut: entree.dateDebut, dateFin: entree.dateFin, decompte };
}

/** R5 : refus si une autre demande en cours (ou à modifier) ou validée du même salarié chevauche la période. */
async function controlerChevauchement(db: Db, p: { userId: string; debut: JourCivil; fin: JourCivil; exclureDemandeId?: string }) {
  const existants = await db.demandeConge.findMany({
    where: {
      userId: p.userId,
      statut: { in: [...STATUTS_CONGE_OCCUPANT_LA_PERIODE] as StatutDemandeConge[] },
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
    throw new RefusConge(`Une demande en cours ou validée couvre déjà cette période (${ref}).`, "dateDebut");
  }
}

async function noterHistorique(db: Db, p: { demandeId: string; action: string; detail: string; userId: string }) {
  await db.historiqueEntry.create({
    data: { entity: "DemandeConge", entityId: p.demandeId, action: p.action, detail: p.detail, userId: p.userId },
  });
}

/** Aperçu sans écriture (formulaire) : jours ouvrés et chevauchement, avec exactement les contrôles de la soumission. */
export async function apercuConge(
  db: Db,
  p: { userId: string; entree: EntreeConge; maintenant: Date; exclureDemandeId?: string }
): Promise<{ nbJoursOuvres: number; joursFeriesInclus: JourCivil[] }> {
  const prepare = await preparerConge(db, p);
  await controlerChevauchement(db, { userId: p.userId, debut: prepare.dateDebut, fin: prepare.dateFin, exclureDemandeId: p.exclureDemandeId });
  return { nbJoursOuvres: prepare.decompte.nbJoursOuvres, joursFeriesInclus: prepare.decompte.joursFeriesInclus };
}

// ---------------------------------------------------------------------------------------------------------------------
// Soumission, resoumission
// ---------------------------------------------------------------------------------------------------------------------

export interface SoumissionConge {
  id: string;
  reference: string;
  statut: StatutCircuitConge;
  nbJoursOuvres: number;
  /** Comptes à prévenir (le responsable, ou la RH, ou le DG) : calculés avec le contexte lu dans la transaction. */
  destinataires: string[];
}

function libelleNature(nature: NatureConge): string {
  return nature === "CONGE" ? "Congé" : "Permission exceptionnelle";
}

export async function soumettreConge(db: Db, p: { userId: string; entree: EntreeConge; maintenant: Date }): Promise<SoumissionConge> {
  await verrouillerCongeUtilisateur(db, p.userId);
  const prepare = await preparerConge(db, p);
  await controlerChevauchement(db, { userId: p.userId, debut: prepare.dateDebut, fin: prepare.dateFin });

  const ctx = await chargerContexteCircuit(db, p.userId);
  const parcours = resoudreParcoursConge(ctx);
  if (!parcours.ok) throw new RefusConge(parcours.erreur);

  const reference = await genererReferenceConge(db, p.maintenant);
  const demande = await db.demandeConge.create({
    data: {
      reference,
      nature: prepare.nature,
      motif: prepare.motif,
      dateDebut: colonneDateDepuisJourCivil(prepare.dateDebut),
      dateFin: colonneDateDepuisJourCivil(prepare.dateFin),
      nbJoursOuvres: prepare.decompte.nbJoursOuvres,
      statut: parcours.premierStatut,
      etapeResponsableRequise: parcours.etapeResponsable.requise,
      etapeDepuis: p.maintenant,
      userId: p.userId,
      creeParId: p.userId,
    },
  });
  await creerPlagesConge(db, { userId: p.userId, demandeId: demande.id, reference, jours: prepare.decompte.jours, provisoire: true });
  await noterHistorique(db, {
    demandeId: demande.id,
    action: ACTION_HISTORIQUE_CONGE.SOUMETTRE,
    detail: `${reference} : ${libelleNature(prepare.nature)}, ${prepare.decompte.nbJoursOuvres} jour(s) ouvré(s) du ${prepare.dateDebut} au ${prepare.dateFin}.`,
    userId: p.userId,
  });
  return {
    id: demande.id,
    reference,
    statut: parcours.premierStatut,
    nbJoursOuvres: prepare.decompte.nbJoursOuvres,
    destinataires: destinatairesEtapeConge(parcours.premierStatut, ctx),
  };
}

/**
 * R8 : le demandeur renvoie sa demande après une demande de modification. Nature, motif et dates sont recontrôlés (R2 à R5), le
 * circuit repart de la première étape applicable (parcours recalculé), les décisions précédentes sont effacées (l'historique
 * les garde) et les plages sont remplacées.
 */
export async function resoumettreConge(
  db: Db,
  p: { demandeId: string; acteurId: string; entree: EntreeConge; maintenant: Date }
): Promise<SoumissionConge> {
  await verrouillerLigneDemande(db, p.demandeId);
  const demande = await db.demandeConge.findUnique({ where: { id: p.demandeId } });
  if (!demande) throw new RefusConge("Demande introuvable.");
  await verrouillerCongeUtilisateur(db, demande.userId);

  const ctx = await chargerContexteCircuit(db, demande.userId);
  const parcours = resoudreParcoursConge(ctx);
  if (!parcours.ok) throw new RefusConge(parcours.erreur);
  const r = transitionConge({
    statut: demande.statut,
    action: { type: "RESOUMETTRE", premierStatut: parcours.premierStatut },
    acteur: { id: p.acteurId, rolePermissions: [] },
    demandeurId: demande.userId,
    decideur: null,
  });
  if (!r.ok) throw new RefusConge(r.erreur);

  const prepare = await preparerConge(db, { userId: demande.userId, entree: p.entree, maintenant: p.maintenant });
  await controlerChevauchement(db, { userId: demande.userId, debut: prepare.dateDebut, fin: prepare.dateFin, exclureDemandeId: demande.id });

  const { count } = await db.demandeConge.updateMany({
    where: { id: demande.id, statut: "MODIFICATION_DEMANDEE" },
    data: {
      statut: parcours.premierStatut,
      etapeResponsableRequise: parcours.etapeResponsable.requise,
      etapeDepuis: p.maintenant,
      dernierRappelAt: null,
      nature: prepare.nature,
      motif: prepare.motif,
      dateDebut: colonneDateDepuisJourCivil(prepare.dateDebut),
      dateFin: colonneDateDepuisJourCivil(prepare.dateFin),
      nbJoursOuvres: prepare.decompte.nbJoursOuvres,
      motifModification: null,
      observationRH: null,
      approuveParId: null,
      approuveAt: null,
      valideParId: null,
      valideAt: null,
    },
  });
  if (count === 0) throw new RefusConge("Cette demande a déjà été traitée.");
  await remplacerPlages(db, { userId: demande.userId, demandeId: demande.id, reference: demande.reference, jours: prepare.decompte.jours, provisoire: true });
  await noterHistorique(db, {
    demandeId: demande.id,
    action: ACTION_HISTORIQUE_CONGE.RESOUMETTRE,
    detail: `${demande.reference} renvoyée : ${libelleNature(prepare.nature)}, ${prepare.decompte.nbJoursOuvres} jour(s) ouvré(s) du ${prepare.dateDebut} au ${prepare.dateFin}.`,
    userId: p.acteurId,
  });
  return {
    id: demande.id,
    reference: demande.reference,
    statut: parcours.premierStatut,
    nbJoursOuvres: prepare.decompte.nbJoursOuvres,
    destinataires: destinatairesEtapeConge(parcours.premierStatut, ctx),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Décision, annulation
// ---------------------------------------------------------------------------------------------------------------------

export type ActionDecisionConge =
  | { type: "APPROUVER"; observationRH?: string | null }
  | { type: "REJETER"; motif: string; compterJoursPassesAbsents?: boolean; observationRH?: string | null }
  | { type: "DEMANDER_MODIFICATION"; motif: string; observationRH?: string | null }
  | { type: "ANNULER"; motif: string };

export interface DecisionConge {
  id: string;
  reference: string;
  demandeurId: string;
  ancienStatut: StatutCircuitConge;
  statut: StatutCircuitConge;
  viaRepli: boolean;
  motif?: string;
  observationRH: string | null;
  /** Comptes à prévenir de l'étape suivante (vide si la demande n'attend plus rien). */
  destinatairesSuivants: string[];
  /** Absences « à contrôler » créées par un refus tardif dont la RH a choisi de compter les jours passés (R11). */
  absencesCreees: number;
  nbJoursOuvres: number;
  dateDebut: JourCivil;
  dateFin: JourCivil;
}

/** Date de départ de la tâche des absences (R11) : la même règle que le planificateur (`dateDebutAbsences`). */
export async function lireDateDebutAbsences(db: Db): Promise<Date> {
  const [dernierePurge, miseEnService] = await Promise.all([
    db.reinitialisationPointage.findFirst({ orderBy: { effectueeAt: "desc" }, select: { effectueeAt: true } }),
    db.pointageMiseEnService.findFirst({ select: { misEnServiceAt: true } }),
  ]);
  return dateDebutAbsences({
    systemStartDate: new Date(process.env.SYSTEM_START_DATE || "2026-09-07"),
    dernierePurge: dernierePurge?.effectueeAt,
    miseEnService: miseEnService?.misEnServiceAt,
  });
}

/**
 * R11 : crée une `Absence` « à contrôler » pour chaque jour ouvré de `[debut, fin]` sans pointage d'ARRIVÉE, postérieur ou égal
 * à la date de départ de la tâche des absences, et sans absence déjà enregistrée. Renvoie le nombre créé.
 */
async function compterJoursPassesAbsents(
  db: Db,
  p: { userId: string; reference: string; debut: JourCivil; fin: JourCivil }
): Promise<number> {
  if (comparerJours(p.fin, p.debut) < 0) return 0;
  const feries = await lireJoursFeries(db, p.debut, p.fin);
  const { joursOuvres } = decompterJours({ debut: p.debut, fin: p.fin, joursFeries: feries });
  if (joursOuvres.length === 0) return 0;
  const plancher = formatJourCivil(await lireDateDebutAbsences(db));
  const candidats = joursOuvres.filter((j) => comparerJours(j, plancher) >= 0);
  if (candidats.length === 0) return 0;

  const debutPeriode = parseJourCivil(candidats[0])!;
  const finPeriode = parseJourCivil(candidats[candidats.length - 1])!;
  const finPeriodeInclus = new Date(finPeriode.getFullYear(), finPeriode.getMonth(), finPeriode.getDate(), 23, 59, 59, 999);
  const [pointages, absences] = await Promise.all([
    db.pointage.findMany({ where: { userId: p.userId, type: "ARRIVEE", heure: { gte: debutPeriode, lte: finPeriodeInclus } }, select: { heure: true } }),
    db.absence.findMany({ where: { userId: p.userId, date: { gte: debutPeriode, lte: finPeriodeInclus } }, select: { date: true } }),
  ]);
  const pointes = new Set(pointages.map((x) => formatJourCivil(x.heure)));
  const deja = new Set(absences.map((x) => formatJourCivil(x.date)));
  const aCreer = candidats.filter((j) => !pointes.has(j) && !deja.has(j));
  if (aCreer.length === 0) return 0;
  await db.absence.createMany({
    data: aCreer.map((j) => {
      const d = parseJourCivil(j)!;
      return {
        userId: p.userId,
        date: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
        statut: "A_CONTROLER" as const,
        motif: `Congé ${p.reference} refusé : jour déjà passé compté comme absence.`,
      };
    }),
  });
  return aCreer.length;
}

export async function deciderConge(
  db: Db,
  p: {
    demandeId: string;
    acteur: ActeurConge;
    action: ActionDecisionConge;
    /** L'acteur porte `conges.annuler` (annule même après le début). */
    peutAnnulerApresDebut: boolean;
    maintenant: Date;
  }
): Promise<DecisionConge> {
  // Verrou de ligne : deux décisions simultanées sur la même demande s'enchaînent, la seconde voit le nouveau statut.
  await verrouillerLigneDemande(db, p.demandeId);
  const demande = await db.demandeConge.findUnique({ where: { id: p.demandeId } });
  if (!demande) throw new RefusConge("Demande introuvable.");
  await verrouillerCongeUtilisateur(db, demande.userId);

  const ctx = await chargerContexteCircuit(db, demande.userId);
  const decideur = decideurPourStatutConge(demande.statut, ctx);
  const aujourdhui = formatJourCivil(p.maintenant);
  const debut = jourCivilDepuisColonneDate(demande.dateDebut);
  const fin = jourCivilDepuisColonneDate(demande.dateFin);
  const adebute = comparerJours(aujourdhui, debut) >= 0;
  const a = p.action;
  const r = transitionConge({
    statut: demande.statut,
    action: a.type === "APPROUVER" ? { type: "APPROUVER" } : a,
    acteur: p.acteur,
    demandeurId: demande.userId,
    decideur,
    adebute,
    peutAnnulerApresDebut: p.peutAnnulerApresDebut,
  });
  if (!r.ok) throw new RefusConge(r.erreur);

  const obs = controlerObservationRH(a.type === "ANNULER" ? null : a.observationRH, r.etape);
  if (!obs.ok) throw new RefusConge(obs.erreur, "observationRH");

  // R10 : effets sur les plages (dans la transaction : un refus plus loin annule tout).
  if (r.effet === "VALIDER") await validerPlages(db, demande.id);
  if (a.type === "REJETER") await supprimerPlages(db, { demandeId: demande.id });
  if (a.type === "ANNULER") await supprimerPlages(db, { demandeId: demande.id, ...(adebute ? { aPartirDe: ajouterJours(aujourdhui, 1) } : {}) });

  // R11 : refus après la date de début, la RH ou le responsable choisit de compter (ou non) les jours déjà passés comme absences.
  let joursPasses: boolean | null = null;
  let absencesCreees = 0;
  if (a.type === "REJETER" && comparerJours(debut, aujourdhui) < 0) {
    joursPasses = a.compterJoursPassesAbsents === true;
    if (joursPasses) {
      const hier = ajouterJours(aujourdhui, -1);
      absencesCreees = await compterJoursPassesAbsents(db, {
        userId: demande.userId,
        reference: demande.reference,
        debut,
        fin: comparerJours(fin, hier) < 0 ? fin : hier,
      });
    }
  }

  const data: Prisma.DemandeCongeUpdateManyMutationInput & Record<string, unknown> = {
    statut: r.statut as StatutDemandeConge,
    etapeDepuis: p.maintenant,
    dernierRappelAt: null,
  };
  if (r.etape === "RESPONSABLE") {
    data.approuveParId = p.acteur.id;
    data.approuveAt = p.maintenant;
  } else if (r.etape === "RH") {
    data.valideParId = p.acteur.id;
    data.valideAt = p.maintenant;
  }
  if (obs.texte) data.observationRH = obs.texte;
  if (r.statut === "REJETEE") data.motifRejet = r.motif ?? null;
  if (r.statut === "MODIFICATION_DEMANDEE") data.motifModification = r.motif ?? null;
  if (r.statut === "ANNULEE") {
    data.motifAnnulation = r.motif ?? null;
    data.annuleParId = p.acteur.id;
    data.annuleAt = p.maintenant;
  }
  if (joursPasses !== null) data.joursPassesComptesAbsents = joursPasses;
  const { count } = await db.demandeConge.updateMany({ where: { id: demande.id, statut: demande.statut }, data });
  if (count === 0) throw new RefusConge("Cette demande a déjà été traitée.");

  const action =
    a.type === "APPROUVER"
      ? r.statut === "EN_ATTENTE_RH"
        ? ACTION_HISTORIQUE_CONGE.APPROUVER_RESPONSABLE
        : r.viaRepli
          ? ACTION_HISTORIQUE_CONGE.ACCORDER_PAR_REPLI
          : ACTION_HISTORIQUE_CONGE.ACCORDER
      : a.type === "REJETER"
        ? ACTION_HISTORIQUE_CONGE.REJETER
        : a.type === "DEMANDER_MODIFICATION"
          ? ACTION_HISTORIQUE_CONGE.DEMANDER_MODIFICATION
          : ACTION_HISTORIQUE_CONGE.ANNULER;
  await noterHistorique(db, {
    demandeId: demande.id,
    action,
    detail: `${demande.reference} : ${demande.statut} → ${r.statut}${r.motif ? `. Motif : ${r.motif}` : ""}${r.viaRepli ? " (étape responsable remplacée : responsable indisponible)." : ""}${obs.texte ? ` Observation RH : ${obs.texte}` : ""}`,
    userId: p.acteur.id,
  });
  if (joursPasses !== null) {
    await noterHistorique(db, {
      demandeId: demande.id,
      action: ACTION_HISTORIQUE_CONGE.JOURS_PASSES,
      detail: joursPasses
        ? `${demande.reference} : jours déjà passés comptés comme absences (${absencesCreees} absence(s) à contrôler créée(s)).`
        : `${demande.reference} : jours déjà passés NON comptés comme absences.`,
      userId: p.acteur.id,
    });
  }

  return {
    id: demande.id,
    reference: demande.reference,
    demandeurId: demande.userId,
    ancienStatut: demande.statut,
    statut: r.statut,
    viaRepli: r.viaRepli === true,
    motif: r.motif,
    observationRH: obs.texte,
    destinatairesSuivants: destinatairesEtapeConge(r.statut, ctx),
    absencesCreees,
    nbJoursOuvres: demande.nbJoursOuvres,
    dateDebut: debut,
    dateFin: fin,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Saisie RH (R12)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * R12 : la RH enregistre un congé pour un autre salarié (jamais pour elle-même) : statut VALIDEE directement, plages définitives,
 * mêmes contrôles R2 à R5 que la soumission. L'appelant a déjà contrôlé `conges.valider_rh` sur le rôle.
 */
export async function saisirCongeRH(
  db: Db,
  p: { acteurId: string; userId: string; entree: EntreeConge; maintenant: Date }
): Promise<{ id: string; reference: string; nbJoursOuvres: number }> {
  if (p.acteurId === p.userId) throw new RefusConge("Vous ne pouvez pas enregistrer un congé pour vous-même.");
  await verrouillerCongeUtilisateur(db, p.userId);
  const prepare = await preparerConge(db, { userId: p.userId, entree: p.entree, maintenant: p.maintenant });
  await controlerChevauchement(db, { userId: p.userId, debut: prepare.dateDebut, fin: prepare.dateFin });

  const reference = await genererReferenceConge(db, p.maintenant);
  const demande = await db.demandeConge.create({
    data: {
      reference,
      nature: prepare.nature,
      motif: prepare.motif,
      dateDebut: colonneDateDepuisJourCivil(prepare.dateDebut),
      dateFin: colonneDateDepuisJourCivil(prepare.dateFin),
      nbJoursOuvres: prepare.decompte.nbJoursOuvres,
      statut: "VALIDEE",
      etapeResponsableRequise: false,
      saisieParRH: true,
      etapeDepuis: p.maintenant,
      userId: p.userId,
      creeParId: p.acteurId,
      valideParId: p.acteurId,
      valideAt: p.maintenant,
    },
  });
  await creerPlagesConge(db, { userId: p.userId, demandeId: demande.id, reference, jours: prepare.decompte.jours, provisoire: false });
  await noterHistorique(db, {
    demandeId: demande.id,
    action: ACTION_HISTORIQUE_CONGE.SAISIE_RH,
    detail: `${reference} enregistré par la RH : ${libelleNature(prepare.nature)}, ${prepare.decompte.nbJoursOuvres} jour(s) ouvré(s) du ${prepare.dateDebut} au ${prepare.dateFin}.`,
    userId: p.acteurId,
  });
  return { id: demande.id, reference, nbJoursOuvres: prepare.decompte.nbJoursOuvres };
}
