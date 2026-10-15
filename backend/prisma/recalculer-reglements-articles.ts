// ".env" de la racine du monorepo chargé AVANT tout autre import (voir `chargerEnv.ts`) : toujours la première ligne.
import "./chargerEnv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { classerDemande, refusRattachement, type DemandeARattacher } from "../src/repriseReglements";
import { montantValideArticle } from "../src/reglementArticle";

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
    const demandes = await prisma.demande.findMany({
      where: { lignes: { some: {} }, reglements: { some: {} } },
      select: {
        id: true,
        reference: true,
        createurId: true,
        lignes: {
          select: { id: true, libelle: true, quantite: true, prixUnitaire: true, statutValidation: true, categorieId: true },
          orderBy: { createdAt: "asc" },
        },
        reglements: {
          select: { id: true, ligneDemandeId: true, montant: true, mode: true, estConfirme: true, estAnnule: true, confirmeAt: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    const vue = (d: (typeof demandes)[number]): DemandeARattacher => ({
      id: d.id,
      reference: d.reference,
      articles: d.lignes.map((l) => ({ ...l, prixUnitaire: Number(l.prixUnitaire) })),
      reglements: d.reglements.map((r) => ({ id: r.id, ligneDemandeId: r.ligneDemandeId, montant: Number(r.montant), mode: r.mode, estConfirme: r.estConfirme, estAnnule: r.estAnnule })),
    });
    const eur = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

    let ambigus = 0;
    let rattaches = 0;
    for (const d of demandes) {
      const v = vue(d);
      const c = classerDemande(v);
      if (c.classe === "AMBIGU") {
        ambigus += 1;
        console.log(`\n[AMBIGU] ${d.reference} — règlements sans article à rattacher à la main :`);
        for (const r of d.reglements.filter((x) => c.reglementIds.includes(x.id))) {
          console.log(`  règlement ${r.id} : ${eur(Number(r.montant))} ${r.mode} ${r.estConfirme ? "confirmé" : "brouillon"} (${(r.confirmeAt ?? r.createdAt).toISOString().slice(0, 10)})`);
        }
        console.log("  articles validés :");
        for (const a of v.articles.filter((x) => x.statutValidation === "VALIDEE")) {
          console.log(`  article ${a.id} : « ${a.libelle} » validé ${eur(montantValideArticle(a))}`);
        }
      }
      if (c.classe === "AUTOMATIQUE") {
        console.log(`\n[AUTOMATIQUE] ${d.reference} — ${c.reglementIds.length} règlement(s) → article ${c.ligneId}`);
        if (automatique) {
          rattaches += c.reglementIds.length;
          if (appliquer) {
            await prisma.$transaction(async (tx) => {
              await tx.reglement.updateMany({ where: { id: { in: c.reglementIds }, ligneDemandeId: null }, data: { ligneDemandeId: c.ligneId } });
              await tx.historiqueEntry.create({
                data: {
                  entity: "Demande",
                  entityId: d.id,
                  action: "rattachement_reglement_article",
                  detail: `Reprise du lot D (script manuel) : ${c.reglementIds.length} règlement(s) rattaché(s) à l'unique article validé.`,
                  userId: d.createurId,
                },
              });
            });
          }
        }
      }
    }

    for (const a of affectations) {
      const d = demandes.find((x) => x.reglements.some((r) => r.id === a.reglementId));
      if (!d) {
        console.log(`\n[AFFECTER] règlement ${a.reglementId} : introuvable.`);
        continue;
      }
      const refus = refusRattachement(vue(d), a.reglementId, a.ligneId);
      if (refus) {
        console.log(`\n[AFFECTER] ${d.reference} règlement ${a.reglementId} → article ${a.ligneId} : REFUSÉ — ${refus}`);
        continue;
      }
      console.log(`\n[AFFECTER] ${d.reference} règlement ${a.reglementId} → article ${a.ligneId} : ${appliquer ? "appliqué" : "permis (simulation)"}`);
      rattaches += 1;
      if (appliquer) {
        await prisma.$transaction(async (tx) => {
          const n = await tx.reglement.updateMany({ where: { id: a.reglementId, ligneDemandeId: null }, data: { ligneDemandeId: a.ligneId } });
          if (n.count !== 1) throw new Error("Règlement déjà rattaché entre-temps.");
          await tx.historiqueEntry.create({
            data: {
              entity: "Demande",
              entityId: d.id,
              action: "rattachement_reglement_article",
              detail: `Reprise du lot D (script manuel) : règlement ${a.reglementId} rattaché à l'article ${a.ligneId}.`,
              userId: d.createurId,
            },
          });
        });
      }
    }

    console.log(
      `\n${demandes.length} demande(s) à articles avec règlements examinée(s) ; ${ambigus} ambiguë(s) (avant ce passage) ; ${rattaches} règlement(s) ${appliquer ? "rattaché(s)" : "rattachable(s) (simulation : relancer avec --appliquer pour écrire)"}.`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
