// Lot R (2026-10-22, adapté au lot S) — remise à zéro de mise en production DEPUIS L'APPLICATION : trois étapes dans l'ordre,
// verrou définitif (levé seulement par UPDATE SQL), désactivation des comptes de test, audit. AUTONOME : crée sa PROPRE base jetable `lot_r` (PostgreSQL de test, port 55497),
// migre, seed, remplit TOUTES les tables de test (e2e/lot-n-donnees.ts), lance son PROPRE serveur `next start` (port 3102),
// puis supprime la base. Ne touche jamais une autre base. Prérequis : `next build` fait. Parties :
//  1. état initial (aucun verrou) : seule la simulation est possible ; sauvegarde et remise à zéro bloquées ; aucune étape de levée ;
//     rejeu des Server Actions hors ordre / sans droit : refusé, rien n'est supprimé.
//  2. simulation : décompte table par table (supprimé / conservé), avertissement rouge sur la caisse, rien n'est écrit, tracée.
//  3. sauvegarde : JSON téléchargé avec son empreinte, tracée ; bouton de remise à zéro grisé sans phrase ET après rechargement
//     (sauvegarde non téléchargée dans cette session) ; empreinte fausse / phrase fausse / sans droit : refusés.
//  4. remise à zéro (aucun verrou) : table par table (purgées vides, conservées intactes), audit des étapes conservé, verrou posé,
//     l'écran ne montre plus que « Remise à zéro effectuée le … par … Fonction verrouillée. » ; simulation / sauvegarde / purge refusées.
//  5. comptes de test : Admin (panneau seul), refus (connecté, responsables, dernier porteur de systeme.reinitialiser), DG réel
//     (liste, confirmation, désactivation, jamais supprimés), rappel du solde d'ouverture, sessions coupées.
//  6. verrou existant : rien n'est possible dans l'application ; levée par UPDATE SQL (ligne d'audit gardée) ; étapes recommencées ;
//     seconde remise à zéro.
//  7. l'application redémarre : le verrou est toujours actif et un parcours neuf fonctionne (demande créée, numérotation repartie
//     de 1, solde d'ouverture ressaisi). (Le scénario dédié du lot S est e2e/lot-s.mjs.)
import { chromium } from "playwright";
import pg from "pg";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assurerSignatures } from "./signatures-auto.mjs";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND = path.join(RACINE, "backend");
const FRONTEND = path.join(RACINE, "frontend");
const PORT = 3102;
const B = `http://localhost:${PORT}`;
const ADMIN_URL = "postgresql://postgres:pw@localhost:55497/postgres";
const BASE = "lot_r";
const URL_PG = `postgresql://postgres:pw@localhost:55497/${BASE}`;
const URL_PRISMA = `${URL_PG}?schema=public`;
const ENV = { ...process.env, DATABASE_URL: URL_PRISMA };

const resultats = [];
let imprime = false;
process.on("exit", () => {
  if (!imprime) console.log(`${resultats.join("\n")}\n(interrompu avant la fin)`);
});
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
const sh = (cmd, args, extra = {}) => spawnSync(cmd, args, { cwd: BACKEND, env: ENV, encoding: "utf8", ...extra });
const tsx = (fichier, args = []) => sh("npx", ["tsx", fichier, ...args]);
const sortie = (r) => `${r.stdout ?? ""}${r.stderr ?? ""}`;
const sha = (s) => createHash("sha256").update(s).digest("hex");

// ---------- 0. Base jetable ----------
const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${BASE}'`);
await admin.query(`DROP DATABASE IF EXISTS ${BASE}`);
await admin.query(`CREATE DATABASE ${BASE}`);
let r = sh("npx", ["prisma", "migrate", "deploy", "--config", "prisma7.config.ts"]);
verifier("0. migrations appliquées sur la base jetable", /successfully applied/.test(sortie(r)));
r = tsx("prisma/seed.ts");
verifier("0. seed", r.status === 0, `exit ${r.status}`);
const db = new pg.Client({ connectionString: URL_PG });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const nombre = async (table, ou = "") => (await q(`SELECT count(*)::int AS n FROM "${table}" ${ou}`))[0].n;

// Comptes supplémentaires : un second DG de TEST (non responsable), puis des comptes RÉELS (adresse hors *.test) créés plus tard.
const hash = (await q(`SELECT "passwordHash" AS h FROM "User" WHERE email = 'collaborateur@simassurances.test'`))[0].h;
const idRole = async (nom) => (await q(`SELECT id FROM "Role" WHERE name = $1`, [nom]))[0].id;
const idService = async (nom) => (await q(`SELECT id FROM "Service" WHERE name = $1`, [nom]))[0].id;
async function creerCompte(email, nomComplet, role, service) {
  await db.query(
    `INSERT INTO "User" (id, "fullName", email, "passwordHash", "isActive", "tokenVersion", "serviceId", "roleId", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, true, 0, $4, $5, now())`,
    [nomComplet, email, hash, await idService(service), await idRole(role)]
  );
  return (await q(`SELECT id FROM "User" WHERE email = $1`, [email]))[0].id;
}
await creerCompte("dg2@simassurances.test", "DG Test 2", "DG", "Direction DG");
const idCollabReel = await creerCompte("collab.reel@societe.example", "Collaborateur Réel", "Collaborateur", "Commercial");
const idFinanceReel = await creerCompte("finance.reel@societe.example", "Finance Réelle", "Finance", "Finance");
await assurerSignatures(db);
r = tsx("../e2e/lot-n-donnees.ts");
verifier("0. base remplie par la fixture", r.status === 0 && /Base remplie/.test(sortie(r)), sortie(r).trim().split("\n").pop());

const classification = JSON.parse(tsx("../e2e/lot-n-classification.ts").stdout.trim().split("\n").pop());
const tables = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> '_prisma_migrations' ORDER BY 1`)).map((t) => t.table_name);
const BRUIT = ["JournalTechnique", "ExecutionTache"];
const tablesStables = tables.filter((t) => !BRUIT.includes(t) && t !== "HistoriqueEntry"); // les connexions écrivent dans l'historique
const instantane = async () => JSON.stringify(Object.fromEntries(await Promise.all(tablesStables.map(async (t) => [t, await nombre(t)]))));
const diff = (a, b) => {
  const x = JSON.parse(a);
  const y = JSON.parse(b);
  return Object.keys(x).filter((k) => x[k] !== y[k]).map((k) => `${k}: ${x[k]}→${y[k]}`).join(", ");
};
const avant = {};
for (const t of tables) avant[t] = await nombre(t);
const rolePermsAvant = await nombre("RolePermission");

// ---------- Serveur de production ----------
const manifeste = () => JSON.parse(readFileSync(path.join(FRONTEND, ".next/server/server-reference-manifest.json"), "utf8"));
const idAction = (nom) => {
  const m = manifeste().node ?? {};
  const e = Object.entries(m).find(([, v]) => v.exportedName === nom && /systeme\/reinitialisation\/actions/.test(v.filename ?? ""));
  return e?.[0];
};
let serveur = null;
const lancerServeur = async () => {
  serveur = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: FRONTEND,
    detached: true,
    stdio: "ignore",
    env: { ...ENV, AUTH_SECRET: "secret-e2e-lotr-0123456789abcdef0123456789abcdef", AUTH_URL: B, ALLOWED_OFFICE_IPS: "10.9.9.9,127.0.0.1,::1", CRON_SECRET: "secret-e2e", AUTH_TRUST_HOST: "true", PLANIFICATEUR_ACTIF: "false" },
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${B}/login`)).ok) return;
    } catch {
      /* pas encore prêt */
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
};
const arreterServeur = () => {
  try {
    if (serveur) process.kill(-serveur.pid);
  } catch {
    /* déjà arrêté */
  }
};
process.on("exit", arreterServeur);
await lancerServeur();

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const erreursJs = [];
const PDF = (nom) => ({ name: nom, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n") });
async function connecter(email, { attendreSortie = true } = {}) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(e.message));
  await p.goto(`${B}/login`);
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', "password123");
  if (attendreSortie) await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click('button[type="submit"]')]);
  else {
    await p.click('button[type="submit"]');
    await new Promise((res) => setTimeout(res, 3000));
  }
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
/** Rejeu RÉEL d'une Server Action (même identifiant, même protocole que le navigateur) avec la session d'un contexte. */
async function agir(ctx, nom, args) {
  const id = idAction(nom);
  if (!id) return { message: `(action ${nom} introuvable dans le manifeste)`, brut: "" };
  const rep = await ctx.request.post(`${B}/systeme/reinitialisation`, {
    headers: { "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" },
    data: JSON.stringify(args),
  });
  const brut = await rep.text();
  const m = /"message":"((?:[^"\\]|\\.)*)"/.exec(brut);
  const st = /"status":"(success|error)"/.exec(brut);
  return { message: m ? JSON.parse(`"${m[1]}"`) : "", statut: st?.[1] ?? null, brut };
}
const statutEtape = async (p, id) => (await p.locator(`[data-etape-statut="${id}"]`).innerText().catch(() => "")).trim();
const traces = async (action) => q(`SELECT h.detail, h."entityId", u.email FROM "HistoriqueEntry" h JOIN "User" u ON u.id = h."userId" WHERE h.entity = 'ReinitialisationSysteme' AND h.action = $1 ORDER BY h."createdAt"`, [action]);
const HASH_FAUX = "b".repeat(64);

// ======================================================================================================================
// 1. État initial : aucun verrou
// ======================================================================================================================
const dg = await connecter("dg@simassurances.test");
await dg.p.goto(`${B}/systeme/reinitialisation`);
verifier("1. l'écran du DG s'ouvre et affiche les étapes 1, 2 et 3", (await dg.p.locator('[data-etape="SIMULATION"]').count()) === 1 && (await dg.p.locator('[data-etape="SAUVEGARDE"]').count()) === 1 && (await dg.p.locator('[data-etape="PURGE"]').count()) === 1);
verifier("1. il n'existe aucune étape ni bouton de levée du verrou dans l'application", (await dg.p.locator('[data-etape="LEVEE_VERROU"]').count()) === 0 && (await dg.p.locator('[data-action="lever-verrou"]').count()) === 0 && !idAction("leverVerrouAction"));
verifier("1. statuts initiaux : simulation « À faire », sauvegarde et remise à zéro « Bloquée »", (await statutEtape(dg.p, "SIMULATION")) === "À faire" && (await statutEtape(dg.p, "SAUVEGARDE")) === "Bloquée" && (await statutEtape(dg.p, "PURGE")) === "Bloquée");
verifier("1. boutons Sauvegarde et Remise à zéro grisés", (await dg.p.locator('[data-action="sauvegarder"]').isDisabled()) && (await dg.p.locator('[data-action="purger"]').isDisabled()));
verifier("1. avant toute remise à zéro : ni panneau des comptes de test, ni audit", (await dg.p.locator('[data-section="comptes-test"]').count()) === 0 && (await dg.p.locator('[data-section="audit"]').count()) === 0);
{
  const rep = await dg.ctx.request.get(`${B}/api/systeme/reinitialisation/sauvegarde`);
  verifier("1. route de sauvegarde sans simulation : 409", rep.status() === 409, `${rep.status()} ${(await rep.text()).slice(0, 80)}`);
}
const avantRefus = await instantane();
{
  const a = await agir(dg.ctx, "reinitialiserAction", ["REINITIALISER", HASH_FAUX]);
  verifier("1. rejeu : remise à zéro sans simulation → refusée (étape 1 d'abord)", a.statut === "error" && /simulation/.test(a.message), a.message || a.brut.slice(0, 160));
  const c = await agir(dg.ctx, "desactiverComptesDeTestAction", [[], true]);
  verifier("1. rejeu : désactivation des comptes de test avant toute remise à zéro → refusée", c.statut === "error" && /Aucune remise à zéro/.test(c.message), c.message);
}
{
  const fin = await connecter("finance@simassurances.test");
  const s = await agir(fin.ctx, "simulerAction", []);
  const rz = await agir(fin.ctx, "reinitialiserAction", ["REINITIALISER", HASH_FAUX]);
  const ds = await agir(fin.ctx, "desactiverComptesDeTestAction", [[], true]);
  verifier("1. rejeu par la Finance (sans systeme.reinitialiser) : simulation, remise à zéro, désactivation → « Action non autorisée. »", [s, rz, ds].every((x) => x.message === "Action non autorisée."), [s, rz, ds].map((x) => x.message).join(" | "));
  const rep = await fin.ctx.request.get(`${B}/api/systeme/reinitialisation/sauvegarde`);
  verifier("1. route de sauvegarde : 403 pour la Finance", rep.status() === 403);
  await fin.p.goto(`${B}/systeme/reinitialisation`);
  verifier("1. l'écran est inaccessible à la Finance", !fin.p.url().includes("/systeme/reinitialisation"));
  await fin.ctx.close();
  const adm = await connecter("admin@simassurances.test");
  const ra = await agir(adm.ctx, "reinitialiserAction", ["REINITIALISER", HASH_FAUX]);
  verifier("1. rejeu par l'Admin : remise à zéro refusée (réservée au DG)", ra.message === "Action non autorisée.", ra.message);
  await adm.p.goto(`${B}/systeme/reinitialisation`);
  verifier("1. l'Admin n'accède pas à l'écran avant toute remise à zéro", !adm.p.url().includes("/systeme/reinitialisation"));
  await adm.ctx.close();
}
verifier("1. rien n'a été supprimé par ces refus", (await instantane()) === avantRefus, diff(avantRefus, await instantane()));
verifier("1. aucun verrou posé", (await nombre("ReinitialisationSysteme")) === 0);

// ======================================================================================================================
// 2. Simulation
// ======================================================================================================================
const avantSim = await instantane();
await dg.p.locator('[data-action="simuler"]').click();
await dg.p.locator("[data-simulation]").waitFor({ timeout: 60000 });
const avertissement = (await dg.p.locator("[data-avertissement-caisse]").innerText()).replace(/\s+/g, " ");
verifier("2. avertissement ROUGE sur la caisse (texte exact)", avertissement.includes("La caisse est entièrement vidée, solde d'ouverture compris ; il faudra le ressaisir."), avertissement);
verifier("2. l'avertissement est en rouge (classes danger)", /text-danger/.test((await dg.p.locator("[data-avertissement-caisse]").getAttribute("class")) ?? ""));
verifier("2. l'avertissement donne le nombre d'écritures de caisse et le solde", avertissement.includes("2 écriture(s)") && /400\s?000 FCFA/.test(avertissement), avertissement);
await dg.p.locator("[data-simulation] summary").first().click();
const textePage = (await dg.p.locator("[data-simulation]").innerText()).replace(/\s+/g, " ");
verifier("2. décompte « Supprimé » table par table (demande 1, reglement 1, journalCaisse 2)", /demande 1\b/.test(textePage) && /reglement 1\b/.test(textePage) && /journalCaisse 2\b/.test(textePage), textePage.slice(0, 200));
await dg.p.locator("[data-simulation] summary").nth(1).click();
const textePage2 = (await dg.p.locator("[data-simulation]").innerText()).replace(/\s+/g, " ");
verifier("2. décompte « Conservé » table par table (User, Role, Categorie…)", new RegExp(`User ${avant.User}\\b`).test(textePage2) && /Role \d+/.test(textePage2) && /Categorie \d+/.test(textePage2) && /BudgetParametrage \d+/.test(textePage2), textePage2.slice(-200));
verifier("2. la simulation n'a rien supprimé ni modifié (hors trace d'audit)", (await instantane()).replace(/"HistoriqueEntry":\d+,?/, "") === avantSim.replace(/"HistoriqueEntry":\d+,?/, ""));
verifier("2. la simulation est tracée dans l'historique d'audit (qui, quand)", (await traces("simulation_reinitialisation")).length === 1 && (await traces("simulation_reinitialisation"))[0].email === "dg@simassurances.test");
verifier("2. statuts : simulation « Faite », sauvegarde « À faire », remise à zéro encore « Bloquée »", (await statutEtape(dg.p, "SIMULATION")) === "Faite" && (await statutEtape(dg.p, "SAUVEGARDE")) === "À faire" && (await statutEtape(dg.p, "PURGE")) === "Bloquée");
verifier("2. le bouton de sauvegarde est maintenant actif, la remise à zéro toujours grisée", !(await dg.p.locator('[data-action="sauvegarder"]').isDisabled()) && (await dg.p.locator('[data-action="purger"]').isDisabled()));

// ======================================================================================================================
// 3. Sauvegarde
// ======================================================================================================================
{
  const a = await agir(dg.ctx, "reinitialiserAction", ["REINITIALISER", HASH_FAUX]);
  verifier("3. rejeu : remise à zéro sans sauvegarde téléchargée → refusée (étape 2 d'abord)", a.statut === "error" && /sauvegarde/.test(a.message), a.message);
}
const [telechargement] = await Promise.all([dg.p.waitForEvent("download", { timeout: 60000 }), dg.p.locator('[data-action="sauvegarder"]').click()]);
const fichierSauvegarde = path.join(os_tmp(), "sauvegarde-lot-r.json");
function os_tmp() {
  return process.env.TMPDIR || "/tmp";
}
await telechargement.saveAs(fichierSauvegarde);
let sauvegarde = null;
try {
  sauvegarde = JSON.parse(readFileSync(fichierSauvegarde, "utf8"));
} catch {
  sauvegarde = null;
}
const empreinteAffichee = await dg.p.locator("[data-empreinte]").getAttribute("data-empreinte");
verifier("3. la sauvegarde téléchargée est un JSON valide avec la demande, le règlement et l'audit Encaissements", !!sauvegarde && sauvegarde.tables.demande.length === 1 && sauvegarde.tables.reglement.length === 1 && Array.isArray(sauvegarde.tables.encAudit));
verifier("3. l'empreinte affichée est celle du fichier (meta.empreinteSha256)", !!sauvegarde && /^[0-9a-f]{64}$/.test(empreinteAffichee ?? "") && sauvegarde.meta.empreinteSha256 === empreinteAffichee);
const traceSauv = await traces("sauvegarde_reinitialisation");
verifier("3. la sauvegarde est tracée avec son empreinte (qui, quand)", traceSauv.length === 1 && (traceSauv[0].detail ?? "").includes(empreinteAffichee) && traceSauv[0].email === "dg@simassurances.test");
verifier("3. statut « Faite » ; bouton de remise à zéro grisé tant que la phrase n'est pas tapée", (await statutEtape(dg.p, "SAUVEGARDE")) === "Faite" && (await dg.p.locator('[data-action="purger"]').isDisabled()));
await dg.p.locator('[data-champ="phrase-purge"]').fill("REINITIALISE");
verifier("3. phrase incomplète : bouton toujours grisé", await dg.p.locator('[data-action="purger"]').isDisabled());
await dg.p.locator('[data-champ="phrase-purge"]').fill("REINITIALISER");
verifier("3. phrase exacte + sauvegarde téléchargée : bouton actif", !(await dg.p.locator('[data-action="purger"]').isDisabled()));
{
  const a = await agir(dg.ctx, "reinitialiserAction", ["REINITIALISER", HASH_FAUX]);
  verifier("3. rejeu : empreinte qui n'est pas celle de la sauvegarde téléchargée → refusée", a.statut === "error" && /ne correspond pas/.test(a.message), a.message);
  const b = await agir(dg.ctx, "reinitialiserAction", ["reinitialiser", empreinteAffichee]);
  verifier("3. rejeu : mauvaise phrase (casse) → refusée", b.statut === "error" && /REINITIALISER/.test(b.message), b.message);
}
verifier("3. rien n'a été supprimé par ces refus", (await nombre("Demande")) === 1 && (await nombre("JournalCaisse")) === 2 && (await nombre("ReinitialisationSysteme")) === 0);
// Rechargement de la page : la sauvegarde n'est plus « téléchargée dans cette session » → bouton grisé
await dg.p.reload();
verifier("3. après rechargement : la sauvegarde est « Faite » côté serveur mais le bouton de remise à zéro est grisé (à retélécharger)", (await statutEtape(dg.p, "SAUVEGARDE")) === "Faite" && (await dg.p.locator('[data-action="purger"]').isDisabled()));
{
  await dg.p.locator('[data-champ="phrase-purge"]').fill("REINITIALISER").catch(() => {});
  verifier("3. après rechargement : même avec la phrase, le bouton reste grisé tant que la sauvegarde n'est pas retéléchargée", await dg.p.locator('[data-action="purger"]').isDisabled());
}

// ======================================================================================================================
// 4. Remise à zéro (aucun verrou) — table par table
// ======================================================================================================================
const histoAvant = Object.fromEntries((await q(`SELECT entity, count(*)::int AS n FROM "HistoriqueEntry" GROUP BY entity`)).map((x) => [x.entity, x.n]));
const notifAvant = Object.fromEntries((await q(`SELECT category, count(*)::int AS n FROM "Notification" GROUP BY category`)).map((x) => [x.category, x.n]));
const avantPurge1 = {};
for (const t of tables) avantPurge1[t] = await nombre(t);
await Promise.all([dg.p.waitForEvent("download", { timeout: 60000 }), dg.p.locator('[data-action="sauvegarder"]').click()]);
await dg.p.locator("[data-empreinte]").waitFor();
await dg.p.locator('[data-champ="phrase-purge"]').fill("REINITIALISER");
await dg.p.locator('[data-action="purger"]').click();
const fait1 = await attendre(async () => (await nombre("ReinitialisationSysteme")) === 1, 90000);
verifier("4. remise à zéro exécutée par l'écran : une ligne d'audit, verrou posé", fait1 && (await nombre("ReinitialisationSysteme", `WHERE verrou = 'REINITIALISATION'`)) === 1);
await dg.p.locator("[data-message-verrou]").waitFor({ timeout: 30000 }).catch(() => {});
const message = (await dg.p.locator("[data-message-verrou]").innerText().catch(() => "")).replace(/\s+/g, " ");
verifier("4. juste après la purge, l'écran remplace l'assistant par « Remise à zéro effectuée le … par … Fonction verrouillée. »", /^Remise à zéro effectuée le \d{2}\/\d{2}\/\d{4}.* par DG Test\. Fonction verrouillée\.$/.test(message), message.slice(0, 200));
const apres = {};
for (const t of tables) apres[t] = await nombre(t);
const purgees = Object.entries(classification).filter(([, c]) => c.statut === "PURGEE").map(([t]) => t);
const ecartsPurgees = purgees.filter((t) => apres[t] !== 0 && !BRUIT.includes(t));
verifier(`4. table par table : les ${purgees.length} tables PURGÉES sont vides`, ecartsPurgees.length === 0, ecartsPurgees.map((t) => `${t}=${apres[t]}`).join(", "));
const conservees = Object.entries(classification).filter(([, c]) => c.statut === "CONSERVEE").map(([t]) => t);
// Conservées : intactes, SAUF la ligne d'audit/verrou (+1) et les traces d'audit de l'étape (HistoriqueEntry est « partielle », traitée plus bas)
const ecartsConservees = conservees.filter((t) => apres[t] !== (t === "ReinitialisationSysteme" ? avantPurge1[t] + 1 : avantPurge1[t]));
verifier(`4. table par table : les ${conservees.length} tables CONSERVÉES sont intactes (verrou +1)`, ecartsConservees.length === 0, ecartsConservees.map((t) => `${t}: ${avantPurge1[t]}→${apres[t]}`).join(", "));
const histoApres = Object.fromEntries((await q(`SELECT entity, count(*)::int AS n FROM "HistoriqueEntry" GROUP BY entity`)).map((x) => [x.entity, x.n]));
const entitesPurgees = ["Demande", "LigneDemande", "JournalCaisse", "RetourExterne", "Pointage", "PointageQR", "PointageGeo", "JustificationPointage", "DemandeConge"];
verifier("4. historique : entités de test supprimées, audit et configuration conservés", entitesPurgees.every((e) => !histoApres[e]) && histoApres.BudgetParametrage === histoAvant.BudgetParametrage && histoApres.User === histoAvant.User);
verifier("4. l'audit des ÉTAPES (simulation, sauvegarde, remise à zéro) a survécu à la purge", (await traces("simulation_reinitialisation")).length === 1 && (await traces("sauvegarde_reinitialisation")).length === 2 && (await traces("reinitialisation_systeme")).length === 1);
const notifApres = Object.fromEntries((await q(`SELECT category, count(*)::int AS n FROM "Notification" GROUP BY category`)).map((x) => [x.category, x.n]));
verifier("4. notifications : TRESORERIE / RH / POINTAGE supprimées, ADMIN / SYSTEME conservées", !notifApres.TRESORERIE && !notifApres.RH && !notifApres.POINTAGE && notifApres.ADMIN === notifAvant.ADMIN && notifApres.SYSTEME === notifAvant.SYSTEME);
verifier("4. configuration intacte : permissions des rôles, budgets validés, délégation, services avec responsable, jours fériés", (await nombre("RolePermission")) === rolePermsAvant && (await nombre("BudgetParametrage", `WHERE statut = 'VALIDE'`)) === 2 && (await nombre("PermissionDelegation", `WHERE "estActive"`)) >= 1 && (await nombre("Service", `WHERE "responsableId" IS NOT NULL`)) === 8 && (await nombre("JourFerie")) === avant.JourFerie);
verifier("4. signatures enrôlées conservées (toutes versions)", (await nombre("SignatureUtilisateur")) === avant.SignatureUtilisateur);
verifier("4. caisse : le grand livre est vide (solde d'ouverture à ressaisir)", (await nombre("JournalCaisse")) === 0);
verifier("4. tous les comptes sont conservés et actifs", (await nombre("User")) === avant.User && (await nombre("User", `WHERE "isActive"`)) === avant.User);
await dg.p.goto(`${B}/systeme/reinitialisation`);
verifier("4. l'écran affiche « verrou actif » et l'audit (une remise à zéro)", (await dg.p.locator('[data-etat-verrou="actif"]').count()) === 1 && (await dg.p.locator('[data-section="audit"] li').count()) === 1);
verifier("4. verrou définitif : plus aucun bouton (simuler, sauvegarder, purger), aucune étape, aucune levée possible depuis l'application", (await dg.p.locator("[data-etape]").count()) === 0 && (await dg.p.locator('[data-action="simuler"], [data-action="sauvegarder"], [data-action="purger"], [data-action="lever-verrou"]').count()) === 0);
verifier("4. le DG garde la permission systeme.reinitialiser, mais elle ne suffit plus (message de verrou seul)", (await dg.p.locator("[data-message-verrou]").innerText()).includes("Fonction verrouillée."));
verifier("4. panneau des comptes de test + rappel exact du solde d'ouverture", (await dg.p.locator('[data-section="comptes-test"]').count()) === 1 && (await dg.p.locator("[data-rappel-solde-ouverture]").innerText()).includes("Saisir le solde d'ouverture de caisse avant d'ouvrir l'application."));
{
  const nbTraces = await nombre("HistoriqueEntry", `WHERE entity = 'ReinitialisationSysteme'`);
  const a = await agir(dg.ctx, "reinitialiserAction", ["REINITIALISER", sauvegarde.meta.empreinteSha256]);
  verifier("4. rejeu d'une seconde remise à zéro (même sauvegarde, bonne phrase) → refusé : verrou", a.statut === "error" && /verrouill/.test(a.message) && /UPDATE SQL/.test(a.message), a.message);
  const s = await agir(dg.ctx, "simulerAction", []);
  verifier("4. rejeu d'une simulation → refusé : verrou, aucune trace de simulation écrite", s.statut === "error" && /verrouill/.test(s.message) && (await traces("simulation_reinitialisation")).length === 1, s.message);
  const rep = await dg.ctx.request.get(`${B}/api/systeme/reinitialisation/sauvegarde`);
  const texte = await rep.text();
  verifier("4. la route de sauvegarde est refusée (409) tant que le verrou existe", rep.status() === 409 && /verrouill/.test(texte), `${rep.status()} ${texte.slice(0, 120)}`);
  verifier("4. ces refus n'ont écrit aucune trace ni supprimé aucune ligne", (await nombre("HistoriqueEntry", `WHERE entity = 'ReinitialisationSysteme'`)) === nbTraces && (await nombre("ReinitialisationSysteme")) === 1);
}
await dg.ctx.close();

// ======================================================================================================================
// 5. Comptes de test
// ======================================================================================================================
// Aucun compte réel DG pour l'instant : dg@ et dg2@ sont les seuls porteurs de systeme.reinitialiser. dg@ est responsable de
// « Direction DG » : on confie ce service à un compte non-DG pour que seul le « dernier porteur » soit en jeu.
await db.query(`UPDATE "Service" SET "responsableId" = $1 WHERE name = 'Direction DG'`, [idCollabReel]);
const adm = await connecter("admin@simassurances.test");
await adm.p.goto(`${B}/systeme/reinitialisation`);
verifier("5. l'Admin voit le panneau des comptes de test (après une remise à zéro) et PAS les étapes", adm.p.url().includes("/systeme/reinitialisation") && (await adm.p.locator("[data-comptes-test]").count()) === 1 && (await adm.p.locator("[data-etape]").count()) === 0);
verifier("5. l'Admin voit le lien « Réinitialisation » dans le menu", (await adm.p.locator('a[href="/systeme/reinitialisation"]').count()) >= 1);
verifier("5. rappel « Saisir le solde d'ouverture de caisse avant d'ouvrir l'application. » affiché à l'Admin aussi", (await adm.p.locator("[data-rappel-solde-ouverture]").innerText()).includes("Saisir le solde d'ouverture de caisse avant d'ouvrir l'application."));
const refusDe = async (p, email) => (await p.locator(`[data-refus-compte="${email}"]`).innerText().catch(() => "")).replace(/\s+/g, " ");
verifier("5. compte connecté (admin@) : listé mais refusé", /compte avec lequel vous êtes connecté/.test(await refusDe(adm.p, "admin@simassurances.test")));
verifier("5. un responsable de service (finance@) est refusé avec la raison", /seul responsable du service « Finance »/.test(await refusDe(adm.p, "finance@simassurances.test")), await refusDe(adm.p, "finance@simassurances.test"));
verifier("5. le DOUBLE porteur de systeme.reinitialiser (dg@ et dg2@, aucun autre) : les deux refusés, « dernier compte actif »", /dernier compte actif/.test(await refusDe(adm.p, "dg@simassurances.test")) && /dernier compte actif/.test(await refusDe(adm.p, "dg2@simassurances.test")), `${await refusDe(adm.p, "dg@simassurances.test")} | ${await refusDe(adm.p, "dg2@simassurances.test")}`);
verifier("5. un compte ordinaire (collaborateur@) n'a pas de refus", (await adm.p.locator('[data-refus-compte="collaborateur@simassurances.test"]').count()) === 0);
{
  // Rejeu serveur par l'Admin : sélection qui contient les deux porteurs → aucun n'est désactivé ; compte connecté refusé aussi
  const idDg = (await q(`SELECT id FROM "User" WHERE email = 'dg@simassurances.test'`))[0].id;
  const idDg2 = (await q(`SELECT id FROM "User" WHERE email = 'dg2@simassurances.test'`))[0].id;
  const idAdm = (await q(`SELECT id FROM "User" WHERE email = 'admin@simassurances.test'`))[0].id;
  const a = await agir(adm.ctx, "desactiverComptesDeTestAction", [[idDg, idDg2, idAdm], true]);
  verifier("5. rejeu : désactiver les deux derniers porteurs + le compte connecté → rien n'est désactivé", a.statut === "error" && (await nombre("User", `WHERE "isActive" = false`)) === 0, a.message);
  const b = await agir(adm.ctx, "desactiverComptesDeTestAction", [[idDg], false]);
  verifier("5. rejeu : sans confirmation → refusé", b.statut === "error" && /Confirmez/.test(b.message), b.message);
  const c = await agir(adm.ctx, "desactiverComptesDeTestAction", [[idCollabReel], true]);
  verifier("5. rejeu : un compte RÉEL (hors *@simassurances.test) glissé dans la sélection → jamais désactivé", (await q(`SELECT "isActive" AS a FROM "User" WHERE id = $1`, [idCollabReel]))[0].a === true && c.statut === "error", c.message);
}
// Un vrai compte DG existe maintenant : dg@ et dg2@ deviennent désactivables
const idDgReel = await creerCompte("dg.reel@societe.example", "DG Réel", "DG", "Direction DG");
await db.query(`UPDATE "Service" SET "responsableId" = $1 WHERE name = 'Direction DG'`, [idDgReel]);
await adm.p.reload();
verifier("5. avec un DG réel actif, dg@ et dg2@ ne sont plus refusés", (await adm.p.locator('[data-refus-compte="dg2@simassurances.test"]').count()) === 0 && (await adm.p.locator('[data-refus-compte="dg@simassurances.test"]').count()) === 0);
await adm.ctx.close();

// Le DG RÉEL désactive depuis l'écran : liste, confirmation, résultat. D'abord les responsables : on leur désigne un responsable réel.
for (const s of ["Commercial", "Technique", "Comptabilité", "Marketing", "RH", "Informatique", "Finance"]) await db.query(`UPDATE "Service" SET "responsableId" = $1 WHERE name = $2`, [idDgReel, s]);
const dgr = await connecter("dg.reel@societe.example");
await dgr.p.goto(`${B}/systeme/reinitialisation`);
const avantDesact = { users: await nombre("User"), actifs: await nombre("User", `WHERE "isActive"`) };
const nbListes = await dgr.p.locator("[data-compte-test]").count();
verifier("5. le DG réel voit la liste des comptes de test encore actifs", nbListes >= 12, `${nbListes} compte(s)`);
verifier("5. les comptes réels ne figurent pas dans la liste", (await dgr.p.locator('[data-compte-test="collab.reel@societe.example"]').count()) === 0 && (await dgr.p.locator('[data-compte-test="dg.reel@societe.example"]').count()) === 0);
await dgr.p.locator('[data-action="desactiver-comptes-test"]').click();
const listeConfirmation = (await dgr.p.locator("[data-confirmation-desactivation]").innerText()).replace(/\s+/g, " ");
verifier("5. confirmation : la liste des comptes à désactiver est affichée avant d'agir", listeConfirmation.includes("collaborateur@simassurances.test") && listeConfirmation.includes(`${nbListes} compte(s)`), listeConfirmation.slice(0, 160));
verifier("5. rien n'est désactivé avant la confirmation", (await nombre("User", `WHERE "isActive"`)) === avantDesact.actifs);
await dgr.p.locator('[data-action="confirmer-desactivation"]').click();
const fait = await attendre(async () => (await q(`SELECT count(*)::int AS n FROM "User" WHERE email LIKE '%@simassurances.test' AND "isActive"`))[0].n === 0, 60000);
verifier("5. tous les comptes de test sont désactivés (jamais supprimés)", fait && (await nombre("User")) === avantDesact.users);
verifier("5. les comptes réels restent actifs", (await q(`SELECT count(*)::int AS n FROM "User" WHERE email LIKE '%@societe.example' AND "isActive"`))[0].n === 3);
verifier("5. chaque désactivation est tracée (DEACTIVATE) + une trace de synthèse dans l'audit de la remise à zéro", (await nombre("HistoriqueEntry", `WHERE entity = 'User' AND action = 'DEACTIVATE' AND detail LIKE '%remise à zéro de mise en production%'`)) === (await nombre("User", `WHERE email LIKE '%@simassurances.test' AND NOT "isActive"`)) && (await traces("desactivation_comptes_test")).length >= 1 && new RegExp(`${nbListes} compte\\(s\\) de test désactivé`).test((await traces("desactivation_comptes_test")).map((t) => t.detail).join(" ")), `listés ${nbListes}, DEACTIVATE ${await nombre("HistoriqueEntry", `WHERE entity = 'User' AND action = 'DEACTIVATE' AND detail LIKE '%remise à zéro de mise en production%'`)}, inactifs ${await nombre("User", `WHERE email LIKE '%@simassurances.test' AND NOT "isActive"`)}, synthèses ${(await traces("desactivation_comptes_test")).length}`);
verifier("5. les sessions en cours sont coupées (tokenVersion incrémenté)", (await q(`SELECT "tokenVersion" AS v FROM "User" WHERE email = 'collaborateur@simassurances.test'`))[0].v >= 1);
await dgr.p.goto(`${B}/systeme/reinitialisation`);
verifier("5. l'écran confirme : aucun compte de test actif", (await dgr.p.locator("[data-aucun-compte-test]").count()) === 1);
{
  const idsTest = (await q(`SELECT id FROM "User" WHERE email LIKE '%@simassurances.test' LIMIT 2`)).map((x) => x.id);
  const a = await agir(dgr.ctx, "desactiverComptesDeTestAction", [idsTest, true]);
  verifier("5. rejeu sur des comptes déjà désactivés → rien à faire", a.statut === "error", a.message);
}
await dgr.ctx.close();
{
  const refus = await connecter("collaborateur@simassurances.test", { attendreSortie: false });
  verifier("5. un compte de test désactivé ne peut plus se connecter", refus.p.url().includes("/login"), refus.p.url());
  await refus.ctx.close();
}

// ======================================================================================================================
// 6. Verrou existant : rien n'est possible dans l'application ; levée par UPDATE SQL ; étapes recommencées ; seconde remise à zéro
// ======================================================================================================================
// Le DG réel est le seul porteur actif. Données fraîches à purger : une écriture de caisse et une notification de Trésorerie.
await db.query(`INSERT INTO "JournalCaisse" (id, type, montant, source, "refId", "userId") VALUES (gen_random_uuid()::text, 'ENTREE', 123456, 'alimentation_caisse', 'lot-r-2', $1)`, [idFinanceReel]);
await db.query(`INSERT INTO "Notification" (id, titre, message, "userId", category) VALUES (gen_random_uuid()::text, 'Trésorerie lot R', 'à purger', $1, 'TRESORERIE')`, [idFinanceReel]);
const dg6 = await connecter("dg.reel@societe.example");
await dg6.p.goto(`${B}/systeme/reinitialisation`);
verifier("6. verrou actif : le DG réel (permission systeme.reinitialiser) ne voit que le message de verrou, aucune étape", (await dg6.p.locator('[data-etat-verrou="actif"]').count()) === 1 && (await dg6.p.locator("[data-etape]").count()) === 0 && /Fonction verrouillée\./.test(await dg6.p.locator("[data-message-verrou]").innerText()));
{
  const avant6 = await instantane();
  const s = await agir(dg6.ctx, "simulerAction", []);
  const rz = await agir(dg6.ctx, "reinitialiserAction", ["REINITIALISER", HASH_FAUX]);
  verifier("6. rejeu par le DG réel : simulation et remise à zéro refusées avec le message de verrou", [s, rz].every((x) => x.statut === "error" && /verrouill/.test(x.message)), [s, rz].map((x) => x.message).join(" | "));
  const rep = await dg6.ctx.request.get(`${B}/api/systeme/reinitialisation/sauvegarde`);
  verifier("6. rejeu par le DG réel : route de sauvegarde refusée (409)", rep.status() === 409);
  verifier("6. rien n'a été supprimé par ces refus (la caisse fraîche est toujours là)", (await instantane()) === avant6 && (await nombre("JournalCaisse")) === 1, diff(avant6, await instantane()));
}
// La seule levée possible : l'UPDATE SQL documenté (docs/mise-en-production.md, § 10). La ligne d'audit est conservée.
const idLigneAudit = (await q(`SELECT id FROM "ReinitialisationSysteme"`))[0].id;
await db.query(`UPDATE "ReinitialisationSysteme" SET verrou = 'LEVE-' || id WHERE verrou = 'REINITIALISATION'`);
verifier("6. levée par UPDATE SQL : la ligne d'audit est CONSERVÉE, verrou = LEVE-<id>", (await nombre("ReinitialisationSysteme")) === 1 && (await q(`SELECT verrou AS v FROM "ReinitialisationSysteme"`))[0].v === `LEVE-${idLigneAudit}`);
await dg6.p.goto(`${B}/systeme/reinitialisation`);
verifier("6. verrou levé : l'assistant revient (simulation « À faire », sauvegarde et remise à zéro « Bloquées »)", (await dg6.p.locator('[data-etat-verrou="actif"]').count()) === 0 && (await statutEtape(dg6.p, "SIMULATION")) === "À faire" && (await statutEtape(dg6.p, "PURGE")) === "Bloquée");
await dg6.p.locator('[data-action="simuler"]').click();
await dg6.p.locator("[data-simulation]").waitFor({ timeout: 60000 });
verifier("6. la nouvelle simulation compte la nouvelle écriture de caisse (1 écriture)", (await dg6.p.locator("[data-avertissement-caisse]").innerText()).includes("1 écriture(s)"));
const [dl2] = await Promise.all([dg6.p.waitForEvent("download", { timeout: 60000 }), dg6.p.locator('[data-action="sauvegarder"]').click()]);
const fichier2 = path.join(os_tmp(), "sauvegarde-lot-r-2.json");
await dl2.saveAs(fichier2);
const sauvegarde2 = JSON.parse(readFileSync(fichier2, "utf8"));
verifier("6. la seconde sauvegarde contient les nouvelles données (journalCaisse 1, notification Trésorerie)", sauvegarde2.tables.journalCaisse.length === 1 && sauvegarde2.tables.notificationTresorerie.some((n) => n.titre === "Trésorerie lot R"));
await dg6.p.locator('[data-champ="phrase-purge"]').fill("REINITIALISER");
verifier("6. verrou levé + simulation + sauvegarde téléchargée + phrase exacte : bouton de remise à zéro actif", !(await dg6.p.locator('[data-action="purger"]').isDisabled()));
const sigAvant6 = await nombre("SignatureUtilisateur"); // un compte créé en cours de test a pu recevoir sa signature de test
await dg6.p.locator('[data-action="purger"]').click();
const fait2 = await attendre(async () => (await nombre("ReinitialisationSysteme")) === 2, 90000);
verifier("6. seconde remise à zéro : deux lignes d'audit, UN seul verrou actif (reposé)", fait2 && (await nombre("ReinitialisationSysteme", `WHERE verrou = 'REINITIALISATION'`)) === 1);
verifier("6. les nouvelles données ont été supprimées (caisse 0, notification Trésorerie)", (await nombre("JournalCaisse")) === 0 && (await nombre("Notification", `WHERE category = 'TRESORERIE'`)) === 0);
verifier("6. la configuration reste intacte après la seconde remise à zéro", (await nombre("RolePermission")) === rolePermsAvant && (await nombre("BudgetParametrage", `WHERE statut = 'VALIDE'`)) === 2 && (await nombre("SignatureUtilisateur")) === sigAvant6, JSON.stringify({ rp: [await nombre("RolePermission"), rolePermsAvant], bp: await nombre("BudgetParametrage", `WHERE statut = 'VALIDE'`), sig: [await nombre("SignatureUtilisateur"), sigAvant6] }));
await dg6.p.goto(`${B}/systeme/reinitialisation`);
const audit = (await dg6.p.locator('[data-section="audit"]').innerText()).replace(/\s+/g, " ");
verifier("6. l'audit liste les deux remises à zéro, la première « Verrou levé (par UPDATE SQL », la seconde verrou actif", (await dg6.p.locator('[data-section="audit"] li').count()) === 2 && /Verrou levé \(par UPDATE SQL/.test(audit) && /Verrou actif/.test(audit), audit.slice(0, 280));
verifier("6. de nouveau verrouillé : message seul, plus d'assistant", (await dg6.p.locator("[data-etape]").count()) === 0 && /Fonction verrouillée\./.test(await dg6.p.locator("[data-message-verrou]").innerText()));
await dg6.ctx.close();

// ======================================================================================================================
// 7. L'application redémarre ; un parcours neuf fonctionne
// ======================================================================================================================
arreterServeur();
await new Promise((res) => setTimeout(res, 2000));
await lancerServeur();
{
  const c = await connecter("collab.reel@societe.example");
  await c.p.goto(`${B}/treso/demandes/nouvelle`);
  await c.p.locator('input[aria-label="Libellé de l\'article"]').first().fill("Article après remise à zéro");
  await c.p.locator('input[aria-label="Motif de la ligne"]').first().fill("motif après remise à zéro");
  await c.p.locator('input[aria-label="Prix unitaire"]').first().fill("15000");
  await c.p.getByRole("button", { name: "Envoyer la demande" }).click();
  await c.p.getByText("Demande créée avec succès.").waitFor({ timeout: 30000 });
  const d = (await q(`SELECT reference, "etapeCircuit" FROM "Demande"`))[0];
  verifier("7. après redémarrage : demande créée, numérotation repartie de 1", !!d && /^DEM-\d{4}-000001$/.test(d.reference), JSON.stringify(d));
  verifier("7. la demande entre dans le circuit (étape Service, responsable = DG réel)", d?.etapeCircuit === "SERVICE");
  await c.ctx.close();
  const f = await connecter("finance.reel@societe.example");
  await f.p.goto(`${B}/treso/finance/solde-ouverture`);
  verifier("7. solde d'ouverture : l'écran propose de le DÉFINIR (aucun solde en vigueur)", (await f.p.getByText("Aucun solde d'ouverture n'a encore été défini").count()) === 1);
  await f.p.getByLabel("Montant (FCFA)").fill("750000");
  await f.p.locator('input[type="file"]').first().setInputFiles(PDF("comptage.pdf"));
  await f.p.getByText(/Fichier envoyé/).first().waitFor({ timeout: 20000 });
  await f.p.getByRole("button", { name: "Définir le solde d'ouverture" }).click();
  const ok = await attendre(async () => (await nombre("JournalCaisse", `WHERE source = 'solde_ouverture'`)) === 1);
  verifier("7. solde d'ouverture ressaisi par l'écran normal : une écriture ENTREE de 750 000", ok);
  await f.ctx.close();
}
{
  const d = await connecter("dg.reel@societe.example");
  await d.p.goto(`${B}/systeme/reinitialisation`);
  verifier("7. après redémarrage : le verrou est toujours actif (message seul) et l'audit complet est visible", (await d.p.locator('[data-etat-verrou="actif"]').count()) === 1 && (await d.p.locator("[data-etape]").count()) === 0 && (await d.p.locator('[data-section="audit"] li').count()) === 2);
  await d.ctx.close();
}

verifier("aucune erreur JavaScript non interceptée", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));

// ---------- Nettoyage ----------
await browser.close();
arreterServeur();
await db.end();
await new Promise((res) => setTimeout(res, 1500));
await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${BASE}'`).catch(() => {});
await admin.query(`DROP DATABASE IF EXISTS ${BASE}`).catch(() => {});
await admin.end();

imprime = true;
console.log(resultats.join("\n"));
const ko = resultats.filter((x) => x.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles OK`);
process.exit(ko ? 1 : 0);
