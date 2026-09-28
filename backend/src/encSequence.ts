// Numérotation du module Encaissements (docs/encaissements-conception.md §6.4, modèle `EncSequence`).
//
// Incrément ATOMIQUE en une seule instruction SQL (INSERT … ON CONFLICT DO UPDATE … RETURNING) : le verrou de ligne
// posé par PostgreSQL sérialise les appels concurrents, deux transactions ne peuvent jamais obtenir la même valeur.
// Jamais `count() + 1`. Dans une transaction qui échoue, le numéro est rendu avec elle (pas de trou « consommé »).
//
// L'année portée par la clé (saisie ou paiement ?) reste une question ouverte (ambiguïté 15) : ce module ne la tranche
// pas, l'appelant fournit l'année.

import type { PrismaClient } from "./generated/prisma/client";

/** Client ou transaction Prisma : seul `$queryRaw` est utilisé. */
export type EncSequenceDb = Pick<PrismaClient, "$queryRaw">;

export type EncPrefixeAnnuel = "PAI" | "SUS" | "RGS";

/** Largeur du numéro : PAI-AAAA-NNNNNN et SUS-AAAA-NNNNNN (cahier), RGS aligné ; BRD-AAAA-MM-NNNN (cahier). */
const LARGEUR: Record<EncPrefixeAnnuel | "BRD", number> = { PAI: 6, SUS: 6, RGS: 6, BRD: 4 };

const CLE_ANNUELLE = /^(PAI|SUS|RGS)-(\d{4})$/;
const CLE_MENSUELLE = /^BRD-(\d{4})-(0[1-9]|1[0-2])$/;

export class EncSequenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncSequenceError";
  }
}

function verifierAnnee(annee: number) {
  if (!Number.isInteger(annee) || annee < 2000 || annee > 2999) {
    throw new EncSequenceError(`Année de séquence invalide : ${annee}.`);
  }
}

export function cleSequenceAnnuelle(prefixe: EncPrefixeAnnuel, annee: number): string {
  verifierAnnee(annee);
  return `${prefixe}-${annee}`;
}

/** Bordereaux : la numérotation repart à 1 chaque mois (`mois` de 1 à 12). */
export function cleSequenceBordereau(annee: number, mois: number): string {
  verifierAnnee(annee);
  if (!Number.isInteger(mois) || mois < 1 || mois > 12) throw new EncSequenceError(`Mois de séquence invalide : ${mois}.`);
  return `BRD-${annee}-${String(mois).padStart(2, "0")}`;
}

function largeurPourCle(cle: string): number {
  const annuelle = CLE_ANNUELLE.exec(cle);
  if (annuelle) return LARGEUR[annuelle[1] as EncPrefixeAnnuel];
  if (CLE_MENSUELLE.test(cle)) return LARGEUR.BRD;
  throw new EncSequenceError(`Clé de séquence invalide : « ${cle} ».`);
}

/** « PAI-2026 » + 123 → « PAI-2026-000123 » ; « BRD-2026-09 » + 7 → « BRD-2026-09-0007 ». */
export function formaterNumero(cle: string, valeur: number): string {
  const largeur = largeurPourCle(cle);
  if (!Number.isInteger(valeur) || valeur < 1) throw new EncSequenceError(`Valeur de séquence invalide : ${valeur}.`);
  if (String(valeur).length > largeur) {
    throw new EncSequenceError(`Séquence « ${cle} » épuisée : ${valeur} dépasse ${largeur} chiffres.`);
  }
  return `${cle}-${String(valeur).padStart(largeur, "0")}`;
}

/** Réserve la valeur suivante (1 pour une clé encore inexistante) et la renvoie. */
export async function prochaineValeur(db: EncSequenceDb, cle: string): Promise<number> {
  largeurPourCle(cle);
  const lignes = await db.$queryRaw<{ valeur: number }[]>`
    INSERT INTO "EncSequence" ("cle", "valeur") VALUES (${cle}, 1)
    ON CONFLICT ("cle") DO UPDATE SET "valeur" = "EncSequence"."valeur" + 1
    RETURNING "valeur"`;
  return Number(lignes[0].valeur);
}

/** Réserve et formate le numéro suivant (ex. « PAI-2026-000124 »). */
export async function prochainNumero(db: EncSequenceDb, cle: string): Promise<string> {
  return formaterNumero(cle, await prochaineValeur(db, cle));
}

/**
 * Import : remonte la séquence au plus grand numéro importé, pour que la prochaine saisie ne reprenne jamais un numéro
 * existant. Ne fait JAMAIS baisser une séquence (GREATEST). Renvoie la valeur résultante.
 */
export async function remonterSequence(db: EncSequenceDb, cle: string, valeurMin: number): Promise<number> {
  largeurPourCle(cle);
  if (!Number.isInteger(valeurMin) || valeurMin < 0) throw new EncSequenceError(`Valeur minimale invalide : ${valeurMin}.`);
  const lignes = await db.$queryRaw<{ valeur: number }[]>`
    INSERT INTO "EncSequence" ("cle", "valeur") VALUES (${cle}, ${valeurMin})
    ON CONFLICT ("cle") DO UPDATE SET "valeur" = GREATEST("EncSequence"."valeur", EXCLUDED."valeur")
    RETURNING "valeur"`;
  return Number(lignes[0].valeur);
}
