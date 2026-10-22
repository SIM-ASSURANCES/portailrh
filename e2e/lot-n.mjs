// Lot N (2026-10-30) — réinitialisation pour la mise en production et vérification avant mise en service.
// AUTONOME : crée sa PROPRE base jetable `lot_n` (PostgreSQL de test, port 55497), migre, seed, remplit TOUTES les tables de test
// (e2e/lot-n-donnees.ts), lance son PROPRE serveur `next start` sur le port 3101, puis supprime la base. Ne touche jamais une autre base.
// Prérequis : `next build` fait. Parties :
//  1. couverture : chaque table du schéma est classée (purgée / partielle / conservée) ; chaque table PURGÉE est remplie avant la purge.
//  2. délégations (1.7) : `utilisateursAvecPermission` inclut le délégué ACTIF, jamais un donneur désactivé ni une délégation révoquée.
//  3. simulation : n'écrit rien ; refus (sans compte, compte sans la permission, mauvaise phrase, sauvegarde impossible) : rien n'est supprimé.
//  4. purge réelle : sauvegarde JSON relue, table par table (purgée = 0, conservée = intacte), historique / notifications / actions signées partielles,
//     fichiers supprimés, configuration intacte (rôles, permissions, délégations, services, catégories, budgets, signatures, paramètre).
//  5. verrou : seconde purge refusée (CLI, écran, route de sauvegarde 409), non-DG sans accès ; vérification finale (script) lit le verrou.
//  6. l'application démarre et un parcours neuf fonctionne : demande créée (numérotation repartie de 1), solde d'ouverture ressaisi par l'écran.
//  7. levée du verrou par la commande SQL du runbook, puis seconde purge VOLONTAIRE par l'écran (DG) avec sauvegarde téléchargée.
import { chromium } from "playwright";
import pg from "pg";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assurerSignatures } from "./signatures-auto.mjs";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND = path.join(RACINE, "backend");
const FRONTEND = path.join(RACINE, "frontend");
const PORT = 3101;
const B = `http://localhost:${PORT}`;
const ADMIN_URL = "postgresql://postgres:pw@localhost:55497/postgres";
const BASE = "lot_n";
const URL_PG = `postgresql://postgres:pw@localhost:55497/${BASE}`;
const URL_PRISMA = `${URL_PG}?schema=public`;
const ENV = { ...process.env, DATABASE_URL: URL_PRISMA };

const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
const sh = (cmd, args, extra = {}) => spawnSync(cmd, args, { cwd: BACKEND, env: ENV, encoding: "utf8", ...extra });
const tsx = (fichier, args = []) => sh("npx", ["tsx", fichier, ...args]);
const cli = (args) => tsx("prisma/reinitialiser-production.ts", args);
const sortie = (r) => `${r.stdout ?? ""}${r.stderr ?? ""}`;

// ---------- 0. Base jetable ----------
const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${BASE}'`);
await admin.query(`DROP DATABASE IF EXISTS ${BASE}`);
await admin.query(`CREATE DATABASE ${BASE}`);
let r = sh("npx", ["prisma", "migrate", "deploy", "--config", "prisma7.config.ts"]);
verifier("0. migrations appliquées sur la base jetable", /successfully applied/.test(sortie(r)), sortie(r).split("\n").filter(Boolean).pop());
r = tsx("prisma/seed.ts");
verifier("0. seed", r.status === 0, `exit ${r.status}`);
const db = new pg.Client({ connectionString: URL_PG });
await db.connect();
await assurerSignatures(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const nombre = async (table, ou = "") => (await q(`SELECT count(*)::int AS n FROM "${table}" ${ou}`))[0].n;
r = tsx("../e2e/lot-n-donnees.ts");
verifier("0. base remplie par la fixture", r.status === 0 && /Base remplie/.test(sortie(r)), sortie(r).trim().split("\n").pop());

// ---------- 1. Couverture ----------
const classification = JSON.parse(tsx("../e2e/lot-n-classification.ts").stdout.trim().split("\n").pop());
const tables = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> '_prisma_migrations' ORDER BY 1`)).map((t) => t.table_name);
const nonClassees = tables.filter((t) => !(t in classification));
verifier("1. chaque table de la base est classée", nonClassees.length === 0, nonClassees.join(", "));
const purgees = Object.entries(classification).filter(([, c]) => c.statut === "PURGEE").map(([t]) => t);
const vides = [];
for (const t of purgees) if ((await nombre(t)) === 0) vides.push(t);
verifier(`1. chaque table PURGÉE contient des données avant la purge (${purgees.length} tables)`, vides.length === 0, `vides : ${vides.join(", ")}`);

// ---------- 2. Délégations et notifications par permission ----------
r = tsx("../e2e/lot-n-delegations.ts");
let del = null;
try {
  del = JSON.parse(sortie(r).trim().split("\n").pop());
} catch {
  del = null;
}
verifier("2. utilisateursAvecPermission : titulaire (RH) ET délégué actif (collaborateur)", !!del && del.complet.includes(del.rh) && del.complet.includes(del.collab), sortie(r).slice(-200));
verifier("2. sans les délégués (décision lue sur le rôle) : le délégué n'y est pas", !!del && del.sansDelegues.includes(del.rh) && !del.sansDelegues.includes(del.collab));
verifier("2. excludeUserId retire le délégué", !!del && !del.sansCollab.includes(del.collab) && del.sansCollab.includes(del.rh));
verifier("2. donneur désactivé : la délégation ne compte plus", !!del && !del.donneurInactif.includes(del.collab) && !del.donneurInactif.includes(del.rh));
verifier("2. délégation révoquée : le délégué n'est plus notifié", !!del && !del.revoquee.includes(del.collab) && del.revoquee.includes(del.rh));

// ---------- Instantané « avant » ----------
const avant = {};
for (const t of tables) avant[t] = await nombre(t);
const histoAvant = Object.fromEntries((await q(`SELECT entity, count(*)::int AS n FROM "HistoriqueEntry" GROUP BY entity`)).map((x) => [x.entity, x.n]));
const notifAvant = Object.fromEntries((await q(`SELECT category, count(*)::int AS n FROM "Notification" GROUP BY category`)).map((x) => [x.category, x.n]));
const rolePermsAvant = await nombre("RolePermission");

// ---------- Serveur de production sur la base jetable ----------
const serveur = spawn("npx", ["next", "start", "-p", String(PORT)], {
  cwd: FRONTEND,
  detached: true,
  stdio: "ignore",
  env: { ...ENV, AUTH_SECRET: "secret-e2e-lotn-0123456789abcdef0123456789abcdef", AUTH_URL: B, ALLOWED_OFFICE_IPS: "10.9.9.9,127.0.0.1,::1", CRON_SECRET: "secret-e2e", AUTH_TRUST_HOST: "true", PLANIFICATEUR_ACTIF: "false" },
});
const arreterServeur = () => {
  try {
    process.kill(-serveur.pid);
  } catch {
    /* déjà arrêté */
  }
};
process.on("exit", arreterServeur);
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${B}/login`)).ok) break;
  } catch {
    /* pas encore prêt */
  }
  await new Promise((res) => setTimeout(res, 1000));
}

const tmp = mkdtempSync(path.join(os.tmpdir(), "lot-n-"));
const uploads = path.join(tmp, "uploads");
mkdirSync(uploads);
for (const f of ["lot-n-test.pdf", "lot-n-test-2.pdf", "enc-lot-n.xlsx"]) writeFileSync(path.join(uploads, f), "x");
const sauvegardes = path.join(tmp, "sauvegardes");

// ---------- 3. Simulation et refus : rien n'est écrit ----------
// Le serveur de production écrit seul dans ces deux tables (incidents SMTP / Firebase non configurés, planificateur) : hors comparaison,
// comme elles sont hors empreinte de la sauvegarde.
const BRUIT = ["JournalTechnique", "ExecutionTache"];
const tablesStables = tables.filter((t) => !BRUIT.includes(t));
const instantane = async () => JSON.stringify(Object.fromEntries(await Promise.all(tablesStables.map(async (t) => [t, await nombre(t)]))));
const comptesAvant = JSON.stringify(Object.fromEntries(tablesStables.map((t) => [t, avant[t]])));
const diff = (a, b) => {
  const x = JSON.parse(a);
  const y = JSON.parse(b);
  return Object.keys(x).filter((k) => x[k] !== y[k]).map((k) => `${k}: ${x[k]}→${y[k]}`).join(", ");
};
r = cli([]);
verifier("3. simulation : affiche le détail et conclut « RIEN n'a été écrit »", r.status === 0 && /SIMULATION/.test(sortie(r)) && /RIEN n'a été écrit/.test(sortie(r)) && /demande\s+1/.test(sortie(r)));
{
  const maintenant = await instantane();
  verifier("3. simulation : aucune table modifiée", maintenant === comptesAvant, diff(comptesAvant, maintenant));
}
r = cli(["--appliquer", "--confirmation", "REINITIALISER", "--dossier-sauvegarde", sauvegardes, "--uploads", uploads]);
verifier("3. refus : sans --utilisateur", r.status === 1 && /--utilisateur/.test(sortie(r)));
r = cli(["--appliquer", "--utilisateur", "finance@simassurances.test", "--confirmation", "REINITIALISER", "--dossier-sauvegarde", sauvegardes, "--uploads", uploads]);
verifier("3. refus : compte dont le rôle n'a pas systeme.reinitialiser (Finance)", r.status === 1 && /systeme\.reinitialiser/.test(sortie(r)));
r = cli(["--appliquer", "--utilisateur", "dg@simassurances.test", "--confirmation", "reinitialiser", "--dossier-sauvegarde", sauvegardes, "--uploads", uploads]);
verifier("3. refus : phrase de confirmation incorrecte (casse)", r.status === 1 && /phrase de confirmation incorrecte/.test(sortie(r)));
const fichierBloquant = path.join(tmp, "pas-un-dossier");
writeFileSync(fichierBloquant, "x");
r = cli(["--appliquer", "--utilisateur", "dg@simassurances.test", "--confirmation", "REINITIALISER", "--dossier-sauvegarde", path.join(fichierBloquant, "sous"), "--uploads", uploads]);
verifier("3. sauvegarde impossible (dossier inutilisable) : la purge est REFUSÉE", r.status !== 0 && /Sauvegarde|sauvegarde/.test(sortie(r)), sortie(r).trim().split("\n").pop());
{
  const maintenant = await instantane();
  verifier("3. rien n'a été supprimé après ces refus", maintenant === comptesAvant && existsSync(path.join(uploads, "lot-n-test.pdf")), diff(comptesAvant, maintenant));
}
verifier("3. aucun verrou posé par les refus", (await nombre("ReinitialisationSysteme")) === 0);

// ---------- 4. Purge réelle ----------
r = cli(["--appliquer", "--utilisateur", "dg@simassurances.test", "--confirmation", "REINITIALISER", "--dossier-sauvegarde", sauvegardes, "--uploads", uploads]);
verifier("4. purge réelle réussie", r.status === 0 && /Réinitialisation EFFECTUÉE/.test(sortie(r)), sortie(r).trim().split("\n").slice(-3).join(" | "));
const fichiersSauvegarde = existsSync(sauvegardes) ? readdirSync(sauvegardes).filter((f) => f.endsWith(".json")) : [];
verifier("4. une sauvegarde JSON horodatée a été écrite AVANT la purge", fichiersSauvegarde.length === 1 && /^sauvegarde-reinitialisation-\d{4}-/.test(fichiersSauvegarde[0] ?? ""));
let sauvegarde = null;
try {
  sauvegarde = JSON.parse(readFileSync(path.join(sauvegardes, fichiersSauvegarde[0]), "utf8"));
} catch {
  sauvegarde = null;
}
verifier("4. la sauvegarde contient les lignes supprimées (demande, règlement, pointage, encAudit)", !!sauvegarde && sauvegarde.tables.demande.length === 1 && sauvegarde.tables.reglement.length === 1 && sauvegarde.tables.pointage.length === 1 && sauvegarde.tables.encAudit.length === 1);
verifier("4. la sauvegarde porte l'empreinte et le décompte", !!sauvegarde && /^[0-9a-f]{64}$/.test(sauvegarde.meta.empreinteSha256) && sauvegarde.meta.decompte.demande === 1);
verifier("4. fichiers de uploads/ supprimés", !existsSync(path.join(uploads, "lot-n-test.pdf")) && !existsSync(path.join(uploads, "lot-n-test-2.pdf")) && !existsSync(path.join(uploads, "enc-lot-n.xlsx")));

// Table par table
const apres = {};
for (const t of tables) apres[t] = await nombre(t);
const ecartsPurgees = purgees.filter((t) => apres[t] !== 0 && !BRUIT.includes(t));
verifier(`4. table par table : les ${purgees.length} tables PURGÉES sont vides`, ecartsPurgees.length === 0, ecartsPurgees.map((t) => `${t}=${apres[t]}`).join(", "));
const conservees = Object.entries(classification).filter(([, c]) => c.statut === "CONSERVEE").map(([t]) => t);
const attendus = { ReinitialisationSysteme: avant.ReinitialisationSysteme + 1 };
const ecartsConservees = conservees.filter((t) => apres[t] !== (attendus[t] ?? avant[t]));
verifier(`4. table par table : les ${conservees.length} tables CONSERVÉES sont intactes (verrou +1)`, ecartsConservees.length === 0, ecartsConservees.map((t) => `${t}: ${avant[t]}→${apres[t]}`).join(", "));
const histoApres = Object.fromEntries((await q(`SELECT entity, count(*)::int AS n FROM "HistoriqueEntry" GROUP BY entity`)).map((x) => [x.entity, x.n]));
const entitesPurgees = ["Demande", "LigneDemande", "JournalCaisse", "RetourExterne", "Pointage", "PointageQR", "PointageGeo", "JustificationPointage", "DemandeConge"];
verifier("4. historique : entités de test supprimées", entitesPurgees.every((e) => !histoApres[e]), JSON.stringify(entitesPurgees.filter((e) => histoApres[e])));
const histoConservees = Object.keys(histoAvant).filter((e) => !entitesPurgees.includes(e));
const ecartHisto = histoConservees.filter((e) => histoApres[e] !== histoAvant[e]);
verifier("4. historique : audit et configuration conservés à l'identique (User, BudgetParametrage…)", ecartHisto.length === 0 && histoConservees.includes("BudgetParametrage") && histoConservees.includes("User"), ecartHisto.join(", "));
verifier("4. historique : la purge s'est tracée (ReinitialisationSysteme)", histoApres.ReinitialisationSysteme === 1);
const notifApres = Object.fromEntries((await q(`SELECT category, count(*)::int AS n FROM "Notification" GROUP BY category`)).map((x) => [x.category, x.n]));
verifier("4. notifications : TRESORERIE / RH / POINTAGE supprimées, ADMIN / SYSTEME conservées", !notifApres.TRESORERIE && !notifApres.RH && !notifApres.POINTAGE && notifApres.ADMIN === notifAvant.ADMIN && notifApres.SYSTEME === notifAvant.SYSTEME, JSON.stringify(notifApres));
const signees = await q(`SELECT entite FROM "ActionSignee"`);
verifier("4. actions signées : seule celle liée à l'historique conservé (budget) subsiste", signees.length === 1 && signees[0].entite === "BudgetParametrage");
const lien = await q(`SELECT count(*)::int AS n FROM "HistoriqueEntry" h JOIN "ActionSignee" a ON a.id = h."actionSigneeId" WHERE h.entity = 'BudgetParametrage'`);
verifier("4. l'historique du budget garde le lien vers sa signature (pas de « Signature non rattachée »)", lien[0].n === 1);

// Congés (lot Q) : demandes (validée et rejetée), plage liée, historique et notifications purgés ; jours fériés conservés
verifier("4. congés : les demandes de congé (validée et rejetée) sont supprimées", avant.DemandeConge === 2 && apres.DemandeConge === 0, `${avant.DemandeConge}→${apres.DemandeConge}`);
verifier("4. congés : leur historique est supprimé, y compris l'entité DemandeConge", !histoApres.DemandeConge && histoAvant.DemandeConge === 2);
verifier("4. congés : plus aucune plage d'absence liée à un congé (aucune orpheline)", (await nombre("PlageAbsenceAutorisee", `WHERE "demandeCongeId" IS NOT NULL`)) === 0);
verifier("4. congés : jours fériés conservés", (await nombre("JourFerie")) === avant.JourFerie && avant.JourFerie >= 1);

// Configuration intacte
verifier("4. config : permissions des rôles inchangées", (await nombre("RolePermission")) === rolePermsAvant);
verifier("4. config : signatures enrôlées et leurs versions (finance : 2 versions de plus)", (await q(`SELECT count(*)::int AS n FROM "SignatureUtilisateur" s JOIN "User" u ON u.id = s."userId" WHERE u.email = 'finance@simassurances.test'`))[0].n >= 2);
verifier("4. config : budgets validés (catégorie + seuils de caisse) conservés", (await nombre("BudgetParametrage", `WHERE statut = 'VALIDE'`)) === 2);
verifier("4. config : date « catégorisation obligatoire » conservée", (await q(`SELECT "valeurDate" FROM "ParametreTresorerie" WHERE cle = 'categorisation.obligatoire_a_partir_du'`))[0]?.valeurDate?.toISOString().startsWith("2027-01-15"));
verifier("4. config : délégation, catégories, objets, services avec responsable", (await nombre("PermissionDelegation", `WHERE "estActive"`)) >= 1 && (await nombre("Categorie")) >= 1 && (await nombre("Objet")) >= 1 && (await nombre("Service", `WHERE "responsableId" IS NOT NULL`)) === 8);
verifier("4. config : comptes tous présents et actifs", (await nombre("User", `WHERE "isActive"`)) === avant.User);
verifier("4. caisse : le grand livre est vide (solde 0, solde d'ouverture à ressaisir)", (await nombre("JournalCaisse")) === 0);
verifier("4. numérotation : plus aucune demande (la prochaine repart de 1)", (await nombre("Demande")) === 0);

// ---------- 5. Verrou ----------
const apresVerrou = await instantane();
r = cli(["--appliquer", "--utilisateur", "dg@simassurances.test", "--confirmation", "REINITIALISER", "--dossier-sauvegarde", sauvegardes, "--uploads", uploads]);
verifier("5. verrou : seconde purge refusée par la ligne de commande", r.status === 1 && /verrou/.test(sortie(r)));
verifier("5. verrou : rien n'a changé après ce refus", (await instantane()) === apresVerrou);
verifier("5. verrou : une seule ligne de verrou actif", (await nombre("ReinitialisationSysteme", `WHERE verrou = 'REINITIALISATION'`)) === 1);

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const erreursJs = [];
const PDF = (nom) => ({ name: nom, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n") });
async function connecter(email) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(e.message));
  await p.goto(`${B}/login`);
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', "password123");
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click('button[type="submit"]')]);
  return { ctx, p };
}
const attendre = async (fn, ms = 20000) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await fn()) return true;
    await new Promise((res) => setTimeout(res, 250));
  }
  return false;
};

{
  const dg = await connecter("dg@simassurances.test");
  const rep = await dg.ctx.request.get(`${B}/api/systeme/reinitialisation/sauvegarde`);
  verifier("5. verrou : la route de sauvegarde répond 409 au DG", rep.status() === 409, String(rep.status()));
  await dg.p.goto(`${B}/systeme/reinitialisation`);
  verifier("5. verrou : l'écran affiche le verrou actif et l'audit, la remise à zéro est grisée (lot R : étapes dans l'ordre)", (await dg.p.locator('[data-etat-verrou="actif"]').count()) === 1 && (await dg.p.locator('[data-section="audit"]').count()) === 1 && (await dg.p.locator('[data-action="purger"]').isDisabled()));
  await dg.ctx.close();
  const fin = await connecter("finance@simassurances.test");
  const repF = await fin.ctx.request.get(`${B}/api/systeme/reinitialisation/sauvegarde`);
  verifier("5. permission : la route de sauvegarde refuse la Finance (403)", repF.status() === 403, String(repF.status()));
  await fin.p.goto(`${B}/systeme/reinitialisation`);
  verifier("5. permission : l'écran de réinitialisation est inaccessible à la Finance", !fin.p.url().includes("/systeme/reinitialisation"), fin.p.url());
  await fin.ctx.close();
  const anon = await fetch(`${B}/api/systeme/reinitialisation/sauvegarde`, { redirect: "manual" });
  verifier("5. permission : route de sauvegarde sans session refusée", [401, 307, 302].includes(anon.status), String(anon.status));
}
const avantVerif = await instantane();
r = sh("npx", ["tsx", "prisma/verifier-mise-en-production.ts", "--final"]);
verifier("5. script de vérification : lit le verrou (« déjà effectuée ») et reste en lecture seule", /déjà effectuée/.test(sortie(r)) && r.status === 1 && /À CORRIGER/.test(sortie(r)));
verifier("5. script de vérification : n'a rien écrit", (await instantane()) === avantVerif);

// ---------- 6. Parcours neuf après la purge ----------
{
  const c = await connecter("collaborateur@simassurances.test");
  await c.p.goto(`${B}/treso/demandes/nouvelle`);
  await c.p.locator('input[aria-label="Libellé de l\'article"]').first().fill("Article après purge");
  await c.p.locator('input[aria-label="Motif de la ligne"]').first().fill("motif après purge");
  await c.p.locator('input[aria-label="Prix unitaire"]').first().fill("15000");
  await c.p.getByRole("button", { name: "Envoyer la demande" }).click();
  await c.p.getByText("Demande créée avec succès.").waitFor({ timeout: 30000 });
  const d = (await q(`SELECT reference, "etapeCircuit", statut FROM "Demande"`))[0];
  verifier("6. parcours neuf : demande créée, numérotation repartie de 1", !!d && /^DEM-\d{4}-000001$/.test(d.reference), JSON.stringify(d));
  verifier("6. parcours neuf : la demande entre dans le circuit (étape Service)", d?.etapeCircuit === "SERVICE");
  await c.ctx.close();

  const f = await connecter("finance@simassurances.test");
  await f.p.goto(`${B}/treso/finance/solde-ouverture`);
  verifier("6. solde d'ouverture : l'écran propose de le DÉFINIR (aucun solde en vigueur)", (await f.p.getByText("Aucun solde d'ouverture n'a encore été défini").count()) === 1);
  await f.p.getByLabel("Montant (FCFA)").fill("750000");
  await f.p.locator('input[type="file"]').first().setInputFiles(PDF("comptage.pdf"));
  await f.p.getByText(/Fichier envoyé/).first().waitFor({ timeout: 20000 });
  await f.p.getByRole("button", { name: "Définir le solde d'ouverture" }).click();
  const ok = await attendre(async () => (await nombre("JournalCaisse", `WHERE source = 'solde_ouverture'`)) === 1);
  const ecr = (await q(`SELECT type, montant::float AS montant FROM "JournalCaisse" WHERE source = 'solde_ouverture'`))[0];
  verifier("6. solde d'ouverture ressaisi par le mode normal : UNE écriture ENTREE de 750 000", ok && ecr?.type === "ENTREE" && ecr.montant === 750000, JSON.stringify(ecr));
  await f.p.goto(`${B}/treso/finance`);
  verifier("6. tableau de bord Finance : charge après la purge", (await f.p.getByText("750").count()) >= 1 || f.p.url().includes("/treso/finance"));
  await f.ctx.close();
}

// ---------- 7. Levée du verrou (SQL du runbook) puis seconde purge volontaire par l'écran ----------
await db.query(`UPDATE "ReinitialisationSysteme" SET verrou = 'LEVE-' || id WHERE verrou = 'REINITIALISATION'`);
verifier("7. SQL du runbook : le verrou est levé, la ligne d'audit est conservée", (await nombre("ReinitialisationSysteme", `WHERE verrou = 'REINITIALISATION'`)) === 0 && (await nombre("ReinitialisationSysteme")) === 1);
r = cli([]);
verifier("7. la simulation voit le verrou « libre »", /Verrou de réinitialisation : libre/.test(sortie(r)));
{
  const dg = await connecter("dg@simassurances.test");
  await dg.p.goto(`${B}/systeme/reinitialisation`);
  verifier("7. écran : le DG retrouve les étapes (simulation d'abord, étape 3 absente puisque le verrou est levé)", (await dg.p.locator('[data-action="simuler"]').count()) === 1 && (await dg.p.locator('[data-etape="LEVEE_VERROU"]').count()) === 0);
  const confirmer = dg.p.getByRole("button", { name: "Réinitialiser définitivement" });
  verifier("7. écran : « Réinitialiser » grisé sans simulation, sauvegarde ni phrase", await confirmer.isDisabled());
  await dg.p.locator('[data-action="simuler"]').click();
  await dg.p.locator("[data-simulation]").waitFor({ timeout: 60000 });
  const boutonSauvegarde = dg.p.locator('[data-action="sauvegarder"]');
  const [telechargement] = await Promise.all([dg.p.waitForEvent("download", { timeout: 30000 }), boutonSauvegarde.click()]);
  const fichier = path.join(tmp, "sauvegarde-ecran.json");
  await telechargement.saveAs(fichier);
  let web = null;
  try {
    web = JSON.parse(readFileSync(fichier, "utf8"));
  } catch {
    web = null;
  }
  verifier("7. écran : la sauvegarde téléchargée est un JSON valide (BigInt d'EncAudit compris) avec la demande du parcours neuf", !!web && web.tables.demande.length === 1 && Array.isArray(web.tables.encAudit));
  await dg.p.locator('[data-champ="phrase-purge"]').fill("REINITIALISE");
  verifier("7. écran : phrase incomplète → toujours grisé", await confirmer.isDisabled());
  await dg.p.locator('[data-champ="phrase-purge"]').fill("REINITIALISER");
  await confirmer.click();
  const fait = await attendre(async () => (await nombre("ReinitialisationSysteme", `WHERE verrou = 'REINITIALISATION'`)) === 1, 60000);
  verifier("7. écran : seconde purge VOLONTAIRE effectuée, verrou reposé", fait);
  verifier("7. écran : la demande du parcours neuf est purgée, deux lignes d'audit conservées", (await nombre("Demande")) === 0 && (await nombre("ReinitialisationSysteme")) === 2);
  verifier("7. écran : la configuration reste intacte après la seconde purge", (await nombre("BudgetParametrage", `WHERE statut = 'VALIDE'`)) === 2 && (await nombre("RolePermission")) === rolePermsAvant);
  await dg.ctx.close();
}
r = cli(["--appliquer", "--utilisateur", "dg@simassurances.test", "--confirmation", "REINITIALISER", "--dossier-sauvegarde", sauvegardes, "--uploads", uploads]);
verifier("7. verrou reposé : une troisième purge est refusée", r.status === 1 && /verrou/.test(sortie(r)));

verifier("aucune erreur JavaScript non interceptée", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));

// ---------- Nettoyage ----------
await browser.close();
arreterServeur();
await db.end();
await new Promise((res) => setTimeout(res, 1500));
await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${BASE}'`).catch(() => {});
await admin.query(`DROP DATABASE IF EXISTS ${BASE}`).catch(() => {});
await admin.end();

console.log(resultats.join("\n"));
const ko = resultats.filter((x) => x.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles OK`);
process.exit(ko ? 1 : 0);
