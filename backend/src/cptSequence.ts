// Numérotation du module Gestion Compta (docs/compta-conception.md §1.3 C-11 et §8, modèle `CptSequence`).
//
// Copié de backend/src/encSequence.ts le 2026-10-22 — Gestion Compta est indépendant : toute correction se reporte à la main.
//
// Incrément ATOMIQUE en une seule instruction SQL (INSERT … ON CONFLICT DO UPDATE … RETURNING) : le verrou de ligne
// posé par PostgreSQL sérialise les appels concurrents, deux transactions ne peuvent jamais obtenir la même valeur.
// Jamais `count() + 1`. Dans une transaction qui échoue, le numéro est rendu avec elle (pas de trou « consommé »).
//
// Identifiants métier (C-11), différents des `PAI-` / `SUS-` d'Encaissements :
//   CPE-AAAA-NNNNNN  encaissement             CPR-AAAA-NNNNNN  règlement de partenaire
//   CPD-AAAA-NN      déclaration de TCA (une par mois, au plus 99 par an)
// L'année portée par la clé est celle de la date de valeur / de l'opération : l'appelant la fournit.

import type { PrismaClient } from "./generated/prisma/client";

/** Client ou transaction Prisma : seul `$queryRaw` est utilisé. */
export type CptSequenceDb = Pick<PrismaClient, "$queryRaw">;

export type CptPrefixeAnnuel = "CPE" | "CPR" | "CPD";

/** Largeur du numéro (nombre de chiffres) par préfixe. */
const LARGEUR: Record<CptPrefixeAnnuel, number> = { CPE: 6, CPR: 6, CPD: 2 };

const CLE_ANNUELLE = /^(CPE|CPR|CPD)-(\d{4})$/;

export class CptSequenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CptSequenceError";
  }
}

function verifierAnnee(annee: number) {
  if (!Number.isInteger(annee) || annee < 2000 || annee > 2999) {
    throw new CptSequenceError(`Année de séquence invalide : ${annee}.`);
  }
}

export function cleSequenceAnnuelle(prefixe: CptPrefixeAnnuel, annee: number): string {
  verifierAnnee(annee);
  return `${prefixe}-${annee}`;
}

function largeurPourCle(cle: string): number {
  const annuelle = CLE_ANNUELLE.exec(cle);
  if (annuelle) return LARGEUR[annuelle[1] as CptPrefixeAnnuel];
  throw new CptSequenceError(`Clé de séquence invalide : « ${cle} ».`);
}

/** « CPE-2026 » + 123 → « CPE-2026-000123 » ; « CPD-2026 » + 9 → « CPD-2026-09 ». */
export function formaterNumero(cle: string, valeur: number): string {
  const largeur = largeurPourCle(cle);
  if (!Number.isInteger(valeur) || valeur < 1) throw new CptSequenceError(`Valeur de séquence invalide : ${valeur}.`);
  if (String(valeur).length > largeur) {
    throw new CptSequenceError(`Séquence « ${cle} » épuisée : ${valeur} dépasse ${largeur} chiffres.`);
  }
  return `${cle}-${String(valeur).padStart(largeur, "0")}`;
}

/** Réserve la valeur suivante (1 pour une clé encore inexistante) et la renvoie. */
export async function prochaineValeur(db: CptSequenceDb, cle: string): Promise<number> {
  largeurPourCle(cle);
  const lignes = await db.$queryRaw<{ valeur: number }[]>`
    INSERT INTO "CptSequence" ("cle", "valeur") VALUES (${cle}, 1)
    ON CONFLICT ("cle") DO UPDATE SET "valeur" = "CptSequence"."valeur" + 1
    RETURNING "valeur"`;
  return Number(lignes[0].valeur);
}

/** Réserve et formate le numéro suivant (ex. « CPE-2026-000124 »). */
export async function prochainNumero(db: CptSequenceDb, cle: string): Promise<string> {
  return formaterNumero(cle, await prochaineValeur(db, cle));
}

/**
 * Réserve `nombre` numéros CONSÉCUTIFS en UNE seule instruction (import d'un relevé de 10 000 lignes : pas 10 000 allers-retours)
 * et les renvoie formatés, dans l'ordre. Même garantie que `prochaineValeur` : le verrou de ligne sérialise les appels
 * concurrents, deux transactions ne reçoivent jamais le même numéro, et un échec rend le bloc avec la transaction.
 */
export async function reserverNumerosCpt(db: CptSequenceDb, cle: string, nombre: number): Promise<string[]> {
  largeurPourCle(cle);
  if (!Number.isInteger(nombre) || nombre < 0) throw new CptSequenceError(`Nombre de numéros invalide : ${nombre}.`);
  if (nombre === 0) return [];
  const lignes = await db.$queryRaw<{ valeur: number }[]>`
    INSERT INTO "CptSequence" ("cle", "valeur") VALUES (${cle}, ${nombre}::int)
    ON CONFLICT ("cle") DO UPDATE SET "valeur" = "CptSequence"."valeur" + ${nombre}::int
    RETURNING "valeur"`;
  const derniere = Number(lignes[0].valeur);
  return Array.from({ length: nombre }, (_, i) => formaterNumero(cle, derniere - nombre + 1 + i));
}

/**
 * Reprise de l'historique (lot GC-11) : remonte la séquence au plus grand numéro repris, pour que la prochaine saisie ne
 * reprenne jamais un numéro existant. Ne fait JAMAIS baisser une séquence (GREATEST). Renvoie la valeur résultante.
 */
export async function remonterSequence(db: CptSequenceDb, cle: string, valeurMin: number): Promise<number> {
  largeurPourCle(cle);
  if (!Number.isInteger(valeurMin) || valeurMin < 0) throw new CptSequenceError(`Valeur minimale invalide : ${valeurMin}.`);
  const lignes = await db.$queryRaw<{ valeur: number }[]>`
    INSERT INTO "CptSequence" ("cle", "valeur") VALUES (${cle}, ${valeurMin})
    ON CONFLICT ("cle") DO UPDATE SET "valeur" = GREATEST("CptSequence"."valeur", EXCLUDED."valeur")
    RETURNING "valeur"`;
  return Number(lignes[0].valeur);
}
