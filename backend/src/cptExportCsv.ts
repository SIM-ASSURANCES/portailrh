// Exports de Gestion Compta : types communs et écriture CSV (lot GC-1f ; docs/compta-conception.md, GC-10d).
//
// PUR : aucune dépendance (ni Prisma, ni ExcelJS, ni Next). L'écriture Excel en flux, qui a besoin d'ExcelJS, vit dans le
// frontend (`lib/compta/exportFlux.ts`) et partage ces types et ces règles de mise en forme.
//
// Conventions d'un export, identiques en Excel et en CSV :
//  - un montant est un nombre à deux décimales (en CSV, virgule décimale : le séparateur est « ; », comme l'Excel français) ;
//  - une date `Date` est un jour civil lu en UTC (convention des colonnes `@db.Date` de Prisma, minuit UTC) ; une chaîne
//    `AAAA-MM-JJ` est acceptée telle quelle ;
//  - un texte qui commencerait un calcul dans Excel (`=`, `+`, `-`, `@`, tabulation, retour chariot) est neutralisé.

export type TypeColonneExportCpt = "texte" | "montant" | "date" | "entier";

export interface ColonneExportCpt {
  /** Clé de la valeur dans la ligne. */
  cle: string;
  /** Titre affiché en tête de colonne. */
  titre: string;
  type: TypeColonneExportCpt;
  /** Largeur en caractères (Excel seulement). */
  largeur?: number;
}

export type ValeurExportCpt = string | number | Date | null | undefined;
export type LigneExportCpt = Record<string, ValeurExportCpt>;

/** Une feuille Excel compte au plus 1 048 576 lignes, en-tête comprise : au-delà de ce plafond, exporter en CSV. */
export const CPT_EXPORT_EXCEL_LIGNES_MAX = 1_048_575;

export class CptExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CptExportError";
  }
}

export const CSV_BOM = "﻿";
export const CSV_SEPARATEUR = ";";
export const CSV_FIN_DE_LIGNE = "\r\n";

const deuxChiffres = (n: number) => String(n).padStart(2, "0");

/** Jour civil `{ a, m, j }` d'une valeur date, ou `null` si elle n'en est pas une. */
export function jourCivilExport(valeur: ValeurExportCpt): { a: number; m: number; j: number } | null {
  if (valeur instanceof Date) {
    if (Number.isNaN(valeur.getTime())) return null;
    return { a: valeur.getUTCFullYear(), m: valeur.getUTCMonth() + 1, j: valeur.getUTCDate() };
  }
  if (typeof valeur === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeur.trim());
    if (m) return { a: Number(m[1]), m: Number(m[2]), j: Number(m[3]) };
  }
  return null;
}

/** Centimes entiers d'un montant (nombre ou texte décimal « -1398.6 »), ou `null` s'il n'est pas lisible. */
export function centimesExport(valeur: ValeurExportCpt): number | null {
  const n = typeof valeur === "number" ? valeur : typeof valeur === "string" && /^-?\d+(\.\d+)?$/.test(valeur.trim()) ? Number(valeur.trim()) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** `-1398.60` : centimes signés écrits sans passer par un flottant. */
export function montantDepuisCentimes(centimes: number, separateurDecimal = "."): string {
  const signe = centimes < 0 ? "-" : "";
  const abs = Math.abs(centimes);
  return `${signe}${Math.floor(abs / 100)}${separateurDecimal}${deuxChiffres(abs % 100)}`;
}

const DEBUT_DE_FORMULE = /^[=+\-@\t\r]/;

/** Préfixe d'une apostrophe un texte qu'Excel exécuterait comme une formule (« =1+1 », « @SUM(…) », « -2+3 »). */
export function neutraliserFormule(texte: string): string {
  return DEBUT_DE_FORMULE.test(texte) ? `'${texte}` : texte;
}

/** Cellule CSV d'une valeur, selon le type de sa colonne. Ne lève jamais : une valeur illisible devient une cellule vide. */
export function celluleCsv(valeur: ValeurExportCpt, type: TypeColonneExportCpt): string {
  if (valeur === null || valeur === undefined || valeur === "") return "";
  let texte: string;
  switch (type) {
    case "montant": {
      const c = centimesExport(valeur);
      texte = c === null ? "" : montantDepuisCentimes(c, ",");
      break;
    }
    case "date": {
      const jour = jourCivilExport(valeur);
      texte = jour ? `${String(jour.a).padStart(4, "0")}-${deuxChiffres(jour.m)}-${deuxChiffres(jour.j)}` : "";
      break;
    }
    case "entier":
      texte = typeof valeur === "number" && Number.isFinite(valeur) ? (Number.isInteger(valeur) ? valeur.toFixed(0) : String(valeur)) : "";
      break;
    default:
      texte = neutraliserFormule(valeur instanceof Date ? valeur.toISOString() : String(valeur));
  }
  return /[;"\r\n]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
}

/** Ligne d'en-têtes CSV (titres), terminée par `\r\n`. Les titres sont du texte du module, neutralisés par prudence. */
export function enteteCsv(colonnes: readonly ColonneExportCpt[]): string {
  return colonnes.map((c) => celluleCsv(c.titre, "texte")).join(CSV_SEPARATEUR) + CSV_FIN_DE_LIGNE;
}

/** Ligne de données CSV, terminée par `\r\n`. */
export function ligneCsv(colonnes: readonly ColonneExportCpt[], ligne: LigneExportCpt): string {
  return colonnes.map((c) => celluleCsv(ligne[c.cle], c.type)).join(CSV_SEPARATEUR) + CSV_FIN_DE_LIGNE;
}
