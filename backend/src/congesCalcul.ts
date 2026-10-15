// Congés — calculs PURS (Lot 2 de la fusion Congés / Permissions d'absence, 2026-10-15).
//
// Aucun accès base : les jours fériés, la date d'embauche et les soldes sont fournis par l'appelant. Un jour est un
// « jour civil » `AAAA-MM-JJ` (texte), jamais un instant : pas de dérive de fuseau, pas de comparaison d'heures. Les
// week-ends et jours fériés passent par `estJourNonOuvre` (pointage-utils.ts), la règle unique du portail pour le
// Pointage et la détection des absences — jamais une seconde définition du « jour ouvré ».
//
// Règles de solde PROVISOIRES (D6, à confirmer par la RH) : dotation annuelle complète à la date anniversaire de
// l'embauche, jours entiers, pas de report, congé à cheval sur deux exercices REFUSÉ (à scinder en deux demandes).

import { estJourNonOuvre } from "./pointage-utils";

export type JourCivil = string;
export type DecompteConge = "CALENDAIRE" | "OUVRABLE";

/** Plus longue période acceptée (garde-fou contre une saisie absurde et contre les boucles). */
export const MAX_JOURS_PERIODE = 366;

const FORMAT_JOUR = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Date locale (minuit) d'un jour civil, `null` si le texte n'est pas un jour calendaire valide (30 février…). */
export function parseJourCivil(jour: string): Date | null {
  const m = FORMAT_JOUR.exec(jour);
  if (!m) return null;
  const [annee, mois, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(annee, mois - 1, j);
  if (d.getFullYear() !== annee || d.getMonth() !== mois - 1 || d.getDate() !== j) return null;
  return d;
}

const deux = (n: number) => String(n).padStart(2, "0");

/** Jour civil d'une date, en heure locale du serveur (Abidjan) comme le reste du module. */
export function formatJourCivil(d: Date): JourCivil {
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** Jour civil d'une colonne SQL `DATE` (Prisma la renvoie à minuit UTC) : composantes UTC, jamais locales. */
export function jourCivilDepuisColonneDate(d: Date): JourCivil {
  return `${d.getUTCFullYear()}-${deux(d.getUTCMonth() + 1)}-${deux(d.getUTCDate())}`;
}

/** Valeur à écrire dans une colonne SQL `DATE` pour un jour civil (minuit UTC). */
export function colonneDateDepuisJourCivil(jour: JourCivil): Date {
  return new Date(`${jour}T00:00:00.000Z`);
}

export function ajouterJours(jour: JourCivil, n: number): JourCivil {
  const d = parseJourCivil(jour);
  if (!d) throw new Error(`Jour civil invalide : ${jour}`);
  return formatJourCivil(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** Négatif si a < b, 0 si égaux, positif sinon (l'ordre des textes `AAAA-MM-JJ` est l'ordre chronologique). */
export function comparerJours(a: JourCivil, b: JourCivil): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Tous les jours de la période, bornes comprises ; `[]` si la fin précède le début. */
export function listerJours(debut: JourCivil, fin: JourCivil): JourCivil[] {
  if (comparerJours(fin, debut) < 0) return [];
  const jours: JourCivil[] = [];
  let courant = debut;
  while (comparerJours(courant, fin) <= 0) {
    jours.push(courant);
    if (jours.length > MAX_JOURS_PERIODE) throw new Error("Période trop longue.");
    courant = ajouterJours(courant, 1);
  }
  return jours;
}

function estWeekEnd(jour: JourCivil): boolean {
  const g = parseJourCivil(jour)?.getDay();
  return g === 0 || g === 6;
}

function estNonOuvre(jour: JourCivil, feries: ReadonlySet<JourCivil>): boolean {
  const d = parseJourCivil(jour);
  if (!d) throw new Error(`Jour civil invalide : ${jour}`);
  // `estJourNonOuvre` : samedi, dimanche, ou jour férié (comparaison locale année/mois/jour).
  return estJourNonOuvre(d, feries.has(jour) ? [d] : []);
}

// ---------------------------------------------------------------------------------------------------------------------
// Décompte des jours
// ---------------------------------------------------------------------------------------------------------------------

export interface DecompteJours {
  /** Jours décomptés selon le type (calendaire : tous ; ouvrable : sans week-ends ni jours fériés). */
  nbJours: number;
  joursCalendaires: number;
  joursOuvrables: number;
  /** Jours qui comptent pour ce type (base du débit de solde et de la répartition par exercice). */
  joursDecomptes: JourCivil[];
  /** Jours fériés tombant dans la période (hors week-end), pour l'affichage. */
  joursFeriesInclus: JourCivil[];
  /** Tous les jours de la période (une plage d'absence autorisée est créée pour chacun à la validation). */
  jours: JourCivil[];
}

export function calculerNbJours(params: {
  debut: JourCivil;
  fin: JourCivil;
  decompte: DecompteConge;
  joursFeries: readonly JourCivil[];
}): DecompteJours {
  const feries = new Set(params.joursFeries);
  const jours = listerJours(params.debut, params.fin);
  const ouvrables = jours.filter((j) => !estNonOuvre(j, feries));
  const joursDecomptes = params.decompte === "OUVRABLE" ? ouvrables : jours;
  return {
    nbJours: joursDecomptes.length,
    joursCalendaires: jours.length,
    joursOuvrables: ouvrables.length,
    joursDecomptes,
    joursFeriesInclus: jours.filter((j) => feries.has(j) && !estWeekEnd(j)),
    jours,
  };
}

/**
 * Date de fin d'un congé de `nbJours` jours à partir de `debut` (types à durée fixée, article 13). Ouvrable : le
 * `nbJours`-ième jour ouvré à compter de `debut` (inclus s'il est ouvré) ; calendaire : `debut + nbJours - 1`.
 */
export function dateFinPourJours(params: {
  debut: JourCivil;
  nbJours: number;
  decompte: DecompteConge;
  joursFeries: readonly JourCivil[];
}): JourCivil {
  const { debut, nbJours, decompte } = params;
  if (!Number.isInteger(nbJours) || nbJours <= 0) return debut;
  if (decompte === "CALENDAIRE") return ajouterJours(debut, nbJours - 1);
  const feries = new Set(params.joursFeries);
  let courant = debut;
  let compte = 0;
  for (let i = 0; i < MAX_JOURS_PERIODE * 3; i++) {
    if (!estNonOuvre(courant, feries)) {
      compte++;
      if (compte === nbJours) return courant;
    }
    courant = ajouterJours(courant, 1);
  }
  throw new Error("Date de fin introuvable.");
}

// ---------------------------------------------------------------------------------------------------------------------
// Exercice de congé (depuis la date d'embauche) et ancienneté
// ---------------------------------------------------------------------------------------------------------------------

export interface ExerciceConge {
  /** Année de la date anniversaire qui ouvre l'exercice. */
  exercice: number;
  debut: JourCivil;
  /** Veille du prochain anniversaire. */
  fin: JourCivil;
}

function joursDansLeMois(annee: number, mois: number): number {
  return new Date(annee, mois, 0).getDate();
}

/** Anniversaire de l'embauche dans l'année donnée ; un 29 février tombe le 28 les années non bissextiles. */
function anniversaire(dateEmbauche: JourCivil, annee: number): JourCivil {
  const d = parseJourCivil(dateEmbauche);
  if (!d) throw new Error(`Date d'embauche invalide : ${dateEmbauche}`);
  const mois = d.getMonth() + 1;
  const jour = Math.min(d.getDate(), joursDansLeMois(annee, mois));
  return `${annee}-${deux(mois)}-${deux(jour)}`;
}

/**
 * Exercice de congé qui contient `reference` : il court d'un anniversaire de la date d'embauche à la veille du
 * suivant. Avant le premier anniversaire de l'année, la référence appartient à l'exercice de l'année précédente.
 */
export function calculerExercice(dateEmbauche: JourCivil, reference: JourCivil): ExerciceConge {
  const refAnnee = Number(reference.slice(0, 4));
  const cetteAnnee = anniversaire(dateEmbauche, refAnnee);
  const annee = comparerJours(reference, cetteAnnee) >= 0 ? refAnnee : refAnnee - 1;
  return {
    exercice: annee,
    debut: anniversaire(dateEmbauche, annee),
    fin: ajouterJours(anniversaire(dateEmbauche, annee + 1), -1),
  };
}

/** Jours décomptés regroupés par exercice (un seul exercice : le cas normal). */
export function repartirParExercice(joursDecomptes: readonly JourCivil[], dateEmbauche: JourCivil): Map<number, number> {
  const parExercice = new Map<number, number>();
  for (const j of joursDecomptes) {
    const { exercice } = calculerExercice(dateEmbauche, j);
    parExercice.set(exercice, (parExercice.get(exercice) ?? 0) + 1);
  }
  return parExercice;
}

export const MESSAGE_CHEVAUCHEMENT_EXERCICE =
  "Ce congé couvre deux exercices de congé : déposez deux demandes, une par exercice (règle provisoire en attente de la RH).";

/**
 * Exercice sur lequel débiter un congé déductible, ou le refus s'il couvre deux exercices (D6 provisoire). L'exercice
 * est celui des JOURS DU CONGÉ (jamais celui d'aujourd'hui : un congé pris l'an prochain ne débite pas le solde en cours).
 */
export function exerciceDuDebit(
  joursDecomptes: readonly JourCivil[],
  dateEmbauche: JourCivil
): { ok: true; exercice: ExerciceConge } | { ok: false; erreur: string } {
  if (joursDecomptes.length === 0) return { ok: false, erreur: "Aucun jour décompté sur cette période." };
  const parExercice = repartirParExercice(joursDecomptes, dateEmbauche);
  if (parExercice.size > 1) return { ok: false, erreur: MESSAGE_CHEVAUCHEMENT_EXERCICE };
  return { ok: true, exercice: calculerExercice(dateEmbauche, joursDecomptes[0]) };
}

/** Mois révolus entre l'embauche et la référence (le dernier jour d'un mois court compte l'anniversaire du 29, 30, 31). */
export function calculerAncienneteMois(dateEmbauche: JourCivil, reference: JourCivil): number {
  const e = parseJourCivil(dateEmbauche);
  const r = parseJourCivil(reference);
  if (!e || !r) throw new Error("Jour civil invalide.");
  let mois = (r.getFullYear() - e.getFullYear()) * 12 + (r.getMonth() - e.getMonth());
  const jourAnniversaire = Math.min(e.getDate(), joursDansLeMois(r.getFullYear(), r.getMonth() + 1));
  if (r.getDate() < jourAnniversaire) mois -= 1;
  return Math.max(0, mois);
}

export const MESSAGE_DATE_EMBAUCHE_MANQUANTE =
  "Votre date d'embauche n'est pas renseignée : demandez à la RH de la saisir avant de déposer une demande.";

/**
 * Ancienneté exigée par un type. Jamais de repli silencieux sur la date de création du compte (tous les comptes
 * datent de septembre 2026) : sans date d'embauche, un type qui exige de l'ancienneté est refusé.
 */
export function verifierAnciennete(params: {
  dateEmbauche: JourCivil | null;
  moisRequis: number;
  reference: JourCivil;
}): { eligible: true; moisAnciennete: number | null } | { eligible: false; erreur: string; moisAnciennete: number | null } {
  const { dateEmbauche, moisRequis, reference } = params;
  if (moisRequis <= 0) {
    return {
      eligible: true,
      moisAnciennete: dateEmbauche ? calculerAncienneteMois(dateEmbauche, reference) : null,
    };
  }
  if (!dateEmbauche) return { eligible: false, erreur: MESSAGE_DATE_EMBAUCHE_MANQUANTE, moisAnciennete: null };
  const moisAnciennete = calculerAncienneteMois(dateEmbauche, reference);
  if (moisAnciennete < moisRequis) {
    return {
      eligible: false,
      moisAnciennete,
      erreur: `Ce type de congé exige ${moisRequis} mois d'ancienneté (${moisAnciennete} mois révolus au ${reference}).`,
    };
  }
  return { eligible: true, moisAnciennete };
}

// ---------------------------------------------------------------------------------------------------------------------
// Solde
// ---------------------------------------------------------------------------------------------------------------------

export interface PlanDebit {
  /** Jours à débiter (0 pour un type non déductible). */
  aDebiter: number;
  disponible: number;
  suffisant: boolean;
  manque: number;
}

/**
 * Débit prévu pour une demande. `soldeRestant` nul : la ligne de solde de l'exercice n'existe pas encore (elle sera
 * créée à la dotation du type, `nbJoursDefaut`). Un type non déductible ne touche jamais au solde.
 */
export function planifierDebit(params: {
  nonDeductible: boolean;
  nbJoursDefaut: number;
  soldeRestant: number | null;
  nbJours: number;
}): PlanDebit {
  if (params.nonDeductible) return { aDebiter: 0, disponible: 0, suffisant: true, manque: 0 };
  const disponible = params.soldeRestant ?? params.nbJoursDefaut;
  const suffisant = disponible >= params.nbJours;
  return { aDebiter: params.nbJours, disponible, suffisant, manque: suffisant ? 0 : params.nbJours - disponible };
}

export function messageSoldeInsuffisant(plan: PlanDebit): string {
  return `Solde insuffisant : ${plan.disponible} jour(s) disponible(s), ${plan.aDebiter} demandé(s).`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Chevauchement
// ---------------------------------------------------------------------------------------------------------------------

export interface PeriodeConge {
  id?: string;
  debut: JourCivil;
  fin: JourCivil;
}

/** Deux périodes, bornes comprises, se recouvrent-elles ? */
export function periodesSeChevauchent(a: PeriodeConge, b: PeriodeConge): boolean {
  return comparerJours(a.debut, b.fin) <= 0 && comparerJours(b.debut, a.fin) <= 0;
}

export function premierChevauchement(periode: PeriodeConge, existantes: readonly PeriodeConge[]): PeriodeConge | null {
  return existantes.find((e) => e.id !== periode.id && periodesSeChevauchent(periode, e)) ?? null;
}
