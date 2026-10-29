// Page « Présence du jour » de la RH après l'extraction de sa lecture dans `lib/presenceJour.ts` (phase 5 de la
// fiabilisation du pointage) : mêmes compteurs, mêmes onglets, même palmarès qu'avant. Base JETABLE (voir e2e/README.md).
// Capture d'écran dans le dossier donné par E2E_CAPTURES (défaut : ./e2e-captures, non versionné).
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import pg from "pg";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
const CAPTURES = process.env.E2E_CAPTURES ?? "./e2e-captures";
if (!/localhost:55497|e2e/.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");
mkdirSync(CAPTURES, { recursive: true });

const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const uid = async (email) => (await q(`SELECT id FROM "User" WHERE email = $1`, [email]))[0].id;
const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);

const collab = await uid("collaborateur@simassurances.test");
const finance = await uid("finance@simassurances.test");
const compta = await uid("responsable-comptabilite@simassurances.test");
const technique = await uid("responsable-technique@simassurances.test");
const aujourdhui = (h, m) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
};

// Jour ouvré attendu : sinon la page affiche « jour de repos » et aucun manquant.
const jourSemaine = new Date().getDay();
if (jourSemaine === 0 || jourSemaine === 6) console.log("ATTENTION : lancé un week-end, les compteurs de manquants seront nuls.");

// Rejouable : nettoie d'abord ses propres lignes.
await q(`DELETE FROM "JustificationPointage" WHERE id LIKE 'jr-%'`);
await q(`DELETE FROM "Pointage" WHERE id LIKE 'pr-%'`);
await q(`DELETE FROM "PlageAbsenceAutorisee" WHERE id LIKE 'plr-%'`);
await q(`DELETE FROM "Absence" WHERE id LIKE 'ar-%'`);
await q(`INSERT INTO "Pointage"(id, type, source, heure, "heurePrevue", "estRetard", "minutesRetard", "userId") VALUES ('pr-1', 'ARRIVEE', 'ORDINATEUR', $1, '07:45', true, 25, $2)`, [aujourdhui(0, 10), collab]);
await q(`INSERT INTO "JustificationPointage"(id, "pointageId", statut, "updatedAt") VALUES ('jr-1', 'pr-1', 'SOUMISE', now())`);
await q(`INSERT INTO "Pointage"(id, type, source, heure, "heurePrevue", "userId") VALUES ('pr-2', 'ARRIVEE', 'ORDINATEUR', $1, '07:45', $2)`, [aujourdhui(0, 5), finance]);
await q(`INSERT INTO "Pointage"(id, type, source, heure, "heurePrevue", "estDepartAnticipe", "userId") VALUES ('pr-3', 'DEPART', 'ORDINATEUR', $1, '16:45', true, $2)`, [aujourdhui(0, 40), finance]);
await q(`INSERT INTO "JustificationPointage"(id, "pointageId", statut, "updatedAt") VALUES ('jr-3', 'pr-3', 'EN_ATTENTE', now())`);
await q(`INSERT INTO "PlageAbsenceAutorisee"(id, date, "heureDebut", "heureFin", source, "userId") VALUES ('plr-1', $1, '00:00', '23:59', 'CONGE', $2)`, [aujourdhui(0, 0), compta]);
await q(`INSERT INTO "Absence"(id, date, statut, "userId", "updatedAt") VALUES ('ar-1', $1, 'A_CONTROLER', $2, now())`, [aujourdhui(0, 0), technique]);

const browser = await chromium.launch();
const erreursJs = [];
const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" }, viewport: { width: 1280, height: 1000 } });
const p = await ctx.newPage();
p.on("pageerror", (e) => erreursJs.push(e.message));
await p.goto(`${B}/login`);
await p.fill('input[name="email"]', "rh@simassurances.test");
await p.fill('input[name="password"]', "password123");
await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click('button[type="submit"]')]);
await p.goto(`${B}/pointage/rh/presence`);

const carte = async (libelle) => Number((await p.locator(`div:has(> p:text-is("${libelle}"))`).first().innerText().catch(() => "")).replace(/\D+/g, " ").trim().split(" ").pop() ?? NaN);
const corps = await p.locator("main").innerText();
verifier("Titre de la page", corps.includes("Présence du jour"));
for (const libelle of ["Présents", "Retardataires", "Absents", "Absences autorisées", "Manquants"]) {
  verifier(`Carte « ${libelle} » affichée`, corps.includes(libelle));
}
// Onglets : effectifs entre parenthèses ou badges ; on lit les listes en cliquant.
async function onglet(nom) {
  await p.getByRole("button", { name: new RegExp(nom) }).first().click();
  // Seulement la liste de l'onglet : entre « Détails de la présence » et « Palmarès des retards ».
  const t = await p.locator("main").innerText();
  return t.slice(t.indexOf("Détails de la présence"), t.indexOf("Palmarès des retards"));
}
const presents = await onglet("Présents");
verifier("Présents : Collaborateur Test (retard) et Finance Test (départ anticipé)", presents.includes("Collaborateur Test") && presents.includes("Finance Test"));
const retards = await onglet("Retardataires");
verifier("Retardataires : Collaborateur Test, 25 min, justification envoyée", retards.includes("Collaborateur Test") && /25 min/.test(retards) && /Justification envoy/i.test(retards));
const absents = await onglet("Absents");
verifier("Absents : le responsable technique (absence enregistrée)", absents.includes("Responsable Technique Test"));
const autorises = await onglet("Absence autorisée");
verifier("Absences autorisées : Comptabilité (congé) et pas dans Absents", autorises.includes("Responsable Comptabilité Test") && !absents.includes("Responsable Comptabilité Test"));
const manquants = await onglet("Manquants");
verifier("Manquants : ni les présents, ni les absents, ni les absences autorisées", !manquants.includes("Collaborateur Test") && !manquants.includes("Finance Test") && !manquants.includes("Responsable Technique Test") && !manquants.includes("Responsable Comptabilité Test"));
await p.getByRole("button", { name: /Présents/ }).first().click();
{
  // Palmarès du mois : doit refléter exactement les pointages en retard du mois en base.
  const debutMois = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const att = (await q(`SELECT count(*)::int n, coalesce(sum("minutesRetard"),0)::int m FROM "Pointage" WHERE "estRetard" AND heure >= $1 AND "userId" = $2`, [debutMois, collab]))[0];
  const t = await p.locator("main").innerText();
  verifier("Palmarès des retards : Collaborateur Test conforme à la base", t.includes(`${att.n} retards (${att.m} min)`), `${att.n} retards (${att.m} min)`);
}
await p.screenshot({ path: `${CAPTURES}/presence-rh.png`, fullPage: true });

// Une date passée via ?date= fonctionne encore.
const hier = new Date();
hier.setDate(hier.getDate() - 1);
const iso = `${hier.getFullYear()}-${String(hier.getMonth() + 1).padStart(2, "0")}-${String(hier.getDate()).padStart(2, "0")}`;
const r = await p.goto(`${B}/pointage/rh/presence?date=${iso}`);
verifier("?date= jour précédent : la page répond", r.status() === 200 && (await p.locator("body").innerText()).includes("Présence du"));

await p.setViewportSize({ width: 390, height: 800 });
await p.goto(`${B}/pointage/rh/presence`);
verifier("390 px sans défilement horizontal de la page", !(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
verifier("Aucune erreur JavaScript", erreursJs.length === 0, erreursJs.join(" | "));

await browser.close();
await db.end();
console.log(resultats.join("\n"));
const ko = resultats.filter((x) => x.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko ? 1 : 0);
