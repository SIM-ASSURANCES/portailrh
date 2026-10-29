// ".env" de la racine du monorepo chargé AVANT tout autre import (voir `chargerEnv.ts`) : toujours la première ligne.
import "./chargerEnv";
import readline from "node:readline/promises";

import { prisma } from "../src/prisma";
import {
  CONFIRMATION_REINITIALISATION,
  ReinitialisationError,
  enregistrerNettoyageFichiers,
  executerReinitialisation,
  genererSauvegardeReinitialisation,
  simulerReinitialisation,
} from "../src/reinitialisation";
import { CLASSIFICATION_TABLES } from "../src/reinitialisationClassification";
import { analyserArguments, confirmationValide, problemesAvantPurge } from "../src/reinitialisationCli";
import { ecrireSauvegardeVerifiee, supprimerFichiersUploads } from "../src/reinitialisationFichiers";
import { urlsFichiersAPurger } from "../src/reinitialisation";

/**
 * Réinitialisation avant mise en production, en ligne de commande (lot N). Même logique que l'écran
 * `/systeme/reinitialisation` (`backend/src/reinitialisation.ts`) : purge de TOUTES les données de test, jamais de la
 * configuration (tableau « purgée / conservée » : `reinitialisationClassification.ts` et docs/mise-en-production.md).
 *
 *   npx tsx prisma/reinitialiser-production.ts                         # SIMULATION : compte ce qui serait supprimé, n'écrit RIEN
 *   npx tsx prisma/reinitialiser-production.ts --appliquer --utilisateur dg@exemple.ci \
 *        [--dossier-sauvegarde ./sauvegardes] [--uploads ./uploads] [--confirmation REINITIALISER]
 *
 * Garde-fous (aucun n'est contournable) : compte portant `systeme.reinitialiser` par son RÔLE (le DG ; jamais une délégation) ;
 * phrase exacte REINITIALISER (tapée si --confirmation est absente) ; sauvegarde JSON complète écrite, fsync, RELUE et vérifiée
 * AVANT la purge — si elle échoue, rien n'est supprimé ; empreinte de la sauvegarde recomparée DANS la transaction de purge ;
 * verrou unique qui interdit une seconde purge (levée par la commande SQL du runbook, § 10).
 * Les fichiers de uploads/ ne sont pas dans le JSON : copier le dossier avant (le script rappelle le chemin).
 * LANCÉ À LA MAIN, jamais par une migration ni au démarrage.
 */
async function main() {
  const args = analyserArguments(process.argv.slice(2), process.env, process.cwd());
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL absente.");

  const sim = await simulerReinitialisation();
  console.log("=== Réinitialisation avant mise en production ===");
  console.log(`Mode : ${args.appliquer ? "RÉEL (--appliquer)" : "SIMULATION (aucune écriture)"}`);
  console.log(`Verrou de réinitialisation : ${sim.verrouActif ? "ACTIF (une purge a déjà eu lieu)" : "libre"}`);
  console.log(`Module Encaissements : ${sim.encEnService ? "EN SERVICE → conservé en entier" : "pas encore en service → données de test purgées"}`);
  console.log("\nLignes qui seraient supprimées (table du schéma Prisma → nombre) :");
  for (const [table, n] of Object.entries(sim.decompte)) console.log(`  ${table.padEnd(34)} ${String(n).padStart(8)}`);
  console.log(`  ${"TOTAL".padEnd(34)} ${String(Object.values(sim.decompte).reduce((a, b) => a + b, 0)).padStart(8)}`);
  console.log(`Fichiers de uploads/ référencés : ${sim.fichiers}`);
  console.log("\nTables CONSERVÉES (jamais touchées) :");
  for (const [modele, c] of Object.entries(CLASSIFICATION_TABLES)) if (c.statut === "CONSERVEE") console.log(`  ${modele} — ${c.note}`);
  console.log("\nLe solde de caisse (dont le solde d'ouverture) repart de ZÉRO : le grand livre JournalCaisse est vidé ; ressaisir le solde d'ouverture par l'écran « Solde d'ouverture de caisse ».");

  if (!args.appliquer) {
    console.log("\nSimulation terminée : RIEN n'a été écrit. Pour purger réellement : --appliquer --utilisateur <email du DG>.");
    return;
  }

  const utilisateur = args.utilisateur
    ? await prisma.user.findFirst({
        where: { email: { equals: args.utilisateur.trim(), mode: "insensitive" } },
        select: { id: true, isActive: true, role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } },
      })
    : null;
  const problemes = problemesAvantPurge(args, {
    verrouActif: sim.verrouActif,
    utilisateurTrouve: Boolean(utilisateur),
    utilisateurActif: Boolean(utilisateur?.isActive),
    utilisateurAPermission: Boolean(utilisateur?.role.permissions.some((p) => p.permission.key === "systeme.reinitialiser")),
  });
  if (problemes.length > 0 || !utilisateur) {
    for (const p of problemes) console.error(`REFUS : ${p}`);
    process.exitCode = 1;
    return;
  }

  let confirmation = args.confirmation;
  if (confirmation === null) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    confirmation = await rl.question(`\nCette opération est DÉFINITIVE. Tapez exactement ${CONFIRMATION_REINITIALISATION} pour continuer : `);
    rl.close();
  }
  if (!confirmationValide(confirmation)) {
    console.error(`REFUS : phrase de confirmation incorrecte (attendu : ${CONFIRMATION_REINITIALISATION}).`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nRappel : copiez le dossier ${args.dossierUploads} avant de continuer (non inclus dans la sauvegarde JSON).`);
  const sauvegarde = await genererSauvegardeReinitialisation(utilisateur.id);
  const ecrite = await ecrireSauvegardeVerifiee(args.dossierSauvegarde, sauvegarde.contenu); // lève → rien n'est purgé
  console.log(`Sauvegarde écrite et vérifiée : ${ecrite.chemin} (${ecrite.octets} octets, SHA-256 du fichier ${ecrite.sha256Fichier}).`);

  const urls = urlsFichiersAPurger(sim.jeux);
  const resultat = await executerReinitialisation({ userId: utilisateur.id, sauvegardeSha256: sauvegarde.empreinte });
  const fichiers = await supprimerFichiersUploads(urls, args.dossierUploads);
  await enregistrerNettoyageFichiers(resultat.id, fichiers.supprimes, fichiers.echecs);
  console.log(`\nRéinitialisation EFFECTUÉE (audit ${resultat.id}).`);
  for (const [table, n] of Object.entries(resultat.decompte)) console.log(`  ${table.padEnd(34)} ${String(n).padStart(8)}`);
  console.log(`Fichiers supprimés : ${fichiers.supprimes}, déjà absents : ${fichiers.absents}, échecs : ${fichiers.echecs}.`);
  console.log("Étapes suivantes : désactiver les comptes de test, ressaisir le solde d'ouverture (docs/mise-en-production.md, §5-6).");
}

main()
  .catch((e) => {
    console.error(e instanceof ReinitialisationError ? `REFUS : ${e.message}` : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
