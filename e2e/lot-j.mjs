// Lot J (budgets) — sur base JETABLE (voir e2e/README.md). Nécessite exceljs et unzip.
// Adapté au lot J ter : le budget GLOBAL n'est plus un montant saisi (solde de caisse réel) — son cycle est testé par e2e/lot-j-ter.mjs ;
// ce script couvre les budgets de CATÉGORIE (paramétrage, validation du DG, restes, orange / rouge, confirmation).
//   1. Migration : budgets existants repris « validés par le DG », sans fin, seuil par défaut (20 % / 0 %) ; rejouée sans effet.
//   2. Paramétrage : la Finance saisit (catégorie), refus d'une saisie incohérente, soumission au DG, le DG valide ou
//      refuse (motif obligatoire), un paramétrage en attente / refusé / futur n'est jamais pris en compte, jamais modifié en place.
//   3. Validation d'une demande à 3 articles : reste global ET catégorie affichés à CHAQUE validation, ORANGE (alerte + notification
//      Finance et DG, validation permise), ROUGE (bloquée, demande de confirmation au DG, seul le DG confirme, motif tracé).
//   4. Le DG qui valide un article soumis confirme lui-même le dépassement dans le même geste (motif obligatoire).
//   5. Parcours de l'article et reporting (page + Excel) ; rien montré au demandeur ; aucune écriture de caisse touchée.
import { execFileSync } from "node:child_process";
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
const dossier = mkdtempSync(join(tmpdir(), "lotj-"));

const P = "e2e-lotj-";
const CAT1 = `${P}cat1`; // budget paramétré par l'écran (1 000 000, 20 % / 10 %)
const CAT2 = `${P}cat2`; // budget qui ne prend effet que demain
const CAT3 = `${P}cat3`; // budget de 100 000 : le DG valide un article soumis en rouge
const CAT4 = `${P}cat4`; // budget SANS seuil : aucune alerte
const CAT5 = `${P}cat5`; // aucune catégorie budgétée
const CAT6 = `${P}cat6`; // budget refusé par le DG
const CATS = [CAT1, CAT2, CAT3, CAT4, CAT5, CAT6];
const nettoyer = async () => {
  await q(`DELETE FROM "Notification" WHERE message LIKE '%DEM-LOTJ-%' OR titre LIKE '%budget%' OR titre LIKE '%Budget%'`);
  await q(`DELETE FROM "HistoriqueEntry" WHERE entity = 'BudgetParametrage' OR "entityId" LIKE '${P}%' OR detail LIKE '%DEM-LOTJ-%'`);
  await q(`DELETE FROM "BudgetDepassement" WHERE "demandeId" LIKE '${P}%'`);
  await q(`DELETE FROM "BudgetParametrage" WHERE portee = 'GLOBAL' OR "categorieId" = ANY($1)`, [CATS]);
  await q(`DELETE FROM "BudgetParametrage" WHERE id LIKE 'budget-repris-${P}%'`);
  await q(`DELETE FROM "LigneDemande" WHERE "demandeId" LIKE '${P}%'`);
  await q(`DELETE FROM "Demande" WHERE id LIKE '${P}%'`);
  await q(`DELETE FROM "Objet" WHERE "categorieId" = ANY($1)`, [CATS]);
  await q(`DELETE FROM "Categorie" WHERE id = ANY($1)`, [CATS]);
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
const journalEmpreinte = async () => (await q(`SELECT COALESCE(md5(string_agg(id || ':' || type || ':' || montant::text, ',' ORDER BY id)), '') AS h, count(*)::int AS n FROM "JournalCaisse"`))[0];

/** Identifiant d'une Server Action, lu dans les scripts client de la page (ils portent le nom de la fonction). */
async function idAction(page, nom) {
  const ressources = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name).filter((u) => u.includes("/_next/static/") && u.endsWith(".js")));
  for (const url of ressources) {
    const texte = await (await fetch(url)).text();
    const m = new RegExp(`createServerReference\\)?\\(\\s*"([0-9a-f]{20,})"[^)]*?"${nom}"`).exec(texte);
    if (m) return m[1];
  }
  return null;
}
/** Appel DIRECT d'une Server Action (sans passer par l'écran : le grisage des boutons ne protège de rien). */
async function appelerAction(page, id, args) {
  const r = await page.context().request.post(page.url(), {
    headers: { "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" },
    data: JSON.stringify(args),
  });
  const texte = await r.text();
  return { succes: /"status":"success"/.test(texte), message: /"message":"((?:[^"\\]|\\.)*)"/.exec(texte)?.[1] ?? texte.slice(0, 300) };
}

await q(`INSERT INTO "Categorie"(id, label, "isActive") VALUES ($1,'E2E-J-CAT1',true),($2,'E2E-J-CAT2',true),($3,'E2E-J-CAT3',true),($4,'E2E-J-CAT4',true),($5,'E2E-J-CAT5',true),($6,'E2E-J-CAT6',true)`, CATS);
const caisse0 = await journalEmpreinte();

// ======================================================================================================================
// 1. MIGRATION DES BUDGETS EXISTANTS
// ======================================================================================================================
{
  const sqlMigration = readFileSync(new URL("../backend/prisma/migrations/20261023090000_budgets_parametrage/migration.sql", import.meta.url), "utf8");
  await q(`INSERT INTO "Categorie"(id, label, "isActive", "budgetAlloue") VALUES ('${P}legacy','E2E-J-LEGACY',true, 777000)`);
  const sqlJter = readFileSync(new URL("../backend/prisma/migrations/20261024090000_budget_global_solde_caisse/migration.sql", import.meta.url), "utf8");
  await db.query(sqlMigration); // rejeu de la migration : doit créer la reprise de cette catégorie, sans erreur
  await db.query(sqlJter); // le lot J ter retire l'ancienne contrainte que ce rejeu vient de reposer
  const r = (await q(`SELECT * FROM "BudgetParametrage" WHERE "categorieId" = '${P}legacy'`));
  verifier("1. budget existant repris : un paramétrage VALIDÉ par le DG, sans date de fin", r.length === 1 && r[0].statut === "VALIDE" && r[0].dateFin === null && r[0].repris === true, JSON.stringify(r[0] ?? {}));
  verifier("1. … montant conservé, début « depuis toujours » (2000-01-01), pas d'auteur", Number(r[0]?.montant) === 777000 && r[0]?.dateDebut.toISOString().slice(0, 10) === "2000-01-01" && r[0]?.soumisParId === null);
  verifier("1. … seuil par défaut documenté : pourcentage restant, orange 20, rouge 0", r[0]?.modeSeuil === "POURCENTAGE" && Number(r[0]?.seuilOrange) === 20 && Number(r[0]?.seuilRouge) === 0);
  await db.query(sqlMigration);
  await db.query(sqlJter);
  verifier("1. migration rejouée : aucun doublon", (await q(`SELECT count(*)::int AS n FROM "BudgetParametrage" WHERE "categorieId" = '${P}legacy'`))[0].n === 1);
  const perm = await q(`SELECT r.name FROM "RolePermission" rp JOIN "Permission" p ON p.id = rp."permissionId" JOIN "Role" r ON r.id = rp."roleId" WHERE p.key = 'treso.valider_budget'`);
  verifier("1. permission treso.valider_budget : le DG seul", perm.length === 1 && /dg/i.test(perm[0].name), JSON.stringify(perm));
  const aussi = await q(`SELECT r.name FROM "RolePermission" rp JOIN "Permission" p ON p.id = rp."permissionId" JOIN "Role" r ON r.id = rp."roleId" WHERE p.key = 'treso.modifier_budget_categorie'`);
  verifier("1. paramétrer (treso.modifier_budget_categorie) : la Finance, pas le DG", aussi.some((x) => /finance/i.test(x.name)) && !aussi.some((x) => /^dg$/i.test(x.name)), JSON.stringify(aussi));
  await q(`DELETE FROM "BudgetParametrage" WHERE "categorieId" = '${P}legacy'`);
  await q(`DELETE FROM "Categorie" WHERE id = '${P}legacy'`);
}

// ======================================================================================================================
// 2. PARAMÉTRAGE PAR LA FINANCE, VALIDATION PAR LE DG
// ======================================================================================================================
const finance = await connecter("finance@simassurances.test");
const dg = await connecter("dg@simassurances.test");
const nbParam = async () => (await q(`SELECT count(*)::int AS n FROM "BudgetParametrage" WHERE "categorieId" = ANY($1) OR portee = 'GLOBAL'`, [CATS]))[0].n;
async function soumettre(page, { categorie, libelle, montant, debut, fin, mode, orange, rouge }) {
  await page.goto(`${B}/treso/finance/budgets`);
  const form = page.locator("[data-parametrage-budget-form]");
  const ligne = form.locator(`[data-budget-ligne-saisie="${libelle}"]`);
  await form.locator('input[name="dateDebut"]').fill(debut ?? jourIso(0));
  await form.locator('input[name="dateFin"]').fill(fin ?? "");
  await ligne.locator(`input[name="montant-${categorie}"]`).fill(String(montant));
  await ligne.locator(`select[name="mode-${categorie}"]`).selectOption(mode ?? "AUCUN");
  if (mode && mode !== "AUCUN") {
    await ligne.locator(`input[name="orange-${categorie}"]`).fill(String(orange));
    await ligne.locator(`input[name="rouge-${categorie}"]`).fill(String(rouge));
  }
  await form.locator("[data-soumettre-selection]").click();
}
async function decider(page, id, valider, motif) {
  await page.goto(`${B}/treso/finance/budgets`);
  const bloc = page.locator(`[data-parametrage-attente="${id}"]`);
  if (valider) await bloc.locator("[data-valider-parametrage]").click();
  else {
    await bloc.locator("[data-refuser-parametrage]").click();
    const confirmer = bloc.locator("[data-confirmer-refus]");
    verifier("2. refus : « Confirmer le refus » grisé tant que le motif est vide", await confirmer.isDisabled());
    await bloc.locator('input[name="motifRefus"]').fill(motif);
    await confirmer.click();
  }
}

{
  const avant = await nbParam();
  // 2a. Saisie incohérente refusée (rouge ≥ orange) : rien n'est créé.
  await soumettre(finance, { categorie: CAT1, libelle: "E2E-J-CAT1", montant: 1000000, mode: "POURCENTAGE", orange: 10, rouge: 20 });
  verifier("2a. saisie incohérente (rouge ≥ orange) : message d'erreur, aucun paramétrage créé", (await attendre(async () => /strictement plus bas/.test(net(await finance.locator("[data-parametrage-budget-form]").innerText())))) && (await nbParam()) === avant);

  // 2b. Saisie correcte : EN_ATTENTE, historisée, le DG est prévenu, pas encore en vigueur.
  await soumettre(finance, { categorie: CAT1, libelle: "E2E-J-CAT1", montant: 1000000, mode: "POURCENTAGE", orange: 20, rouge: 10 });
  verifier("2b. paramétrage de la catégorie soumis : EN_ATTENTE", await attendre(async () => (await q(`SELECT statut FROM "BudgetParametrage" WHERE "categorieId" = $1`, [CAT1]))[0]?.statut === "EN_ATTENTE"));
  const p1 = (await q(`SELECT * FROM "BudgetParametrage" WHERE "categorieId" = $1`, [CAT1]))[0];
  verifier("2b. … soumis par la Finance, début aujourd'hui, seuils 20 / 10 en pourcentage", p1.soumisParId === idFinance && p1.dateDebut.toISOString().slice(0, 10) === jourIso(0) && p1.modeSeuil === "POURCENTAGE" && Number(p1.seuilOrange) === 20 && Number(p1.seuilRouge) === 10);
  verifier("2b. … historisé et le DG est notifié", (await q(`SELECT 1 FROM "HistoriqueEntry" WHERE entity='BudgetParametrage' AND "entityId"=$1 AND action='budget_soumis'`, [p1.id])).length === 1 && (await attendre(async () => (await q(`SELECT 1 FROM "Notification" WHERE "userId"=$1 AND titre='Budget à valider'`, [idDG])).length >= 1)));
  await finance.goto(`${B}/treso/finance/budgets`);
  verifier("2b. pas encore en vigueur : absent de « Budgets en vigueur »", (await finance.locator('[data-budget-ligne="E2E-J-CAT1"]').count()) === 0);
  verifier("2b. un second paramétrage est refusé tant que le premier attend le DG (écran : ligne désactivée ; serveur : refus par appel direct)", await (async () => {
    await finance.goto(`${B}/treso/finance/budgets`);
    const ligneDesactivee = await finance.locator('[data-budget-ligne-saisie="E2E-J-CAT1"] input[type="checkbox"]').isDisabled();
    const idSoumettre = await idAction(finance, "soumettreParametragesBudgetAction");
    const refus = idSoumettre ? await appelerAction(finance, idSoumettre, [[{ portee: "CATEGORIE", categorieId: CAT1, montant: 5, dateDebut: jourIso(0), dateFin: null, seuil: null }]]) : { succes: true, message: "" };
    return ligneDesactivee && !refus.succes && /déjà en attente/.test(refus.message) && (await nbParam()) === avant + 1;
  })());

  // 2c. Droits : la Finance ne décide pas ; le DG ne paramètre pas.
  await dg.goto(`${B}/treso/finance/budgets`);
  const idDecider = await idAction(dg, "deciderParametragesBudgetAction");
  verifier("2c. identifiant de deciderParametragesBudgetAction retrouvé", !!idDecider);
  if (idDecider) {
    await finance.goto(`${B}/treso/finance/budgets`);
    const refus = await appelerAction(finance, idDecider, [[{ id: p1.id }], true]);
    verifier("2c. la Finance ne peut pas valider (appel direct refusé)", !refus.succes && /non autoris/i.test(refus.message) && (await q(`SELECT statut FROM "BudgetParametrage" WHERE id=$1`, [p1.id]))[0].statut === "EN_ATTENTE", refus.message);
  }
  verifier("2c. le DG n'a pas le formulaire de paramétrage", (await dg.locator("[data-parametrage-budget-form]").count()) === 0 && (await dg.locator("[data-parametrage-attente]").count()) >= 1);
  verifier("2c. la Finance n'a pas les boutons Valider / Refuser", (await finance.locator("[data-valider-parametrage]").count()) === 0);

  // 2d. Le DG REFUSE (motif obligatoire) un budget de catégorie.
  await soumettre(finance, { categorie: CAT6, libelle: "E2E-J-CAT6", montant: 999, mode: "AUCUN" });
  await attendre(async () => (await q(`SELECT 1 FROM "BudgetParametrage" WHERE "categorieId"=$1`, [CAT6])).length === 1);
  const pg1 = (await q(`SELECT id FROM "BudgetParametrage" WHERE "categorieId"=$1`, [CAT6]))[0];
  await decider(dg, pg1.id, false, "Montant trop bas pour l'exercice");
  verifier("2d. le DG refuse avec motif : REFUSE, motif conservé, décideur tracé", await attendre(async () => (await q(`SELECT statut, "motifRefus", "decideParId" FROM "BudgetParametrage" WHERE id=$1`, [pg1.id]))[0].statut === "REFUSE"));
  const refuse = (await q(`SELECT "motifRefus", "decideParId" FROM "BudgetParametrage" WHERE id=$1`, [pg1.id]))[0];
  verifier("2d. … motif et décideur", /trop bas/.test(refuse.motifRefus) && refuse.decideParId === idDG);
  verifier("2d. … la Finance est notifiée du refus", await attendre(async () => (await q(`SELECT 1 FROM "Notification" WHERE "userId"=$1 AND titre='Budget refusé par le DG'`, [idFinance])).length >= 1));
  await soumettre(finance, { categorie: CAT6, libelle: "E2E-J-CAT6", montant: 1999, mode: "AUCUN" });
  await attendre(async () => (await q(`SELECT 1 FROM "BudgetParametrage" WHERE "categorieId"=$1 AND statut='EN_ATTENTE'`, [CAT6])).length === 1);
  verifier("2d. le paramétrage refusé n'est pas modifié : une NOUVELLE ligne a été créée", (await q(`SELECT statut FROM "BudgetParametrage" WHERE id=$1`, [pg1.id]))[0].statut === "REFUSE" && (await q(`SELECT count(*)::int AS n FROM "BudgetParametrage" WHERE "categorieId"=$1`, [CAT6]))[0].n === 2);

  // 2e. Le DG valide le budget de la catégorie.
  await decider(dg, p1.id, true);
  verifier("2e. le DG valide le budget de la catégorie : VALIDE", await attendre(async () => (await q(`SELECT statut FROM "BudgetParametrage" WHERE id=$1`, [p1.id]))[0].statut === "VALIDE"));
  verifier("2e. validation et refus historisés (auteur DG)", (await q(`SELECT count(*)::int AS n FROM "HistoriqueEntry" WHERE entity='BudgetParametrage' AND "userId"=$1 AND action IN ('budget_valide','budget_refuse')`, [idDG]))[0].n === 2);
  await finance.goto(`${B}/treso/finance/budgets`);
  const ligneCat1 = net(await finance.locator('[data-budget-ligne="E2E-J-CAT1"]').innerText());
  verifier("2e. « Budgets en vigueur » : catégorie (1 000 000, seuils 20 % / 10 %) et budget global = solde de caisse", /1 000 000 FCFA/.test(ligneCat1) && /20 % restants/.test(ligneCat1) && /10 % restants/.test(ligneCat1) && (await finance.locator('[data-budget-ligne="global"]').count()) === 1, ligneCat1);

  // 2f. Date d'effet : un budget qui commence demain n'est pas pris en compte aujourd'hui.
  await soumettre(finance, { categorie: CAT2, libelle: "E2E-J-CAT2", montant: 500000, debut: jourIso(1), mode: "POURCENTAGE", orange: 30, rouge: 5 });
  await attendre(async () => (await q(`SELECT 1 FROM "BudgetParametrage" WHERE "categorieId"=$1`, [CAT2])).length === 1);
  const p2 = (await q(`SELECT id FROM "BudgetParametrage" WHERE "categorieId"=$1`, [CAT2]))[0];
  await decider(dg, p2.id, true);
  await attendre(async () => (await q(`SELECT statut FROM "BudgetParametrage" WHERE id=$1`, [p2.id]))[0].statut === "VALIDE");
  await finance.goto(`${B}/treso/finance/budgets`);
  verifier("2f. budget validé mais qui commence demain : pas « en vigueur » aujourd'hui, présent dans l'historique", (await finance.locator('[data-budget-ligne="E2E-J-CAT2"]').count()) === 0 && (await finance.locator(`[data-parametrage="${p2.id}"]`).count()) === 1);
  const nouveauDebut = await finance.locator('input[name="dateDebut"]').getAttribute("min");
  verifier("2f. le champ date de début interdit le passé (min = aujourd'hui)", nouveauDebut === jourIso(0));

  // Budgets de test posés directement : CAT3 (100 000, 20 % / 10 %), CAT4 (50 000 sans seuil).
  await q(`INSERT INTO "BudgetParametrage"(id, portee, "categorieId", montant, "dateDebut", "modeSeuil", "seuilOrange", "seuilRouge", statut, "decideParId", "decideAt") VALUES ('${P}b3','CATEGORIE',$1,100000, current_date,'POURCENTAGE',20,10,'VALIDE',$3,now()), ('${P}b4','CATEGORIE',$2,50000, current_date,NULL,NULL,NULL,'VALIDE',$3,now())`, [CAT3, CAT4, idDG]);
}

// ======================================================================================================================
// 3. VALIDATION D'UNE DEMANDE À 3 ARTICLES : RESTES, ORANGE, ROUGE, CONFIRMATION DU DG
// ======================================================================================================================
async function demande(suffixe, numero, articles, extra = {}) {
  const D = `${P}${suffixe}`;
  const total = articles.reduce((s, a) => s + a.montant, 0);
  await q(
    `INSERT INTO "Demande"(id, reference, montant, "montantValide", statut, "createurId", "updatedAt", "beneficiaireType", "beneficiaireUserId", "etapeCircuit", "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", description, "typeDemande", "categorieId")
     VALUES ($1, $2, $3, 0, 'EN_ATTENTE_VALIDATION', $4, now(), 'COLLABORATEUR', $4, 'FINANCE', true, false, 'OPTIONNELLE', 'test e2e lot J', $5, $6)`,
    [D, `DEM-LOTJ-${numero}`, total, idCollab, extra.typeDemande ?? "STANDARD", extra.categorieId ?? null]
  );
  for (const [i, a] of articles.entries()) {
    await q(`INSERT INTO "LigneDemande"(id, libelle, "libelleOriginal", quantite, "prixUnitaire", "demandeId", motif, "categorieId") VALUES ($1,$2,$2,1,$3,$4,'motif e2e',$5)`, [`${D}-l${i + 1}`, a.libelle, a.montant, D, a.categorie]);
  }
  return D;
}
const lignes = async (D) => q(`SELECT id, libelle, "statutValidation", "budgetApresValidation", "decideurFinanceId" FROM "LigneDemande" WHERE "demandeId" = $1 ORDER BY id`, [D]);
const idValider = async (page) => idAction(page, "validerLignesAction");
async function cocherValider(page, L) {
  await page.locator(`[data-ligne-card="${L}"]`).getByRole("button", { name: "Valider", exact: true }).click();
}

let D1;
{
  D1 = await demande("D1", 1, [
    { libelle: "Article A", montant: 600000, categorie: CAT1 },
    { libelle: "Article B", montant: 200000, categorie: CAT1 },
    { libelle: "Article C", montant: 150000, categorie: CAT1 },
  ]);
  const [A, Bb, C] = [`${D1}-l1`, `${D1}-l2`, `${D1}-l3`];
  await finance.goto(`${B}/treso/finance/demandes/${D1}`);

  // 3a. Article A : reste global ET catégorie affichés AVANT d'enregistrer (prévisionnel), aucun niveau d'alerte.
  await cocherValider(finance, A);
  const bloc = finance.locator("[data-budget-bloc]");
  await bloc.waitFor();
  const texteA = net(await bloc.innerText());
  verifier("3a. reste du budget GLOBAL et de la CATÉGORIE affichés à la validation", (await bloc.locator('[data-budget-prevision="global"]').count()) === 1 && (await bloc.locator('[data-budget-prevision="categorie"]').count()) === 1, texteA);
  verifier("3a. catégorie : reste 400 000 FCFA après cette validation (40 %), niveau « Dans la limite »", /E2E-J-CAT1.*reste 400 000 FCFA.*40 %/.test(texteA) && (await bloc.getAttribute("data-niveau-budget")) === "AUCUN", texteA);
  verifier("3a. avant l'enregistrement : rien n'est écrit (article toujours en attente)", (await lignes(D1)).find((l) => l.id === A).statutValidation === "EN_ATTENTE");
  await finance.getByRole("button", { name: /Enregistrer les décisions/ }).click();
  verifier("3a. A validé (sous les seuils)", await attendre(async () => (await lignes(D1)).find((l) => l.id === A).statutValidation === "VALIDEE"));
  verifier("3a. … photo du budget conservée sur l'article (reste catégorie 400 000)", Number((await lignes(D1)).find((l) => l.id === A).budgetApresValidation?.categorie?.resteApres) === 400000);
  verifier("3a. … aucune notification d'alerte, aucune entrée alerte_budget", (await q(`SELECT 1 FROM "HistoriqueEntry" WHERE action='alerte_budget' AND "entityId"=$1`, [D1])).length === 0);

  // 3b. Article B : ORANGE — alerte visible, validation permise, notifications Finance et DG.
  await finance.goto(`${B}/treso/finance/demandes/${D1}`);
  await cocherValider(finance, Bb);
  await finance.locator("[data-budget-bloc]").waitFor();
  verifier("3b. ORANGE : alerte visible, reste catégorie 200 000 FCFA (20 %)", (await finance.locator('[data-alerte-budget="ORANGE"]').count()) === 1 && /reste 200 000 FCFA/.test(net(await finance.locator("[data-budget-bloc]").innerText())));
  verifier("3b. ORANGE : « Enregistrer » reste possible", await finance.getByRole("button", { name: /Enregistrer les décisions/ }).isEnabled());
  await finance.getByRole("button", { name: /Enregistrer les décisions/ }).click();
  verifier("3b. B validé malgré l'alerte orange", await attendre(async () => (await lignes(D1)).find((l) => l.id === Bb).statutValidation === "VALIDEE"));
  verifier("3b. … alerte tracée dans l'historique de la demande", (await q(`SELECT detail FROM "HistoriqueEntry" WHERE action='alerte_budget' AND "entityId"=$1`, [D1])).length === 1);
  verifier("3b. … le DG est notifié (alerte orange)", await attendre(async () => (await q(`SELECT 1 FROM "Notification" WHERE "userId"=$1 AND titre='Alerte orange sur un budget' AND message LIKE '%DEM-LOTJ-1%'`, [idDG])).length === 1));
  verifier("3b. … l'auteur de la validation (Finance) n'est pas notifié de sa propre action", (await q(`SELECT 1 FROM "Notification" WHERE "userId"=$1 AND titre='Alerte orange sur un budget'`, [idFinance])).length === 0);
  const autresFinance = await q(`SELECT DISTINCT u.id FROM "User" u JOIN "RolePermission" rp ON rp."roleId" = u."roleId" JOIN "Permission" p ON p.id = rp."permissionId" WHERE p.key = 'treso.decider_finance' AND u."isActive" AND u.id <> $1`, [idFinance]);
  verifier("3b. … la Finance (autres comptes porteurs de decider_finance) est notifiée", autresFinance.length === 0 || (await q(`SELECT 1 FROM "Notification" WHERE "userId" = ANY($1) AND titre='Alerte orange sur un budget'`, [autresFinance.map((x) => x.id)])).length >= 1, `${autresFinance.length} autre(s) compte(s)`);

  // 3c. Article C : ROUGE — bloqué, demande de confirmation au DG, seul le DG confirme.
  await finance.goto(`${B}/treso/finance/demandes/${D1}`);
  const idVal = await idValider(finance);
  await cocherValider(finance, C);
  await finance.locator("[data-budget-bloc]").waitFor();
  verifier("3c. ROUGE : alerte rouge affichée, reste catégorie 50 000 FCFA (5 %)", (await finance.locator('[data-alerte-budget="ROUGE"]').count()) === 1 && /reste 50 000 FCFA/.test(net(await finance.locator("[data-budget-bloc]").innerText())));
  verifier("3c. ROUGE : « Enregistrer » GRISÉ pour la Finance et bouton « Demander la confirmation du DG »", (await finance.getByRole("button", { name: /Enregistrer les décisions/ }).isDisabled()) && (await finance.locator("[data-demander-confirmation-dg]").isEnabled()));
  verifier("3c. ROUGE : la Finance n'a PAS de champ de confirmation du dépassement", (await finance.locator('input[name="motifDepassement"]').count()) === 0);
  const refus = idVal ? await appelerAction(finance, idVal, [D1, [{ ligneId: C, statut: "VALIDEE" }]]) : { succes: true, message: "" };
  verifier("3c. serveur : validation de C REFUSÉE par appel direct (blocage rouge, confirmation du DG demandée)", !refus.succes && /seuil rouge/i.test(refus.message) && /DG/.test(refus.message) && (await lignes(D1)).find((l) => l.id === C).statutValidation === "EN_ATTENTE", refus.message);
  const refusMotif = idVal ? await appelerAction(finance, idVal, [D1, [{ ligneId: C, statut: "VALIDEE" }], "Je confirme moi-même ce dépassement"]) : { succes: true, message: "" };
  verifier("3c. serveur : un motif saisi par la Finance ne débloque rien (seul le DG confirme)", !refusMotif.succes && (await lignes(D1)).find((l) => l.id === C).statutValidation === "EN_ATTENTE", refusMotif.message);
  await finance.locator("[data-demander-confirmation-dg]").click();
  verifier("3c. demande de confirmation enregistrée (statut DEMANDE, photo du dépassement)", await attendre(async () => (await q(`SELECT statut, resume FROM "BudgetDepassement" WHERE "demandeId"=$1`, [D1])).length === 1 && /ROUGE/.test((await q(`SELECT resume FROM "BudgetDepassement" WHERE "demandeId"=$1`, [D1]))[0].resume)));
  verifier("3c. … le DG est notifié de la demande", await attendre(async () => (await q(`SELECT 1 FROM "Notification" WHERE "userId"=$1 AND titre='Confirmation de dépassement de budget demandée'`, [idDG])).length === 1));
  await finance.reload();
  await cocherValider(finance, C);
  verifier("3c. après la demande : la Finance reste bloquée (« en attente »)", (await finance.getByRole("button", { name: /Enregistrer les décisions/ }).isDisabled()) && /en attente/.test(net(await finance.locator("[data-demander-confirmation-dg]").innerText())));

  // 3d. Le DG confirme avec un motif (10 caractères minimum), tracé ; la Finance peut alors valider.
  await dg.goto(`${B}/treso/finance/budgets`);
  const bd = dg.locator("[data-depassement]").first();
  verifier("3d. le DG voit la demande de confirmation (référence, résumé)", /DEM-LOTJ-1/.test(net(await bd.innerText())) && /ROUGE/.test(net(await bd.innerText())));
  const confirmer = bd.getByRole("button", { name: "Confirmer le dépassement" });
  verifier("3d. « Confirmer » grisé sans motif suffisant", await confirmer.isDisabled());
  await bd.locator('input[name="motifDepassement"]').fill("court");
  verifier("3d. … et avec un motif de 5 caractères", await confirmer.isDisabled());
  const idConfirmer = await idAction(dg, "confirmerDepassementBudgetAction");
  await finance.goto(`${B}/treso/finance/budgets`);
  if (idConfirmer) {
    const refuse2 = await appelerAction(finance, idConfirmer, [(await q(`SELECT id FROM "BudgetDepassement" WHERE "demandeId"=$1`, [D1]))[0].id, "Motif écrit par la Finance"]);
    verifier("3d. la Finance ne peut pas confirmer un dépassement (appel direct refusé)", !refuse2.succes && /non autoris/i.test(refuse2.message) && (await q(`SELECT statut FROM "BudgetDepassement" WHERE "demandeId"=$1`, [D1]))[0].statut === "DEMANDE", refuse2.message);
  }
  await bd.locator('input[name="motifDepassement"]').fill("Achat urgent validé en comité de direction");
  await confirmer.click();
  verifier("3d. le DG confirme : statut CONFIRME, motif et confirmateur tracés", await attendre(async () => (await q(`SELECT statut, motif, "confirmeParId" FROM "BudgetDepassement" WHERE "demandeId"=$1`, [D1]))[0]?.statut === "CONFIRME"));
  const dep = (await q(`SELECT motif, "confirmeParId" FROM "BudgetDepassement" WHERE "demandeId"=$1`, [D1]))[0];
  verifier("3d. … motif conservé, confirmateur = DG", /comité de direction/.test(dep.motif) && dep.confirmeParId === idDG);
  verifier("3d. … la Finance qui l'avait demandé est notifiée", await attendre(async () => (await q(`SELECT 1 FROM "Notification" WHERE "userId"=$1 AND titre='Dépassement de budget confirmé par le DG'`, [idFinance])).length === 1));

  await finance.goto(`${B}/treso/finance/demandes/${D1}`);
  await cocherValider(finance, C);
  verifier("3d. la Finance voit « Le DG a confirmé le dépassement » et « Enregistrer » est dégrisé", /Le DG a confirmé le dépassement/.test(net(await finance.locator('[data-alerte-budget="ROUGE"]').innerText())) && (await finance.getByRole("button", { name: /Enregistrer les décisions/ }).isEnabled()));
  await finance.getByRole("button", { name: /Enregistrer les décisions/ }).click();
  verifier("3d. C est validé grâce à la confirmation du DG", await attendre(async () => (await lignes(D1)).find((l) => l.id === C).statutValidation === "VALIDEE"));
  verifier("3d. la confirmation est consommée (UTILISE, usage unique)", (await q(`SELECT statut, "utiliseAt" FROM "BudgetDepassement" WHERE "demandeId"=$1`, [D1]))[0].statut === "UTILISE");
  verifier("3d. historique : demande, confirmation et utilisation tracées", (await q(`SELECT action FROM "HistoriqueEntry" WHERE "entityId"=$1 AND action IN ('demande_confirmation_depassement','confirmation_depassement_budget','depassement_budget_utilise')`, [D1])).length === 3);
  verifier("3d. photo du budget de C : niveau ROUGE, reste 50 000", ((s) => s?.niveau === "ROUGE" && Number(s?.categorie?.resteApres) === 50000)((await lignes(D1)).find((l) => l.id === C).budgetApresValidation));

  // 3e. Parcours, historique et pages : Finance et DG voient le budget ; le demandeur ne voit rien.
  await finance.goto(`${B}/treso/finance/demandes/${D1}`);
  const parcoursC = net(await finance.locator(`[data-ligne-card="${C}"]`).innerText());
  const parcoursFin = await finance.locator("[data-parcours-budget]").allInnerTexts();
  verifier("3e. parcours de l'article (Finance) : « Budget après la validation de cet article » avec le reste catégorie", parcoursFin.length >= 3 && parcoursFin.some((t) => /reste 50 000 FCFA/.test(net(t)) && /alerte rouge/i.test(net(t))), parcoursC.slice(0, 300));
  const collab = await connecter("collaborateur@simassurances.test");
  await collab.goto(`${B}/treso/demandes/${D1}`);
  const texteCollab = net(await collab.locator("body").innerText());
  verifier("3e. le demandeur ne voit ni budget, ni alerte, ni confirmation (parcours et historique)", !/budget/i.test(texteCollab.replace(/E2E-J-CAT1/g, "")) && !/dépassement/i.test(texteCollab) && (await collab.locator("[data-parcours-budget]").count()) === 0);
  await collab.close();

  // 3f. Budget SANS seuil : aucune alerte, même au-delà du budget.
  const D4 = await demande("D4", 4, [{ libelle: "Article sans seuil", montant: 80000, categorie: CAT4 }]);
  await finance.goto(`${B}/treso/finance/demandes/${D4}`);
  await cocherValider(finance, `${D4}-l1`);
  await finance.locator("[data-budget-bloc]").waitFor();
  verifier("3f. budget sans seuil : reste négatif affiché (dépassé de 30 000 FCFA) mais AUCUNE alerte", (await finance.locator("[data-alerte-budget]").count()) === 0 && /dépassé de 30 000 FCFA/.test(net(await finance.locator("[data-budget-bloc]").innerText())));
  await finance.getByRole("button", { name: /Enregistrer les décisions/ }).click();
  verifier("3f. … et la validation passe", await attendre(async () => (await lignes(D4))[0].statutValidation === "VALIDEE"));

  // 3g. Le budget GLOBAL (solde de caisse réel, sans seuil validé ici) s'affiche mais n'alerte jamais — son cycle est dans e2e/lot-j-ter.mjs.
  const D5 = await demande("D5", 5, [{ libelle: "Article hors budget", montant: 1950000, categorie: CAT5 }]);
  await finance.goto(`${B}/treso/finance/demandes/${D5}`);
  await cocherValider(finance, `${D5}-l1`);
  await finance.locator("[data-budget-bloc]").waitFor();
  verifier("3g. sans seuil global validé : le solde de caisse prévisionnel s'affiche, jamais d'alerte", (await finance.locator('[data-budget-prevision="global"]').count()) === 1 && (await finance.locator("[data-alerte-budget]").count()) === 0);
  await q(`DELETE FROM "LigneDemande" WHERE "demandeId" = '${D5}'`);
  await q(`DELETE FROM "Demande" WHERE id = '${D5}'`);
}

// ======================================================================================================================
// 4. LE DG QUI VALIDE CONFIRME LUI-MÊME, DANS LE MÊME GESTE
// ======================================================================================================================
{
  const D2 = await demande("D2", 2, [{ libelle: "Article DG", montant: 95000, categorie: CAT3 }]);
  const L = `${D2}-l1`;
  await finance.goto(`${B}/treso/finance/demandes/${D2}`);
  await finance.locator(`[data-soumettre-article="${L}"]`).click();
  verifier("4. la Finance soumet l'article au DG", await attendre(async () => (await q(`SELECT "soumiseAuDG" FROM "LigneDemande" WHERE id=$1`, [L]))[0].soumiseAuDG === true));
  await dg.goto(`${B}/treso/dg/${D2}`);
  const carte = dg.locator("[data-ligne-dg]").first();
  await carte.waitFor();
  const valider = carte.getByRole("button", { name: "Valider", exact: true });
  verifier("4. écran du DG : reste après la validation de CET article (5 000 FCFA, 5 %) et alerte rouge", /reste 5 000 FCFA/.test(net(await carte.innerText())) && (await carte.locator('[data-alerte-budget="ROUGE"]').count()) === 1);
  verifier("4. écran du DG : « Valider » grisé tant que le motif de confirmation manque", await valider.isDisabled());
  await carte.locator('input[name^="motifDepassement"]').fill("court");
  verifier("4. … et avec un motif de 5 caractères", await valider.isDisabled());
  const idDecLigne = await idAction(dg, "deciderLigneDGAction");
  if (idDecLigne) {
    const sansMotif = await appelerAction(dg, idDecLigne, [L, true]);
    verifier("4. serveur : validation du DG sans motif de confirmation REFUSÉE (appel direct)", !sansMotif.succes && /motif/i.test(sansMotif.message) && (await q(`SELECT "decisionDG" FROM "LigneDemande" WHERE id=$1`, [L]))[0].decisionDG === null, sansMotif.message);
  }
  await carte.locator('input[name^="motifDepassement"]').fill("Dépense stratégique approuvée par la direction");
  await valider.click();
  verifier("4. le DG valide en confirmant le dépassement dans le même geste", await attendre(async () => (await q(`SELECT "decisionDG" FROM "LigneDemande" WHERE id=$1`, [L]))[0].decisionDG === "VALIDEE"));
  const dep2 = await q(`SELECT statut, motif, "confirmeParId", "demandeParId" FROM "BudgetDepassement" WHERE "demandeId"=$1`, [D2]);
  verifier("4. … confirmation tracée d'emblée UTILISE (DG = demandeur = confirmateur, motif)", dep2.length === 1 && dep2[0].statut === "UTILISE" && dep2[0].confirmeParId === idDG && dep2[0].demandeParId === idDG && /stratégique/.test(dep2[0].motif));
  verifier("4. … historique : confirmation_depassement_budget", (await q(`SELECT 1 FROM "HistoriqueEntry" WHERE action='confirmation_depassement_budget' AND "entityId"=$1`, [D2])).length === 1);
  verifier("4. … photo du budget conservée sur l'article (ROUGE, reste 5 000)", ((s) => s?.niveau === "ROUGE" && Number(s?.categorie?.resteApres) === 5000)((await q(`SELECT "budgetApresValidation" AS s FROM "LigneDemande" WHERE id=$1`, [L]))[0].s));
  verifier("4. … la Finance est prévenue de l'alerte rouge confirmée", await attendre(async () => (await q(`SELECT 1 FROM "Notification" WHERE "userId"=$1 AND titre LIKE 'Alerte rouge sur un budget%'`, [idFinance])).length >= 1));
  // La Finance confirme ensuite l'article validé par le DG : aucune nouvelle confirmation n'est exigée.
  await finance.goto(`${B}/treso/finance/demandes/${D2}`);
  await finance.locator(`[data-ligne-card="${L}"]`).getByRole("button", { name: /Confirmer la validation/ }).click();
  verifier("4. la Finance confirme l'article déjà validé par le DG : pas de nouvelle alerte (déjà engagé)", (await finance.locator("[data-alerte-budget]").count()) === 0 && (await finance.getByRole("button", { name: /Enregistrer les décisions/ }).isEnabled()));
  await finance.getByRole("button", { name: /Enregistrer les décisions/ }).click();
  verifier("4. … et l'article passe à VALIDEE sans second blocage", await attendre(async () => (await q(`SELECT "statutValidation" FROM "LigneDemande" WHERE id=$1`, [L]))[0].statutValidation === "VALIDEE"));
  verifier("4. … la photo du budget n'est pas recalculée (toujours reste 5 000)", Number((await q(`SELECT "budgetApresValidation"->'categorie'->>'resteApres' AS r FROM "LigneDemande" WHERE id=$1`, [L]))[0].r) === 5000);
}

// ======================================================================================================================
// 5. REPORTING (page + Excel) ET RIEN DE TOUCHÉ EN CAISSE
// ======================================================================================================================
{
  await finance.goto(`${B}/treso/finance/reporting`);
  const ligne = finance.locator('[data-suivi-budget="E2E-J-CAT1"]');
  await ligne.waitFor();
  const t = net(await ligne.innerText());
  verifier("5. reporting : suivi budgétaire avec période, reste après validations (50 000) et niveau rouge", /50 000 FCFA/.test(t) && (await ligne.locator('[data-niveau-budget="ROUGE"]').count()) === 1 && /à partir du/.test(t), t);
  verifier("5. reporting : le budget global figure en tête du suivi", (await finance.locator('[data-suivi-budget="global"]').count()) === 1);
  const reponse = await finance.context().request.get(`${B}/api/treso/reporting/export`);
  verifier("5. export Excel : 200", reponse.status() === 200);
  const f = join(dossier, "reporting.xlsx");
  writeFileSync(f, await reponse.body());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(f);
  const suivi = wb.getWorksheet("Suivi budgétaire");
  const entetes = suivi.getRow(1).values.slice(1);
  verifier("5. Excel « Suivi budgétaire » : colonnes période, reste après validations, seuils, niveau", ["Période", "Reste après validations (FCFA)", "Seuils d'alerte", "Niveau"].every((h) => entetes.includes(h)), JSON.stringify(entetes));
  let trouve = null;
  suivi.eachRow((row) => { if (row.getCell(1).value === "E2E-J-CAT1") trouve = row.values.slice(1); });
  verifier("5. Excel : ligne E2E-J-CAT1 (reste 50 000, niveau Alerte rouge)", !!trouve && trouve.includes(50000) && trouve.includes("Alerte rouge"), JSON.stringify(trouve));
  const reporting = wb.getWorksheet("Reporting");
  const idxBudget = reporting.getRow(1).values.indexOf("Budget après validation (reste)");
  let budgetC = null;
  reporting.eachRow((row) => { if (row.getCell(idxBudget).value && /E2E-J-CAT1/.test(String(row.getCell(idxBudget).value)) && /alerte rouge/.test(String(row.getCell(idxBudget).value))) budgetC = String(row.getCell(idxBudget).value); });
  verifier("5. Excel « Reporting » : colonne « Budget après validation (reste) » sur les lignes ARTICLE", idxBudget > 0 && !!budgetC, budgetC ?? "");
  const caisse1 = await journalEmpreinte();
  verifier("5. aucune écriture de caisse créée ni modifiée par le lot", caisse1.h === caisse0.h && caisse1.n === caisse0.n);
}

verifier("aucune erreur JavaScript non interceptée", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));
await nettoyer();
await db.end();
await browser.close();
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles réussis.`);
process.exit(ko ? 1 : 0);
