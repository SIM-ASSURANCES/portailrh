// Congés — application en base (module simplifié, 2026-10-19). Toujours dans la transaction de l'appelant.
//
// Les règles sont dans `congesCalcul.ts` (jours ouvrés, chevauchement) et `circuitConge.ts` (qui décide, quelle transition) :
// ce fichier ne fait que LIRE le contexte et ÉCRIRE le résultat, avec ces garanties :
//   - chaque changement de statut est un `updateMany` conditionné au statut lu, sous un verrou de ligne sur la demande
//     (`SELECT … FOR UPDATE`) puis le verrou du collaborateur (ordre constant : ligne, collaborateur, référence) ;
//   - la référence est calculée sous un verrou consultatif du mois, dans la transaction de création ;
//   - R10 : à la soumission une plage d'absence autorisée par jour de la période est posée `provisoire` (la journée n'est jamais
//     une absence), elle devient définitive à la validation, est retirée au refus, à la demande de modification (O4) et à
//     l'annulation, et remplacée à la resoumission ;
//   - JOURS DÉJÀ PASSÉS : une plage d'un jour antérieur à aujourd'hui n'est JAMAIS retirée, sauf refus tardif avec la case
//     « compter les jours passés » cochée (R11, qui crée alors les absences). Raison : la tâche des absences réexamine la veille ;
//     retirer la plage d'hier ferait créer l'absence que le décideur a choisi de ne pas compter. L'état affiché d'un tel jour
//     passe par `etatPlageConge` (circuitConge.ts), jamais par le seul champ `provisoire`.
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
  estJourOuvre,
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
 * et des suivants (les jours antérieurs restent couverts). `avant` : seulement celles des jours antérieurs à ce jour (refus
 * tardif, case cochée). Renvoie le nombre supprimé.
 */
export async function supprimerPlages(db: Db, p: { demandeId: string; aPartirDe?: JourCivil; avant?: JourCivil }): Promise<number> {
  const debut = p.aPartirDe ? parseJourCivil(p.aPartirDe) : null;
  const fin = p.avant ? parseJourCivil(p.avant) : null;
  const { count } = await db.plageAbsenceAutorisee.deleteMany({
    where: { demandeCongeId: p.demandeId, ...(debut || fin ? { date: { ...(debut ? { gte: debut } : {}), ...(fin ? { lt: fin } : {}) } } : {}) },
  });
  return count;
}

/** Jours (civils) des plages de la demande antérieurs à `aujourdhui` : les jours qu'elle a protégés jusqu'ici. */
export async function joursPassesProteges(db: Db, p: { demandeId: string; aujourdhui: JourCivil }): Promise<JourCivil[]> {
  const plages = await db.plageAbsenceAutorisee.findMany({
    where: { demandeCongeId: p.demandeId, date: { lt: parseJourCivil(p.aujourdhui)! } },
    select: { date: true },
    orderBy: { date: "asc" },
  });
  return plages.map((x) => formatJourCivil(x.date));
}

/**
 * Resoumission : les plages d'aujourd'hui et des jours suivants sont remplacées par celles de la nouvelle période (qui ne commence
 * jamais avant aujourd'hui), de nouveau provisoires. Les jours déjà passés gardent leur plage (voir l'en-tête du fichier).
 */
export async function remplacerPlages(
  db: Db,
  p: { userId: string; demandeId: string; reference: string; jours: readonly JourCivil[]; provisoire: boolean; aujourdhui: JourCivil }
): Promise<void> {
  await supprimerPlages(db, { demandeId: p.demandeId, aPartirDe: p.aujourdhui });
  await creerPlagesConge(db, { ...p, jours: p.jours.filter((j) => comparerJours(j, p.aujourdhui) >= 0) });
}

/**
 * Validation : les plages de la PÉRIODE de la demande deviennent définitives. Un jour passé d'une ancienne période (demande
 * renvoyée avec d'autres dates) reste provisoire : il a été protégé, il n'est pas un congé validé.
 */
async function validerPlages(db: Db, p: { demandeId: string; debut: JourCivil; fin: JourCivil }): Promise<void> {
  const fin = parseJourCivil(p.fin)!;
  await db.plageAbsenceAutorisee.updateMany({
    where: {
      demandeCongeId: p.demandeId,
      date: { gte: parseJourCivil(p.debut)!, lte: new Date(fin.getFullYear(), fin.getMonth(), fin.getDate(), 23, 59, 59, 999) },
    },
    data: { provisoire: false },
  });
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
  await remplacerPlages(db, {
    userId: demande.userId,
    demandeId: demande.id,
    reference: demande.reference,
    jours: prepare.decompte.jours,
    provisoire: true,
    aujourdhui: formatJourCivil(p.maintenant),
  });
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
 * Jour d'entrée en vigueur du compte pour les absences : sa création, ou sa dernière (ré)activation si elle est plus récente. Même
 * règle que la tâche des absences (« Option B ») : aucune absence ce jour-là ni avant.
 */
async function jourEntreeEnVigueur(db: Db, userId: string, creeLe: Date): Promise<JourCivil> {
  const activation = await db.historiqueEntry.findFirst({
    where: { entity: "User", entityId: userId, action: { in: ["ACTIVATE", "INVITATION_ACTIVATED"] } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return formatJourCivil(activation && activation.createdAt > creeLe ? activation.createdAt : creeLe);
}

/**
 * R11 : crée une `Absence` « à contrôler » pour chaque jour de `jours` (les jours passés que la demande protégeait) qui est un
 * jour ouvré, sans pointage d'ARRIVÉE, sans absence déjà enregistrée, en respectant les règles de la tâche des absences : date de
 * départ (`dateDebutAbsences`), compte actif, et jamais le jour de création ou de (ré)activation du compte ni avant.
 * Renvoie le nombre créé.
 */
async function compterJoursPassesAbsents(db: Db, p: { userId: string; reference: string; jours: readonly JourCivil[] }): Promise<number> {
  if (p.jours.length === 0) return 0;
  const user = await db.user.findUnique({ where: { id: p.userId }, select: { isActive: true, createdAt: true } });
  if (!user || !user.isActive) return 0;
  const premier = p.jours[0];
  const dernier = p.jours[p.jours.length - 1];
  const feries = await lireJoursFeries(db, premier, dernier);
  const plancher = formatJourCivil(await lireDateDebutAbsences(db));
  const entree = await jourEntreeEnVigueur(db, p.userId, user.createdAt);
  const candidats = p.jours.filter(
    (j) => estJourOuvre(j, feries) && comparerJours(j, plancher) >= 0 && comparerJours(j, entree) > 0
  );
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

  // R10, O4 : effets sur les plages (dans la transaction : un refus plus loin annule tout). Les jours déjà passés gardent leur
  // plage (voir l'en-tête) ; une annulation après le début garde aussi celle du jour même (le jour est entamé).
  const passes = a.type === "REJETER" ? await joursPassesProteges(db, { demandeId: demande.id, aujourdhui }) : [];
  if (r.effet === "VALIDER") await validerPlages(db, { demandeId: demande.id, debut, fin });
  if (r.effet === "SUPPRIMER_PLAGES") {
    const aPartirDe = a.type === "ANNULER" && adebute ? ajouterJours(aujourdhui, 1) : aujourdhui;
    await supprimerPlages(db, { demandeId: demande.id, aPartirDe });
  }

  // R11 : refus alors que des jours déjà passés étaient protégés par la demande. Le décideur (RH ou responsable) choisit de les
  // compter comme absences (plages retirées, absences « à contrôler » créées) ou non (plages gardées : la tâche des absences, qui
  // réexamine la veille, ne les comptera jamais).
  let joursPasses: boolean | null = null;
  let absencesCreees = 0;
  if (a.type === "REJETER" && passes.length > 0) {
    joursPasses = a.compterJoursPassesAbsents === true;
    if (joursPasses) {
      await supprimerPlages(db, { demandeId: demande.id, avant: aujourdhui });
      absencesCreees = await compterJoursPassesAbsents(db, { userId: demande.userId, reference: demande.reference, jours: passes });
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
