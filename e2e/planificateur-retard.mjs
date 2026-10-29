// Fiabilisation du pointage — phase 3 : planificateur coupé (PLANIFICATEUR_ACTIF=false) → le moniteur passe la tâche
// « En retard ». À lancer sur un serveur démarré avec `PLANIFICATEUR_ACTIF=false bash e2e/base-jetable.sh`.
import { chromium } from "playwright";
import pg from "pg";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");
const db = new pg.Client({ connectionString: DB });
await db.connect();
const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);

// Dernière exécution réussie il y a 20 minutes : plus de deux intervalles de 5 minutes.
const il_y_a = new Date(Date.now() - 20 * 60_000);
await db.query(
  `INSERT INTO "ExecutionTache"(id, tache, declenchement, debut, fin, statut) VALUES ('e2e-retard', 'RELANCES_JUSTIFICATION', 'PLANIFICATEUR', $1, $1, 'SUCCES')`,
  [il_y_a]
);
await new Promise((r) => setTimeout(r, 20_000)); // laisser passer le premier passage éventuel (il doit NE PAS avoir lieu)
const n = (await db.query(`SELECT count(*)::int n FROM "ExecutionTache" WHERE declenchement='PLANIFICATEUR' AND id <> 'e2e-retard'`)).rows[0].n;
verifier("Planificateur coupé : aucune exécution planifiée", n === 0, `${n} ligne(s)`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
const p = await ctx.newPage();
await p.goto(`${B}/login`);
await p.fill('input[name="email"]', "admin@simassurances.test");
await p.fill('input[name="password"]', "password123");
await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click('button[type="submit"]')]);
await p.goto(`${B}/admin/journal-technique`);
const carte = p.locator('[data-tache="RELANCES_JUSTIFICATION"]');
verifier("Moniteur : « En retard » sur les relances", (await carte.innerText()).includes("En retard"));
await p.goto(`${B}/admin`);
const accueil = await p.locator('[data-carte="journal-technique"]').innerText();
verifier("Accueil admin : tâche(s) en retard signalée(s)", /en retard/.test(accueil), accueil.replace(/\n/g, " | "));
await p.goto(`${B}/admin/journal-technique?onglet=sante`);
verifier("Santé : « Planificateur actif » = Non", /Planificateur actif[\s\S]{0,120}Non/.test(await p.locator("body").innerText()));
await browser.close();
await db.end();
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko ? 1 : 0);
