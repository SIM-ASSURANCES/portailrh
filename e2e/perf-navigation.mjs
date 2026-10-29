// Lot N+O (partie 4) — temps de navigation en PRODUCTION (`next start`) sur une base jetable bien remplie (e2e/perf-donnees.ts).
// Autonome : crée la base `perf` (migrations + seed + volume), lance `next start` sur le port 3102, mesure chaque page principale
// (3 passages, médiane, temps jusqu'à l'évènement « load »), imprime un tableau et signale les pages lentes. Supprime la base ensuite
// (E2E_GARDER_BASE=1 pour la garder). Prérequis : `next build` fait.
import { chromium } from "playwright";
import pg from "pg";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND = path.join(RACINE, "backend");
const FRONTEND = path.join(RACINE, "frontend");
const PORT = 3102;
const B = `http://localhost:${PORT}`;
const BASE = "perf";
const URL_PG = `postgresql://postgres:pw@localhost:55497/${BASE}`;
const ENV = { ...process.env, DATABASE_URL: `${URL_PG}?schema=public` };
const SEUIL_LENT_MS = Number(process.env.E2E_SEUIL_LENT_MS ?? 1500);
const sh = (args) => spawnSync("npx", args, { cwd: BACKEND, env: ENV, encoding: "utf8" });

const admin = new pg.Client({ connectionString: "postgresql://postgres:pw@localhost:55497/postgres" });
await admin.connect();
if (!process.env.E2E_REUTILISER_BASE) {
  await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${BASE}'`);
  await admin.query(`DROP DATABASE IF EXISTS ${BASE}`);
  await admin.query(`CREATE DATABASE ${BASE}`);
  sh(["prisma", "migrate", "deploy", "--config", "prisma7.config.ts"]);
  sh(["tsx", "prisma/seed.ts"]);
  const r = sh(["tsx", "../e2e/perf-donnees.ts"]);
  console.log(r.stdout.trim().split("\n").pop());
}

const serveur = spawn("npx", ["next", "start", "-p", String(PORT)], {
  cwd: FRONTEND,
  detached: true,
  stdio: "ignore",
  env: { ...ENV, AUTH_SECRET: "secret-e2e-perf-0123456789abcdef0123456789abcdef", AUTH_URL: B, ALLOWED_OFFICE_IPS: "10.9.9.9,127.0.0.1,::1", CRON_SECRET: "secret-e2e", AUTH_TRUST_HOST: "true", PLANIFICATEUR_ACTIF: "false" },
});
const arreter = () => {
  try {
    process.kill(-serveur.pid);
  } catch {
    /* déjà arrêté */
  }
};
process.on("exit", arreter);
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${B}/login`)).ok) break;
  } catch {
    /* pas prêt */
  }
  await new Promise((res) => setTimeout(res, 1000));
}

const PAGES = {
  "perf1@simassurances.test": [["Accueil (modules)", "/"], ["Mon accueil Trésorerie", "/treso/tableau-de-bord"], ["Mes demandes", "/treso/demandes"], ["Mon historique de pointage", "/pointage/historique"], ["Nouvelle demande", "/treso/demandes/nouvelle"]],
  "finance@simassurances.test": [
    ["Accueil Finance", "/treso/finance"],
    ["Demandes en attente de validation", "/treso/finance/demandes"],
    ["Toutes les demandes", "/treso/finance/demandes/toutes"],
    ["À décaisser", "/treso/finance/a-decaisser"],
    ["À régulariser", "/treso/finance/a-regulariser"],
    ["Fonds à régulariser", "/treso/finance/fonds-a-regulariser"],
    ["Dépenses non justifiées", "/treso/finance/depenses-non-justifiees"],
    ["Budgets", "/treso/finance/budgets"],
    ["Reporting (tableau unique)", "/treso/finance/reporting"],
    ["Retours en attente", "/treso/finance/retours"],
    ["Solde d'ouverture / caisse", "/treso/finance/solde-ouverture"],
  ],
  "dg@simassurances.test": [["Étape DG", "/treso/dg"], ["Accueil Finance (DG)", "/treso/finance"]],
  "responsable-commercial@simassurances.test": [["Mon service", "/treso/service"], ["Mon équipe", "/pointage/mon-equipe"], ["Justifications", "/pointage/justifications"]],
  "rh@simassurances.test": [["Présence du jour (RH)", "/pointage/rh/presence"], ["Reporting pointage (RH)", "/pointage/rh/reporting"], ["Absences (RH)", "/pointage/rh/absences"], ["Pointages (RH)", "/pointage/rh/pointages"], ["Corrections (RH)", "/pointage/rh/corrections"]],
  "admin@simassurances.test": [["Console admin", "/admin"], ["Utilisateurs", "/admin/users"], ["Journal technique", "/admin/journal-technique"]],
};

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const lignes = [];
for (const [email, pages] of Object.entries(PAGES)) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
  const p = await ctx.newPage();
  await p.goto(`${B}/login`);
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', "password123");
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click('button[type="submit"]')]);
  for (const [nom, chemin] of pages) {
    const temps = [];
    let statut = 0;
    for (let i = 0; i < 3; i++) {
      const debut = Date.now();
      try {
        const rep = await p.goto(`${B}${chemin}`, { waitUntil: "load", timeout: 60000 });
        statut = rep?.status() ?? 0;
      } catch {
        statut = -1; // délai de 60 s dépassé
      }
      temps.push(Date.now() - debut);
      if (statut === -1) break;
      if (i === 0 && p.url().includes("acces_refuse")) statut = 307;
    }
    const mediane = [...temps].sort((a, b) => a - b)[Math.floor(temps.length / 2)];
    lignes.push({ email: email.split("@")[0], nom, chemin, statut, temps, mediane });
  }
  await ctx.close();
}
await browser.close();

console.log(`\nPage`.padEnd(46) + "Compte".padEnd(24) + "HTTP".padEnd(6) + "passages (ms)".padEnd(22) + "médiane");
for (const l of lignes) {
  console.log(`${l.nom}`.padEnd(45) + ` ${l.email}`.padEnd(24) + `${l.statut}`.padEnd(6) + l.temps.join(" / ").padEnd(22) + `${l.mediane} ms${l.statut === -1 ? " (DÉLAI DÉPASSÉ)" : ""}${l.mediane > SEUIL_LENT_MS ? "   ← LENT" : ""}`);
}
const lentes = lignes.filter((l) => l.mediane > SEUIL_LENT_MS);
console.log(`\n${lignes.length} pages mesurées, ${lentes.length} au-dessus de ${SEUIL_LENT_MS} ms : ${lentes.map((l) => l.nom).join(", ") || "aucune"}.`);

arreter();
if (!process.env.E2E_GARDER_BASE) {
  await new Promise((res) => setTimeout(res, 1500));
  await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${BASE}'`).catch(() => {});
  await admin.query(`DROP DATABASE IF EXISTS ${BASE}`).catch(() => {});
}
await admin.end();
