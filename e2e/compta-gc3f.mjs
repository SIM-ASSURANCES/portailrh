// Gestion Compta, lot GC-3f — ÉCRAN « PRODUCTION » (/compta/production) : dépôt et import d'un bordereau par l'écran réel.
// Sur base JETABLE et neuve (voir e2e/README.md : `next build` puis `bash e2e/base-jetable.sh`) : ce script ÉCRIT en base et ne se rejoue
// pas sur la même base. Données 100 % synthétiques. Il vérifie :
//  0. la migration a posé le format d'import PRODUCTION par défaut ;
//  1. le compte qui importe voit le formulaire ; page vide au départ ;
//  2. dépôt d'un CSV (en-têtes du format par défaut, dates JJ/MM/AAAA), puis import : bilan affiché, contrats / échéances / import en base ;
//  3. la page rechargée montre contrats, anomalies et historique ; la recherche trouve (client) ou dit « aucun contrat » ;
//  4. le même fichier ne s'importe pas deux fois (message à l'écran, rien de plus en base) ;
//  5. lecture seule (Direction) : ni formulaire, ni dépôt (route 403), mais la liste est lisible ;
//  6. mobile 390 px sans défilement horizontal de la page, aucune erreur JavaScript.
import { chromium } from "playwright";
import pg from "pg";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/i.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");

const db = new pg.Client({ connectionString: DB });
await db.connect();
const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const erreursJs = [];

const sessions = new Map();
async function contexte(email) {
  let ctx = sessions.get(email);
  if (!ctx) {
    ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
    const connexion = await ctx.newPage();
    await connexion.goto(`${B}/login`);
    await connexion.fill('input[name="email"]', email);
    await connexion.fill('input[name="password"]', "password123");
    await Promise.all([connexion.waitForURL((u) => !u.pathname.startsWith("/login")), connexion.click('button[type="submit"]')]);
    await connexion.close();
    sessions.set(email, ctx);
  }
  return ctx;
}
async function ouvrir(email, q = "") {
  const ctx = await contexte(email);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(`${email} : ${e.message}`));
  await p.goto(`${B}/compta/production${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  await p.waitForSelector("h1");
  await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  return p;
}

const PRODUCTION = "compta-production@simassurances.test";
const DIRECTION = "compta-direction@simassurances.test";

const texte = async (p) => (await p.locator("body").innerText()).replace(/\s+/g, " ");
const compter = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);

// ---------- Jeu d'essai ----------
await db.query(`INSERT INTO "CptProduit" (id, code, libelle, branche, "majAt") VALUES ('prod-e2e', 'P1', 'Produit un', 'ACCIDENTS', now())`);
await db.query(`INSERT INTO "CptPartenaire" (id, nom, "estApporteur", "majAt") VALUES ('part-e2e', 'Courtier A', true, now())`);

const ENTETES = [
  "Numéro de police", "Identifiant de paiement (PaiementID)", "Type de contrat (individuel ou groupe)", "Produit (code ou libellé)",
  "Type d'opération", "Client", "Téléphone du client", "Partenaire apporteur", "Fractionnement", "Date d'effet", "Date d'échéance",
  "Mode de paiement déclaré", "Référence de paiement déclarée", "Date de paiement déclarée", "Prime TTC", "Prime hors taxe",
  "Accessoires", "Taxe", "Commission déclarée", "Frais de gestion déclarés", "Montant payé déclaré",
];
const ligne = (v) => ENTETES.map((e) => v[e] ?? "").map((c) => `"${c}"`).join(",");
const CSV = Buffer.from(
  [
    ENTETES.map((e) => `"${e}"`).join(","),
    ligne({ "Numéro de police": "POL-E2E-1", "Produit (code ou libellé)": "P1", Client: "Awa Kone", "Téléphone du client": "0700000001", "Partenaire apporteur": "Courtier A", Fractionnement: "Mensuel", "Date d'effet": "01/01/2027", "Date d'échéance": "31/12/2027", "Prime TTC": "120000" }),
    ligne({ "Numéro de police": "POL-E2E-2", "Produit (code ou libellé)": "ZZZ", Client: "Inconnu", "Date d'effet": "01/01/2027", "Date d'échéance": "31/12/2027", "Prime TTC": "5000" }),
    ligne({ "Numéro de police": "POL-E2E-3", "Produit (code ou libellé)": "P1", Client: "Bamba Yao", "Partenaire apporteur": "Courtier Fantôme", Fractionnement: "Comptant", "Date d'effet": "01/02/2027", "Date d'échéance": "31/01/2028", "Prime TTC": "60000" }),
  ].join("\n"),
  "utf8"
);

// ---------- 0. Format par défaut posé par la migration ----------
verifier("0. un format d'import PRODUCTION par défaut existe (migration)", (await compter(`SELECT count(*)::int AS n FROM "CptFormatImport" WHERE type = 'PRODUCTION' AND "parDefaut" AND actif`)) === 1);

// ---------- 1. Le compte qui importe ----------
let p = await ouvrir(PRODUCTION);
verifier("1. titre « Production »", (await p.locator("h1").first().innerText()).trim() === "Production");
verifier("1. le formulaire d'import est visible", (await p.locator("[data-import-production-cpt]").count()) === 1);
verifier("1. aucun contrat au départ : message de liste vide", (await p.locator("[data-production-vide]").count()) === 1);

// ---------- 2. Dépôt puis import ----------
await p.locator("input[data-import-production-fichier]").setInputFiles({ name: "bordereau-e2e.csv", mimeType: "text/csv", buffer: CSV });
await p.getByText("déposé, pas encore importé").waitFor({ timeout: 15000 });
verifier("2. fichier déposé : « pas encore importé », rien écrit en base", (await compter(`SELECT count(*)::int AS n FROM "CptContrat"`)) === 0);
await p.locator("[data-import-production-lancer]").click();
await p.locator("[data-import-production-bilan]").waitFor({ timeout: 60000 });
const bilan = await p.locator("[data-import-production-bilan]").innerText();
verifier("2. bilan : 3 lignes lues", /3 ligne\(s\) lue\(s\)/.test(bilan), bilan.replace(/\s+/g, " "));
verifier("2. bilan : 2 contrats créés, 1 ligne rejetée", /2 contrat\(s\) créé\(s\)/.test(bilan) && /1 ligne\(s\) rejetée\(s\)/.test(bilan));
verifier("2. en base : 2 contrats, 13 échéances (12 + 1), 1 import", (await compter(`SELECT count(*)::int AS n FROM "CptContrat"`)) === 2 && (await compter(`SELECT count(*)::int AS n FROM "CptEcheance"`)) === 13 && (await compter(`SELECT count(*)::int AS n FROM "CptImport"`)) === 1);
verifier("2. la police rejetée n'existe pas", (await compter(`SELECT count(*)::int AS n FROM "CptContrat" WHERE "numPolice" = 'POL-E2E-2'`)) === 0);
verifier("2. l'import porte le format par défaut et son bilan", (await compter(`SELECT count(*)::int AS n FROM "CptImport" WHERE "formatId" IS NOT NULL AND bilan IS NOT NULL`)) === 1);
await p.close();

// ---------- 3. La page rechargée ----------
p = await ouvrir(PRODUCTION);
verifier("3. les deux contrats créés sont listés", (await p.locator("[data-contrat-police]").count()) === 2 && (await p.locator('[data-contrat-police="POL-E2E-1"]').count()) === 1);
const corps = await texte(p);
verifier("3. la prime TTC est affichée (120 000) et l'apporteur", /120\s?000/.test(corps) && /Courtier A/.test(corps));
verifier("3. anomalie « Produit inconnu » listée avec la police et la ligne", (await p.locator('[data-anomalie-type="PRODUIT_INCONNU"]').count()) === 1 && /POL-E2E-2/.test(await p.locator('[data-anomalie-type="PRODUIT_INCONNU"]').innerText()));
verifier("3. anomalie « Partenaire inconnu » listée (contrat créé quand même)", (await p.locator('[data-anomalie-type="PARTENAIRE_INCONNU"]').count()) === 1);
verifier("3. l'historique cite le fichier", (await p.locator("[data-production-imports]").innerText()).includes("bordereau-e2e.csv"));
await p.close();

p = await ouvrir(PRODUCTION, "kone");
verifier("3. recherche « kone » : un seul contrat (par le nom du client)", (await p.locator("[data-contrat-police]").count()) === 1 && (await p.locator('[data-contrat-police="POL-E2E-1"]').count()) === 1);
await p.close();
p = await ouvrir(PRODUCTION, "pol e2e 3");
verifier("3. recherche « pol e2e 3 » (plusieurs mots) : le contrat POL-E2E-3", (await p.locator('[data-contrat-police="POL-E2E-3"]').count()) === 1 && (await p.locator("[data-contrat-police]").count()) === 1);
await p.close();
p = await ouvrir(PRODUCTION, "zzzz");
verifier("3. recherche sans résultat : message dédié", (await p.locator("[data-production-vide]").count()) === 1 && /Aucun contrat ne correspond/.test(await texte(p)));
await p.close();

// ---------- 4. Un même fichier, une seule fois ----------
p = await ouvrir(PRODUCTION);
await p.locator("input[data-import-production-fichier]").setInputFiles({ name: "bordereau-e2e-bis.csv", mimeType: "text/csv", buffer: CSV });
await p.getByText("déposé, pas encore importé").waitFor({ timeout: 15000 });
await p.locator("[data-import-production-lancer]").click();
await p.locator("[data-import-production-erreur]").waitFor({ timeout: 30000 });
verifier("4. le même contenu est refusé avec un message clair", /déjà été importé/.test(await p.locator("[data-import-production-erreur]").innerText()));
verifier("4. rien de plus en base (2 contrats, 1 import)", (await compter(`SELECT count(*)::int AS n FROM "CptContrat"`)) === 2 && (await compter(`SELECT count(*)::int AS n FROM "CptImport"`)) === 1);
await p.close();

// ---------- 5. Lecture seule ----------
p = await ouvrir(DIRECTION);
verifier("5. Direction : aucun formulaire d'import", (await p.locator("[data-import-production-cpt]").count()) === 0);
verifier("5. Direction : la liste des contrats est lisible", (await p.locator("[data-contrat-police]").count()) === 2);
await p.close();
const ctxDirection = await contexte(DIRECTION);
const depot = await ctxDirection.request.post(`${B}/api/compta/import/upload`, { multipart: { file: { name: "x.csv", mimeType: "text/csv", buffer: CSV } } });
verifier("5. Direction : la route de dépôt répond 403", depot.status() === 403, `statut ${depot.status()}`);

// ---------- 7. Traitement des anomalies (GC-3h) ----------
p = await ouvrir(PRODUCTION);
verifier("7. deux anomalies à traiter, une case chacune", (await p.locator("[data-anomalie-case]").count()) === 2);
verifier("7. le bouton « Marquer traitées » est grisé tant que rien n'est sélectionné", await p.locator("[data-anomalies-bouton]").isDisabled());
await p.locator('[data-anomalie-type="PARTENAIRE_INCONNU"] [data-anomalie-case]').check();
verifier("7. une fois une case cochée, le bouton annonce « (1) » et se dégrise", /\(1\)/.test(await p.locator("[data-anomalies-bouton]").innerText()) && !(await p.locator("[data-anomalies-bouton]").isDisabled()));
await p.locator('[data-anomalies-traiter] input[name="commentaire"]').fill("Partenaire créé depuis");
await p.locator("[data-anomalies-bouton]").click();
await p.locator('[data-anomalie-type="PARTENAIRE_INCONNU"]').waitFor({ state: "detached", timeout: 15000 });
verifier("7. l'anomalie traitée quitte la liste, l'autre reste", (await p.locator("[data-anomalie-case]").count()) === 1 && (await p.locator('[data-anomalie-type="PRODUIT_INCONNU"]').count()) === 1);
const traitee = (await db.query(`SELECT statut, "traiteeParId", "traiteeAt", resolution FROM "CptAnomalie" WHERE type = 'PARTENAIRE_INCONNU'`)).rows[0];
verifier("7. en base : TRAITEE avec le traitant, la date et le commentaire", traitee?.statut === "TRAITEE" && !!traitee.traiteeParId && !!traitee.traiteeAt && traitee.resolution === "Partenaire créé depuis", JSON.stringify(traitee));
verifier("7. l'autre anomalie est intacte (à traiter)", (await compter(`SELECT count(*)::int AS n FROM "CptAnomalie" WHERE type = 'PRODUIT_INCONNU' AND statut = 'A_TRAITER'`)) === 1);
verifier("7. une ligne d'audit « traitement » a été écrite", (await compter(`SELECT count(*)::int AS n FROM "CptAudit" WHERE entite = 'CptAnomalie' AND action = 'traitement'`)) === 1);
verifier("7. le compteur d'anomalies de la page passe à 1", /Anomalies à traiter\s*1\b/.test(await texte(p)), (await texte(p)).slice(0, 200));
await p.close();
p = await ouvrir(DIRECTION);
verifier("7. Direction : aucune case ni bouton de traitement", (await p.locator("[data-anomalie-case]").count()) === 0 && (await p.locator("[data-anomalies-traiter]").count()) === 0);
verifier("7. Direction : l'anomalie restante est lisible", (await p.locator('[data-anomalie-type="PRODUIT_INCONNU"]').count()) === 1);
await p.close();

// ---------- 6. Mobile ----------
const ctxMobile = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
const connexion = await ctxMobile.newPage();
await connexion.goto(`${B}/login`);
await connexion.fill('input[name="email"]', PRODUCTION);
await connexion.fill('input[name="password"]', "password123");
await Promise.all([connexion.waitForURL((u) => !u.pathname.startsWith("/login")), connexion.click('button[type="submit"]')]);
await connexion.goto(`${B}/compta/production`);
await connexion.waitForSelector("h1");
await connexion.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
const debord = await connexion.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
verifier("6. mobile 390 px : aucun défilement horizontal de la page", debord <= 1, `débordement ${debord} px`);
await ctxMobile.close();

verifier("6. aucune erreur JavaScript", erreursJs.length === 0, erreursJs.join(" | "));

console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\nGC-3f (écran Production) : ${resultats.length - ko}/${resultats.length} contrôles réussis`);
await browser.close();
await db.end();
process.exit(ko === 0 ? 0 : 1);
