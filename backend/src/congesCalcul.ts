// Congés — calculs PURS (module simplifié, 2026-10-19).
//
// Aucun accès base : les jours fériés sont fournis par l'appelant. Un jour est un « jour civil » `AAAA-MM-JJ` (texte), jamais un
// instant : pas de dérive de fuseau, pas de comparaison d'heures. Les week-ends et jours fériés passent par `estJourNonOuvre`
// (pointage-utils.ts), la règle unique du portail pour le Pointage et la détection des absences — jamais une seconde définition
// du « jour ouvré ». Plus de solde, d'exercice ni d'ancienneté : le nombre de jours ouvrés n'est qu'une information (R4).

import { estJourNonOuvre } from "./pointage-utils";

export type JourCivil = string;

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
// Jours ouvrés (R4)
// ---------------------------------------------------------------------------------------------------------------------

export interface DecompteJours {
  /** Tous les jours de la période (une plage d'absence autorisée est créée pour chacun, R10). */
  jours: JourCivil[];
  /** Jours du lundi au vendredi hors jours fériés (information affichée ; une période sans aucun est refusée). */
  joursOuvres: JourCivil[];
  nbJoursOuvres: number;
  /** Jours fériés tombant dans la période (hors week-end), pour l'affichage. */
  joursFeriesInclus: JourCivil[];
}

/** `true` si le jour est un jour ouvré : ni samedi, ni dimanche, ni jour férié de `feries`. */
export function estJourOuvre(jour: JourCivil, feries: readonly JourCivil[] = []): boolean {
  return !estNonOuvre(jour, new Set(feries));
}

export function decompterJours(params: { debut: JourCivil; fin: JourCivil; joursFeries: readonly JourCivil[] }): DecompteJours {
  const feries = new Set(params.joursFeries);
  const jours = listerJours(params.debut, params.fin);
  const joursOuvres = jours.filter((j) => !estNonOuvre(j, feries));
  return {
    jours,
    joursOuvres,
    nbJoursOuvres: joursOuvres.length,
    joursFeriesInclus: jours.filter((j) => feries.has(j) && !estWeekEnd(j)),
  };
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
