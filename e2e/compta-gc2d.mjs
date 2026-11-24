// Gestion Compta, lot GC-2d — RECHERCHE RAPIDE DES RÉFÉRENTIELS (/compta/referentiels?q=…).
// Sur base JETABLE et neuve (voir e2e/README.md : `next build` puis `bash e2e/base-jetable.sh`) : ce script ÉCRIT en base et ne se rejoue
// pas sur la même base. Il crée ses fiches par l'écran réel, puis vérifie :
//  1. l'index est écrit en même temps que la fiche (création) et réécrit à sa modification ;
//  2. la recherche par début de mot (accents, apostrophe, plusieurs mots, téléphone sans « + »), le filtre de l'onglet et les compteurs ;
//  3. un partenaire renommé : les mots de ses clients suivent (nom du partenaire d'origine) ;
//  4. lecture seule (Direction) : la recherche fonctionne aussi ; liens d'onglets, « Effacer », saisie sans résultat ;
//  5. mobile 390 px sans défilement horizontal, aucune erreur JavaScript.
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
async function ouvrir(email, onglet, q = "") {
  const ctx = await contexte(email);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(`${email} : ${e.message}`));
  await p.goto(`${B}/compta/referentiels?onglet=${onglet}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  await p.waitForSelector("h1");
  await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  return p;
}

const RFCRH = "compta-rfcrh@simassurances.test";
const DIRECTION = "compta-direction@simassurances.test";

const texte = async (p) => (await p.locator("body").innerText()).replace(/\s+/g, " ");
const formulaire = (p, titre) => p.locator(`form[data-formulaire-cpt="${titre}"]`);

async function remplirEtEnvoyer(p, titre, valeurs) {
  const f = formulaire(p, titre);
  await f.waitFor();
  for (const [nom, valeur] of Object.entries(valeurs)) {
    const champ = f.locator(`[name="${nom}"]`);
    const type = await champ.evaluate((el) => (el.tagName === "SELECT" ? "select" : el.getAttribute("type")));
    if (type === "select") await champ.selectOption(valeur);
    else if (type === "checkbox") await (valeur ? champ.check() : champ.uncheck());
    else await champ.fill(valeur);
  }
  await Promise.all([p.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]), f.locator('button[type="submit"]').click()]);
  await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(400);
}

const compter = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);
const motsDe = async (entite, id) => (await db.query(`SELECT mot FROM "CptMot" WHERE entite = $1 AND "entiteId" = $2`, [entite, id])).rows.map((r) => r.mot);
/** Contenu de l'onglet courant (tableau ou message de liste vide) : jamais les formulaires ni la barre d'onglets. */
const liste = async (p, ref) => (await p.locator(`[data-referentiel="${ref}"]`).innerText()).replace(/\s+/g, " ");
const compteur = async (p, onglet) => (await p.locator(`[data-compteur-onglet="${onglet}"]`).first().innerText().catch(() => "")).trim();

// ---------- 1. Création : l'index est écrit avec la fiche ----------
const pp = await ouvrir(RFCRH, "partenaires");
await remplirEtEnvoyer(pp, "Ajouter un partenaire", { nom: "Courtier Épsilon", estApporteur: true, coordonnees: "Cocody, Abidjan", tiersOdoo: "T-EPS" });
const idEps = (await db.query(`SELECT id FROM "CptPartenaire" WHERE nom = 'Courtier Épsilon'`)).rows[0].id;
const motsEps = await motsDe("PARTENAIRE", idEps);
verifier("1. partenaire créé : ses mots sont indexés (accent retiré, coordonnées, tiers Odoo)", ["courtier", "epsilon", "abidjan", "teps"].every((m) => motsEps.includes(m)) && motsEps.some((m) => m.startsWith("cocody")), JSON.stringify(motsEps));
await pp.close();

const pcl = await ouvrir(RFCRH, "clients");
await remplirEtEnvoyer(pcl, "Ajouter un client", { nom: "Aïssatou N'Diaye", telephone: "+225 05 12 34 56 78", pieceIdentite: "CNI-778899", partenaireOrigineId: idEps });
const idClient = (await db.query(`SELECT id FROM "CptClient" WHERE nom = 'Aïssatou N''Diaye'`)).rows[0].id;
const motsClient = await motsDe("CLIENT", idClient);
verifier("1. client créé : nom, téléphone sans « + », pièce et partenaire d'origine indexés", ["aissatou", "ndiaye", "diaye", "2250512345678", "cni778899", "778899", "courtier", "epsilon"].every((m) => motsClient.includes(m)), JSON.stringify(motsClient));
await remplirEtEnvoyer(pcl, "Ajouter un client", { nom: "Yao Brou", telephone: "", pieceIdentite: "", partenaireOrigineId: "" });
await pcl.close();

const ppr = await ouvrir(RFCRH, "produits");
await remplirEtEnvoyer(ppr, "Ajouter un produit", { code: "rc-auto", libelle: "Responsabilité civile", branche: "ACCIDENTS", tarifReference: "", compteOdoo: "411200" });
const idProduit = (await db.query(`SELECT id FROM "CptProduit" WHERE code = 'RC-AUTO'`)).rows[0].id;
const motsProduit = await motsDe("PRODUIT", idProduit);
verifier("1. produit créé : code, libellé, branche et compte Odoo indexés", ["rcauto", "rc", "auto", "responsabilite", "civile", "accidents", "411200"].every((m) => motsProduit.includes(m)), JSON.stringify(motsProduit));
await ppr.close();
verifier("1. les trois types de fiches ont leurs mots dans l'index", (await compter(`SELECT count(DISTINCT entite)::int AS n FROM "CptMot"`)) === 3);

// ---------- 2. Recherche sur l'écran ----------
let p = await ouvrir(RFCRH, "clients", "ndiaye");
verifier("2. « ndiaye » (apostrophe ignorée) trouve le client dans l'onglet Clients", (await liste(p, "clients")).includes("Aïssatou N'Diaye") && !(await liste(p, "clients")).includes("Yao Brou"));
verifier("2. le compteur de l'onglet Clients vaut 1, Partenaires 0, Produits 0", (await compteur(p, "clients")) === "(1)" && (await compteur(p, "partenaires")) === "(0)" && (await compteur(p, "produits")) === "(0)", `${await compteur(p, "clients")}/${await compteur(p, "partenaires")}/${await compteur(p, "produits")}`);
verifier("2. le champ de recherche garde la saisie", (await p.locator('input[name="q"]').inputValue()) === "ndiaye");
await p.close();

p = await ouvrir(RFCRH, "clients", "aissatou diaye");
verifier("2. plusieurs mots (ET) : « aissatou diaye »", (await liste(p, "clients")).includes("Aïssatou N'Diaye"));
await p.close();

p = await ouvrir(RFCRH, "clients", "22505");
verifier("2. le téléphone se retrouve sans le « + » (« 22505 »)", (await liste(p, "clients")).includes("Aïssatou N'Diaye"));
await p.close();

p = await ouvrir(RFCRH, "clients", "uessan");
verifier("2. un fragment au milieu d'un mot ne trouve rien", !(await liste(p, "clients")).includes("Aïssatou") && (await liste(p, "clients")).includes("Aucun client enregistré"));
await p.close();

p = await ouvrir(RFCRH, "partenaires", "epsilon");
verifier("2. « epsilon » : le partenaire est dans l'onglet Partenaires", (await liste(p, "partenaires")).includes("Courtier Épsilon"));
verifier("2. « epsilon » : compteurs Partenaires 1 et Clients 1 (nom du partenaire d'origine)", (await compteur(p, "partenaires")) === "(1)" && (await compteur(p, "clients")) === "(1)", `${await compteur(p, "partenaires")}/${await compteur(p, "clients")}`);
const hrefClients = await p.locator('[data-onglet-compta="clients"]').getAttribute("href");
verifier("2. les liens d'onglets conservent la recherche", /q=epsilon/.test(hrefClients ?? ""), hrefClients ?? "");
await p.locator('[data-onglet-compta="clients"]').click();
await p.waitForURL((u) => u.searchParams.get("onglet") === "clients");
await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
verifier("2. cliquer l'onglet Clients applique la même recherche", (await liste(p, "clients")).includes("Aïssatou N'Diaye") && !(await liste(p, "clients")).includes("Yao Brou"));
await p.locator("[data-recherche-effacer]").click();
await p.waitForURL((u) => u.searchParams.get("q") === null);
await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
verifier("2. « Effacer » rétablit la liste complète", (await liste(p, "clients")).includes("Yao Brou") && (await liste(p, "clients")).includes("Aïssatou N'Diaye"));
await p.close();

p = await ouvrir(RFCRH, "produits", "responsabilite auto");
verifier("2. produit : « responsabilite auto » (accent ignoré, deux mots)", (await liste(p, "produits")).includes("RC-AUTO"));
await p.close();

// Saisie dans le champ, bouton « Rechercher »
p = await ouvrir(RFCRH, "partenaires");
await p.locator('input[name="q"]').fill("courtier");
await Promise.all([p.waitForURL((u) => u.searchParams.get("q") === "courtier"), p.getByRole("button", { name: "Rechercher" }).click()]);
await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
verifier("2. le bouton « Rechercher » lance la recherche et garde l'onglet", new URL(p.url()).searchParams.get("onglet") === "partenaires" && (await liste(p, "partenaires")).includes("Courtier Épsilon"));
await p.close();

// ---------- 3. Modification : l'index suit ----------
// Un partenaire renommé : ses clients sont réindexés avec le nouveau nom.
p = await ouvrir(RFCRH, "partenaires");
await p.locator('[data-referentiel="partenaires"] button[data-action="modifier"]:visible').first().click();
await remplirEtEnvoyer(p, "Modifier le partenaire", { nom: "Courtier Omega" });
await p.close();
const motsClientApres = await motsDe("CLIENT", idClient);
verifier("3. partenaire renommé : le client est réindexé (« omega » présent, « epsilon » absent)", motsClientApres.includes("omega") && !motsClientApres.includes("epsilon"), JSON.stringify(motsClientApres));
p = await ouvrir(RFCRH, "clients", "omega");
verifier("3. « omega » trouve le client par le nouveau nom de son partenaire", (await liste(p, "clients")).includes("Aïssatou N'Diaye"));
await p.close();
p = await ouvrir(RFCRH, "clients", "epsilon");
verifier("3. « epsilon » ne trouve plus rien", !(await liste(p, "clients")).includes("Aïssatou"));
await p.close();

// Un client modifié : ancien téléphone retiré, nouveau trouvé.
p = await ouvrir(RFCRH, "clients");
await p.locator('[data-referentiel="clients"] tr', { hasText: "Aïssatou" }).locator('button[data-action="modifier"]:visible').first().click();
await remplirEtEnvoyer(p, "Modifier le client", { telephone: "+225 07 99 88 77 66" });
await p.close();
const motsClient2 = await motsDe("CLIENT", idClient);
verifier("3. client modifié : nouveau téléphone indexé, ancien retiré", motsClient2.includes("2250799887766") && !motsClient2.includes("2250512345678"), JSON.stringify(motsClient2));
p = await ouvrir(RFCRH, "clients", "22507998");
verifier("3. le nouveau numéro se retrouve à l'écran", (await liste(p, "clients")).includes("Aïssatou N'Diaye"));
await p.close();

// Un produit modifié : nouveau libellé indexé.
p = await ouvrir(RFCRH, "produits");
await p.locator('[data-referentiel="produits"] button[data-action="modifier"]:visible').first().click();
await remplirEtEnvoyer(p, "Modifier le produit", { libelle: "Assistance routière" });
await p.close();
const motsProduit2 = await motsDe("PRODUIT", idProduit);
verifier("3. produit modifié : « assistance » et « routiere » indexés, « responsabilite » retiré", motsProduit2.includes("assistance") && motsProduit2.includes("routiere") && !motsProduit2.includes("responsabilite"), JSON.stringify(motsProduit2));

// ---------- 4. Lecture seule ----------
p = await ouvrir(DIRECTION, "clients", "diaye");
verifier("4. Direction (lecture seule) : la recherche fonctionne", (await liste(p, "clients")).includes("Aïssatou N'Diaye") && (await p.locator("form[data-formulaire-cpt]").count()) === 0);
await p.close();
p = await ouvrir(DIRECTION, "partenaires", "zzzzzz");
verifier("4. saisie sans résultat : liste vide et compteurs à 0", (await compteur(p, "partenaires")) === "(0)" && (await liste(p, "partenaires")).includes("Aucun partenaire"));
await p.close();
p = await ouvrir(DIRECTION, "taux", "courtier");
verifier("4. les onglets sans index (taux, comptes, conventions) ignorent la recherche sans erreur", (await p.locator("h1").first().innerText()).trim() === "Référentiels" && (await p.locator('[data-onglet-compta="taux"]').count()) === 1);
await p.close();

// Saisies hostiles : jamais d'erreur serveur, jamais « tout »
for (const saisie of ["%", "_", "'", "\\", "a".repeat(300), "<script>alert(1)</script>"]) {
  const pc = await ouvrir(RFCRH, "clients", saisie);
  const titre = (await pc.locator("h1").first().innerText()).trim();
  verifier(`4. saisie hostile « ${saisie.slice(0, 20)} » : page normale, rien de trouvé`, titre === "Référentiels" && !(await liste(pc, "clients")).includes("Yao Brou"));
  await pc.close();
}

// ---------- 5. Mobile, erreurs JavaScript ----------
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
const pm = await mobile.newPage();
await pm.goto(`${B}/login`);
await pm.fill('input[name="email"]', RFCRH);
await pm.fill('input[name="password"]', "password123");
await Promise.all([pm.waitForURL((u) => !u.pathname.startsWith("/login")), pm.click('button[type="submit"]')]);
for (const o of ["clients", "partenaires"]) {
  await pm.goto(`${B}/compta/referentiels?onglet=${o}&q=diaye`);
  await pm.waitForSelector("h1");
  await pm.waitForLoadState("networkidle");
  const larg = await pm.evaluate(() => ({ doc: document.documentElement.scrollWidth, vue: window.innerWidth }));
  verifier(`5. mobile 390 px : ${o} avec recherche sans défilement horizontal`, larg.doc <= larg.vue, JSON.stringify(larg));
}
await mobile.close();
verifier("5. aucune erreur JavaScript dans les pages visitées", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));

for (const ctx of sessions.values()) await ctx.close();
await browser.close();
await db.end();

console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\nGC-2d : ${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko === 0 ? 0 : 1);
