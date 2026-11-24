// Recherche rapide par début de mot des référentiels de Gestion Compta (lot GC-2d ; docs/compta-conception.md §2.2).
//
// Copié de backend/src/encRecherche.ts le 2026-10-26 — Gestion Compta est indépendant : toute correction se reporte à la
// main dans les deux fichiers (règle d'indépendance, jamais un import `enc*`).
//
// Sans extension PostgreSQL : une table d'index `CptMot` (un mot normalisé par ligne, colonne `mot` en collation « C » pour
// que le btree serve un `LIKE 'x%'`) et une recherche par DÉBUT DE MOT — chaque mot saisi doit commencer au moins un mot
// de la fiche. Normalisation identique des deux côtés : minuscules, accents français retirés, apostrophes et tirets
// ignorés (« nguessan » trouve « N'Guessan »). Les parties d'un mot composé sont aussi indexées (« 0031337 » pour
// « POL-0031337 »). Limite assumée : un fragment au MILIEU d'un mot (« uessan ») ne trouve rien.
//
// Une entrée d'index = (entité, identifiant) : CLIENT, PARTENAIRE, PRODUIT aujourd'hui ; le lot GC-3 y ajoutera les contrats
// sans changer la table. Tout point qui crée ou modifie une fiche doit réécrire ses mots dans la MÊME transaction
// (`indexerMotsCpt`), et `supprimerMotsCpt` si une fiche disparaît.

import { Prisma } from "./generated/prisma/client";
import type { PrismaClient } from "./generated/prisma/client";

/** Fiches indexées. Une chaîne et non un enum de base : ajouter une entité ne demande aucune migration. */
export const ENTITES_MOTS_CPT = ["CLIENT", "PARTENAIRE", "PRODUIT", "CONTRAT"] as const;
export type EntiteMotsCpt = (typeof ENTITES_MOTS_CPT)[number];

/** Lettres accentuées et leurs équivalents (même ordre) ; les caractères de `IGNORES` sont supprimés. Les mêmes listes sont
 *  recopiées dans la migration `20261101150000_compta_recherche_mots` (remplissage initial). */
const ACCENTS = "éèêëàâäîïôöùûüç";
const SANS_ACCENTS = "eeeeaaaiioouuuc";
const IGNORES = "'’-";
/** Séparateurs des parties d'un mot composé (même classe dans la migration). */
const SEPARATEURS_PARTIES = /['’/._-]+/;

export const RECHERCHE_MOTS_MAX_CPT = 6;
export const RECHERCHE_LIMITE_MAX_CPT = 1000;

function retirerAccents(texte: string): string {
  let sortie = "";
  for (const car of texte) {
    const i = ACCENTS.indexOf(car);
    sortie += i >= 0 ? SANS_ACCENTS[i] : car;
  }
  return sortie;
}

export function normaliserTexteRechercheCpt(texte: string): string {
  let sortie = "";
  for (const car of retirerAccents(texte.toLowerCase())) {
    if (!IGNORES.includes(car)) sortie += car;
  }
  return sortie;
}

/** Mots normalisés de la saisie, sans doublon, au plus `RECHERCHE_MOTS_MAX_CPT` (un mot vide n'est jamais gardé). */
export function decouperRechercheCpt(saisie: string): string[] {
  const mots = normaliserTexteRechercheCpt(saisie)
    .split(/\s+/)
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
  return [...new Set(mots)].slice(0, RECHERCHE_MOTS_MAX_CPT);
}

/**
 * Mots à indexer pour une fiche : chaque texte en minuscules, découpé sur les espaces ; pour chaque jeton, le jeton
 * normalisé (sans accents, apostrophes ni tirets) ET ses parties (séparées par apostrophe, tiret, barre, point ou
 * souligné). Sans doublon. Doit rester identique au remplissage SQL de la migration.
 */
export function motsIndexesCpt(textes: readonly (string | null | undefined)[]): string[] {
  const mots = new Set<string>();
  for (const texte of textes) {
    if (!texte) continue;
    for (const jeton of texte.toLowerCase().split(/\s+/)) {
      if (!jeton) continue;
      const joint = normaliserTexteRechercheCpt(jeton);
      if (joint) mots.add(joint);
      for (const partie of retirerAccents(jeton).split(SEPARATEURS_PARTIES)) {
        if (partie) mots.add(partie);
      }
    }
  }
  return [...mots];
}

/** Échappe les jokers de LIKE (`%`, `_`, `\`) : un mot saisi est toujours cherché tel quel. */
export function echapperLikeCpt(mot: string): string {
  return mot.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ---------- Textes indexés par fiche (une seule définition, utilisée par les actions ET par la reprise) ----------

/** Téléphone enregistré « +2250700000001 » : indexé aussi sans le « + » pour qu'on le retrouve en tapant « 22507 ». */
function telephoneIndexable(telephone: string | null | undefined): string | null {
  return telephone ? telephone.replace(/^\+/, "") : null;
}

export function textesIndexClientCpt(c: {
  nom: string;
  telephone: string | null;
  pieceIdentite: string | null;
  tiersOdoo: string | null;
  partenaireOrigineNom?: string | null;
}): (string | null)[] {
  return [c.nom, telephoneIndexable(c.telephone), c.pieceIdentite, c.tiersOdoo, c.partenaireOrigineNom ?? null];
}

export function textesIndexPartenaireCpt(p: { nom: string; coordonnees: string | null; tiersOdoo: string | null }): (string | null)[] {
  return [p.nom, p.coordonnees, p.tiersOdoo];
}

export function textesIndexProduitCpt(p: { code: string; libelle: string; libelleBranche: string; compteOdoo: string | null }): (string | null)[] {
  return [p.code, p.libelle, p.libelleBranche, p.compteOdoo];
}

/** Contrat (GC-3c) : numéro de police, client, apporteur, produit et référence de paiement déclarée. */
export function textesIndexContratCpt(c: {
  numPolice: string;
  client: string | null;
  partenaire: string | null;
  produitCode: string | null;
  produitLibelle: string | null;
  referencePaiement: string | null;
}): (string | null)[] {
  return [c.numPolice, c.client, c.partenaire, c.produitCode, c.produitLibelle, c.referencePaiement];
}

// ---------- Écriture de l'index ----------

export type CptIndexMotsDb = Pick<PrismaClient, "cptMot">;

/**
 * Réécrit les mots d'une fiche (même transaction que l'écriture de la fiche). `nouveau` : fiche créée à l'instant, rien à
 * effacer.
 */
export async function indexerMotsCpt(
  db: CptIndexMotsDb,
  entite: EntiteMotsCpt,
  entiteId: string,
  textes: readonly (string | null | undefined)[],
  nouveau = false
): Promise<void> {
  if (!nouveau) await db.cptMot.deleteMany({ where: { entite, entiteId } });
  const mots = motsIndexesCpt(textes);
  if (mots.length > 0) {
    await db.cptMot.createMany({ data: mots.map((mot) => ({ entite, entiteId, mot })), skipDuplicates: true });
  }
}

export async function supprimerMotsCpt(db: CptIndexMotsDb, entite: EntiteMotsCpt, entiteId: string): Promise<void> {
  await db.cptMot.deleteMany({ where: { entite, entiteId } });
}

// ---------- Lecture ----------

export type CptRechercheDb = Pick<PrismaClient, "$queryRaw">;

export interface ResultatRechercheCpt {
  entite: EntiteMotsCpt;
  entiteId: string;
}

/**
 * Fiches dont CHAQUE mot saisi commence au moins un mot indexé (ET entre les mots). `entite` restreint à un type de fiche.
 * Au plus `limite` résultats (bornée à `RECHERCHE_LIMITE_MAX_CPT`), triés par entité puis identifiant : un ordre stable, la
 * page applique ensuite son tri propre. Saisie vide ou sans mot exploitable : aucun résultat (jamais « tout »).
 */
export async function rechercherCpt(
  db: CptRechercheDb,
  saisie: string,
  options: { entite?: EntiteMotsCpt; entites?: readonly EntiteMotsCpt[]; limite?: number } = {}
): Promise<ResultatRechercheCpt[]> {
  const mots = decouperRechercheCpt(saisie);
  if (mots.length === 0) return [];
  const limite = Math.max(1, Math.min(options.limite ?? 200, RECHERCHE_LIMITE_MAX_CPT));

  const [premier, ...suivants] = mots;
  // `entite` = un seul type ; `entites` = plusieurs (la page des référentiels exclut les contrats, bien plus nombreux : sans cela
  // ils occuperaient les 500 places du résultat et feraient disparaître partenaires et produits).
  const filtreEntite = options.entite
    ? Prisma.sql`AND "entite" = ${options.entite}`
    : options.entites && options.entites.length > 0
      ? Prisma.sql`AND "entite" = ANY(${[...options.entites]}::text[])`
      : Prisma.empty;
  // Le premier mot sert de point d'entrée sur l'index (`mot`, entité, identifiant) ; chacun des suivants est un EXISTS : le
  // planificateur peut s'arrêter dès `limite` fiches complètes, même quand un mot est très courant.
  const autres = suivants.map(
    (mot) =>
      Prisma.sql`AND EXISTS (SELECT 1 FROM "CptMot" m WHERE m."entite" = c."entite" AND m."entiteId" = c."entiteId" AND m."mot" LIKE ${`${echapperLikeCpt(mot)}%`})`
  );
  const lignes = await db.$queryRaw<{ entite: string; entiteId: string }[]>`
    SELECT c."entite", c."entiteId"
    FROM (SELECT DISTINCT "entite", "entiteId" FROM "CptMot" WHERE "mot" LIKE ${`${echapperLikeCpt(premier)}%`} ${filtreEntite}) c
    WHERE TRUE ${autres.length > 0 ? Prisma.join(autres, " ") : Prisma.empty}
    ORDER BY c."entite", c."entiteId"
    LIMIT ${limite}`;
  return lignes.map((l) => ({ entite: l.entite as EntiteMotsCpt, entiteId: l.entiteId }));
}
