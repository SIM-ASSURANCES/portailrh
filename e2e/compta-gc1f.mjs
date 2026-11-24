// Gestion Compta, lot GC-1f — DÉPÔT DE FICHIER D'IMPORT et EXPORT EN FLUX.
// Sur base JETABLE (voir e2e/README.md : `next build` puis `bash e2e/base-jetable.sh`, avec AUTH_SECRET et AUTH_TRUST_HOST).
// Playwright est installé sans l'enregistrer (`npm i --no-save playwright`) ; ExcelJS vient du workspace frontend.
//  1. dépôt : 401 sans session, 403 sans permission d'import, accepté pour production ET comptable ;
//  2. le type est déduit du CONTENU (un .xlsx renommé .csv reste xlsx), jamais du nom ni du type MIME annoncés ;
//  3. refus (PDF, fichier vide, contenu binaire, trop gros, champ absent) : aucune ligne `CptPieceJointe` créée ;
//  4. le plafond de taille suit le paramètre `import.limite_taille_mo` (modifié puis restauré en base) ;
//  5. trace : `CptPieceJointe` (SHA-256 recalculé, taille) et `CptAudit` « depot_fichier_import » avec l'adresse IP ;
//  6. export d'essai : droits (401/403), paramètres invalides refusés ;
//  7. CSV de 100 000 lignes en moins d'une minute : BOM, en-tête, « ; », virgule décimale, formule neutralisée, négatif ;
//  8. Excel de 100 000 lignes en moins d'une minute, relu avec ExcelJS : nombres, dates, texte `=CLIENT(…)` resté du TEXTE.
import { createHash } from "node:crypto";

import ExcelJS from "exceljs";
import pg from "pg";
import { chromium } from "playwright";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/i.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");
const NB_LIGNES = Number(process.env.E2E_COMPTA_EXPORT_LIGNES ?? 100000);

const db = new pg.Client({ connectionString: DB });
await db.connect();
const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const erreursJs = [];

/** Ouvre une session (contexte navigateur) pour ce compte ; l'API de requêtes du contexte partage ses cookies. */
async function ouvrir(email) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(e.message));
  await p.goto(`${B}/login`);
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', "password123");
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click('button[type="submit"]')]);
  return ctx;
}

const deposer = (ctx, { nom, type, contenu, champ = "file" }) =>
  ctx.request.post(`${B}/api/compta/import/upload`, { multipart: { [champ]: { name: nom, mimeType: type, buffer: contenu } } });

const compter = async (table) => (await db.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n;

// ---------- Fichiers synthétiques ----------
const classeur = new ExcelJS.Workbook();
const feuille = classeur.addWorksheet("Production");
feuille.addRow(["Police", "Date", "Montant"]);
feuille.addRow(["POL-0000001", new Date(Date.UTC(2026, 9, 25)), 12500.5]);
const XLSX = Buffer.from(await classeur.xlsx.writeBuffer());
const CSV = Buffer.from("Police;Date;Montant\r\nPOL-0000001;2026-10-25;12500,50\r\n", "utf8");
const PDF = Buffer.from("%PDF-1.4\n%synthétique\n", "latin1");
const BINAIRE = Buffer.concat([Buffer.from("abc"), Buffer.from([0, 1, 2, 3]), Buffer.from("def")]);

// ---------- 1. Dépôt : droits ----------
const sansSession = await browser.newContext();
const r401 = await deposer(sansSession, { nom: "a.csv", type: "text/csv", contenu: CSV });
verifier("1. dépôt sans session : 401", r401.status() === 401, String(r401.status()));
await sansSession.close();

const commercial = await ouvrir("compta-commercial@simassurances.test");
const r403 = await deposer(commercial, { nom: "a.csv", type: "text/csv", contenu: CSV });
verifier("1. dépôt par le commercial (ni production ni relevés) : 403", r403.status() === 403, String(r403.status()));
const rDg = await deposer(await ouvrir("dg@simassurances.test"), { nom: "a.csv", type: "text/csv", contenu: CSV });
verifier("1. dépôt par le DG (superviseur) : 403", rDg.status() === 403, String(rDg.status()));
verifier("1. aucune pièce jointe créée par ces refus", (await compter("CptPieceJointe")) === 0);

// ---------- 2. Dépôt accepté, type déduit du contenu ----------
const production = await ouvrir("compta-production@simassurances.test");
const rXlsx = await deposer(production, { nom: "production-octobre.xlsx", type: "application/octet-stream", contenu: XLSX });
const jXlsx = await rXlsx.json();
verifier("2. production : un xlsx est accepté", rXlsx.status() === 200 && jXlsx.type === "xlsx", JSON.stringify(jXlsx));
verifier("2. le nom stocké est généré (UUID), jamais le nom d'origine", /^[0-9a-f-]{36}\.xlsx$/.test(jXlsx.url ?? ""), jXlsx.url);

const comptable = await ouvrir("compta-comptable@simassurances.test");
const rCsv = await deposer(comptable, { nom: "releve.csv", type: "text/csv", contenu: CSV });
const jCsv = await rCsv.json();
verifier("2. comptable (relevés) : un csv est accepté", rCsv.status() === 200 && jCsv.type === "csv", JSON.stringify(jCsv));

const rMenteur = await deposer(production, { nom: "menteur.csv", type: "text/csv", contenu: XLSX });
const jMenteur = await rMenteur.json();
verifier("2. un xlsx renommé .csv (et annoncé text/csv) reste un xlsx", rMenteur.status() === 200 && jMenteur.type === "xlsx", JSON.stringify(jMenteur));

// ---------- 5. Trace : métadonnées recalculées et audit ----------
const piece = (await db.query(`SELECT * FROM "CptPieceJointe" WHERE id = $1`, [jXlsx.pieceJointeId])).rows[0];
verifier("5. SHA-256 recalculé depuis le fichier déposé", piece?.sha256 === createHash("sha256").update(XLSX).digest("hex"));
verifier("5. taille et nom d'origine enregistrés", piece?.taille === XLSX.length && piece?.nomOrigine === "production-octobre.xlsx");
verifier("5. type MIME dérivé du contenu, pas du client", piece?.mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", piece?.mime);
const audit = (await db.query(`SELECT * FROM "CptAudit" WHERE entite = 'CptPieceJointe' AND "entiteId" = $1`, [jXlsx.pieceJointeId])).rows[0];
verifier("5. audit « depot_fichier_import » avec l'auteur et l'adresse IP", audit?.action === "depot_fichier_import" && audit?.ip === "10.9.9.9", JSON.stringify(audit));
const avantRefus = await compter("CptPieceJointe");

// ---------- 3. Refus ----------
const refus = [
  ["un PDF", { nom: "a.pdf", type: "application/pdf", contenu: PDF }],
  ["un fichier vide", { nom: "vide.csv", type: "text/csv", contenu: Buffer.alloc(0) }],
  ["un contenu binaire inconnu", { nom: "x.csv", type: "text/csv", contenu: BINAIRE }],
  ["un envoi sans le champ « file »", { nom: "a.csv", type: "text/csv", contenu: CSV, champ: "autre" }],
];
for (const [libelle, f] of refus) {
  const r = await deposer(production, f);
  verifier(`3. ${libelle} : refusé (400)`, r.status() === 400, `${r.status()} ${(await r.text()).slice(0, 80)}`);
}
const gros = Buffer.alloc(11 * 1024 * 1024, "a;");
const rGros = await deposer(production, { nom: "gros.csv", type: "text/csv", contenu: gros });
verifier("3. 11 Mo : refusé, plafond de 10 Mo annoncé", rGros.status() === 400 && /10 Mo/.test(await rGros.text()), String(rGros.status()));
// Entre le plafond et plafond + 1 Mo, la requête passe le contrôle d'annonce mais le proxy de Next la tronque à 10 Mo :
// jamais un 500, toujours un refus lisible.
const limite = Buffer.alloc(10 * 1024 * 1024 + 300 * 1024, "a;");
const rLimite = await deposer(production, { nom: "limite.csv", type: "text/csv", contenu: limite });
verifier("3. 10,3 Mo (corps tronqué par Next) : refusé proprement (400), jamais un 500", rLimite.status() === 400 && /10 Mo/.test(await rLimite.text()), String(rLimite.status()));
verifier("3. aucun refus n'a créé de pièce jointe", (await compter("CptPieceJointe")) === avantRefus);

// ---------- 4. Le plafond suit le paramètre ----------
await db.query(`UPDATE "CptParametre" SET valeur = '1' WHERE cle = 'import.limite_taille_mo'`);
try {
  const deuxMo = Buffer.alloc(2 * 1024 * 1024, "a;");
  const r = await deposer(production, { nom: "deux.csv", type: "text/csv", contenu: deuxMo });
  verifier("4. paramètre à 1 Mo : un fichier de 2 Mo est refusé, « 1 Mo » annoncé", r.status() === 400 && /\(1 Mo\)/.test(await r.text()), String(r.status()));
} finally {
  await db.query(`UPDATE "CptParametre" SET valeur = '10' WHERE cle = 'import.limite_taille_mo'`);
}
const rOk = await deposer(production, { nom: "retour.csv", type: "text/csv", contenu: CSV });
verifier("4. paramètre restauré à 10 Mo : le dépôt reprend", rOk.status() === 200, String(rOk.status()));

// ---------- 6. Export d'essai : droits et paramètres ----------
const rfcrh = await ouvrir("compta-rfcrh@simassurances.test");
const anonyme = await browser.newContext();
verifier("6. export sans session : 401", (await anonyme.request.get(`${B}/api/compta/export/essai`)).status() === 401);
await anonyme.close();
verifier("6. export par la production (pas `cpt.parametrer`) : 403", (await production.request.get(`${B}/api/compta/export/essai`)).status() === 403);
for (const q of ["format=pdf", "lignes=0", "lignes=1000001", "lignes=abc", "lignes=1.5"]) {
  const r = await rfcrh.request.get(`${B}/api/compta/export/essai?${q}`);
  verifier(`6. paramètre invalide « ${q} » : 400`, r.status() === 400, String(r.status()));
}

// ---------- 7. CSV de N lignes ----------
let t0 = Date.now();
const rc = await rfcrh.request.get(`${B}/api/compta/export/essai?format=csv&lignes=${NB_LIGNES}`, { timeout: 180000 });
const csv = (await rc.body()).toString("utf8");
const dureeCsv = (Date.now() - t0) / 1000;
verifier(`7. CSV ${NB_LIGNES} lignes en moins d'une minute`, rc.status() === 200 && dureeCsv < 60, `${dureeCsv.toFixed(1)} s, ${(csv.length / 1e6).toFixed(1)} Mo`);
verifier("7. type de contenu CSV UTF-8 et téléchargement", /text\/csv/.test(rc.headers()["content-type"]) && /essai-export-compta\.csv/.test(rc.headers()["content-disposition"]));
const lignesCsv = csv.split("\r\n");
verifier("7. BOM puis en-tête séparé par « ; »", lignesCsv[0] === "﻿Référence;Date;Client;Montant (FCFA);Rang", JSON.stringify(lignesCsv[0].slice(0, 80)));
verifier(`7. ${NB_LIGNES} lignes de données terminées par CRLF`, lignesCsv.length === NB_LIGNES + 2 && lignesCsv.at(-1) === "", `${lignesCsv.length} segments`);
verifier("7. ligne 1 : montant à virgule décimale, date ISO", lignesCsv[1] === "ESSAI-0000001;2026-01-02;Client synthétique 1;0,37;1", lignesCsv[1]);
verifier("7. ligne 10 : montant négatif écrit tel quel (jamais préfixé comme une formule)", lignesCsv[10].includes(";-3,70;"), lignesCsv[10]);
verifier("7. ligne 50 : texte « =CLIENT(50) » neutralisé par une apostrophe", lignesCsv[50].includes(";'=CLIENT(50);"), lignesCsv[50]);

// ---------- 8. Excel de N lignes ----------
t0 = Date.now();
const rx = await rfcrh.request.get(`${B}/api/compta/export/essai?format=xlsx&lignes=${NB_LIGNES}`, { timeout: 240000 });
const xlsx = await rx.body();
const dureeXlsx = (Date.now() - t0) / 1000;
verifier(`8. Excel ${NB_LIGNES} lignes en moins d'une minute`, rx.status() === 200 && dureeXlsx < 60, `${dureeXlsx.toFixed(1)} s, ${(xlsx.length / 1e6).toFixed(1)} Mo`);
verifier("8. type de contenu Excel", /spreadsheetml\.sheet/.test(rx.headers()["content-type"]));
const relu = new ExcelJS.Workbook();
await relu.xlsx.load(xlsx);
const f = relu.getWorksheet("Essai");
verifier("8. feuille « Essai » relue, en-tête + toutes les lignes", f?.rowCount === NB_LIGNES + 1, `${f?.rowCount} lignes`);
verifier("8. en-têtes", ["Référence", "Date", "Client", "Montant (FCFA)", "Rang"].every((t, i) => f.getRow(1).getCell(i + 1).value === t));
const l11 = f.getRow(11);
verifier("8. montant négatif = NOMBRE (-3,7), pas du texte", l11.getCell(4).value === -3.7, String(l11.getCell(4).value));
verifier("8. date = vraie date (UTC minuit)", l11.getCell(2).value instanceof Date && l11.getCell(2).value.toISOString() === "2026-01-11T00:00:00.000Z", String(l11.getCell(2).value));
verifier("8. entier = nombre", l11.getCell(5).value === 10, String(l11.getCell(5).value));
const l51 = f.getRow(51).getCell(3).value;
verifier("8. « =CLIENT(50) » reste du TEXTE (jamais une formule)", l51 === "=CLIENT(50)", JSON.stringify(l51));

verifier("9. aucune erreur JavaScript dans les pages visitées", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));

await browser.close();
await db.end();

console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\nGC-1f : ${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko === 0 ? 0 : 1);
