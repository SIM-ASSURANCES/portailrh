// Recherche de contrats (module Encaissements, CDC V2.6 F2, commits 5a et 5a-bis).
//
// Sans extension PostgreSQL. Option B (2026-10-04, mesures à 150 000 contrats) : la recherche passe par une table
// d'index `EncContratMot` (un mot normalisé par ligne, index btree `text_pattern_ops`) et cherche par DÉBUT DE MOT —
// chaque mot saisi doit commencer au moins un mot du contrat (n° de police, client, partenaire, produit, branche,
// références de paiement). Normalisation identique des deux côtés : minuscules, accents français retirés,
// apostrophes et tirets ignorés (« nguessan » trouve « N'Guessan »). Les parties d'un mot composé sont aussi
// indexées (« guessan », « 0031337 » pour « POL-0031337 »). Limite assumée : un fragment au MILIEU d'un mot
// (« uessan ») ne trouve rien.

import { Prisma } from "./generated/prisma/client";
import type { PrismaClient } from "./generated/prisma/client";

/** Lettres accentuées et leurs équivalents (même ordre) ; les caractères de `IGNORES` sont supprimés. Les mêmes
 *  listes sont recopiées dans la migration `20261004090000_encaissements_recherche_mots` (remplissage initial). */
const ACCENTS = "éèêëàâäîïôöùûüç";
const SANS_ACCENTS = "eeeeaaaiioouuuc";
const IGNORES = "'’-";
/** Séparateurs des parties d'un mot composé (même classe dans la migration). */
const SEPARATEURS_PARTIES = /['’/._-]+/;

export const RECHERCHE_MOTS_MAX = 6;

function retirerAccents(texte: string): string {
  let sortie = "";
  for (const car of texte) {
    const i = ACCENTS.indexOf(car);
    sortie += i >= 0 ? SANS_ACCENTS[i] : car;
  }
  return sortie;
}

export function normaliserTexteRecherche(texte: string): string {
  let sortie = "";
  for (const car of retirerAccents(texte.toLowerCase())) {
    if (!IGNORES.includes(car)) sortie += car;
  }
  return sortie;
}

/** Mots normalisés, sans doublon, au plus `RECHERCHE_MOTS_MAX` (un mot vide n'est jamais gardé). */
export function decouperRecherche(saisie: string): string[] {
  const mots = normaliserTexteRecherche(saisie)
    .split(/\s+/)
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
  return [...new Set(mots)].slice(0, RECHERCHE_MOTS_MAX);
}

/**
 * Mots à indexer pour un contrat (`EncContratMot`) : chaque texte en minuscules, découpé sur les espaces ; pour chaque
 * jeton, le jeton normalisé (sans accents, apostrophes ni tirets) ET ses parties (séparées par apostrophe, tiret,
 * barre, point ou souligné). Sans doublon. Doit rester identique au remplissage SQL de la migration.
 */
export function motsIndexes(textes: readonly (string | null | undefined)[]): string[] {
  const mots = new Set<string>();
  for (const texte of textes) {
    if (!texte) continue;
    for (const jeton of texte.toLowerCase().split(/\s+/)) {
      if (!jeton) continue;
      const joint = normaliserTexteRecherche(jeton);
      if (joint) mots.add(joint);
      for (const partie of retirerAccents(jeton).split(SEPARATEURS_PARTIES)) {
        if (partie) mots.add(partie);
      }
    }
  }
  return [...mots];
}

/** Échappe les jokers de LIKE (`%`, `_`, `\`) : un mot saisi est toujours cherché tel quel. */
export function echapperLike(mot: string): string {
  return mot.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export type EncRechercheDb = Pick<PrismaClient, "$queryRaw">;
export type EncIndexMotsDb = Pick<PrismaClient, "encContratMot">;

/**
 * Réécrit les mots indexés d'un contrat (même transaction que l'écriture du contrat ou de son paiement). Tout point
 * qui crée ou modifie un contrat, ou crée un paiement avec référence, doit l'appeler. `nouveau` : contrat créé à
 * l'instant, rien à effacer.
 */
export async function indexerMotsContrat(
  db: EncIndexMotsDb,
  contratId: string,
  textes: readonly (string | null | undefined)[],
  nouveau = false
): Promise<void> {
  if (!nouveau) await db.encContratMot.deleteMany({ where: { contratId } });
  const mots = motsIndexes(textes);
  if (mots.length > 0) {
    await db.encContratMot.createMany({ data: mots.map((mot) => ({ contratId, mot })), skipDuplicates: true });
  }
}

/**
 * Vrai si la saisie ressemble à un n° de police ou à une référence de paiement : un seul mot (lettres, chiffres,
 * tirets, points, barres, soulignés), au moins 3 caractères dont un chiffre.
 */
export function ressembleIdentifiant(saisie: string): boolean {
  const s = saisie.trim();
  return s.length >= 3 && /^[\p{L}\p{N}_./-]+$/u.test(s) && /\p{N}/u.test(s);
}

/** Égalité exacte sur n° de police ou référence (index existants ; saisie telle quelle, majuscules, minuscules). */
async function rechercherIdentifiantExact(db: EncRechercheDb, saisie: string, limite: number): Promise<string[]> {
  const s = saisie.trim();
  const variantes = [...new Set([s, s.toUpperCase(), s.toLowerCase()])];
  const lignes = await db.$queryRaw<{ id: string }[]>`
    SELECT c."id" FROM "EncContrat" c
    WHERE c."id" IN (
      SELECT "id" FROM "EncContrat" WHERE "numPolice" IN (${Prisma.join(variantes)})
      UNION
      SELECT "contratId" FROM "EncEncaissement" WHERE "reference" IN (${Prisma.join(variantes)})
    )
    ORDER BY c."numPolice"
    LIMIT ${limite}`;
  return lignes.map((l) => l.id);
}

/**
 * Identifiants des contrats correspondant à la saisie, triés par numéro de police (au plus `limite`). Un n° de
 * police ou une référence exacts sont d'abord cherchés par égalité (le contrat exact seul) ; sinon, recherche par
 * début de mot dans `EncContratMot` (couvre aussi le préfixe d'un n° de police ou d'une référence).
 */
export async function rechercherContratIds(db: EncRechercheDb, saisie: string, limite: number): Promise<string[]> {
  const mots = decouperRecherche(saisie);
  if (mots.length === 0) return [];
  if (ressembleIdentifiant(saisie)) {
    const exacts = await rechercherIdentifiantExact(db, saisie, limite);
    if (exacts.length > 0) return exacts;
  }

  // Un EXISTS par mot (plutôt qu'un INTERSECT d'ensembles) : le planificateur peut parcourir les contrats par n° de
  // police et s'arrêter aux `limite` premiers qui conviennent — décisif quand un mot est très courant
  // (« courtage 7 » : 245 ms en INTERSECT, quelques ms ainsi, mesuré à 150 000 contrats).
  const conditions = mots.map(
    (mot) =>
      Prisma.sql`EXISTS (SELECT 1 FROM "EncContratMot" m WHERE m."contratId" = c."id" AND m."mot" LIKE ${`${echapperLike(mot)}%`})`
  );
  const lignes = await db.$queryRaw<{ id: string }[]>`
    SELECT c."id" FROM "EncContrat" c
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY c."numPolice"
    LIMIT ${limite}`;
  return lignes.map((l) => l.id);
}
