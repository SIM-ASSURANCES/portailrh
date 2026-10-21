// ".env" de la racine du monorepo chargé AVANT tout autre import (voir `chargerEnv.ts`) : toujours la première ligne.
import "./chargerEnv";
import path from "node:path";
import readline from "node:readline/promises";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  etapeClotureArticles,
  etapeComptageReglements,
  etapeReglementsArticles,
  etapeSignatures,
  etapeStatutsArticles,
  type ResultatEtape,
} from "../src/rattrapageEtapes";
import {
  CONFIRMATION_RATTRAPAGE,
  ETAPES_RATTRAPAGE,
  analyserArgumentsRattrapage,
  confirmationRattrapageValide,
  formaterBilan,
  type BilanEtape,
  type DefinitionEtape,
  type IdEtape,
} from "../src/rattrapageProduction";

/**
 * Rattrapage des données existantes avant la mise en service (lot O) — enchaîne, DANS LE BON ORDRE, les scripts de reprise des
 * lots B, C, D et L bis (même code que chacun d'eux : `src/rattrapageEtapes.ts`).
 *
 *   npx tsx prisma/rattrapage-production.ts                    # SIMULATION (défaut) : compte et liste, n'écrit RIEN
 *   npx tsx prisma/rattrapage-production.ts --appliquer [--confirmation RATTRAPER]
 *
 * Avec --appliquer : phrase RATTRAPER à taper (ou --confirmation), puis pour chaque étape : état avant (simulation), écriture, état
 * APRÈS (nouvelle simulation) ; ARRÊT à la première erreur (les étapes déjà passées restent faites : chacune est idempotente, on
 * peut relancer). Les cas ambigus ne sont jamais devinés. Aucune écriture de caisse n'est touchée.
 * PRÉREQUIS : sauvegarde complète faite (pg_dump, docs/mise-en-production.md étape 1) — le script ne peut pas défaire ses écritures.
 * LANCÉ À LA MAIN, jamais par une migration ni au démarrage.
 */
const indenter = (l: string) => (l.startsWith("\n") ? `\n    ${l.slice(1)}` : `    ${l}`);

async function main() {
  const args = analyserArgumentsRattrapage(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL absente.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    console.log(`=== Rattrapage des données existantes — ${args.appliquer ? "MODE RÉEL (--appliquer)" : "SIMULATION (aucune écriture)"} ===`);

    if (args.appliquer) {
      let confirmation = args.confirmation;
      if (confirmation === null) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        console.log("\nCe script ÉCRIT dans la base (statuts, rattachements, clôtures, signatures) et ne sait pas défaire ses écritures.");
        confirmation = await rl.question(`La sauvegarde pg_dump est-elle faite ? Tapez exactement ${CONFIRMATION_RATTRAPAGE} pour continuer : `);
        rl.close();
      }
      if (!confirmationRattrapageValide(confirmation)) {
        console.error(`REFUS : phrase de confirmation incorrecte (attendu : ${CONFIRMATION_RATTRAPAGE}).`);
        process.exitCode = 1;
        return;
      }
    }

    const bilans: BilanEtape[] = [];
    const executer = async (id: IdEtape, appliquer: boolean, log: (l: string) => void): Promise<ResultatEtape> => {
      switch (id) {
        case "statuts":
          return etapeStatutsArticles(prisma, { appliquer, log });
        case "reglements":
          return etapeReglementsArticles(prisma, { appliquer, log, automatique: true });
        case "cloture":
          return etapeClotureArticles(prisma, { appliquer, log });
        case "signatures":
          return etapeSignatures(prisma, { appliquer, log });
        case "comptage":
          throw new Error("étape de comptage traitée à part");
      }
    };

    for (const etape of ETAPES_RATTRAPAGE as readonly DefinitionEtape[]) {
      console.log(`\n--- Étape ${etape.numero} : ${etape.titre} (lot ${etape.lot})`);
      console.log(`    ${etape.note}${etape.ecrit && etape.irreversible ? " — écriture non défaisable par le script" : ""}`);
      try {
        if (etape.id === "comptage") {
          const c = await etapeComptageReglements(prisma, path.resolve(__dirname, "comptage-reglements-articles.sql"), (l) => console.log(l));
          const avant: ResultatEtape = { examinees: c.lignes, aTraiter: 0, traitees: 0, ambigus: c.demandesAmbigues, resume: "" };
          bilans.push({ etape, avant, appliquees: 0, apres: null });
          continue;
        }
        const avant = await executer(etape.id, false, (l) => console.log(indenter(l)));
        console.log(indenter(avant.resume));
        let apres: ResultatEtape | null = null;
        let appliquees = 0;
        if (args.appliquer && avant.aTraiter > 0) {
          console.log("    → application…");
          const ecrit = await executer(etape.id, true, () => undefined);
          appliquees = ecrit.traitees;
          apres = await executer(etape.id, false, () => undefined);
          console.log(`    → ${appliquees} écrit(s). Contrôle (nouvelle simulation) : ${apres.aTraiter} restant(s) à traiter, ${apres.ambigus} cas ambigu(s) laissé(s) tel(s).`);
        } else if (args.appliquer) {
          apres = avant;
        }
        bilans.push({ etape, avant, appliquees, apres });
      } catch (e) {
        console.error(`\nERREUR à l'étape ${etape.numero} (${etape.titre}) : ${e instanceof Error ? e.message : String(e)}`);
        console.error("ARRÊT : les étapes suivantes n'ont pas été lancées. Les étapes déjà passées sont idempotentes : corriger puis relancer.");
        console.log("\n" + formaterBilan(bilans, args.appliquer));
        process.exitCode = 1;
        return;
      }
    }

    console.log("\n" + formaterBilan(bilans, args.appliquer));
    if (!args.appliquer) console.log("\nSimulation terminée : RIEN n'a été écrit. Pour appliquer : --appliquer (après sauvegarde pg_dump).");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
