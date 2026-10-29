// ".env" de la racine du monorepo chargé AVANT tout autre import (voir `chargerEnv.ts`) : toujours la première ligne.
import "./chargerEnv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { etapeReglementsArticles } from "../src/rattrapageEtapes";

/**
 * Rattachement des règlements antérieurs au lot D à l'article qu'ils ont payé (2026-10-16).
 *
 * La migration `20261016090000_reglement_par_article` rattache déjà, sans doute possible, les règlements des demandes
 * dont UN SEUL article est validé. Ce script traite le reste :
 *   - il LISTE les demandes ambiguës (deux articles validés ou plus et au moins un règlement non annulé sans article),
 *     avec leurs articles validés et leurs règlements : tant qu'elles existent, aucun règlement ne peut être créé,
 *     modifié ni confirmé sur ces demandes (l'annulation reste possible) ;
 *   - il rattache à la main un règlement à un article avec `--affecter ID_REGLEMENT:ID_ARTICLE` (répétable) ;
 *   - avec `--automatique`, il rattache les cas à un seul article validé qui auraient échappé à la migration.
 * Il ne devine JAMAIS un cas ambigu et ne touche jamais une écriture de caisse (JournalCaisse, JournalBanque).
 *
 * LANCÉ À LA MAIN, JAMAIS PAR UNE MIGRATION NI AU DÉMARRAGE. Par défaut : simulation (aucune écriture). Avec
 * `--appliquer` : écrit (une transaction par demande) et trace une entrée d'historique `rattachement_reglement_article`.
 *
 *   npx tsx prisma/recalculer-reglements-articles.ts                                  # liste + simulation
 *   npx tsx prisma/recalculer-reglements-articles.ts --automatique --appliquer         # cas à un seul article validé
 *   npx tsx prisma/recalculer-reglements-articles.ts --affecter REG:ART --appliquer    # rattachement manuel
 */
async function main() {
  const args = process.argv.slice(2);
  const appliquer = args.includes("--appliquer");
  const automatique = args.includes("--automatique");
  const affectations: { reglementId: string; ligneId: string }[] = [];
  args.forEach((a, i) => {
    if (a === "--affecter") {
      const [reglementId, ligneId] = (args[i + 1] ?? "").split(":");
      if (!reglementId || !ligneId) throw new Error("--affecter attend ID_REGLEMENT:ID_ARTICLE.");
      affectations.push({ reglementId, ligneId });
    }
  });
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL absente.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    // La logique vit dans `src/rattrapageEtapes.ts` (partagée avec `rattrapage-production.ts`).
    const r = await etapeReglementsArticles(prisma, { appliquer, log: console.log, automatique, affectations });
    console.log(r.resume);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
