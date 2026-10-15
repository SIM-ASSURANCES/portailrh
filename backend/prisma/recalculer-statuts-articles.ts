// ".env" de la racine du monorepo chargé AVANT tout autre import (voir `chargerEnv.ts`) : toujours la première ligne.
import "./chargerEnv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { corrigerDemande, type DemandeARecalculer } from "../src/repriseArticles";

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
    const demandes = await prisma.demande.findMany({
      where: { typeDemande: "STANDARD", lignes: { some: {} } },
      select: {
        id: true,
        reference: true,
        typeDemande: true,
        statut: true,
        etapeCircuit: true,
        modeEtapeDG: true,
        montant: true,
        montantValide: true,
        lignes: { select: { quantite: true, prixUnitaire: true, statutValidation: true, soumiseAuDG: true, decisionDG: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const sommes = await prisma.reglement.groupBy({
      by: ["demandeId"],
      where: { estConfirme: true, estAnnule: false },
      _sum: { montant: true },
    });
    const totalRegle = new Map(sommes.map((s) => [s.demandeId, Number(s._sum.montant ?? 0)]));

    let nombre = 0;
    for (const d of demandes) {
      const entree: DemandeARecalculer = {
        id: d.id,
        reference: d.reference,
        typeDemande: d.typeDemande,
        statut: d.statut,
        etapeCircuit: d.etapeCircuit,
        modeEtapeDG: d.modeEtapeDG,
        montant: Number(d.montant),
        montantValide: Number(d.montantValide ?? 0),
        totalRegle: totalRegle.get(d.id) ?? 0,
        lignes: d.lignes.map((l) => ({
          quantite: l.quantite,
          prixUnitaire: l.prixUnitaire.toString(),
          statutValidation: l.statutValidation,
          soumiseAuDG: l.soumiseAuDG,
          decisionDG: l.decisionDG,
        })),
      };
      const correction = corrigerDemande(entree);
      if (!correction) continue;
      nombre += 1;
      console.log(`${correction.reference} — ${correction.resume.join(" ; ")}`);
      if (!appliquer) continue;
      await prisma.$transaction(async (tx) => {
        await tx.demande.update({ where: { id: d.id }, data: correction.changements });
        // Compte système : l'entrée d'historique exige un auteur, on prend le créateur de la demande comme porteur
        // technique et on le dit dans le détail.
        const demande = await tx.demande.findUniqueOrThrow({ where: { id: d.id }, select: { createurId: true } });
        await tx.historiqueEntry.create({
          data: {
            entity: "Demande",
            entityId: d.id,
            action: "reprise_statut_articles",
            detail: `Reprise du lot B (script manuel) : ${correction.resume.join(" ; ")}`,
            userId: demande.createurId,
          },
        });
      });
    }
    console.log(
      `${demandes.length} demande(s) à articles examinée(s), ${nombre} ${appliquer ? "corrigée(s)" : "à corriger (simulation : relancer avec --appliquer pour écrire)"}.`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
