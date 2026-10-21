// Autonomie des articles, lot H — LIBELLÉS DE DATES (Demande créée le / Livraison prévue le / Géré le) ET DU MENU (Accueil, Accueil Finance, infobulles).
// Sur base JETABLE (voir e2e/README.md). Nécessite `pdftotext` et `unzip`.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { chromium } from "playwright";
import pg from "pg";
import { assurerSignatures } from "./signatures-auto.mjs";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/i.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");

const db = new pg.Client({ connectionString: DB });
await db.connect();
await assurerSignatures(db); // lot L : les actions sensibles exigent une signature enrôlée
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const erreursJs = [];
const attendre = async (fn, ms = 15000) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};
const net = (t) => t.replace(/ | /g, " ").replace(/\s+/g, " ");
const PDF = (nom) => ({ name: nom, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n") });
const dossier = mkdtempSync(join(tmpdir(), "loth-"));

const PREFIXE = "e2e-loth-";
const nettoyer = async () => {
  await q(`DELETE FROM "Notification" WHERE message LIKE '%DEM-LOTH-%'`);
  await q(`DELETE FROM "HistoriqueEntry" WHERE "entityId" LIKE '${PREFIXE}%' OR detail LIKE '%DEM-LOTH-%'`);
  await q(`DELETE FROM "JournalCaisse" WHERE id LIKE '${PREFIXE}%' OR "demandeId" LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "PieceJointe" WHERE id LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "DepenseLigne" WHERE "retourCaisseId" IN (SELECT id FROM "RetourCaisse" WHERE "reglementId" IN (SELECT id FROM "Reglement" WHERE "demandeId" LIKE '${PREFIXE}%'))`);
  await q(`DELETE FROM "RetourCaisse" WHERE "reglementId" IN (SELECT id FROM "Reglement" WHERE "demandeId" LIKE '${PREFIXE}%')`);
  await q(`DELETE FROM "ReglementCategorieAllocation" WHERE "reglementId" LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "Reglement" WHERE id LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "LigneDemande" WHERE "demandeId" LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "Demande" WHERE id LIKE '${PREFIXE}%'`);
};
await nettoyer();

const uid = async (email) => (await q(`SELECT id FROM "User" WHERE email = $1`, [email]))[0].id;
const idCollab = await uid("collaborateur@simassurances.test");
const idFinance = await uid("finance@simassurances.test");
const idAssistant = await uid("assistant-finance@simassurances.test");

const sessions = new Map();
async function connecter(email) {
  let ctx = sessions.get(email);
  if (!ctx) {
    ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
    const connexion = await ctx.newPage();
    connexion.on("pageerror", (e) => erreursJs.push(e.message));
    await connexion.goto(`${B}/login`);
    await connexion.fill('input[name="email"]', email);
    await connexion.fill('input[name="password"]', "password123");
    await Promise.all([connexion.waitForURL((u) => !u.pathname.startsWith("/login")), connexion.click('button[type="submit"]')]);
    await connexion.close();
    sessions.set(email, ctx);
  }
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(e.message));
  return p;
}
const soldeCaisse = async () => Number((await q(`SELECT COALESCE(SUM(CASE WHEN type = 'ENTREE' THEN montant ELSE -montant END), 0)::float AS s FROM "JournalCaisse"`))[0].s);


const PREF = PREFIXE;
await q(`INSERT INTO "Categorie"(id, label, "isActive") VALUES ('e2e-loth-cat', 'E2E-H-CAT', true) ON CONFLICT (id) DO NOTHING`);

// ---------------------------------------------------------------------------------------------------------------------
// Fixture : demande créée le 01/09/2026 ; article A (livraison 15/12/2026, validé le 10/09, réglé 100 000 en Caisse le 05/10/2026)
// et article B (sans date de livraison, encore en attente, donc « Géré le — »).
// ---------------------------------------------------------------------------------------------------------------------
const D = `${PREF}D`;
const LA = `${D}-a`;
const LB = `${D}-b`;
await q(
  `INSERT INTO "Demande"(id, reference, montant, "montantValide", statut, "createurId", "updatedAt", "createdAt", "beneficiaireType", "beneficiaireUserId", "etapeCircuit", "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", description)
   VALUES ($1, 'DEM-LOTH-1', 150000, 100000, 'PARTIELLEMENT_VALIDEE', $2, now(), '2026-09-01T09:00:00Z', 'COLLABORATEUR', $2, 'FINANCE', true, false, 'OPTIONNELLE', 'test e2e lot H')`,
  [D, idCollab]
);
await q(
  `INSERT INTO "LigneDemande"(id, libelle, "libelleOriginal", quantite, "prixUnitaire", "demandeId", "categorieId", motif, "statutValidation", "decideParId", "decideAt", "decideurFinanceId", "dateLivraison")
   VALUES ($1, 'ARTICLE A', 'ARTICLE A', 1, 100000, $2, 'e2e-loth-cat', 'motif', 'VALIDEE', $3, '2026-09-10T09:00:00Z', $3, '2026-12-15')`,
  [LA, D, idFinance]
);
await q(
  `INSERT INTO "LigneDemande"(id, libelle, "libelleOriginal", quantite, "prixUnitaire", "demandeId", "categorieId", motif, "statutValidation")
   VALUES ($1, 'ARTICLE B', 'ARTICLE B', 1, 50000, $2, 'e2e-loth-cat', 'motif', 'EN_ATTENTE')`,
  [LB, D]
);
await q(`INSERT INTO "JournalCaisse"(id, type, montant, source, "refId", "userId") VALUES ('e2e-loth-appro', 'ENTREE', 1000000, 'alimentation_caisse', 'e2e-loth-appro', $1)`, [idAssistant]);
await q(
  `INSERT INTO "Reglement"(id, montant, mode, "estConfirme", "demandeId", "ligneDemandeId", "auteurId", "confirmeAt") VALUES ($1, 100000, 'CAISSE', true, $2, $3, $4, '2026-10-05T10:00:00Z')`,
  [`${PREF}rA`, D, LA, idAssistant]
);
await q(`INSERT INTO "JournalCaisse"(id, type, montant, source, "refId", "userId", "demandeId") VALUES ('e2e-loth-sortie', 'SORTIE', 100000, 'reglement_caisse', $1, $2, $3)`, [`${PREF}rA`, idAssistant, D]);
const caisseAvant = await soldeCaisse();

// ======================================================================================================================
// 1. MENU : libellés par rôle (routes inchangées), infobulles, titres de page
// ======================================================================================================================
const liens = async (p) =>
  p.evaluate(() =>
    [...document.querySelectorAll("aside a[href]")].map((a) => ({ href: a.getAttribute("href"), texte: a.textContent.replace(/\s+/g, " ").trim(), title: a.getAttribute("title") }))
  );
const parRole = {};
for (const [role, email] of [
  ["Collaborateur", "collaborateur@simassurances.test"],
  ["Finance (Responsable)", "finance@simassurances.test"],
  ["Assistant Finance", "assistant-finance@simassurances.test"],
  ["DG", "dg@simassurances.test"],
  ["RH", "rh@simassurances.test"],
  ["Admin", "admin@simassurances.test"],
  ["Responsable de service", "responsable-commercial@simassurances.test"],
]) {
  const p = await connecter(email);
  await p.goto(`${B}/`);
  await p.waitForSelector("aside a[href]");
  const ls = await liens(p);
  parRole[role] = ls;
  const dash = ls.filter((l) => /tableau de bord|accueil/i.test(l.texte)).map((l) => `${l.href} « ${l.texte} »`);
  console.log(`MENU ${role} : ${dash.join(" | ")}`);
  verifier(`1. ${role} : aucun ancien libellé « Mon tableau de bord » / « Tableau de bord Finance »`, !ls.some((l) => /Mon tableau de bord|Tableau de bord Finance/i.test(l.texte)));
  verifier(`1. ${role} : l'entrée "/" garde « Tableau de bord »`, ls.find((l) => l.href === "/")?.texte === "Tableau de bord");
  await p.close();
}
const lib = (role, href) => parRole[role].find((l) => l.href === href)?.texte ?? null;
verifier("1. Collaborateur : /treso/tableau-de-bord = « Accueil », pas d'entrée Finance", lib("Collaborateur", "/treso/tableau-de-bord") === "Accueil" && lib("Collaborateur", "/treso/finance") === null);
verifier("1. Finance : /treso/finance = « Accueil Finance » (et son accueil personnel « Accueil »)", lib("Finance (Responsable)", "/treso/finance") === "Accueil Finance" && lib("Finance (Responsable)", "/treso/tableau-de-bord") === "Accueil");
verifier("1. Assistant Finance : pas d'accès au tableau Finance (permission absente) ; son accueil personnel = « Accueil »", lib("Assistant Finance", "/treso/finance") === null && lib("Assistant Finance", "/treso/tableau-de-bord") === "Accueil");
verifier("1. DG : /treso/finance = « Accueil Finance »", lib("DG", "/treso/finance") === "Accueil Finance");
verifier("1. RH et Admin : seulement « Tableau de bord » (aucune entrée Accueil Trésorerie)", lib("RH", "/treso/tableau-de-bord") === null && lib("Admin", "/treso/tableau-de-bord") === null && lib("RH", "/treso/finance") === null);
verifier("1. infobulle (title) = libellé complet sur chaque entrée du menu", Object.values(parRole).every((ls) => ls.every((l) => !l.texte || l.title === l.texte.replace(/\d+$/, "").trim() || (l.title && l.texte.startsWith(l.title)))), JSON.stringify(Object.values(parRole)[0].filter((l) => l.title !== l.texte).slice(0, 3)));
{
  const p = await connecter("finance@simassurances.test");
  await p.goto(`${B}/treso/finance`);
  verifier("1. /treso/finance : titre de page « Accueil Finance »", (await p.locator("h1").first().innerText()).trim() === "Accueil Finance");
  await p.goto(`${B}/treso/tableau-de-bord`);
  verifier("1. /treso/tableau-de-bord : titre de page « Accueil »", (await p.locator("h1").first().innerText()).trim() === "Accueil");
  await p.goto(`${B}/`);
  verifier("1. / : titre de page « Tableau de bord » (inchangé)", (await p.locator("h1").first().innerText()).trim() === "Tableau de bord");
  // Libellé tronqué : le lien porte son libellé complet en infobulle, sans changer la largeur du menu.
  const tronque = await p.evaluate(() => {
    const a = [...document.querySelectorAll("aside a[href]")].find((x) => x.getAttribute("href") === "/treso/finance/solde-ouverture");
    const s = a?.querySelector("span");
    return a ? { title: a.getAttribute("title"), largeurMenu: document.querySelector("aside").getBoundingClientRect().width, tronque: s ? s.scrollWidth > s.clientWidth : null } : null;
  });
  verifier("1. entrée « Solde d'ouverture de caisse » : infobulle complète, menu à 256 px", !!tronque && tronque.title === "Solde d'ouverture de caisse" && Math.round(tronque.largeurMenu) === 256, JSON.stringify(tronque));
  await p.close();
}

// ======================================================================================================================
// 2. DATES : écrans (collaborateur, Finance), listes
// ======================================================================================================================
{
  const c = await connecter("collaborateur@simassurances.test");
  await c.goto(`${B}/treso/demandes/${D}`);
  const page = net(await c.locator("body").innerText());
  verifier("2. détail collaborateur : « Demande créée le 01/09/2026 »", /Demande créée le 01\/09\/2026/.test(page), page.slice(0, 200));
  verifier("2. détail collaborateur : « Géré le 05/10/2026 » au niveau de la demande (dernier événement : règlement)", /Géré le 05\/10\/2026 \(réglé\)/.test(page));
  const livraisons = (await c.locator("[data-date-livraison]").allInnerTexts()).map(net);
  verifier("2. cartes d'articles : « Livraison prévue le 15/12/2026 » (A) et « Livraison prévue le — » (B)", livraisons.some((t) => /Livraison prévue le 15\/12\/2026/.test(t)) && livraisons.some((t) => /Livraison prévue le —/.test(t)), livraisons.join(" | "));
  const gere = (await c.locator("[data-gere-le]").allInnerTexts()).map(net);
  verifier("2. cartes d'articles : A « Géré le 05/10/2026 (réglé) », B « Géré le — »", gere.some((t) => /Géré le 05\/10\/2026 \(réglé\)/.test(t)) && gere.some((t) => /^Géré le —$/.test(t)), gere.join(" | "));

  // Formulaire « Nouvelle demande d'achat » : date de création automatique, un seul bouton « Appliquer à tous les articles ».
  await c.goto(`${B}/treso/demandes/nouvelle`);
  const aujourdhui = new Date().toLocaleDateString("fr-FR", { timeZone: "Africa/Abidjan" });
  const bloc = net(await c.locator("[data-demande-creee-le]").innerText());
  verifier("2. formulaire : « Demande créée le <date du jour> » dans l'en-tête, non modifiable", bloc.includes("Demande créée le") && bloc.includes(aujourdhui) && (await c.locator("[data-demande-creee-le] input, [data-demande-creee-le] select").count()) === 0, bloc);
  verifier("2. formulaire : un seul bouton « Appliquer à tous les articles » (plus de bouton « Appliquer la date »)", (await c.locator("[data-appliquer-a-tous]").count()) === 1 && (await c.locator("[data-appliquer-date-a-tous]").count()) === 0 && (await c.getByRole("button", { name: /Appliquer la date/ }).count()) === 0);
  const futur = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  await c.locator("[data-date-livraison-commune]").fill(futur(10));
  await c.locator("[data-date-livraison-article]").first().fill(futur(20));
  await c.locator("[data-appliquer-a-tous]").click();
  verifier("2. formulaire : une date d'article personnalisée demande confirmation avant remplacement", (await c.locator("[data-confirmation-appliquer]").count()) === 1 && (await c.locator("[data-date-livraison-article]").first().inputValue()) === futur(20));
  await c.getByRole("button", { name: "Remplacer" }).click();
  verifier("2. formulaire : « Appliquer à tous les articles » applique aussi la date commune", (await c.locator("[data-date-livraison-article]").first().inputValue()) === futur(10));
  await c.goto(`${B}/treso/demandes`);
  const entetes = (await c.locator("table th, [role=columnheader]").allInnerTexts()).map(net).join(" | ");
  verifier("2. « Mes demandes » : colonnes « Demande créée le » et « Géré le »", /Demande créée le/i.test(entetes) && /Géré le/i.test(entetes), entetes);
  const ligneDem = net(await c.locator("tr", { hasText: "DEM-LOTH-1" }).first().innerText().catch(async () => await c.locator("body").innerText()));
  verifier("2. « Mes demandes » : la ligne porte 01/09/2026 et 05/10/2026 (réglé)", /01\/09\/2026/.test(ligneDem) && /05\/10\/2026 \(réglé\)/.test(ligneDem), ligneDem);
  await c.goto(`${B}/treso/tableau-de-bord`);
  const t2 = net(await c.locator("body").innerText());
  verifier("2. « Accueil » (ex-Mon tableau de bord) : colonnes de date libellées", /Demande créée le/i.test(t2) && /Géré le/i.test(t2));
  await c.close();

  const f = await connecter("finance@simassurances.test");
  await f.goto(`${B}/treso/finance/demandes/${D}`);
  const pf = net(await f.locator("body").innerText());
  verifier("2. détail Finance : « Demande créée le 01/09/2026 par … · Géré le 05/10/2026 (réglé) »", /Demande créée le 01\/09\/2026 par/.test(pf) && /Géré le 05\/10\/2026 \(réglé\)/.test(pf));
  verifier("2. détail Finance : cartes d'articles « Livraison prévue le » et « Géré le »", (await f.locator("[data-date-livraison]").count()) === 2 && (await f.locator("[data-gere-le]").count()) >= 2);
  await f.goto(`${B}/treso/finance/demandes/toutes?reference=LOTH`);
  const tt = net(await f.locator("body").innerText());
  verifier("2. « Toutes les demandes » : colonnes libellées, ligne 01/09/2026 et 05/10/2026 (réglé)", /Demande créée le/i.test(tt) && /Géré le/i.test(tt) && /01\/09\/2026/.test(tt) && /05\/10\/2026 \(réglé\)/.test(tt), tt.slice(0, 300));
  await f.close();
}

// ======================================================================================================================
// 3. DATES : PDF (reçu de règlement) et Excel (reporting)
// ======================================================================================================================
{
  const f = await connecter("finance@simassurances.test");
  const recu = await f.request.get(`${B}/api/treso/reglements/${PREF}rA/recu`);
  const pdf = join(dossier, "recu.pdf");
  writeFileSync(pdf, await recu.body());
  const t = net(execFileSync("pdftotext", ["-layout", pdf, "-"]).toString());
  verifier("3. reçu PDF : « Demande créée le 1 septembre 2026 », « Livraison prévue le 15/12/2026 », « Géré le 05/10/2026 (réglé) »", recu.status() === 200 && /Demande créée le\s+0?1(er)? septembre 2026/i.test(t) && /Livraison prévue le\s+15\/12\/2026/.test(t) && /Géré le\s+05\/10\/2026 \(réglé\)/.test(t), t.slice(0, 400));
  const bon = await f.request.get(`${B}/api/treso/reglements/${PREF}rA/bon-de-caisse`);
  writeFileSync(join(dossier, "bon.pdf"), await bon.body());
  const tb = net(execFileSync("pdftotext", ["-layout", join(dossier, "bon.pdf"), "-"]).toString());
  verifier("3. bon de caisse : « Demande créée le » et « Livraison prévue le » (document minimal, sans « Géré le »)", bon.status() === 200 && /Demande créée le/.test(tb) && /Livraison prévue le/.test(tb) && !/Géré le/.test(tb), tb.slice(0, 300));
  await f.goto(`${B}/treso/finance/reporting`);
  const rep = net(await f.locator("body").innerText());
  verifier("3. écran de reporting : colonnes « Demande créée le » et « Géré le »", /Demande créée le/i.test(rep) && /Géré le/i.test(rep));
  const x = await f.request.get(`${B}/api/treso/reporting/export`);
  const xlsx = join(dossier, "export.xlsx");
  writeFileSync(xlsx, await x.body());
  const partages = execFileSync("unzip", ["-p", xlsx, "xl/sharedStrings.xml"], { maxBuffer: 64 * 1024 * 1024 }).toString();
  verifier("3. export Excel : en-têtes « Demande créée le » et « Géré le »", x.status() === 200 && partages.includes("Demande créée le") && partages.includes("Géré le"));
  const cl = new ExcelJS.Workbook();
  await cl.xlsx.readFile(xlsx);
  const feuille = cl.getWorksheet("Reporting");
  const entetes = feuille.getRow(1).values;
  const colLivraison = entetes.indexOf("Livraison prévue le");
  let livraisonOk = false;
  feuille.eachRow((row, n) => {
    const v = n > 1 ? row.getCell(colLivraison).value : null;
    if (v instanceof Date && v.toISOString().startsWith("2026-12-15")) livraisonOk = true;
  });
  verifier("3. export Excel : colonne « Livraison prévue le » (15/12/2026) sur la ligne de l'article, « 05/10/2026 (réglé) » en Géré le", livraisonOk && partages.includes("05/10/2026 (réglé)"));
  verifier("3. export Excel : feuille annexe « Journal de caisse » — « Date de l'écriture »", partages.includes("Date de l&apos;écriture") || partages.includes("Date de l'écriture"));
  await f.close();
}
verifier("aucune écriture de caisse créée par ces affichages (solde inchangé)", (await soldeCaisse()) === caisseAvant);

await nettoyer();
verifier("aucune erreur JavaScript en console", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles OK`);
await browser.close();
await db.end();
process.exit(ko === 0 ? 0 : 1);
