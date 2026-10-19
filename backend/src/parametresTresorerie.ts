// Paramètres du module Trésorerie modifiables par la Finance (lot I, 2026-10-19). Pour l'instant un seul : la date à partir
// de laquelle la catégorisation est obligatoire pour valider (voir `categorisationObligatoire.ts`, seule règle). Lecture
// et écriture passent ici ; chaque changement est historisé dans `HistoriqueEntry` (entité `ParametreTresorerie`).

import type { Prisma } from "./generated/prisma/client";
import { prisma } from "./prisma";
import { categorisationObligatoireAu, CLE_CATEGORISATION_OBLIGATOIRE_DES, libelleRegleCategorisation } from "./categorisationObligatoire";

type Db = Prisma.TransactionClient | typeof prisma;

export const ENTITE_PARAMETRE_TRESORERIE = "ParametreTresorerie";
export const ACTION_PARAMETRE_CATEGORISATION = "parametre_categorisation_obligatoire";

export interface RegleCategorisation {
  /** Jour (AAAA-MM-JJ) à partir duquel la catégorisation est obligatoire ; `null` = jamais obligatoire. */
  dateDebut: string | null;
  /** La catégorisation est-elle obligatoire AUJOURD'HUI ? */
  obligatoire: boolean;
  libelle: string;
}

/** Date fixée (AAAA-MM-JJ) ou `null` ; une ligne absente (base non migrée) vaut `null` : rien n'est bloqué. */
export async function lireDateCategorisationObligatoire(db: Db = prisma): Promise<string | null> {
  const ligne = await db.parametreTresorerie.findUnique({ where: { cle: CLE_CATEGORISATION_OBLIGATOIRE_DES } });
  return ligne?.valeurDate ? ligne.valeurDate.toISOString().slice(0, 10) : null;
}

/** Règle en vigueur à `maintenant` (point d'entrée UNIQUE des actions et des écrans). */
export async function chargerRegleCategorisation(db: Db = prisma, maintenant: Date = new Date()): Promise<RegleCategorisation> {
  const dateDebut = await lireDateCategorisationObligatoire(db);
  return { dateDebut, obligatoire: categorisationObligatoireAu(dateDebut, maintenant), libelle: libelleRegleCategorisation(dateDebut, maintenant) };
}

/** Raccourci : la catégorisation est-elle obligatoire aujourd'hui ? */
export async function categorisationEstObligatoire(db: Db = prisma, maintenant: Date = new Date()): Promise<boolean> {
  return (await chargerRegleCategorisation(db, maintenant)).obligatoire;
}

/**
 * Fixe (ou efface avec `null`) la date. Écriture et historique dans la même transaction. Ne touche JAMAIS aux demandes,
 * articles ou écritures existants : seule la règle de validation change.
 */
export async function definirDateCategorisationObligatoire(
  date: string | null,
  userId: string
): Promise<{ avant: string | null; apres: string | null; change: boolean }> {
  return prisma.$transaction(async (tx) => {
    const avant = await lireDateCategorisationObligatoire(tx);
    if (avant === date) return { avant, apres: date, change: false };
    const valeurDate = date ? new Date(`${date}T00:00:00.000Z`) : null;
    await tx.parametreTresorerie.upsert({
      where: { cle: CLE_CATEGORISATION_OBLIGATOIRE_DES },
      create: { cle: CLE_CATEGORISATION_OBLIGATOIRE_DES, valeurDate, majParId: userId },
      update: { valeurDate, majAt: new Date(), majParId: userId },
    });
    const fr = (d: string | null) => (d ? d.split("-").reverse().join("/") : "aucune (jamais obligatoire)");
    await tx.historiqueEntry.create({
      data: {
        entity: ENTITE_PARAMETRE_TRESORERIE,
        entityId: CLE_CATEGORISATION_OBLIGATOIRE_DES,
        action: ACTION_PARAMETRE_CATEGORISATION,
        detail: `Date à partir de laquelle la catégorisation est obligatoire : ${fr(avant)} → ${fr(date)}`,
        userId,
      },
    });
    return { avant, apres: date, change: true };
  });
}
