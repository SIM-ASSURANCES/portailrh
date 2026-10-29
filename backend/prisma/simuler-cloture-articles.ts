// ".env" de la racine du monorepo chargé AVANT tout autre import (voir `chargerEnv.ts`) : toujours la première ligne.
import "./chargerEnv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { etapeClotureArticles } from "../src/rattrapageEtapes";

/**
 * Lot C « Clôture : tous les articles terminés » (2026-10-20) — recherche des demandes DÉJÀ clôturées avant ce lot qui ne
 * respectent pas la nouvelle règle (un article validé pas réglé en entier ou pas à solde nul).
 *
 * Une demande clôturée n'est JAMAIS rouverte et aucune écriture de caisse n'est touchée. Par défaut : SIMULATION (liste les
 * demandes concernées et ce qui manque à chaque article, n'écrit rien). Avec `--appliquer` : marque chaque demande comme
 * « clôturée sans régularisation » (`clotureForcee`, instantané des articles non régularisés avec leurs soldes) pour que
 * l'écran et le reporting la distinguent — le statut reste `CLOTUREE`, la date de clôture d'origine est conservée dans
 * l'historique. Une entrée d'historique `reprise_cloture_articles` est tracée (auteur technique = créateur de la demande).
 * IDEMPOTENT : une demande déjà marquée n'est plus examinée.
 *
 * LANCÉ À LA MAIN, JAMAIS PAR UNE MIGRATION NI AU DÉMARRAGE.
 *
 *   npx tsx prisma/simuler-cloture-articles.ts               # simulation
 *   npx tsx prisma/simuler-cloture-articles.ts --appliquer   # écriture
 */
async function main() {
  const appliquer = process.argv.includes("--appliquer");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL absente.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    // La logique vit dans `src/rattrapageEtapes.ts` (partagée avec `rattrapage-production.ts`).
    const r = await etapeClotureArticles(prisma, { appliquer, log: console.log });
    console.log(r.resume);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
