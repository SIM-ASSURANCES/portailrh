// Renommer un compte (Admin > Utilisateurs). Base JETABLE uniquement (e2e/README.md).
// Vérifie : renommage à l'écran (bureau), refus d'un nom de 1 caractère, rejeu de l'action par un non-Admin refusé, nom dans la
// file du responsable du service, dans l'export du reporting, entrée CHANGE_NOM en base, nom de session sans reconnexion,
// et absence de défilement horizontal à 390 px.
import ExcelJS from "exceljs";
import { chromium } from "playwright";
import pg from "pg";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/i.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");
const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);

const EMAIL = "collaborateur@simassurances.test";
const NOM = "Collaborateur Renommé";
const [collab] = await q(`SELECT id, "fullName" FROM "User" WHERE email = $1`, [EMAIL]);
const ancienNom = collab.fullName;

await q(`INSERT INTO "Categorie"(id, label, "isActive") VALUES ('e2e-nom-cat', 'E2E-NOM-CAT', true) ON CONFLICT (id) DO NOTHING`);
await q(
  `INSERT INTO "Demande"(id, reference, montant, statut, "createurId", "updatedAt", "beneficiaireType", "beneficiaireUserId", "etapeCircuit", "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", "typeDemande", "etapeCircuitDepuis", description)
   VALUES ('e2e-nom-d1', 'DEM-NOM-1', 50000, 'EN_ATTENTE_VALIDATION', $1, now(), 'COLLABORATEUR', $1, 'SERVICE', true, true, 'OPTIONNELLE', 'STANDARD', now(), 'test e2e nom')
   ON CONFLICT (id) DO NOTHING`,
  [collab.id]
);
await q(
  `INSERT INTO "LigneDemande"(id, libelle, "libelleOriginal", quantite, "prixUnitaire", "demandeId", "categorieId", motif, "statutValidation")
   VALUES ('e2e-nom-l1', 'Article nom', 'Article nom', 1, 50000, 'e2e-nom-d1', 'e2e-nom-cat', 'motif', 'EN_ATTENTE') ON CONFLICT (id) DO NOTHING`
);

const browser = await chromium.launch();
const erreursJs = [];
async function connecter(email, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(e.message));
  await p.goto(`${B}/login`);
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', "password123");
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click('button[type="submit"]')]);
  return { ctx, p };
}

// Session du collaborateur ouverte AVANT le renommage (pour prouver l'absence de reconnexion).
const collabSession = await connecter(EMAIL);
await collabSession.p.goto(`${B}/profil`);
verifier("avant : le collaborateur voit son ancien nom", (await collabSession.p.content()).includes(ancienNom));

// --- Admin : renommage à l'écran (bureau) ---
const admin = await connecter("admin@simassurances.test");
const a = admin.p;
let requeteAction = null;
a.on("request", (r) => {
  if (r.method() === "POST" && r.headers()["next-action"] && r.postData()?.includes(collab.id)) requeteAction = { headers: r.headers(), body: r.postData() };
});
await a.goto(`${B}/admin/users`);
const ligne = () => a.locator("tbody tr", { hasText: EMAIL });
await ligne().getByRole("button", { name: /Modifier le nom de/ }).click();

// Nom d'un seul caractère : refusé, erreur sous le champ, base inchangée.
await a.getByRole("textbox", { name: `Nom de ${ancienNom}` }).fill("A");
await a.getByRole("button", { name: "Enregistrer" }).click();
await a.waitForSelector("text=au moins 2 caractères");
verifier("nom de 1 caractère refusé (erreur sous le champ)", true);
verifier("base inchangée après le refus", (await q(`SELECT "fullName" FROM "User" WHERE id = $1`, [collab.id]))[0].fullName === ancienNom);

// Nom valide (espaces multiples réduits).
await a.getByRole("textbox", { name: `Nom de ${ancienNom}` }).fill(`  Collaborateur    Renommé  `);
await a.getByRole("button", { name: "Enregistrer" }).click();
await a.waitForSelector(`tbody tr:has-text("${NOM}")`);
verifier("nouveau nom dans la liste des comptes", (await ligne().first().innerText()).includes(NOM));
verifier("toast de succès", (await a.locator("[data-sonner-toast]").allInnerTexts()).some((t) => t.includes("Nom mis à jour")));
const [apres] = await q(`SELECT "fullName" FROM "User" WHERE id = $1`, [collab.id]);
verifier("nom enregistré nettoyé en base", apres.fullName === NOM, apres.fullName);
const hist = await q(`SELECT detail, "userId" FROM "HistoriqueEntry" WHERE entity = 'User' AND "entityId" = $1 AND action = 'CHANGE_NOM'`, [collab.id]);
verifier("une entrée CHANGE_NOM (ancien → nouveau)", hist.length === 1 && hist[0].detail.includes(ancienNom) && hist[0].detail.includes(NOM), hist[0]?.detail);

// Nom identique : aucune écriture supplémentaire.
await ligne().getByRole("button", { name: /Modifier le nom de/ }).click();
await a.getByRole("button", { name: "Enregistrer" }).click();
await a.waitForTimeout(1500);
verifier("nom identique : pas de nouvelle entrée", (await q(`SELECT 1 FROM "HistoriqueEntry" WHERE "entityId" = $1 AND action = 'CHANGE_NOM'`, [collab.id])).length === 1);

// --- Non-Admin : rejeu de la même Server Action refusé ---
verifier("requête de l'action capturée", requeteAction !== null);
if (requeteAction) {
  const h = { "next-action": requeteAction.headers["next-action"], "content-type": requeteAction.headers["content-type"] ?? "text/plain;charset=UTF-8", accept: "text/x-component" };
  const corps = JSON.stringify([collab.id, "Pirate"]);
  const rep = await collabSession.ctx.request.post(`${B}/admin/users`, { headers: h, data: corps });
  const texte = await rep.text();
  verifier("non-Admin : action refusée (« Action non autorisée. »)", texte.includes("Action non autorisée."), `HTTP ${rep.status()}`);
  verifier("non-Admin : nom inchangé en base", (await q(`SELECT "fullName" FROM "User" WHERE id = $1`, [collab.id]))[0].fullName === NOM);
}

// --- Session du collaborateur : nouveau nom sans reconnexion ---
await collabSession.p.goto(`${B}/profil`);
verifier("session : le collaborateur voit le nouveau nom sans se reconnecter", (await collabSession.p.content()).includes(NOM));

// --- File du responsable du service ---
const resp = await connecter("responsable-commercial@simassurances.test");
await resp.p.goto(`${B}/treso/service`);
verifier("file du responsable du service : nouveau nom", (await resp.p.content()).includes(NOM) && !(await resp.p.content()).includes(ancienNom));

// --- Export du reporting ---
const fin = await connecter("finance@simassurances.test");
const exp = await fin.ctx.request.get(`${B}/api/treso/reporting/export`);
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(await exp.body());
let trouveNouveau = false;
let trouveAncien = false;
wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => {
  const v = String(c.value ?? "");
  if (v.includes(NOM)) trouveNouveau = true;
  if (v.includes(ancienNom)) trouveAncien = true;
})));
verifier("export du reporting : nouveau nom", trouveNouveau && !trouveAncien);

// --- 390 px : pas de défilement horizontal (liste et édition) ---
const mob = await connecter("admin@simassurances.test", { width: 390, height: 800 });
await mob.p.goto(`${B}/admin/users`);
const defil = () => mob.p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
verifier("390 px : pas de défilement horizontal (liste)", await defil());
const carte = mob.p.locator("div.md\\:hidden > div", { hasText: EMAIL }).first();
await carte.getByRole("button", { name: /Modifier le nom de/ }).click();
verifier("390 px : champ d'édition visible dans la carte mobile", await mob.p.getByRole("textbox", { name: `Nom de ${NOM}` }).isVisible());
verifier("390 px : pas de défilement horizontal (édition)", await defil());
await mob.p.getByRole("button", { name: "Annuler" }).click();

verifier("aucune erreur JavaScript", erreursJs.length === 0, erreursJs.join(" | "));

// Nettoyage des fixtures.
await q(`DELETE FROM "LigneDemande" WHERE id = 'e2e-nom-l1'`);
await q(`DELETE FROM "Demande" WHERE id = 'e2e-nom-d1'`);
await browser.close();
await db.end();
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} OK`);
process.exit(ko ? 1 : 0);
