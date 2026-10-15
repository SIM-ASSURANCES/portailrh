// ".env" de la racine du monorepo chargé AVANT tout autre import (voir `chargerEnv.ts`) : toujours la première ligne.
import "./chargerEnv";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { detailClotureForcee, instantaneClotureForcee } from "../src/clotureDemande";
import { chargerEvaluationCloture } from "../src/clotureDemandeDb";

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
    const demandes = await prisma.demande.findMany({
      where: { statut: "CLOTUREE", clotureForcee: false, typeDemande: "STANDARD", lignes: { some: {} } },
      select: { id: true, reference: true, createurId: true },
      orderBy: { createdAt: "asc" },
    });
    let incoherentes = 0;
    for (const d of demandes) {
      const { evaluation } = await chargerEvaluationCloture(d.id);
      // Un article encore « à décider » sur une demande clôturée (ancien circuit) n'est pas du ressort de ce lot.
      if (!evaluation.decidee || evaluation.bloquants.length === 0) continue;
      incoherentes += 1;
      const instantane = instantaneClotureForcee(evaluation.bloquants);
      console.log(`${d.reference} — ${evaluation.bloquants.length} article(s) non régularisé(s) : ${detailClotureForcee(instantane)}`);
      if (!appliquer) continue;
      await prisma.$transaction(async (tx) => {
        await tx.demande.update({
          where: { id: d.id },
          data: {
            clotureForcee: true,
            clotureForceeAt: new Date(),
            clotureForceeParId: null,
            clotureForceeArticles: instantane as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.historiqueEntry.create({
          data: {
            entity: "Demande",
            entityId: d.id,
            action: "reprise_cloture_articles",
            detail: `Reprise du lot C (script manuel) : demande clôturée avant la règle « tous les articles terminés », marquée « clôturée sans régularisation » — articles non régularisés : ${detailClotureForcee(instantane)}`,
            userId: d.createurId,
          },
        });
      });
    }
    console.log(
      `${demandes.length} demande(s) à articles clôturée(s) examinée(s), ${incoherentes} incohérente(s) avec la règle du lot C ${
        appliquer ? "marquée(s) « clôturée sans régularisation »" : "(simulation : relancer avec --appliquer pour les marquer)"
      }.`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
