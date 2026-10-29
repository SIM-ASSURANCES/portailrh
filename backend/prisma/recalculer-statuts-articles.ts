// ".env" de la racine du monorepo chargé AVANT tout autre import (voir `chargerEnv.ts`) : toujours la première ligne.
import "./chargerEnv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { etapeStatutsArticles } from "../src/rattrapageEtapes";

/**
 * Reprise des demandes existantes pour le lot B « décision Finance par article » (2026-10-15).
 *
 * Recalcule, pour chaque demande À ARTICLES (type STANDARD avec au moins une ligne) :
 *   - le montant validé (somme des articles validés) ;
 *   - l'étape (déduite des articles : Finance, DG, Terminée, À corriger — les étapes Service / À corriger / Abandonnée
 *     posées explicitement ne changent pas) ;
 *   - le statut (règle `statutDepuisLignes` : « Réglée » devient atteignable avec un article rejeté, etc.).
 * Les demandes sans article (dépense directe) et les demandes rejetées, clôturées ou abandonnées (statut et étape) ne sont
 * pas touchées. IDEMPOTENT : un second passage ne trouve plus rien à changer.
 *
 * LANCÉ À LA MAIN, JAMAIS PAR UNE MIGRATION NI AU DÉMARRAGE. Par défaut : simulation (aucune écriture, liste des
 * changements). Avec `--appliquer` : écrit les changements (une transaction par demande) et trace une entrée d'historique.
 *
 *   npx tsx prisma/recalculer-statuts-articles.ts               # simulation
 *   npx tsx prisma/recalculer-statuts-articles.ts --appliquer   # écriture
 */
async function main() {
  const appliquer = process.argv.includes("--appliquer");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL absente.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    // La logique vit dans `src/rattrapageEtapes.ts` (partagée avec `rattrapage-production.ts`).
    const r = await etapeStatutsArticles(prisma, { appliquer, log: console.log });
    console.log(r.resume);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
