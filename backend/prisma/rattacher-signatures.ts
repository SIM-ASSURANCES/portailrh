// ".env" de la racine du monorepo chargé AVANT tout autre import (voir `chargerEnv.ts`) : toujours la première ligne.
import "./chargerEnv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { etapeSignatures } from "../src/rattrapageEtapes";

/**
 * Lot L bis (2026-10-28) — reprise des signatures du lot L : rattache à leur action signée, PAR IDENTIFIANT, les lignes d'historique
 * qui ne l'étaient que par l'ancien rapprochement (même compte, dans la minute). Même règle que la migration
 * `20261028090000_signature_lien_identifiant` (qui l'a déjà appliquée UNE fois) : ce script sert à contrôler et à rattraper les lignes
 * restées sans lien, et à COMPTER les cas ambigus, qu'il ne devine jamais (elles restent « Signature non rattachée »).
 *
 * Par défaut : SIMULATION (compte par action : déjà liées, rattachables, ambiguës, sans candidate, antérieures à la mise en service
 * des signatures ; n'écrit rien). Avec `--appliquer` : écrit `HistoriqueEntry.actionSigneeId` des seules lignes rattachables, jamais
 * une autre colonne ni une autre table (le journal de caisse n'est pas touché). IDEMPOTENT : seules les lignes sans lien sont vues.
 *
 * LANCÉ À LA MAIN, JAMAIS PAR UNE MIGRATION NI AU DÉMARRAGE.
 *
 *   npx tsx prisma/rattacher-signatures.ts               # simulation
 *   npx tsx prisma/rattacher-signatures.ts --appliquer   # écriture
 */
async function main() {
  const appliquer = process.argv.includes("--appliquer");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL absente.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    // La logique vit dans `src/rattrapageEtapes.ts` (partagée avec `rattrapage-production.ts`).
    const r = await etapeSignatures(prisma, { appliquer, log: console.log });
    console.log(r.resume);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
