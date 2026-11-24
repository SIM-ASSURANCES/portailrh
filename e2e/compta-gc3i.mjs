// Gestion Compta, lot GC-3i — ÉCRAN « PARAMÈTRES » (/compta/parametres) : formats d'import créés à partir d'un fichier d'exemple.
// Sur base JETABLE et neuve (voir e2e/README.md : `next build` puis `bash e2e/base-jetable.sh`) : ce script ÉCRIT en base et ne se rejoue
// pas sur la même base. Données 100 % synthétiques. Il vérifie :
//  1. le format par défaut posé par la migration est listé ; lecture seule (Direction) : pas de formulaire ni de boutons ;
//  2. dépôt d'un fichier d'exemple aux en-têtes d'un autre éditeur : colonnes suggérées (accents, synonymes), ordre des dates ambigu non deviné ;
//  3. l'enregistrement est bloqué tant que l'ordre d'une date ou un champ obligatoire manque ; puis le format est créé (audit) ;
//  4. un format créé sert vraiment : import d'un bordereau à CES en-têtes par l'écran Production, une fois désigné par défaut ;
//  5. définir par défaut / désactiver : le format par défaut ne se désactive pas ; un seul format par défaut ;
//  6. refus : route de dépôt refusée à la Direction ; formulaire absent sans `cpt.parametrer` ; mobile 390 px ; aucune erreur JS.
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
async function ouvrir(email, chemin = "/compta/parametres") {
  const ctx = await contexte(email);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(`${email} : ${e.message}`));
  await p.goto(`${B}${chemin}`);
  await p.waitForSelector("h1");
  await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  return p;
}

const RFCRH = "compta-rfcrh@simassurances.test";
const PRODUCTION = "compta-production@simassurances.test";
const DIRECTION = "compta-direction@simassurances.test";
const compter = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);

// Fichier d'exemple d'un autre éditeur : titre sur la 1re ligne, en-têtes sur la 2e, dates JJ/MM/AAAA AMBIGUËS (jour <= 12), colonne en trop.
const ENTETES = ["N° Police", "Désignation du produit", "Nom du client", "Apporteur", "Date d'effet", "Date d'échéance", "Prime TTC", "Observations"];
const csv = (lignes) => Buffer.from(lignes.map((l) => l.map((c) => `"${c}"`).join(",")).join("\n"), "utf8");
const LIGNES = [
  ["Bordereau de production — octobre", "", "", "", "", "", "", ""],
  ENTETES,
  ["EXT-1", "P1", "Awa Kone", "Courtier A", "03/04/2027", "02/04/2028", "120000", "RAS"],
  ["EXT-2", "P1", "Yao Brou", "Courtier A", "05/06/2027", "04/06/2028", "60000", ""],
];
const EXEMPLE = csv(LIGNES);

await db.query(`INSERT INTO "CptProduit" (id, code, libelle, branche, "majAt") VALUES ('prod-e2e', 'P1', 'Produit un', 'ACCIDENTS', now())`);
await db.query(`INSERT INTO "CptPartenaire" (id, nom, "estApporteur", "majAt") VALUES ('part-e2e', 'Courtier A', true, now())`);

// ---------- 1. Liste et lecture seule ----------
let p = await ouvrir(RFCRH);
verifier("1. titre « Paramètres »", (await p.locator("h1").first().innerText()).trim() === "Paramètres");
const liste = await p.locator("[data-formats-import]").innerText();
verifier("1. le format par défaut de la migration est listé, « Par défaut » et « Actif »", /Bordereau de production standard/.test(liste) && /Par défaut/.test(liste) && /Actif/.test(liste));
verifier("1. le formulaire de création est visible pour qui paramètre", (await p.locator("[data-nouveau-format-production]").count()) === 1);
await p.close();
p = await ouvrir(DIRECTION);
verifier("1. Direction : formats lisibles, ni formulaire ni boutons", (await p.locator("[data-formats-import]").count()) === 1 && (await p.locator("[data-nouveau-format-production]").count()) === 0 && (await p.locator("[data-format-defaut], [data-format-bascule]").count()) === 0);
await p.close();

// ---------- 2. Fichier d'exemple : suggestions ----------
p = await ouvrir(RFCRH);
await p.locator('input[name="ligneEntete"]').fill("2");
await p.locator("input[data-format-fichier]").setInputFiles({ name: "exemple.csv", mimeType: "text/csv", buffer: EXEMPLE });
await p.locator("[data-format-colonnes]").waitFor({ timeout: 20000 });
const selecteur = (entete, n = 0) => p.locator(`[data-format-colonne="${entete}"] select`).nth(n);
verifier("2. « N° Police » → numPolice (ponctuation)", (await selecteur("N° Police").inputValue()) === "numPolice");
verifier("2. « Désignation du produit » : aucune suggestion hasardeuse", (await selecteur("Désignation du produit").inputValue()) === "");
verifier("2. « Apporteur » → partenaire (synonyme)", (await selecteur("Apporteur").inputValue()) === "partenaire");
verifier("2. « Date d'échéance » → dateEcheance (accent)", (await selecteur("Date d'échéance").inputValue()) === "dateEcheance");
verifier("2. « Observations » ignorée", (await selecteur("Observations").inputValue()) === "");
verifier("2. les dates 03/04/2027 sont ambiguës : l'ordre n'est PAS deviné", (await selecteur("Date d'effet", 1).inputValue()) === "");
verifier("2. le bouton Enregistrer est grisé (produit, ordre des dates, nom manquants)", await p.locator("[data-format-enregistrer]").isDisabled());
const controles = (await p.locator("[data-format-controles]").innerText()).replace(/\s+/g, " ");
verifier("2. les contrôles disent ce qui manque", /Champs obligatoires sans colonne/.test(controles) && /ordre de la date/.test(controles), controles);

// ---------- 3. Compléter puis enregistrer ----------
await selecteur("Désignation du produit").selectOption("produit");
await selecteur("Date d'effet", 1).selectOption("JJ/MM/AAAA");
await selecteur("Date d'échéance", 1).selectOption("JJ/MM/AAAA");
await p.locator('input[name="nomFormat"]').fill("Bordereau Courtier A");
verifier("3. tout est renseigné : « Associations complètes » et bouton dégrisé", /Associations complètes/.test(await p.locator("[data-format-controles]").innerText()) && !(await p.locator("[data-format-enregistrer]").isDisabled()));
await p.locator("[data-format-enregistrer]").click();
await p.locator('[data-format-nom="Bordereau Courtier A"]').waitFor({ timeout: 20000 });
const cree = (await db.query(`SELECT id, "ligneEntete", "parDefaut", actif, colonnes FROM "CptFormatImport" WHERE nom = 'Bordereau Courtier A'`)).rows[0];
verifier("3. en base : ligne d'en-têtes 2, actif, PAS par défaut (le standard l'est déjà)", cree?.ligneEntete === 2 && cree.actif === true && cree.parDefaut === false, JSON.stringify(cree && { l: cree.ligneEntete, d: cree.parDefaut }));
const cols = cree?.colonnes ?? [];
verifier("3. 7 colonnes (« Observations » ignorée), types et obligatoire tirés du bordereau", cols.length === 7 && cols.find((c) => c.champ === "primeTtc")?.type === "montant" && cols.find((c) => c.champ === "numPolice")?.obligatoire === true && cols.find((c) => c.champ === "dateEffet")?.formatDate === "JJ/MM/AAAA", JSON.stringify(cols.map((c) => c.champ)));
verifier("3. audit « creation_format » écrit", (await compter(`SELECT count(*)::int AS n FROM "CptAudit" WHERE entite = 'CptFormatImport' AND action = 'creation_format'`)) === 1);
await p.close();

// ---------- 5. Par défaut, désactivation (avant l'import de l'étape 4) ----------
p = await ouvrir(RFCRH);
const ligneNouveau = p.locator('[data-format-nom="Bordereau Courtier A"]');
await ligneNouveau.locator("[data-format-defaut]").click();
await p.locator('[data-format-nom="Bordereau Courtier A"]').getByText("Par défaut", { exact: true }).waitFor({ timeout: 15000 });
verifier("5. « Définir par défaut » : le nouveau format l'est, l'ancien ne l'est plus (un seul)", (await compter(`SELECT count(*)::int AS n FROM "CptFormatImport" WHERE type = 'PRODUCTION' AND "parDefaut"`)) === 1 && (await compter(`SELECT count(*)::int AS n FROM "CptFormatImport" WHERE nom = 'Bordereau Courtier A' AND "parDefaut"`)) === 1);
verifier("5. audit « format_par_defaut » écrit", (await compter(`SELECT count(*)::int AS n FROM "CptAudit" WHERE action = 'format_par_defaut'`)) === 1);
await ligneNouveau.locator("[data-format-bascule]").click();
await p.waitForTimeout(1000);
verifier("5. le format par défaut ne se désactive pas (reste actif)", (await compter(`SELECT count(*)::int AS n FROM "CptFormatImport" WHERE nom = 'Bordereau Courtier A' AND actif`)) === 1);
await p.locator('[data-format-nom="Bordereau de production standard"] [data-format-bascule]').click();
await p.locator('[data-format-nom="Bordereau de production standard"]').getByText("Inactif").waitFor({ timeout: 15000 });
verifier("5. un format qui n'est pas par défaut se désactive (audit écrit)", (await compter(`SELECT count(*)::int AS n FROM "CptFormatImport" WHERE nom = 'Bordereau de production standard' AND NOT actif`)) === 1 && (await compter(`SELECT count(*)::int AS n FROM "CptAudit" WHERE action = 'desactivation_format'`)) === 1);
await p.close();

// ---------- 4. Le format sert à importer ----------
const pageProduction = await ouvrir(PRODUCTION, "/compta/production");
await pageProduction.locator("input[data-import-production-fichier]").setInputFiles({ name: "ext.csv", mimeType: "text/csv", buffer: EXEMPLE });
await pageProduction.getByText("déposé, pas encore importé").waitFor({ timeout: 15000 });
await pageProduction.locator("[data-import-production-lancer]").click();
await pageProduction.locator("[data-import-production-bilan]").waitFor({ timeout: 60000 });
const contrats = (await db.query(`SELECT "numPolice", "dateEffet"::text AS d, "primeTtc"::text AS p FROM "CptContrat" ORDER BY "numPolice"`)).rows;
verifier("4. l'import avec le format créé : 2 contrats lus, dates JJ/MM/AAAA et primes exactes", contrats.length === 2 && contrats[0].numPolice === "EXT-1" && contrats[0].d === "2027-04-03" && contrats[1].d === "2027-06-05" && /^120000/.test(contrats[0].p), JSON.stringify(contrats));
await pageProduction.close();

// ---------- 6. Refus, mobile ----------
const depot = await (await contexte(DIRECTION)).request.post(`${B}/api/compta/import/upload`, { multipart: { file: { name: "x.csv", mimeType: "text/csv", buffer: EXEMPLE } } });
verifier("6. Direction : la route de dépôt répond 403", depot.status() === 403, `statut ${depot.status()}`);
const depotRfcrh = await (await contexte(RFCRH)).request.post(`${B}/api/compta/import/upload`, { multipart: { file: { name: "y.csv", mimeType: "text/csv", buffer: Buffer.from(EXEMPLE.toString("utf8") + "\n", "utf8") } } });
verifier("6. RFCRH (cpt.parametrer) : le dépôt d'un fichier d'exemple est accepté", depotRfcrh.status() === 200, `statut ${depotRfcrh.status()}`);

const ctxMobile = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
const connexion = await ctxMobile.newPage();
await connexion.goto(`${B}/login`);
await connexion.fill('input[name="email"]', RFCRH);
await connexion.fill('input[name="password"]', "password123");
await Promise.all([connexion.waitForURL((u) => !u.pathname.startsWith("/login")), connexion.click('button[type="submit"]')]);
await connexion.goto(`${B}/compta/parametres`);
await connexion.waitForSelector("h1");
await connexion.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
const debord = await connexion.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
verifier("6. mobile 390 px : aucun défilement horizontal de la page", debord <= 1, `débordement ${debord} px`);
await ctxMobile.close();
verifier("6. aucune erreur JavaScript", erreursJs.length === 0, erreursJs.join(" | "));

console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\nGC-3i (écran Paramètres) : ${resultats.length - ko}/${resultats.length} contrôles réussis`);
await browser.close();
await db.end();
process.exit(ko === 0 ? 0 : 1);
