// Lots J ter et J quater (budget global = solde de caisse, soumission en lot, page Catégories fusionnée dans Budgets, page Budgets
// en DEUX sections séparées : « Budget de caisse » et « Budgets par catégorie », avec leurs propres actions) — sur base JETABLE
// (voir e2e/README.md). Nécessite exceljs.
//   1. Migration : les paramétrages GLOBAUX du lot J sont convertis (montant ignoré, seuil en montant conservé, pourcentage →
//      seuil par défaut, sans seuil → sans seuil) ; rejouée sans effet ; la nouvelle contrainte refuse un global avec montant.
//   2. Page « Budgets » fusionnée : onglet Catégories (règle de catégorisation, création de catégorie et d'objet, suppression,
//      désactivation/réactivation : Admin et Finance depuis le lot J bis), ancienne adresse qui redirige, entrée de menu « Catégories » retirée, accès par permission.
//   3. Soumission (une action PAR section) : le budget global ne prend AUCUN montant (le solde de caisse réel fait foi), seuils en montant uniquement ;
//      soumission en lot (global + catégories) tout ou rien, une seule notification pour le DG, une trace par élément.
//   4. Décision du DG par section, seul ou en lot (valider / refuser, motif commun ou propre à l'élément), jamais sa propre soumission, une seule
//      notification par lot pour la Finance, la Finance ne décide pas.
//   5. Validation d'articles : reste global = solde de caisse − engagé − validation en cours, orange (alerte + notifications),
//      rouge (blocage, confirmation du DG avec motif), solde prévisionnel négatif, règlements Caisse / Banque dans le prévisionnel,
//      DG qui confirme dans le même geste.
//   6. Parcours de l'article, reporting (page + Excel), rien montré au demandeur, journal de caisse jamais modifié.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
process.on("uncaughtException", (e) => {
  console.log(resultats.join("\n"));
  console.log("\nINTERROMPU :", e.message.split("\n").slice(0, 4).join(" | "));
  process.exit(2);
});
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
const fr = (n) => net(Number(n).toLocaleString("fr-FR"));
const dossier = mkdtempSync(join(tmpdir(), "lotjter-"));

const P = "e2e-jt-";
const CATA = `${P}cata`; // budget de 1 000 000 (20 % / 10 %)
const CATB = `${P}catb`; // budget refusé par le DG (lot)
const CATC = `${P}catc`; // budget refusé puis validé
const CATD = `${P}catd`; // budget soumis par le DG lui-même (jamais décidé par lui)
const CATS = [CATA, CATB, CATC, CATD];
const nettoyer = async () => {
  await q(`DELETE FROM "Notification" WHERE message LIKE '%DEM-LOTJT-%' OR titre LIKE '%budget%' OR titre LIKE '%Budget%' OR titre LIKE 'Seuils de caisse%'`);
  await q(`DELETE FROM "HistoriqueEntry" WHERE entity = 'BudgetParametrage' OR "entityId" LIKE '${P}%' OR detail LIKE '%DEM-LOTJT-%'`);
  await q(`DELETE FROM "BudgetDepassement" WHERE "demandeId" LIKE '${P}%'`);
  await q(`DELETE FROM "BudgetParametrage" WHERE portee = 'GLOBAL' OR "categorieId" = ANY($1)`, [CATS]);
  await q(`DELETE FROM "JournalCaisse" WHERE source = 'e2e_jter'`);
  await q(`DELETE FROM "Reglement" WHERE "demandeId" LIKE '${P}%'`);
  await q(`DELETE FROM "LigneDemande" WHERE "demandeId" LIKE '${P}%'`);
  await q(`DELETE FROM "Demande" WHERE id LIKE '${P}%'`);
  await q(`DELETE FROM "Objet" WHERE "categorieId" = ANY($1) OR label LIKE 'E2E-JT-%'`, [CATS]);
  await q(`DELETE FROM "Categorie" WHERE id = ANY($1) OR label LIKE 'E2E-JT-%'`, [CATS]);
};
await nettoyer();

const uid = async (email) => (await q(`SELECT id FROM "User" WHERE email = $1`, [email]))[0].id;
const idCollab = await uid("collaborateur@simassurances.test");
const idFinance = await uid("finance@simassurances.test");
const idDG = await uid("dg@simassurances.test");

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
const jourIso = (decalage) => new Date(Date.now() + decalage * 86400000).toISOString().slice(0, 10);
const journalEmpreinte = async () => (await q(`SELECT COALESCE(md5(string_agg(id || ':' || type || ':' || montant::text, ',' ORDER BY id)), '') AS h, count(*)::int AS n FROM "JournalCaisse" WHERE source <> 'e2e_jter'`))[0];

async function idAction(page, nom) {
  const ressources = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name).filter((u) => u.includes("/_next/static/") && u.endsWith(".js")));
  for (const url of ressources) {
    const texte = await (await fetch(url)).text();
    const m = new RegExp(`createServerReference\\)?\\(\\s*"([0-9a-f]{20,})"[^)]*?"${nom}"`).exec(texte);
    if (m) return m[1];
  }
  return null;
}
async function appelerAction(page, id, args) {
  const r = await page.context().request.post(page.url(), {
    headers: { "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" },
    data: JSON.stringify(args),
  });
  const texte = await r.text();
  return { succes: /"status":"success"/.test(texte), message: /"message":"((?:[^"\\]|\\.)*)"/.exec(texte)?.[1] ?? texte.slice(0, 300) };
}

/** Calcul INDÉPENDANT (SQL) du solde de caisse et de l'engagé non sorti de la caisse, pour recouper ce que la page affiche. */
async function caisseAttendue() {
  const solde = Number((await q(`SELECT COALESCE(SUM(CASE WHEN type='ENTREE' THEN montant ELSE -montant END),0)::float AS s FROM "JournalCaisse"`))[0].s);
  const connu = Number((await q(`SELECT COALESCE(SUM(montant),0)::float AS s FROM "Reglement" WHERE mode='CAISSE' AND NOT "estConfirme" AND NOT "estAnnule"`))[0].s);
  const valides = await q(`
    SELECT d.id, COALESCE(SUM(l.quantite * l."prixUnitaire"), 0)::float AS valide
    FROM "Demande" d JOIN "LigneDemande" l ON l."demandeId" = d.id
    WHERE d.statut NOT IN ('REJETEE','CLOTUREE','ABANDONNEE')
      AND (l."statutValidation" = 'VALIDEE' OR (l."statutValidation" = 'EN_ATTENTE' AND l."decisionDG" = 'VALIDEE'))
    GROUP BY d.id`);
  // Dépenses directes (sans article) : leur montant validé compte comme « validé » tant qu'elles sont ouvertes.
  const directes = await q(`SELECT id, "montantValide"::float AS valide FROM "Demande" WHERE "typeDemande" = 'DEPENSE_DIRECTE' AND statut NOT IN ('REJETEE','CLOTUREE','ABANDONNEE') AND "montantValide" > 0`);
  valides.push(...directes);
  let inconnu = 0;
  for (const v of valides) {
    const regle = Number((await q(`SELECT COALESCE(SUM(montant),0)::float AS s FROM "Reglement" WHERE "demandeId" = $1 AND NOT "estAnnule"`, [v.id]))[0].s);
    inconnu += Math.max(0, v.valide - regle);
  }
  return { solde, connu, inconnu, reste: solde - connu - inconnu };
}

await q(`INSERT INTO "Categorie"(id, label, "isActive") VALUES ($1,'E2E-JT-CATA',true),($2,'E2E-JT-CATB',true),($3,'E2E-JT-CATC',true),($4,'E2E-JT-CATD',true)`, CATS);
const caisse0 = await journalEmpreinte();
// Une alimentation de caisse de test (retirée en fin de script) pour que le solde soit confortable et connu.
await q(`INSERT INTO "JournalCaisse"(id, type, montant, source, "refId", "userId") VALUES ('${P}alim','ENTREE',10000000,'e2e_jter','e2e-jter',$1)`, [idFinance]);

// ======================================================================================================================
// 1. MIGRATION DES PARAMÉTRAGES GLOBAUX DU LOT J
// ======================================================================================================================
{
  const sql = readFileSync(new URL("../backend/prisma/migrations/20261024090000_budget_global_solde_caisse/migration.sql", import.meta.url), "utf8");
  // On refait l'état d'avant la migration pour les lignes globales (contrainte retirée), puis on rejoue la migration.
  await q(`ALTER TABLE "BudgetParametrage" DROP CONSTRAINT "BudgetParametrage_coherence_v2_check"`);
  await q(`INSERT INTO "BudgetParametrage"(id, portee, montant, "dateDebut", "modeSeuil", "seuilOrange", "seuilRouge", statut) VALUES
    ('${P}g-montant','GLOBAL',50000000,'2026-11-01','MONTANT',3000000,1000000,'VALIDE'),
    ('${P}g-pct','GLOBAL',50000000,'2026-11-01','POURCENTAGE',20,10,'VALIDE'),
    ('${P}g-sans','GLOBAL',1000,'2026-11-01',NULL,NULL,NULL,'VALIDE')`);
  await db.query(sql);
  const lignes = Object.fromEntries((await q(`SELECT id, montant, "modeSeuil", "seuilOrange"::float AS o, "seuilRouge"::float AS r FROM "BudgetParametrage" WHERE id LIKE '${P}g-%'`)).map((r) => [r.id, r]));
  verifier("1. le montant saisi des budgets globaux est ignoré (NULL)", Object.values(lignes).every((l) => l.montant === null), JSON.stringify(lignes));
  verifier("1. seuil en MONTANT conservé tel quel (3 000 000 / 1 000 000)", lignes[`${P}g-montant`].modeSeuil === "MONTANT" && lignes[`${P}g-montant`].o === 3000000 && lignes[`${P}g-montant`].r === 1000000);
  verifier("1. seuil en POURCENTAGE remplacé par le seuil par défaut documenté (montant, 100 000 / 0)", lignes[`${P}g-pct`].modeSeuil === "MONTANT" && lignes[`${P}g-pct`].o === 100000 && lignes[`${P}g-pct`].r === 0);
  verifier("1. paramétrage sans seuil : reste sans seuil (aucune alerte globale)", lignes[`${P}g-sans`].modeSeuil === null && lignes[`${P}g-sans`].o === null);
  await db.query(sql);
  const apres = (await q(`SELECT id, montant, "modeSeuil", "seuilOrange"::float AS o, "seuilRouge"::float AS r FROM "BudgetParametrage" WHERE id LIKE '${P}g-%' ORDER BY id`));
  verifier("1. migration rejouée : aucun changement", JSON.stringify(apres) === JSON.stringify(Object.values(lignes).sort((a, b) => a.id.localeCompare(b.id))));
  const refusMontant = await q(`INSERT INTO "BudgetParametrage"(id, portee, montant, "dateDebut") VALUES ('${P}x','GLOBAL',5,'2026-11-01')`).then(() => false, () => true);
  const refusPct = await q(`INSERT INTO "BudgetParametrage"(id, portee, "dateDebut", "modeSeuil", "seuilOrange", "seuilRouge") VALUES ('${P}y','GLOBAL','2026-11-01','POURCENTAGE',20,10)`).then(() => false, () => true);
  verifier("1. contrainte en base : un budget global avec montant, ou avec seuil en pourcentage, est refusé", refusMontant && refusPct);
  await q(`DELETE FROM "BudgetParametrage" WHERE portee = 'GLOBAL'`);
}

// ======================================================================================================================
// 2. PAGE « BUDGETS » FUSIONNÉE AVEC LES CATÉGORIES
// ======================================================================================================================
const finance = await connecter("finance@simassurances.test");
const dg = await connecter("dg@simassurances.test");
{
  await finance.goto(`${B}/treso/finance/categories`);
  const url = new URL(finance.url());
  verifier("2. l'ancienne adresse /treso/finance/categories redirige vers l'onglet « Catégories » de Budgets", url.pathname === "/treso/finance/budgets" && url.searchParams.get("onglet") === "categories", finance.url());
  verifier("2. onglets « Budgets » et « Catégories » présents", (await finance.locator('[data-onglet="budgets"]').count()) === 1 && (await finance.locator('[data-onglet="categories"]').count()) === 1);
  verifier("2. onglet Catégories : règle « catégorisation obligatoire à partir d'une date » (lot I) conservée", (await finance.locator("[data-regle-categorisation]").count()) === 1 && (await finance.locator('input[name="dateCategorisation"]').count()) === 1);
  verifier("2. … création de catégorie, liste, suppression disponibles", (await finance.getByRole("button", { name: "Créer la catégorie" }).count()) === 1 && (await finance.getByRole("button", { name: "Supprimer" }).count()) >= 1);
  // Lot J bis : la Finance (`treso.gerer_categories`) désactive / réactive elle aussi (avant : réservé à l'Admin).
  verifier("2. … désactivation proposée à la Finance (lot J bis ; réactivation une fois désactivée)", (await finance.getByRole("button", { name: "Désactiver" }).count()) >= 1 && (await finance.getByRole("button", { name: "Activer", exact: true }).count()) === 0);

  // Création d'une catégorie puis d'un objet, et suppression : tout par l'écran fusionné.
  await finance.locator('[data-onglet-categories] input[name="label"]').first().fill("E2E-JT-NOUVELLE");
  await finance.getByRole("button", { name: "Créer la catégorie" }).click();
  verifier("2. création d'une catégorie depuis l'onglet", await attendre(async () => (await q(`SELECT 1 FROM "Categorie" WHERE label = 'E2E-JT-NOUVELLE'`)).length === 1));
  await finance.reload();
  const carte = finance.locator("li", { hasText: "E2E-JT-NOUVELLE" }).first();
  await carte.locator('input[name="label"]').fill("E2E-JT-OBJET");
  await carte.getByRole("button", { name: "Ajouter" }).click();
  verifier("2. création d'un objet depuis l'onglet", await attendre(async () => (await q(`SELECT 1 FROM "Objet" WHERE label = 'E2E-JT-OBJET'`)).length === 1));
  await finance.reload();
  const carte2 = finance.locator("li", { hasText: "E2E-JT-NOUVELLE" }).first();
  const ligneObjet = carte2.locator("ul > li", { hasText: "E2E-JT-OBJET" });
  await ligneObjet.getByRole("button", { name: "Supprimer" }).click();
  await ligneObjet.getByRole("button", { name: "Confirmer la suppression" }).click();
  verifier("2. suppression d'un objet depuis l'onglet", await attendre(async () => (await q(`SELECT 1 FROM "Objet" WHERE label = 'E2E-JT-OBJET'`)).length === 0));
  await finance.reload();
  const carte3 = finance.locator("li", { hasText: "E2E-JT-NOUVELLE" }).first();
  await carte3.getByRole("button", { name: "Supprimer" }).first().click();
  await carte3.getByRole("button", { name: "Confirmer la suppression" }).first().click();
  verifier("2. suppression d'une catégorie depuis l'onglet", await attendre(async () => (await q(`SELECT 1 FROM "Categorie" WHERE label = 'E2E-JT-NOUVELLE'`)).length === 0));

  const admin = await connecter("admin@simassurances.test");
  await admin.goto(`${B}/admin/categories`);
  verifier("2. l'Admin garde Activer / Désactiver sur sa page /admin/categories (inchangée ; le layout Finance n'admet pas l'Admin seul, comme avant)", (await admin.getByRole("button", { name: "Désactiver" }).count()) >= 1);
  await admin.close();

  // Menu : plus d'entrée « Catégories », « Budgets » présent.
  await finance.goto(`${B}/treso/finance/budgets`);
  verifier("2. menu : l'entrée « Catégories » n'existe plus, « Budgets » est là", (await finance.locator('a[href="/treso/finance/categories"]').count()) === 0 && (await finance.locator('a[href="/treso/finance/budgets"]').count()) >= 1);
  verifier("2. onglet Budgets par défaut : budget global = solde de caisse affiché", (await finance.locator('[data-budget-ligne="global"]').count()) === 1);

  // Accès par permission (inchangées) : le DG ne voit pas l'onglet Catégories, l'Assistant Finance n'a pas la page.
  await dg.goto(`${B}/treso/finance/budgets?onglet=categories`);
  verifier("2. DG : voit les budgets mais ni l'onglet ni la gestion des catégories (treso.gerer_categories absente)", (await dg.locator("[data-onglet-categories]").count()) === 0 && (await dg.locator('[data-onglet="categories"]').count()) === 0 && (await dg.locator('[data-budget-ligne="global"]').count()) === 1);
  const assistant = await connecter("assistant-finance@simassurances.test");
  await assistant.goto(`${B}/treso/finance/budgets?onglet=categories`);
  verifier("2. Assistant Finance : ni les budgets ni les catégories", new URL(assistant.url()).pathname !== "/treso/finance/budgets" && (await assistant.locator("[data-onglet-categories]").count()) === 0, assistant.url());
  await assistant.close();
}

// ======================================================================================================================
// 3. SOUMISSION : BUDGET GLOBAL SANS MONTANT, SEUILS EN MONTANT, SOUMISSION EN LOT
// ======================================================================================================================
const nbParam = async () => (await q(`SELECT count(*)::int AS n FROM "BudgetParametrage" WHERE "categorieId" = ANY($1) OR portee = 'GLOBAL'`, [CATS]))[0].n;
const avant = await nbParam();
let idSoumettreCaisse;
let idSoumettreCat;
let idDeciderCaisse;
let idDeciderCat;
let pAttente = [];
{
  await finance.goto(`${B}/treso/finance/budgets`);
  // Deux sections distinctes (lot J quater) : le budget de caisse et les budgets par catégorie ne se mélangent pas à l'écran.
  verifier("3. la page a DEUX sections distinctes : « Budget de caisse » et « Budgets par catégorie »", (await finance.locator("[data-section-caisse]").count()) === 1 && (await finance.locator("[data-section-categories]").count()) === 1);
  verifier("3. … le solde de caisse et son formulaire de seuils sont dans la section caisse, le tableau des catégories dans l'autre", (await finance.locator("[data-section-caisse] [data-solde-caisse]").count()) === 1 && (await finance.locator("[data-section-caisse] [data-parametrage-caisse-form]").count()) === 1 && (await finance.locator("[data-section-caisse] [data-budgets-categories]").count()) === 0 && (await finance.locator("[data-section-categories] [data-budgets-categories]").count()) === 1 && (await finance.locator("[data-section-categories] [data-solde-caisse]").count()) === 0 && (await finance.locator("[data-section-categories] [data-parametrage-caisse-form]").count()) === 0);
  verifier("3. … le formulaire de caisse n'a AUCUN champ montant ni pourcentage : dates et deux seuils en FCFA", (await finance.locator('[data-parametrage-caisse-form] input[name^="montant"]').count()) === 0 && (await finance.locator("[data-parametrage-caisse-form] select").count()) === 0 && (await finance.locator('[data-parametrage-caisse-form] input[name="orange-caisse"]').count()) === 1 && (await finance.locator('[data-parametrage-caisse-form] input[name="rouge-caisse"]').count()) === 1);
  verifier("3. … le formulaire des catégories n'a pas de ligne « solde de caisse »", (await finance.locator('[data-lot-budgets-form] [data-budget-ligne-saisie="global"]').count()) === 0 && (await finance.locator("[data-lot-budgets-form] [data-budget-ligne-saisie]").count()) >= 4);
  idSoumettreCaisse = await idAction(finance, "soumettreSeuilsCaisseAction");
  idSoumettreCat = await idAction(finance, "soumettreBudgetsCategoriesAction");
  verifier("3. identifiants des actions de soumission (caisse, catégories) retrouvés", !!idSoumettreCaisse && !!idSoumettreCat);
  const seuilMontant = { mode: "MONTANT", orange: 2000000, rouge: 500000 };

  const refusPct = await appelerAction(finance, idSoumettreCaisse, [{ dateDebut: jourIso(0), dateFin: null, seuil: { mode: "POURCENTAGE", orange: 20, rouge: 10 } }]);
  verifier("3. budget de caisse : un seuil en POURCENTAGE est refusé (aucun total de référence)", !refusPct.succes && /montant/i.test(refusPct.message) && (await nbParam()) === avant, refusPct.message);
  const refusSansSeuil = await appelerAction(finance, idSoumettreCaisse, [{ dateDebut: jourIso(0), dateFin: null, seuil: null }]);
  verifier("3. budget de caisse : sans seuil, la soumission est refusée", !refusSansSeuil.succes && (await nbParam()) === avant, refusSansSeuil.message);
  const refusRouge = await appelerAction(finance, idSoumettreCaisse, [{ dateDebut: jourIso(0), dateFin: null, seuil: { mode: "MONTANT", orange: 100, rouge: 100 } }]);
  verifier("3. budget de caisse : rouge non strictement plus bas que l'orange refusé", !refusRouge.succes && /strictement plus bas/.test(refusRouge.message) && (await nbParam()) === avant, refusRouge.message);
  const refusPasse = await appelerAction(finance, idSoumettreCaisse, [{ dateDebut: jourIso(-1), dateFin: null, seuil: seuilMontant }]);
  verifier("3. date d'effet dans le passé refusée", !refusPasse.succes && (await nbParam()) === avant, refusPasse.message);

  // Un montant et une catégorie envoyés par un client à l'action de caisse sont ignorés : la portée est imposée par l'action.
  const ignore = await appelerAction(finance, idSoumettreCaisse, [{ portee: "CATEGORIE", categorieId: CATA, montant: 777, dateDebut: jourIso(0), dateFin: null, seuil: seuilMontant }]);
  const g = (await q(`SELECT id, montant, "categorieId", portee, "modeSeuil" FROM "BudgetParametrage" WHERE portee = 'GLOBAL' OR "categorieId" = $1`, [CATA]))[0];
  verifier("3. l'action de caisse impose la portée : montant et catégorie envoyés ignorés (global, montant NULL, aucune catégorie)", ignore.succes && g?.portee === "GLOBAL" && g?.montant === null && g?.categorieId === null && g?.modeSeuil === "MONTANT" && (await q(`SELECT 1 FROM "BudgetParametrage" WHERE "categorieId" = $1`, [CATA])).length === 0, ignore.message);
  verifier("3. … UNE notification propre à la section pour le DG (« Seuils de caisse à valider »)", await attendre(async () => (await q(`SELECT count(*)::int AS n FROM "Notification" WHERE "userId"=$1 AND titre = 'Seuils de caisse à valider'`, [idDG]))[0].n === 1));
  const secondCaisse = await appelerAction(finance, idSoumettreCaisse, [{ dateDebut: jourIso(0), dateFin: null, seuil: seuilMontant }]);
  verifier("3. un second paramétrage de caisse pendant que le premier attend le DG est refusé", !secondCaisse.succes && /déjà en attente/.test(secondCaisse.message), secondCaisse.message);

  // Lot de catégories tout ou rien : une ligne invalide refuse tout.
  const lotInvalide = await appelerAction(finance, idSoumettreCat, [[
    { categorieId: CATA, montant: 1000000, dateDebut: jourIso(0), dateFin: null, seuil: null },
    { categorieId: CATB, montant: 0, dateDebut: jourIso(0), dateFin: null, seuil: null },
  ]]);
  verifier("3. soumission en lot de catégories : une ligne incohérente refuse TOUT le lot (rien de créé)", !lotInvalide.succes && (await q(`SELECT 1 FROM "BudgetParametrage" WHERE "categorieId" = ANY($1)`, [[CATA, CATB]])).length === 0, lotInvalide.message);
  const lotDoublon = await appelerAction(finance, idSoumettreCat, [[
    { categorieId: CATA, montant: 1, dateDebut: jourIso(0), dateFin: null, seuil: null },
    { categorieId: CATA, montant: 2, dateDebut: jourIso(0), dateFin: null, seuil: null },
  ]]);
  verifier("3. … et une même catégorie deux fois dans la sélection est refusée", !lotDoublon.succes && (await q(`SELECT 1 FROM "BudgetParametrage" WHERE "categorieId" = $1`, [CATA])).length === 0, lotDoublon.message);
  const lotSansCategorie = await appelerAction(finance, idSoumettreCat, [[{ montant: 5, dateDebut: jourIso(0), dateFin: null, seuil: null }]]);
  verifier("3. … une ligne sans catégorie est refusée par l'action des catégories (jamais prise pour un budget de caisse)", !lotSansCategorie.succes && (await q(`SELECT count(*)::int AS n FROM "BudgetParametrage" WHERE portee = 'GLOBAL'`))[0].n === 1, lotSansCategorie.message);

  // Le DG refuse ce premier paramétrage de caisse (hors lot) ; la Finance resoumet ensuite les seuils par l'écran.
  await dg.goto(`${B}/treso/finance/budgets`);
  idDeciderCaisse = await idAction(dg, "deciderSeuilsCaisseAction");
  idDeciderCat = await idAction(dg, "deciderBudgetsCategoriesAction");
  verifier("3. identifiants des actions de décision (caisse, catégories) retrouvés", !!idDeciderCaisse && !!idDeciderCat);
  const croise = await appelerAction(dg, idDeciderCat, [[{ id: g.id }], true]);
  verifier("3. l'action de décision des catégories refuse un paramétrage de caisse (aucun mélange des sections)", !croise.succes && (await q(`SELECT statut FROM "BudgetParametrage" WHERE id=$1`, [g.id]))[0].statut === "EN_ATTENTE", croise.message);
  const refusSeul = await appelerAction(dg, idDeciderCaisse, [[{ id: g.id }], false, "Seuils à revoir avec la trésorerie"]);
  verifier("3. le DG refuse les seuils de caisse (motif obligatoire fourni)", refusSeul.succes && (await q(`SELECT statut, "motifRefus" FROM "BudgetParametrage" WHERE id=$1`, [g.id]))[0].statut === "REFUSE", refusSeul.message);
  verifier("3. … la Finance reçoit la notification de la section (« Seuils de caisse refusés par le DG »)", await attendre(async () => (await q(`SELECT count(*)::int AS n FROM "Notification" WHERE "userId"=$1 AND titre = 'Seuils de caisse refusés par le DG'`, [idFinance]))[0].n === 1));
  await dg.goto(`${B}/treso/finance/budgets`);
  verifier("3. le DG n'a ni le formulaire de caisse ni celui des catégories", (await dg.locator("[data-parametrage-budget-form]").count()) === 0 && (await dg.locator("[data-parametrage-caisse-form]").count()) === 0);

  // État de caisse avant le cycle : orange / rouge relatifs au reste prévisionnel R0.
  const c0 = await caisseAttendue();
  verifier("3. solde de caisse de test connu (10 000 000 FCFA d'alimentation de test), aucun règlement Caisse à confirmer", c0.solde === 10000000 && c0.connu === 0, JSON.stringify(c0));
  const R0 = c0.reste;
  globalThis.__BASE = c0;
  const orange = R0 - 400000;
  const rouge = R0 - 900000;

  // Soumission PAR L'ÉCRAN, section par section : d'abord les seuils de caisse…
  await finance.goto(`${B}/treso/finance/budgets`);
  const formCaisse = finance.locator("[data-parametrage-caisse-form]");
  await formCaisse.locator('input[name="dateDebut"]').fill(jourIso(0));
  await formCaisse.locator('input[name="orange-caisse"]').fill("100");
  await formCaisse.locator('input[name="rouge-caisse"]').fill("100");
  await formCaisse.locator("[data-soumettre-caisse]").click();
  verifier("3. seuils de caisse incohérents (rouge ≥ orange) : l'erreur s'affiche dans la section, rien n'est créé", (await attendre(async () => /strictement plus bas/.test(net(await formCaisse.innerText())))) && (await q(`SELECT 1 FROM "BudgetParametrage" WHERE portee='GLOBAL' AND statut='EN_ATTENTE'`)).length === 0);
  await formCaisse.locator('input[name="orange-caisse"]').fill(String(orange));
  await formCaisse.locator('input[name="rouge-caisse"]').fill(String(rouge));
  await formCaisse.locator("[data-soumettre-caisse]").click();
  verifier("3. seuils de caisse soumis par l'écran : un paramétrage GLOBAL EN_ATTENTE, sans montant, seuils en FCFA tels que saisis", await attendre(async () => (await q(`SELECT count(*)::int AS n FROM "BudgetParametrage" WHERE portee='GLOBAL' AND statut='EN_ATTENTE'`))[0].n === 1));
  const pg = (await q(`SELECT id, portee, "categorieId", montant, "modeSeuil", "seuilOrange"::float AS o, "seuilRouge"::float AS r, "soumisParId" FROM "BudgetParametrage" WHERE portee='GLOBAL' AND statut='EN_ATTENTE'`))[0];
  verifier("3. … aucun montant, seuils en montant", pg.montant === null && pg.modeSeuil === "MONTANT" && pg.o === orange && pg.r === rouge && pg.soumisParId === idFinance, JSON.stringify(pg));
  verifier("3. … une trace d'historique et UNE notification propre à la section (2 « Seuils de caisse à valider » au total)", (await q(`SELECT count(*)::int AS n FROM "HistoriqueEntry" WHERE entity='BudgetParametrage' AND action='budget_soumis' AND "entityId" = $1`, [pg.id]))[0].n === 1 && await attendre(async () => (await q(`SELECT count(*)::int AS n FROM "Notification" WHERE "userId"=$1 AND titre = 'Seuils de caisse à valider'`, [idDG]))[0].n === 2));
  await finance.reload();
  verifier("3. … le formulaire de caisse est désactivé tant que le DG n'a pas décidé", await finance.locator('[data-parametrage-caisse-form] input[name="orange-caisse"]').isDisabled() && await finance.locator("[data-soumettre-caisse]").isDisabled());

  // … puis le lot de catégories.
  const form = finance.locator("[data-lot-budgets-form]");
  verifier("3. formulaire en lot des catégories : « Soumettre la sélection » grisé tant que rien n'est coché", await form.locator("[data-soumettre-selection]").isDisabled());
  await form.locator('input[name="dateDebut"]').fill(jourIso(0));
  const remplir = async (id, label, montant, mode, o, r) => {
    const ligne = form.locator(`[data-budget-ligne-saisie="${label}"]`);
    await ligne.locator(`input[name="montant-${id}"]`).fill(String(montant));
    await ligne.locator(`select[name="mode-${id}"]`).selectOption(mode);
    if (mode !== "AUCUN") {
      await ligne.locator(`input[name="orange-${id}"]`).fill(String(o));
      await ligne.locator(`input[name="rouge-${id}"]`).fill(String(r));
    }
  };
  await remplir(CATA, "E2E-JT-CATA", 1000000, "POURCENTAGE", 20, 10);
  await remplir(CATB, "E2E-JT-CATB", 500000, "MONTANT", 100000, 20000);
  await remplir(CATC, "E2E-JT-CATC", 300000, "AUCUN");
  await remplir(CATD, "E2E-JT-CATD", 250000, "AUCUN");
  // Une ligne incohérente (rouge ≥ orange) : message sur la bonne ligne, rien n'est créé.
  await form.locator('[data-budget-ligne-saisie="E2E-JT-CATB"] input[name="rouge-' + CATB + '"]').fill("100000");
  await form.locator("[data-soumettre-selection]").click();
  verifier("3. lot avec une ligne incohérente : l'erreur s'affiche sur la ligne, aucun paramétrage de catégorie créé", (await attendre(async () => /strictement plus bas/.test(net(await form.locator('[data-budget-ligne-saisie="E2E-JT-CATB"]').innerText()))) ) && (await q(`SELECT 1 FROM "BudgetParametrage" WHERE "categorieId" = ANY($1) AND statut='EN_ATTENTE'`, [CATS])).length === 0);
  await form.locator('[data-budget-ligne-saisie="E2E-JT-CATB"] input[name="rouge-' + CATB + '"]').fill("20000");
  await form.locator("[data-soumettre-selection]").click();
  verifier("3. soumission en lot par l'écran : 4 paramétrages de catégorie EN_ATTENTE d'un coup", await attendre(async () => (await q(`SELECT count(*)::int AS n FROM "BudgetParametrage" WHERE statut='EN_ATTENTE' AND "categorieId" = ANY($1)`, [CATS]))[0].n === 4));
  pAttente = await q(`SELECT id, portee, "categorieId", montant, "modeSeuil", "seuilOrange"::float AS o, "seuilRouge"::float AS r, "soumisParId" FROM "BudgetParametrage" WHERE statut='EN_ATTENTE' AND ("categorieId" = ANY($1) OR portee='GLOBAL')`, [CATS]);
  verifier("3. … tous soumis par la Finance, une trace d'historique PAR élément (budget_soumis)", pAttente.every((p) => p.soumisParId === idFinance) && (await q(`SELECT count(*)::int AS n FROM "HistoriqueEntry" WHERE entity='BudgetParametrage' AND action='budget_soumis' AND "entityId" = ANY($1)`, [pAttente.map((p) => p.id)]))[0].n === 5);
  verifier("3. … UNE SEULE notification pour tout le lot de catégories (« 4 budgets de catégorie à valider »), distincte de celle de la caisse", await attendre(async () => (await q(`SELECT count(*)::int AS n FROM "Notification" WHERE "userId"=$1 AND titre = '4 budgets de catégorie à valider'`, [idDG]))[0].n === 1));
  await finance.reload();
  verifier("3. … les lignes en attente sont désactivées dans le formulaire des catégories", await finance.locator(`[data-lot-budgets-form] [data-coche-budget="E2E-JT-CATA"]`).isDisabled());
  // Chaque section a son propre historique : jamais de ligne de l'autre.
  const nbGlobal = (await q(`SELECT count(*)::int AS n FROM "BudgetParametrage" WHERE portee='GLOBAL'`))[0].n;
  const nbCat = (await q(`SELECT count(*)::int AS n FROM "BudgetParametrage" WHERE portee='CATEGORIE'`))[0].n;
  verifier("3. historiques séparés : l'historique de caisse ne contient que des seuils de caisse, celui des catégories que des catégories", (await finance.locator("[data-historique-caisse] [data-parametrage]").count()) === nbGlobal && (await finance.locator("[data-historique-categories] [data-parametrage]").count()) === Math.min(nbCat, 100) && !/catégorie/i.test(net(await finance.locator("[data-historique-caisse] thead").innerText())) && /catégorie/i.test(net(await finance.locator("[data-historique-categories] thead").innerText())));
  verifier("3. … et chaque section liste ses propres paramétrages en attente (1 de caisse, 4 de catégories)", (await finance.locator("[data-section-caisse] [data-parametrage-attente]").count()) === 1 && (await finance.locator("[data-section-categories] [data-parametrage-attente]").count()) === 4);
  globalThis.__R0 = R0;
}
const R0 = globalThis.__R0;
const S0 = globalThis.__BASE.solde;
const E0 = globalThis.__BASE.connu + globalThis.__BASE.inconnu; // engagé déjà présent dans la base jetable (données laissées par d'autres scripts)
const E0i = globalThis.__BASE.inconnu;
const seuilsGlobaux = { orange: R0 - 400000, rouge: R0 - 900000 };

// ======================================================================================================================
// 4. DÉCISION DU DG, SECTION PAR SECTION (seul ou en lot)
// ======================================================================================================================
{
  await finance.goto(`${B}/treso/finance/budgets`);
  const refusFinance = await appelerAction(finance, idDeciderCat, [pAttente.filter((p) => p.categorieId).map((p) => ({ id: p.id })), true]);
  verifier("4. la Finance ne peut pas décider (appel direct d'un lot refusé)", !refusFinance.succes && /non autoris/i.test(refusFinance.message) && (await q(`SELECT 1 FROM "BudgetParametrage" WHERE statut <> 'EN_ATTENTE' AND id = ANY($1)`, [pAttente.map((p) => p.id)])).length === 0, refusFinance.message);
  const refusFinanceCaisse = await appelerAction(finance, idDeciderCaisse, [[{ id: pAttente.find((p) => p.portee === "GLOBAL").id }], true]);
  verifier("4. … ni les seuils de caisse", !refusFinanceCaisse.succes && /non autoris/i.test(refusFinanceCaisse.message), refusFinanceCaisse.message);

  await dg.goto(`${B}/treso/finance/budgets`);
  const pg = pAttente.find((p) => p.portee === "GLOBAL");
  const pa = pAttente.find((p) => p.categorieId === CATA);
  const pb = pAttente.find((p) => p.categorieId === CATB);
  const pc = pAttente.find((p) => p.categorieId === CATC);
  const pd = pAttente.find((p) => p.categorieId === CATD);
  const croiseCat = await appelerAction(dg, idDeciderCaisse, [[{ id: pa.id }], true]);
  verifier("4. l'action de décision de caisse refuse un budget de catégorie (aucun mélange des sections)", !croiseCat.succes && (await q(`SELECT statut FROM "BudgetParametrage" WHERE id=$1`, [pa.id]))[0].statut === "EN_ATTENTE", croiseCat.message);
  verifier("4. le DG voit, dans chaque section, ses propres paramétrages à décider (1 de caisse, 4 de catégories)", (await dg.locator("[data-section-caisse] [data-valider-parametrage]").count()) === 1 && (await dg.locator("[data-section-categories] [data-valider-parametrage]").count()) === 4);
  verifier("4. … la barre de décision en lot est dans la section des catégories (4 en attente) ; celle de caisse n'en a pas besoin (un seul paramétrage de caisse à la fois)", (await dg.locator("[data-section-categories] [data-decision-lot]").count()) === 1 && (await dg.locator("[data-section-caisse] [data-decision-lot]").count()) === 0);

  // Caisse : le DG valide les seuils par le bouton de la section.
  await dg.locator(`[data-section-caisse] [data-parametrage-attente="${pg.id}"] [data-valider-parametrage]`).click();
  verifier("4. le DG valide les seuils de caisse (section caisse)", await attendre(async () => (await q(`SELECT statut FROM "BudgetParametrage" WHERE id=$1`, [pg.id]))[0].statut === "VALIDE"));
  verifier("4. … notification propre à la section (« Seuils de caisse validés par le DG »), historique par élément", await attendre(async () => (await q(`SELECT count(*)::int AS n FROM "Notification" WHERE "userId"=$1 AND titre = 'Seuils de caisse validés par le DG'`, [idFinance]))[0].n === 1) && (await q(`SELECT count(*)::int AS n FROM "HistoriqueEntry" WHERE entity='BudgetParametrage' AND action='budget_valide' AND "userId"=$1 AND "entityId" = $2`, [idDG, pg.id]))[0].n === 1);
  // Catégories : lot de VALIDATION A + B.
  await dg.goto(`${B}/treso/finance/budgets`);
  await dg.locator(`[data-section-categories] [data-coche-parametrage="${pa.id}"]`).check();
  await dg.locator(`[data-section-categories] [data-coche-parametrage="${pb.id}"]`).check();
  verifier("4. « Valider la sélection » dégrisé après la sélection", !(await dg.locator("[data-valider-selection]").isDisabled()));
  await dg.locator("[data-valider-selection]").click();
  verifier("4. le DG valide CATA + CATB d'un coup (lot de la section catégories)", await attendre(async () => (await q(`SELECT count(*)::int AS n FROM "BudgetParametrage" WHERE statut='VALIDE' AND id = ANY($1)`, [[pa.id, pb.id]]))[0].n === 2));
  verifier("4. … une trace d'historique PAR élément, auteur DG", (await q(`SELECT count(*)::int AS n FROM "HistoriqueEntry" WHERE entity='BudgetParametrage' AND action='budget_valide' AND "userId"=$1 AND "entityId" = ANY($2)`, [idDG, [pa.id, pb.id]]))[0].n === 2);
  verifier("4. … UNE SEULE notification pour la Finance (« 2 budgets de catégorie validés par le DG »)", await attendre(async () => (await q(`SELECT count(*)::int AS n FROM "Notification" WHERE "userId"=$1 AND titre = '2 budgets de catégorie validés par le DG'`, [idFinance]))[0].n === 1));
  // Lot de REFUS avec motif commun : CATC + CATD (motif obligatoire).
  await dg.goto(`${B}/treso/finance/budgets`);
  await dg.locator(`[data-section-categories] [data-coche-parametrage="${pc.id}"]`).check();
  await dg.locator(`[data-section-categories] [data-coche-parametrage="${pd.id}"]`).check();
  await dg.locator("[data-refuser-selection]").click();
  verifier("4. refus en lot : « Confirmer » grisé sans motif commun", await dg.locator("[data-confirmer-refus-selection]").isDisabled());
  await dg.locator('input[name="motifRefusLot"]').fill("Hors enveloppe de l'exercice");
  await dg.locator("[data-confirmer-refus-selection]").click();
  verifier("4. le DG refuse CATC + CATD d'un coup avec un motif commun", await attendre(async () => (await q(`SELECT count(*)::int AS n FROM "BudgetParametrage" WHERE statut='REFUSE' AND "motifRefus" = 'Hors enveloppe de l''exercice' AND id = ANY($1)`, [[pc.id, pd.id]]))[0].n === 2));
  verifier("4. … UNE SEULE notification de refus pour la Finance, avec le motif", await attendre(async () => (await q(`SELECT message FROM "Notification" WHERE "userId"=$1 AND titre = '2 budgets de catégorie refusés par le DG'`, [idFinance])).length === 1) && /Hors enveloppe/.test((await q(`SELECT message FROM "Notification" WHERE "userId"=$1 AND titre = '2 budgets de catégorie refusés par le DG'`, [idFinance]))[0].message));

  // La Finance resoumet C, D et A en lot ; D est alors une soumission du DG lui-même (jamais décidée par lui).
  await finance.goto(`${B}/treso/finance/budgets`);
  const re = await appelerAction(finance, idSoumettreCat, [[
    { categorieId: CATC, montant: 350000, dateDebut: jourIso(0), dateFin: null, seuil: null },
    { categorieId: CATD, montant: 260000, dateDebut: jourIso(0), dateFin: null, seuil: null },
    { categorieId: CATA, montant: 1200000, dateDebut: jourIso(1), dateFin: null, seuil: null },
  ]]);
  verifier("4. la Finance resoumet C, D et A en lot (nouvelles lignes ; les anciennes restent dans l'historique, rien n'est modifié)", re.succes && (await q(`SELECT count(*)::int AS n FROM "BudgetParametrage" WHERE "categorieId" = ANY($1)`, [CATS]))[0].n === 7);
  const nouveaux = await q(`SELECT id, "categorieId" FROM "BudgetParametrage" WHERE statut='EN_ATTENTE' AND "categorieId" = ANY($1)`, [[CATA, CATC, CATD]]);
  const nc = nouveaux.find((x) => x.categorieId === CATC).id;
  const na = nouveaux.find((x) => x.categorieId === CATA).id;
  const nd = nouveaux.find((x) => x.categorieId === CATD).id;
  await q(`UPDATE "BudgetParametrage" SET "soumisParId" = $2 WHERE id = $1`, [nd, idDG]);
  await dg.goto(`${B}/treso/finance/budgets`);
  verifier("4. un budget soumis par le DG lui-même : case et boutons désactivés, avec la raison", (await dg.locator(`[data-coche-parametrage="${nd}"]`).isDisabled()) && await dg.locator(`[data-parametrage-attente="${nd}"] [data-valider-parametrage]`).isDisabled());
  const seul = await appelerAction(dg, idDeciderCat, [[{ id: nd }], true]);
  verifier("4. … appel direct seul : refusé (jamais sa propre soumission)", !seul.succes && /vous-même soumis|que vous avez/.test(seul.message) && (await q(`SELECT statut FROM "BudgetParametrage" WHERE id=$1`, [nd]))[0].statut === "EN_ATTENTE", seul.message);
  const sansMotif = await appelerAction(dg, idDeciderCat, [[{ id: na }, { id: nc }], false]);
  verifier("4. refus en lot sans aucun motif : refusé en entier, rien n'est décidé", !sansMotif.succes && /motif/i.test(sansMotif.message) && (await q(`SELECT count(*)::int AS n FROM "BudgetParametrage" WHERE statut='EN_ATTENTE' AND id = ANY($1)`, [[na, nc]]))[0].n === 2, sansMotif.message);
  const surMesure = await appelerAction(dg, idDeciderCat, [[{ id: na, motif: "Montant jugé trop élevé" }, { id: nc }], false, "Reporter à l'exercice suivant"]);
  const motifs = Object.fromEntries((await q(`SELECT id, "motifRefus" FROM "BudgetParametrage" WHERE id = ANY($1)`, [[na, nc]])).map((r) => [r.id, r.motifRefus]));
  verifier("4. motif PAR élément ou commun : A garde son motif propre, C reçoit le motif commun", surMesure.succes && motifs[na] === "Montant jugé trop élevé" && motifs[nc] === "Reporter à l'exercice suivant", JSON.stringify(motifs));

  // Lot mêlant une soumission du DG : le reste est décidé, la sienne est ignorée avec sa raison.
  await finance.goto(`${B}/treso/finance/budgets`);
  const re2 = await appelerAction(finance, idSoumettreCat, [[{ categorieId: CATC, montant: 360000, dateDebut: jourIso(0), dateFin: null, seuil: null }]]);
  const nc2 = (await q(`SELECT id FROM "BudgetParametrage" WHERE statut='EN_ATTENTE' AND "categorieId" = $1`, [CATC]))[0]?.id;
  await dg.goto(`${B}/treso/finance/budgets`);
  const partiel = nc2 ? await appelerAction(dg, idDeciderCat, [[{ id: nc2 }, { id: nd }], true]) : { succes: false, message: "" };
  verifier("4. lot mêlant sa propre soumission : CATC validé, CATD ignoré avec la raison", re2.succes && partiel.succes && /Non décidés/.test(partiel.message) && (await q(`SELECT statut FROM "BudgetParametrage" WHERE id=$1`, [nc2]))[0].statut === "VALIDE" && (await q(`SELECT statut FROM "BudgetParametrage" WHERE id=$1`, [nd]))[0].statut === "EN_ATTENTE", partiel.message);
  await q(`DELETE FROM "HistoriqueEntry" WHERE "entityId" = $1`, [nd]);
  await q(`DELETE FROM "BudgetParametrage" WHERE id = $1`, [nd]);

  // Les budgets en vigueur : section caisse (solde + seuils) et tableau des catégories (une ligne par catégorie).
  await finance.goto(`${B}/treso/finance/budgets`);
  const t = net(await finance.locator('[data-section-caisse] [data-budget-ligne="global"]').innerText());
  verifier("4. section caisse : le solde de caisse avec ses seuils en montant et le statut « Validé »", /solde de caisse actuel/i.test(t) && new RegExp(`Orange à ${fr(seuilsGlobaux.orange)} FCFA restants`).test(t) && new RegExp(`rouge à ${fr(seuilsGlobaux.rouge)} FCFA restants`).test(t) && /Validé/.test(t), t);
  const tableau = finance.locator("[data-section-categories] [data-budgets-categories]");
  const ligneA = net(await tableau.locator('[data-budget-ligne="E2E-JT-CATA"]').innerText());
  const ligneB = net(await tableau.locator('[data-budget-ligne="E2E-JT-CATB"]').innerText());
  const ligneD = net(await tableau.locator('[data-budget-ligne="E2E-JT-CATD"]').innerText());
  verifier("4. tableau des catégories : une ligne par catégorie avec budget en vigueur, consommé, réservé, reste, seuils, statut et alerte", /1 000 000 FCFA/.test(ligneA) && /0 FCFA/.test(ligneA) && /20 % restants/.test(ligneA) && /refusé|Validé/i.test(ligneA) && /500 000 FCFA/.test(ligneB) && /Montant restant|restants/.test(ligneB), ligneA + " || " + ligneB);
  verifier("4. … en-têtes du tableau : budget en vigueur, consommé, réservé, reste, période, seuils, statut, alerte", await (async () => { const e = net(await tableau.locator("thead").innerText()).toLowerCase(); return ["budget en vigueur", "consommé", "réservé", "reste", "période", "seuils", "statut", "alerte"].every((h) => e.includes(h)); })() && (await tableau.locator("thead th").count()) === 9);
  verifier("4. … une catégorie sans budget en vigueur reste listée (statut du dernier paramétrage)", /—/.test(ligneD) && /refusé/i.test(ligneD), ligneD);
  verifier("4. … les statuts du tableau suivent les paramétrages (B validé, D refusé)", (await tableau.locator('[data-budget-ligne="E2E-JT-CATB"] [data-statut-categorie="VALIDE"]').count()) === 1 && (await tableau.locator('[data-budget-ligne="E2E-JT-CATD"] [data-statut-categorie="REFUSE"]').count()) === 1);
}

// ======================================================================================================================
// 5. VALIDATION : SOLDE DE CAISSE PRÉVISIONNEL, ORANGE, ROUGE, NÉGATIF, RÈGLEMENTS CAISSE / BANQUE, DG
// ======================================================================================================================
async function demande(suffixe, numero, articles) {
  const D = `${P}${suffixe}`;
  const total = articles.reduce((s, a) => s + a.montant, 0);
  await q(
    `INSERT INTO "Demande"(id, reference, montant, "montantValide", statut, "createurId", "updatedAt", "beneficiaireType", "beneficiaireUserId", "etapeCircuit", "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", description, "typeDemande")
     VALUES ($1, $2, $3, 0, 'EN_ATTENTE_VALIDATION', $4, now(), 'COLLABORATEUR', $4, 'FINANCE', true, false, 'OPTIONNELLE', 'test e2e lot J ter', 'STANDARD')`,
    [D, `DEM-LOTJT-${numero}`, total, idCollab]
  );
  for (const [i, a] of articles.entries()) {
    await q(`INSERT INTO "LigneDemande"(id, libelle, "libelleOriginal", quantite, "prixUnitaire", "demandeId", motif) VALUES ($1,$2,$2,1,$3,$4,'motif e2e')`, [`${D}-l${i + 1}`, a.libelle, a.montant, D]);
  }
  return D;
}
const ligneDe = async (id) => (await q(`SELECT id, "statutValidation", "budgetApresValidation", "decisionDG" FROM "LigneDemande" WHERE id = $1`, [id]))[0];
const cocherValider = (page, L) => page.locator(`[data-ligne-card="${L}"]`).getByRole("button", { name: "Valider", exact: true }).click();
const enregistrer = (page) => page.getByRole("button", { name: /Enregistrer les décisions/ });
async function pageCaisse() {
  await finance.goto(`${B}/treso/finance/budgets`);
  const t = net(await finance.locator('[data-budget-ligne="global"]').innerText());
  return {
    texte: t,
    solde: net(await finance.locator("[data-solde-caisse]").innerText()),
    engage: net(await finance.locator("[data-engage-caisse]").innerText()),
    reste: net(await finance.locator('[data-budget-ligne="global"] [data-reste-budget]').innerText()),
  };
}

let D1;
let A, Bb, C;
{
  D1 = await demande("D1", 1, [
    { libelle: "Article A", montant: 300000 },
    { libelle: "Article B", montant: 200000 },
    { libelle: "Article C", montant: 600000 },
  ]);
  [A, Bb, C] = [`${D1}-l1`, `${D1}-l2`, `${D1}-l3`];
  const p0 = await pageCaisse();
  verifier("5. page Budgets : solde actuel (10 000 000), rien d'engagé, reste = solde — recoupé avec un calcul SQL indépendant", p0.solde === `${fr(S0)} FCFA` && p0.engage === `${fr(E0)} FCFA` && p0.reste === `${fr(R0)} FCFA`, JSON.stringify(p0));

  // 5a. Article A : sous les seuils.
  await finance.goto(`${B}/treso/finance/demandes/${D1}`);
  await cocherValider(finance, A);
  const bloc = finance.locator("[data-budget-bloc]");
  await bloc.waitFor();
  const texteA = net(await bloc.innerText());
  const apresA = R0 - 300000;
  verifier("5a. reste global = solde de caisse prévisionnel affiché à la validation (solde − engagé − cette validation)", (await bloc.locator('[data-budget-prevision="global"]').count()) === 1 && texteA.includes(`${fr(apresA)} FCFA après cette validation`) && texteA.includes(`Solde actuel ${fr(S0)} FCFA`) && texteA.includes(`cette validation ${fr(300000)} FCFA`), texteA);
  verifier("5a. … niveau « Dans la limite », rien n'est écrit avant l'enregistrement", (await bloc.getAttribute("data-niveau-budget")) === "AUCUN" && (await ligneDe(A)).statutValidation === "EN_ATTENTE");
  await enregistrer(finance).click();
  verifier("5a. A validé", await attendre(async () => (await ligneDe(A)).statutValidation === "VALIDEE"));
  verifier("5a. … photo du budget sur l'article : solde de caisse prévisionnel", Number((await ligneDe(A)).budgetApresValidation?.global?.resteApres) === apresA);
  const pA = await pageCaisse();
  verifier("5a. Budgets : « déjà validé, pas encore sorti » = 300 000 (mode non encore connu, supposé en caisse)", pA.engage === `${fr(E0 + 300000)} FCFA` && pA.reste === `${fr(apresA)} FCFA` && pA.texte.includes(`validé sans règlement ${fr(E0i + 300000)} FCFA`), pA.texte);

  // 5b. Article B : ORANGE (reste après = R0 − 500 000 ≤ orange R0 − 400 000).
  await finance.goto(`${B}/treso/finance/demandes/${D1}`);
  await cocherValider(finance, Bb);
  await finance.locator("[data-budget-bloc]").waitFor();
  const texteB = net(await finance.locator("[data-budget-bloc]").innerText());
  verifier("5b. ORANGE : alerte visible sur le solde de caisse, validation permise", (await finance.locator('[data-alerte-budget="ORANGE"]').count()) === 1 && texteB.includes(`déjà validé sans règlement ${fr(E0i + 300000)} FCFA`) && (await enregistrer(finance).isEnabled()), texteB);
  await enregistrer(finance).click();
  verifier("5b. B validé malgré l'alerte orange", await attendre(async () => (await ligneDe(Bb)).statutValidation === "VALIDEE"));
  verifier("5b. … alerte tracée dans l'historique de la demande, avec le solde de caisse prévisionnel", (await q(`SELECT detail FROM "HistoriqueEntry" WHERE action='alerte_budget' AND "entityId"=$1`, [D1])).some((r) => /Solde de caisse prévisionnel/.test(r.detail)));
  verifier("5b. … le DG est notifié (alerte orange sur le solde de caisse)", await attendre(async () => (await q(`SELECT 1 FROM "Notification" WHERE "userId"=$1 AND titre='Alerte orange sur un budget' AND message LIKE '%Solde de caisse prévisionnel%'`, [idDG])).length === 1));
  verifier("5b. … l'auteur de la validation (Finance) n'est pas notifié de sa propre action", (await q(`SELECT 1 FROM "Notification" WHERE "userId"=$1 AND titre='Alerte orange sur un budget'`, [idFinance])).length === 0);

  // 5c. Article C : ROUGE — bloqué, demande de confirmation, seul le DG confirme.
  await finance.goto(`${B}/treso/finance/demandes/${D1}`);
  const idVal = await idAction(finance, "validerLignesAction");
  await cocherValider(finance, C);
  await finance.locator("[data-budget-bloc]").waitFor();
  verifier("5c. ROUGE : alerte rouge, « Enregistrer » grisé, « Demander la confirmation du DG »", (await finance.locator('[data-alerte-budget="ROUGE"]').count()) === 1 && (await enregistrer(finance).isDisabled()) && (await finance.locator("[data-demander-confirmation-dg]").isEnabled()));
  const refus = idVal ? await appelerAction(finance, idVal, [D1, [{ ligneId: C, statut: "VALIDEE" }]]) : { succes: true, message: "" };
  verifier("5c. serveur : validation de C REFUSÉE par appel direct (blocage rouge, solde de caisse)", !refus.succes && /seuil rouge/i.test(refus.message) && /Solde de caisse/.test(refus.message) && (await ligneDe(C)).statutValidation === "EN_ATTENTE", refus.message);
  await finance.locator("[data-demander-confirmation-dg]").click();
  verifier("5c. demande de confirmation enregistrée", await attendre(async () => (await q(`SELECT statut FROM "BudgetDepassement" WHERE "demandeId"=$1`, [D1])).length === 1));
  await dg.goto(`${B}/treso/finance/budgets`);
  const bd = dg.locator("[data-depassement]").first();
  await bd.locator('input[name="motifDepassement"]').fill("Alimentation de caisse prévue en fin de semaine");
  await bd.getByRole("button", { name: "Confirmer le dépassement" }).click();
  verifier("5c. le DG confirme avec un motif : CONFIRME", await attendre(async () => (await q(`SELECT statut FROM "BudgetDepassement" WHERE "demandeId"=$1`, [D1]))[0]?.statut === "CONFIRME"));
  await finance.goto(`${B}/treso/finance/demandes/${D1}`);
  await cocherValider(finance, C);
  await enregistrer(finance).click();
  verifier("5c. C est validé grâce à la confirmation du DG (usage unique)", await attendre(async () => (await ligneDe(C)).statutValidation === "VALIDEE") && (await q(`SELECT statut FROM "BudgetDepassement" WHERE "demandeId"=$1`, [D1]))[0].statut === "UTILISE");
  verifier("5c. … photo de l'article : niveau ROUGE, solde de caisse prévisionnel", ((s) => s?.niveau === "ROUGE" && Number(s?.global?.resteApres) === R0 - 1100000)((await ligneDe(C)).budgetApresValidation));

  // 5d. Ce qui compte dans le prévisionnel : règlements Caisse / Banque (insertions directes, écran relu).
  const reglement = (id, mode, ligne, montant, confirme) =>
    q(`INSERT INTO "Reglement"(id, montant, mode, "estConfirme", "estAnnule", "demandeId", "auteurId", "ligneDemandeId", motif, "confirmeAt") VALUES ($1,$2,$3,$4,false,$5,$6,$7,'règlement e2e',${confirme ? "now()" : "NULL"})`, [`${P}${id}`, montant, mode, confirme, D1, idFinance, ligne]);
  const pAvant = await pageCaisse();
  verifier("5d. départ : engagé de base + 1 100 000 (tout « validé sans règlement »), reste R0 − 1 100 000", pAvant.engage === `${fr(E0 + 1100000)} FCFA` && pAvant.reste === `${fr(R0 - 1100000)} FCFA`, JSON.stringify(pAvant));
  await reglement("rA", "CAISSE", A, 300000, false);
  const pa = await pageCaisse();
  verifier("5d. règlement CAISSE à confirmer sur A (mode connu) : il passe en « règlements Caisse à confirmer », total engagé inchangé", pa.engage === `${fr(E0 + 1100000)} FCFA` && /règlements Caisse à confirmer 300 000 FCFA/.test(pa.texte) && pa.texte.includes(`validé sans règlement ${fr(E0i + 800000)} FCFA`) && pa.reste === pAvant.reste, pa.texte);
  await reglement("rB", "BANQUE", Bb, 200000, false);
  const pb = await pageCaisse();
  verifier("5d. règlement BANQUE à confirmer sur B : B ne compte plus du tout (la banque n'affecte jamais le solde de caisse)", pb.engage === `${fr(E0 + 900000)} FCFA` && pb.reste === `${fr(R0 - 900000)} FCFA` && pb.texte.includes(`validé sans règlement ${fr(E0i + 600000)} FCFA`), pb.texte);
  const empreinteAvantConfirmation = await journalEmpreinte();
  await q(`UPDATE "Reglement" SET "estConfirme" = true, "confirmeAt" = now() WHERE id = $1`, [`${P}rA`]);
  await q(`INSERT INTO "JournalCaisse"(id, type, montant, source, "refId", "demandeId", "userId") VALUES ('${P}sortie','SORTIE',300000,'e2e_jter','${P}rA',$1,$2)`, [D1, idFinance]);
  const pc = await pageCaisse();
  verifier("5d. règlement CAISSE confirmé : le solde baisse de 300 000 et l'engagé aussi — le reste prévisionnel ne bouge pas", pc.solde === `${fr(S0 - 300000)} FCFA` && pc.engage === `${fr(E0 + 600000)} FCFA` && pc.reste === `${fr(R0 - 900000)} FCFA`, JSON.stringify(pc));
  await q(`UPDATE "Reglement" SET "estConfirme" = true, "confirmeAt" = now() WHERE id = $1`, [`${P}rB`]);
  const pd = await pageCaisse();
  const empreinteApresBanque = await journalEmpreinte();
  verifier("5d. règlement BANQUE confirmé : solde de caisse et journal inchangés", pd.solde === pc.solde && pd.reste === pc.reste && empreinteApresBanque.h === empreinteAvantConfirmation.h, JSON.stringify(pd));
  const attendue = await caisseAttendue();
  verifier("5d. la page recoupe le calcul SQL indépendant (solde, engagé, reste)", pd.solde === `${fr(attendue.solde)} FCFA` && pd.engage === `${fr(attendue.connu + attendue.inconnu)} FCFA` && pd.reste === `${fr(attendue.reste)} FCFA`, JSON.stringify(attendue));

  // 5e. Solde prévisionnel NÉGATIF : validation bloquée tant que le DG n'a pas confirmé ; le DG confirme dans le même geste.
  const D3 = await demande("D3", 3, [{ libelle: "Gros achat", montant: 20000000 }]);
  const L3 = `${D3}-l1`;
  await finance.goto(`${B}/treso/finance/demandes/${D3}`);
  await cocherValider(finance, L3);
  await finance.locator("[data-budget-bloc]").waitFor();
  const texteNeg = net(await finance.locator("[data-budget-bloc]").innerText());
  verifier("5e. solde prévisionnel NÉGATIF : affiché « négatif de … » et alerte rouge", /négatif de/.test(texteNeg) && (await finance.locator('[data-alerte-budget="ROUGE"]').count()) === 1 && (await enregistrer(finance).isDisabled()), texteNeg);
  await finance.reload();
  await finance.locator(`[data-soumettre-article="${L3}"]`).click();
  verifier("5e. la Finance soumet l'article au DG", await attendre(async () => (await q(`SELECT "soumiseAuDG" FROM "LigneDemande" WHERE id=$1`, [L3]))[0].soumiseAuDG === true));
  await dg.goto(`${B}/treso/dg/${D3}`);
  const carte = dg.locator("[data-ligne-dg]").first();
  await carte.waitFor();
  const valider = carte.getByRole("button", { name: "Valider", exact: true });
  verifier("5e. écran du DG : solde de caisse prévisionnel négatif et « Valider » grisé sans motif de confirmation", /négatif de/.test(net(await carte.innerText())) && (await valider.isDisabled()));
  const idDecLigne = await idAction(dg, "deciderLigneDGAction");
  const sansMotif = idDecLigne ? await appelerAction(dg, idDecLigne, [L3, true]) : { succes: true, message: "" };
  verifier("5e. serveur : validation du DG sans motif de confirmation REFUSÉE (appel direct)", !sansMotif.succes && /motif/i.test(sansMotif.message) && (await ligneDe(L3)).decisionDG === null, sansMotif.message);
  await carte.locator('input[name^="motifDepassement"]').fill("Achat exceptionnel couvert par un virement attendu");
  await valider.click();
  verifier("5e. le DG valide en confirmant le dépassement dans le même geste", await attendre(async () => (await ligneDe(L3)).decisionDG === "VALIDEE"));
  verifier("5e. … confirmation tracée (UTILISE, demandeur = confirmateur = DG, motif)", ((r) => r.length === 1 && r[0].statut === "UTILISE" && r[0].confirmeParId === idDG && /virement attendu/.test(r[0].motif))(await q(`SELECT statut, motif, "confirmeParId" FROM "BudgetDepassement" WHERE "demandeId"=$1`, [D3])));
  verifier("5e. … la Finance est prévenue de l'alerte rouge confirmée", await attendre(async () => (await q(`SELECT 1 FROM "Notification" WHERE "userId"=$1 AND titre LIKE 'Alerte rouge sur un budget%'`, [idFinance])).length >= 1));
}

// ======================================================================================================================
// 6. PARCOURS, REPORTING, RIEN MONTRÉ AU DEMANDEUR, CAISSE INTACTE
// ======================================================================================================================
{
  await finance.goto(`${B}/treso/finance/demandes/${D1}`);
  const parcours = (await finance.locator("[data-parcours-budget]").allInnerTexts()).map(net);
  verifier("6. parcours de l'article (Finance) : « Solde de caisse prévisionnel » après la validation", parcours.some((t) => /Solde de caisse prévisionnel/.test(t)), parcours.join(" | ").slice(0, 300));
  const collab = await connecter("collaborateur@simassurances.test");
  await collab.goto(`${B}/treso/demandes/${D1}`);
  const texteCollab = net(await collab.locator("body").innerText());
  verifier("6. le demandeur ne voit ni solde de caisse, ni budget, ni alerte", !/solde de caisse/i.test(texteCollab) && !/budget/i.test(texteCollab) && (await collab.locator("[data-parcours-budget]").count()) === 0);
  await collab.close();

  await finance.goto(`${B}/treso/finance/reporting`);
  const ligne = finance.locator('[data-suivi-budget="global"]');
  await ligne.waitFor();
  const t = net(await ligne.innerText());
  verifier("6. reporting : ligne « Budget global (solde de caisse) » avec le solde actuel, sans consommation", /Budget global \(solde de caisse\)/.test(t) && /solde de caisse actuel/.test(t) && /—/.test(t) && new RegExp(`Orange à ${fr(seuilsGlobaux.orange)} FCFA restants`).test(t), t);
  const reponse = await finance.context().request.get(`${B}/api/treso/reporting/export`);
  verifier("6. export Excel : 200", reponse.status() === 200);
  const f = join(dossier, "reporting.xlsx");
  writeFileSync(f, await reponse.body());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(f);
  const suivi = wb.getWorksheet("Suivi budgétaire");
  const entetes = suivi.getRow(1).values.slice(1);
  let global = null;
  suivi.eachRow((row) => { if (/Budget global/.test(String(row.getCell(1).value ?? ""))) global = row.values.slice(1); });
  verifier("6. Excel « Suivi budgétaire » : ligne du budget global avec le détail du solde de caisse", !!global && entetes.includes("Détail (budget global = solde de caisse)") && /Solde de caisse actuel/.test(String(global[entetes.indexOf("Détail (budget global = solde de caisse)")] ?? "")), JSON.stringify(global));
  const reporting = wb.getWorksheet("Reporting");
  const idxBudget = reporting.getRow(1).values.indexOf("Budget après validation (reste)");
  let photo = null;
  reporting.eachRow((row) => { if (row.getCell(idxBudget).value && /Solde de caisse prévisionnel/.test(String(row.getCell(idxBudget).value))) photo = String(row.getCell(idxBudget).value); });
  verifier("6. Excel « Reporting » : colonne « Budget après validation (reste) » parle du solde de caisse prévisionnel", idxBudget > 0 && !!photo, photo ?? "");
}

await nettoyer();
const caisse1 = await journalEmpreinte();
verifier("6. aucune écriture de caisse du portail créée ni modifiée par le lot", caisse1.h === caisse0.h && caisse1.n === caisse0.n);
verifier("aucune erreur JavaScript non interceptée", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));
await db.end();
await browser.close();
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles réussis.`);
process.exit(ko ? 1 : 0);
