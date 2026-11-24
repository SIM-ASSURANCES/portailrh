// Lot S (2026-10-23) — VERROU DÉFINITIF de la remise à zéro. AUTONOME : crée sa PROPRE base jetable `lot_s` (PostgreSQL de test,
// port 55497), migre, seed, remplit toutes les tables de test (e2e/lot-n-donnees.ts), lance son PROPRE serveur `next start`
// (port 3103), puis supprime la base. Ne touche jamais une autre base. Prérequis : `next build` fait. Scénario :
//  1. une première remise à zéro réussit depuis l'écran du DG : la ligne de verrou porte date, utilisateur, décompte (lignes purgées) ;
//  2. l'écran ne montre plus que « Remise à zéro effectuée le … par … Fonction verrouillée. » (aucun bouton, aucune étape) ;
//  3. une DEUXIÈME remise à zéro est refusée côté serveur (rejeu réel de la Server Action, avec la bonne phrase et une vraie
//     sauvegarde) ; la simulation est refusée ; la route de sauvegarde est refusée (409) ; la ligne de commande aussi ;
//     rien n'est supprimé ni tracé ; la permission systeme.reinitialiser est toujours portée par le DG mais ne suffit plus ;
//  4. le verrou SURVIT à un redémarrage de l'application (et à une nouvelle connexion) : mêmes refus ;
//  5. il n'existe aucune action de levée dans l'application ; seul l'UPDATE SQL du runbook lève le verrou (ligne d'audit conservée),
//     après quoi l'assistant revient.
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
const PORT = 3103;
const B = `http://localhost:${PORT}`;
const ADMIN_URL = "postgresql://postgres:pw@localhost:55497/postgres";
const BASE = "lot_s";
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
    env: { ...ENV, AUTH_SECRET: "secret-e2e-lots-0123456789abcdef0123456789abcdef", AUTH_URL: B, ALLOWED_OFFICE_IPS: "10.9.9.9,127.0.0.1,::1", CRON_SECRET: "secret-e2e", AUTH_TRUST_HOST: "true", PLANIFICATEUR_ACTIF: "false" },
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


const MSG_ECRAN = /^Remise à zéro effectuée le \d{2}\/\d{2}\/\d{4}.* par DG Test\. Fonction verrouillée\.$/;
const cli = (args = []) => tsx("prisma/reinitialiser-production.ts", args);
const sauvegardes = path.join(process.env.TMPDIR || "/tmp", "sauvegardes-lot-s");
const uploads = path.join(process.env.TMPDIR || "/tmp", "uploads-lot-s");

// ======================================================================================================================
// 1. Première remise à zéro, par l'écran du DG
// ======================================================================================================================
const dg = await connecter("dg@simassurances.test");
await dg.p.goto(`${B}/systeme/reinitialisation`);
verifier("1. avant toute remise à zéro : l'assistant est là, aucun message de verrou", (await dg.p.locator('[data-etape="SIMULATION"]').count()) === 1 && (await dg.p.locator("[data-message-verrou]").count()) === 0);
await dg.p.locator('[data-action="simuler"]').click();
await dg.p.locator("[data-simulation]").waitFor({ timeout: 60000 });
const [telechargement] = await Promise.all([dg.p.waitForEvent("download", { timeout: 60000 }), dg.p.locator('[data-action="sauvegarder"]').click()]);
const fichierSauvegarde = path.join(process.env.TMPDIR || "/tmp", "sauvegarde-lot-s.json");
await telechargement.saveAs(fichierSauvegarde);
const sauvegarde = JSON.parse(readFileSync(fichierSauvegarde, "utf8"));
const totalAttendu = Object.values(sauvegarde.tables).reduce((n, lignes) => n + (Array.isArray(lignes) ? lignes.length : 0), 0);
await dg.p.locator('[data-champ="phrase-purge"]').fill("REINITIALISER");
await dg.p.locator('[data-action="purger"]').click();
const fait = await attendre(async () => (await nombre("ReinitialisationSysteme")) === 1, 90000);
verifier("1. première remise à zéro exécutée par l'écran", fait);
const ligne = (await q(`SELECT r.verrou, r."effectueeAt", r."decompte", r."sauvegardeSha256", u.email, u."fullName" FROM "ReinitialisationSysteme" r JOIN "User" u ON u.id = r."effectueeParId"`))[0];
const totalDecompte = Object.values(ligne.decompte ?? {}).reduce((n, v) => n + Number(v), 0);
verifier("1. le verrou est enregistré en base : verrou unique, date, utilisateur DG", ligne.verrou === "REINITIALISATION" && ligne.email === "dg@simassurances.test" && Math.abs(Date.now() - new Date(ligne.effectueeAt).getTime()) < 10 * 60 * 1000, JSON.stringify({ verrou: ligne.verrou, email: ligne.email, at: ligne.effectueeAt }));
verifier("1. le verrou garde le nombre de lignes purgées (décompte par table) et l'empreinte de la sauvegarde", totalDecompte > 0 && ligne.sauvegardeSha256 === sauvegarde.meta.empreinteSha256, `décompte ${totalDecompte}, sauvegarde ${totalAttendu} lignes`);

// ======================================================================================================================
// 2. L'écran : message seul, la permission ne suffit plus
// ======================================================================================================================
await dg.p.goto(`${B}/systeme/reinitialisation`);
const message = (await dg.p.locator("[data-message-verrou]").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
verifier("2. l'écran affiche « Remise à zéro effectuée le [date] par [nom]. Fonction verrouillée. »", MSG_ECRAN.test(message), message);
verifier("2. aucun bouton Simuler / Sauvegarder / Remise à zéro, aucune étape, aucune levée", (await dg.p.locator('[data-action="simuler"], [data-action="sauvegarder"], [data-action="purger"], [data-action="lever-verrou"]').count()) === 0 && (await dg.p.locator("[data-etape]").count()) === 0);
verifier("2. le DG porte toujours systeme.reinitialiser par son rôle… mais cela ne suffit plus", (await q(`SELECT count(*)::int AS n FROM "User" u JOIN "RolePermission" rp ON rp."roleId" = u."roleId" JOIN "Permission" p ON p.id = rp."permissionId" WHERE u.email = 'dg@simassurances.test' AND p.key = 'systeme.reinitialiser'`))[0].n === 1);
verifier("2. l'audit est visible sous le message", (await dg.p.locator('[data-section="audit"] li').count()) === 1);

// ======================================================================================================================
// 3. Deuxième remise à zéro, simulation, sauvegarde : refusées côté serveur
// ======================================================================================================================
const refusAttendu = (x) => x.statut === "error" && /verrouill/.test(x.message) && /UPDATE SQL/.test(x.message) && x.message.includes("DG Test");
const traceSim = (await traces("simulation_reinitialisation")).length;
const traceSauv = (await traces("sauvegarde_reinitialisation")).length;
const traceRz = (await traces("reinitialisation_systeme")).length;
async function refusEnBloc(ctx, etiquette) {
  const avant = await instantane();
  const rz = await agir(ctx, "reinitialiserAction", ["REINITIALISER", sauvegarde.meta.empreinteSha256]);
  const sim = await agir(ctx, "simulerAction", []);
  const route = await ctx.request.get(`${B}/api/systeme/reinitialisation/sauvegarde`);
  const texte = await route.text();
  verifier(`${etiquette} : deuxième remise à zéro refusée (bonne phrase, vraie sauvegarde) avec le message de verrou`, refusAttendu(rz), rz.message || rz.brut.slice(0, 160));
  verifier(`${etiquette} : simulation refusée avec le message de verrou`, refusAttendu(sim), sim.message || sim.brut.slice(0, 160));
  verifier(`${etiquette} : route de sauvegarde refusée (409) avec le message de verrou`, route.status() === 409 && /verrouill/.test(texte), `${route.status()} ${texte.slice(0, 120)}`);
  verifier(`${etiquette} : aucune ligne supprimée, aucun nouveau verrou, aucune trace de simulation / sauvegarde / remise à zéro`, (await instantane()) === avant && (await nombre("ReinitialisationSysteme")) === 1 && (await traces("simulation_reinitialisation")).length === traceSim && (await traces("sauvegarde_reinitialisation")).length === traceSauv && (await traces("reinitialisation_systeme")).length === traceRz, diff(avant, await instantane()));
}
await refusEnBloc(dg.ctx, "3. DG");
{
  const attaque = await agir(dg.ctx, "reinitialiserAction", ["REINITIALISER", HASH_FAUX]);
  verifier("3. même avec une empreinte fausse, c'est le verrou qui est annoncé (le verrou passe avant tout)", refusAttendu(attaque), attaque.message);
}
{
  const avant = await instantane();
  const sim = cli([]);
  const rz = cli(["--appliquer", "--utilisateur", "dg@simassurances.test", "--confirmation", "REINITIALISER", "--dossier-sauvegarde", sauvegardes, "--uploads", uploads]);
  verifier("3. ligne de commande : simulation ET remise à zéro refusées (code 1, message de verrou)", sim.status === 1 && rz.status === 1 && /REFUS/.test(sortie(sim)) && /verrouill/.test(sortie(sim)) && /verrouill/.test(sortie(rz)), `${sim.status}/${rz.status} ${sortie(rz).trim().split("\n").pop()}`);
  verifier("3. ligne de commande : rien n'a changé", (await instantane()) === avant && (await nombre("ReinitialisationSysteme")) === 1);
}
{
  const fin = await connecter("finance@simassurances.test");
  const rz = await agir(fin.ctx, "reinitialiserAction", ["REINITIALISER", sauvegarde.meta.empreinteSha256]);
  verifier("3. un compte sans la permission reste refusé « Action non autorisée. » (la permission est contrôlée avant le verrou)", rz.message === "Action non autorisée.", rz.message);
  await fin.ctx.close();
}
verifier("3. aucune action de levée du verrou n'existe dans l'application (manifeste des Server Actions)", !idAction("leverVerrouAction") && Object.values(manifeste().node ?? {}).every((v) => !/lever/i.test(v.exportedName ?? "") || !/systeme\/reinitialisation/.test(v.filename ?? "")));
await dg.ctx.close();

// ======================================================================================================================
// 4. Le verrou survit à un redémarrage de l'application
// ======================================================================================================================
arreterServeur();
await new Promise((res) => setTimeout(res, 2000));
await lancerServeur();
verifier("4. après redémarrage : la ligne de verrou est toujours là, active", (await nombre("ReinitialisationSysteme", `WHERE verrou = 'REINITIALISATION'`)) === 1);
const dg2 = await connecter("dg@simassurances.test");
await dg2.p.goto(`${B}/systeme/reinitialisation`);
const message2 = (await dg2.p.locator("[data-message-verrou]").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
verifier("4. après redémarrage : même message sur l'écran, aucun bouton", MSG_ECRAN.test(message2) && message2 === message && (await dg2.p.locator('[data-action="simuler"], [data-action="sauvegarder"], [data-action="purger"], [data-action="lever-verrou"]').count()) === 0, message2);
await refusEnBloc(dg2.ctx, "4. après redémarrage");
await dg2.ctx.close();

// ======================================================================================================================
// 5. Seul l'UPDATE SQL du runbook lève le verrou
// ======================================================================================================================
const idLigne = (await q(`SELECT id FROM "ReinitialisationSysteme"`))[0].id;
await db.query(`UPDATE "ReinitialisationSysteme" SET verrou = 'LEVE-' || id WHERE verrou = 'REINITIALISATION'`);
verifier("5. UPDATE SQL : le verrou est levé, la ligne d'audit est conservée (verrou = LEVE-<id>)", (await nombre("ReinitialisationSysteme")) === 1 && (await q(`SELECT verrou AS v FROM "ReinitialisationSysteme"`))[0].v === `LEVE-${idLigne}`);
const dg3 = await connecter("dg@simassurances.test");
await dg3.p.goto(`${B}/systeme/reinitialisation`);
verifier("5. verrou levé : l'assistant revient (simulation à faire), plus de message de verrou", (await dg3.p.locator("[data-message-verrou]").count()) === 0 && (await dg3.p.locator('[data-action="simuler"]').count()) === 1);
const simLibre = await agir(dg3.ctx, "simulerAction", []);
verifier("5. verrou levé : la simulation est de nouveau acceptée", simLibre.statut === "success", simLibre.message || "(pas de message)");
await dg3.ctx.close();

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
