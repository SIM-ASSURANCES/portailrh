// Autonomie des articles, lot D (2026-10-16) — RÈGLEMENT PAR ARTICLE, sur base JETABLE (voir e2e/README.md).
//
// Scénario principal : demande à 3 articles (A, B validés, C en attente). On règle A seul (plafond de l'article, pas
// du pot commun), puis B avec SON bénéficiaire ; C reste en attente et le budget n'est consommé que pour les articles
// réglés. Puis : parcours de l'article (badges, étapes atteintes seulement) sur les écrans Finance et collaborateur,
// retour de caisse affiché en lecture, garde 8 PAR ARTICLE (côté écran et côté serveur), règlements antérieurs non
// rattachés (blocage, script de rattachement), documents PDF (article + rappel de la demande).
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import pg from "pg";
import { assurerSignatures } from "./signatures-auto.mjs";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

// --- Données de test (idempotentes) ---------------------------------------------------------------------------------
const PREFIXE = "e2e-lotd-";
const nettoyer = async () => {
  await q(`DELETE FROM "HistoriqueEntry" WHERE "entityId" LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "DepenseLigne" WHERE "retourCaisseId" LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "RetourCaisse" WHERE id LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "JournalCaisse" WHERE "demandeId" LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "JournalBanque" WHERE "reglementId" IN (SELECT id FROM "Reglement" WHERE "demandeId" LIKE '${PREFIXE}%')`);
  await q(`DELETE FROM "ReglementCategorieAllocation" WHERE "reglementId" IN (SELECT id FROM "Reglement" WHERE "demandeId" LIKE '${PREFIXE}%')`);
  await q(`DELETE FROM "Reglement" WHERE "demandeId" LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "LigneDemande" WHERE "demandeId" LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "Demande" WHERE id LIKE '${PREFIXE}%'`);
};
await nettoyer();

const uid = async (email) => (await q(`SELECT id FROM "User" WHERE email = $1`, [email]))[0].id;
const idCollab = await uid("collaborateur@simassurances.test");
const idRh = await uid("rh@simassurances.test");
const idFinance = await uid("finance@simassurances.test");
const idAssistant = await uid("assistant-finance@simassurances.test");
await q(`INSERT INTO "Categorie"(id, label, "isActive") VALUES ('e2e-lotd-cat1', 'E2E-D-CAT1', true), ('e2e-lotd-cat2', 'E2E-D-CAT2', true) ON CONFLICT (id) DO NOTHING`);
// Lot J : le budget d'une catégorie est un paramétrage validé par le DG (la colonne Categorie.budgetAlloue n'est plus lue).
await q(`DELETE FROM "BudgetParametrage" WHERE "categorieId" IN ('e2e-lotd-cat1', 'e2e-lotd-cat2')`);
await q(`INSERT INTO "BudgetParametrage"(id, portee, "categorieId", montant, "dateDebut", "modeSeuil", "seuilOrange", "seuilRouge", statut, repris, "decideAt") VALUES ('e2e-lotd-b1', 'CATEGORIE', 'e2e-lotd-cat1', 100000, DATE '2000-01-01', 'POURCENTAGE', 20, 0, 'VALIDE', true, now()), ('e2e-lotd-b2', 'CATEGORIE', 'e2e-lotd-cat2', 100000, DATE '2000-01-01', 'POURCENTAGE', 20, 0, 'VALIDE', true, now())`);

async function demande(suffixe, lignes, { statut = "PARTIELLEMENT_VALIDEE" } = {}) {
  const id = `${PREFIXE}${suffixe}`;
  const valide = lignes.filter((l) => (l.statut ?? "VALIDEE") === "VALIDEE").length * 10000;
  await q(
    `INSERT INTO "Demande"(id, reference, montant, "montantValide", statut, "createurId", "updatedAt", "beneficiaireType", "beneficiaireUserId",
       "etapeCircuit", "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", description, "validationCompleteParDG")
     VALUES ($1, $2, $3, $4, $5, $6, now(), 'COLLABORATEUR', $6, 'FINANCE', true, false, 'OPTIONNELLE', 'test e2e lot D', false)`,
    [id, `DEM-LOTD-${suffixe.toUpperCase()}`, lignes.length * 10000, valide, statut, idCollab]
  );
  for (const [i, l] of lignes.entries()) {
    const st = l.statut ?? "VALIDEE";
    await q(
      `INSERT INTO "LigneDemande"(id, libelle, quantite, "prixUnitaire", "demandeId", "categorieId", motif, "statutValidation", "beneficiaireType", "beneficiaireUserId",
         "decideParId", "decideAt", "decideurFinanceId")
       VALUES ($1, $2, 1, 10000, $3, $4, 'motif', $5, $6, $7, $8, $9, $8)`,
      [`${id}-l${i + 1}`, l.libelle, id, l.categorie ?? "e2e-lotd-cat1", st, l.beneficiaireUserId ? "COLLABORATEUR" : null, l.beneficiaireUserId ?? null, st === "EN_ATTENTE" ? null : idFinance, st === "EN_ATTENTE" ? null : new Date()]
    );
  }
  return id;
}
const reglementsDe = (id) => q(`SELECT id, "ligneDemandeId", montant::float AS montant, mode, "estConfirme", "estAnnule" FROM "Reglement" WHERE "demandeId" = $1 ORDER BY "createdAt"`, [id]);
const conso = async (cat) => Number((await q(`SELECT COALESCE(SUM(a.montant),0)::float AS s FROM "ReglementCategorieAllocation" a JOIN "Reglement" r ON r.id = a."reglementId" WHERE a."categorieId" = $1 AND r."estConfirme" AND NOT r."estAnnule"`, [cat]))[0].s);

// Demande dont un article attend le DG (page de l'étape DG).
const D7 = await demande("7", [{ libelle: "Article A7", statut: "EN_ATTENTE" }], { statut: "EN_ATTENTE_VALIDATION" });
await q(`UPDATE "Demande" SET "etapeCircuit" = 'DG', "montantValide" = NULL WHERE id = $1`, [D7]);
await q(`UPDATE "LigneDemande" SET "soumiseAuDG" = true, "soumiseDGAt" = now(), "soumiseDGParId" = $2 WHERE "demandeId" = $1`, [D7, idFinance]);

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
  return { ctx: { close: () => p.close() }, p, contexte: ctx };
}
const pageFinance = (p, id) => p.goto(`${B}/treso/finance/demandes/${id}`);
const bloc = (p, ligneId) => p.locator(`[data-article-reglement="${ligneId}"]`);

/**
 * Crée un règlement depuis le bloc d'un article (UI réelle). `viser` détourne la soumission : le formulaire d'un article
 * ACTIF est ouvert, puis ses champs cachés (demande, article) sont réécrits avant l'envoi — comme le ferait un appel
 * direct de la Server Action — pour vérifier que le SERVEUR refuse, indépendamment du grisage de l'écran.
 */
async function creerReglement(p, ligneId, montant, mode = "BANQUE", { viser = null, sansPlafondClient = false } = {}) {
  const b = bloc(p, ligneId);
  await b.getByRole("button", { name: "Ajouter un règlement" }).click();
  await b.locator('input[name="montant"]').fill(String(montant));
  await b.locator('textarea[name="motif"]').fill("Règlement de test e2e");
  await b.locator('select[name="mode"]').selectOption(mode);
  // Les réécritures viennent APRÈS la saisie (React réécrit les champs contrôlés à chaque rendu).
  if (sansPlafondClient) await b.locator('input[name="montant"]').evaluate((el) => el.removeAttribute("max"));
  if (viser) {
    await b.locator('input[name="demandeId"]').evaluate((el, v) => { el.value = v; }, viser.demandeId);
    await b.locator('input[name="ligneDemandeId"]').evaluate((el, v) => { el.value = v; }, viser.ligneDemandeId);
  }
  await b.getByRole("button", { name: "Créer le règlement" }).click();
}

// ======================================================================================================================
// 1. Scénario principal : A et B validés, C en attente — on règle A seul, puis B
// ======================================================================================================================
const D1 = await demande("1", [
  { libelle: "Article A", categorie: "e2e-lotd-cat1" },
  { libelle: "Article B", categorie: "e2e-lotd-cat2", beneficiaireUserId: idRh },
  { libelle: "Article C", statut: "EN_ATTENTE" },
]);
const A1 = `${D1}-l1`, B1 = `${D1}-l2`, C1 = `${D1}-l3`;
{
  const { ctx, p } = await connecter("assistant-finance@simassurances.test");
  await pageFinance(p, D1);
  verifier("1. un bloc de règlement par article VALIDÉ (A, B), aucun pour C", (await bloc(p, A1).count()) === 1 && (await bloc(p, B1).count()) === 1 && (await bloc(p, C1).count()) === 0);
  verifier("1. plus de blocage « plusieurs bénéficiaires » (lot A levé)", !(await p.content()).includes("le règlement par article arrive prochainement"));
  verifier("1. B affiche SON bénéficiaire (rh@)", (await bloc(p, B1).innerText()).includes("Bénéficiaire"));

  // Plafond de l'ARTICLE : 12 000 > 10 000 (A) alors que le pot commun validé est de 20 000.
  await creerReglement(p, A1, 12000, "BANQUE", { sansPlafondClient: true });
  await p.waitForTimeout(1500);
  verifier("1. 12 000 refusé sur A (plafond de l'article, pas du pot commun)", (await reglementsDe(D1)).length === 0);
  verifier("1. message de plafond affiché", (await p.content()).includes("reste à régler de cet article"));

  // A : règlement partiel de 4 000 (Banque), créé puis confirmé.
  await pageFinance(p, D1);
  await creerReglement(p, A1, 4000);
  verifier("1. règlement de 4 000 créé, rattaché à A", await attendre(async () => (await reglementsDe(D1)).length === 1));
  let rs = await reglementsDe(D1);
  verifier("1. le règlement porte l'article A", rs[0].ligneDemandeId === A1 && rs[0].montant === 4000);
  const alloc = await q(`SELECT "categorieId", montant::float AS m FROM "ReglementCategorieAllocation" WHERE "reglementId" = $1`, [rs[0].id]);
  verifier("1. allocation unique 100 % vers la catégorie de A", alloc.length === 1 && alloc[0].categorieId === "e2e-lotd-cat1" && alloc[0].m === 4000);
  verifier("1. budget non consommé tant que le brouillon n'est pas confirmé", (await conso("e2e-lotd-cat1")) === 0);
  await pageFinance(p, D1);
  await bloc(p, A1).getByRole("button", { name: "Confirmer", exact: true }).click();
  verifier("1. règlement de A confirmé", await attendre(async () => (await reglementsDe(D1))[0]?.estConfirme === true));
  verifier("1. budget CAT1 consommé = 4 000, CAT2 intact (B pas touché)", (await conso("e2e-lotd-cat1")) === 4000 && (await conso("e2e-lotd-cat2")) === 0);

  // B n'a rien : toujours entièrement à régler ; C en attente.
  await pageFinance(p, D1);
  verifier("1. B toujours entièrement à régler (reste 10 000)", (await bloc(p, B1).innerText()).replace(/\s/g, "").includes("reste10000FCFA"));
  verifier("1. A : reste 6 000", (await bloc(p, A1).innerText()).replace(/\s/g, "").includes("reste6000FCFA"));
  const stat = (await q(`SELECT statut FROM "Demande" WHERE id = $1`, [D1]))[0].statut;
  verifier("1. statut de la demande inchangé, dérivé des articles (C en attente → « En cours »)", stat === "PARTIELLEMENT_VALIDEE" && (await p.getByText(/En cours \(2\/3 traités\)/).count()) >= 1);

  // 12 000 → refusé sur le reste de A (6 000) ; 7 000 aussi ; 6 000 passe.
  await creerReglement(p, A1, 7000, "BANQUE", { sansPlafondClient: true });
  await p.waitForTimeout(1200);
  verifier("1. 7 000 refusé sur A (reste 6 000)", (await reglementsDe(D1)).length === 1);
  await pageFinance(p, D1);
  await creerReglement(p, A1, 6000);
  await attendre(async () => (await reglementsDe(D1)).length === 2);
  await pageFinance(p, D1);
  await bloc(p, A1).getByRole("button", { name: "Confirmer", exact: true }).first().click();
  verifier("1. A entièrement réglé en deux fois (4 000 + 6 000)", await attendre(async () => (await q(`SELECT COALESCE(SUM(montant),0)::float AS s FROM "Reglement" WHERE "ligneDemandeId" = $1 AND "estConfirme"`, [A1]))[0].s === 10000));

  // B : règlement complet avec son propre bénéficiaire.
  await pageFinance(p, D1);
  await creerReglement(p, B1, 10000);
  await attendre(async () => (await reglementsDe(D1)).some((r) => r.ligneDemandeId === B1));
  await pageFinance(p, D1);
  await bloc(p, B1).getByRole("button", { name: "Confirmer", exact: true }).click();
  verifier("1. B réglé", await attendre(async () => (await reglementsDe(D1)).find((r) => r.ligneDemandeId === B1)?.estConfirme === true));
  verifier("1. budget : CAT1 = 10 000 (A), CAT2 = 10 000 (B) — chacun sa catégorie", (await conso("e2e-lotd-cat1")) === 10000 && (await conso("e2e-lotd-cat2")) === 10000);
  const stat2 = (await q(`SELECT statut FROM "Demande" WHERE id = $1`, [D1]))[0].statut;
  verifier("1. C toujours en attente : la demande n'est pas « Réglée »", stat2 === "PARTIELLEMENT_VALIDEE");
  await ctx.close();
}

// ======================================================================================================================
// 2. Parcours de l'article (Finance, collaborateur, DG, responsable de service)
// ======================================================================================================================
{
  const { ctx, p } = await connecter("finance@simassurances.test");
  await pageFinance(p, D1);
  const badge = (ligneId) => p.locator(`xpath=//*[contains(@id,'${ligneId}') or @data-ligne-id='${ligneId}']//*[@data-parcours-badge]`);
  const badges = await p.locator("[data-parcours-badge]").evaluateAll((els) => els.map((e) => e.getAttribute("data-parcours-badge")));
  verifier("2. Finance : badges A « REGLE », B « REGLE », C « EN_ATTENTE »", badges.filter((b) => b === "REGLE").length === 2 && badges.includes("EN_ATTENTE"), badges.join(","));
  verifier("2. Finance : étapes Validé puis Réglé affichées pour A", (await p.locator('[data-parcours-etape="VALIDE"]').count()) >= 2 && (await p.locator('[data-parcours-etape="REGLE"]').count()) >= 2);
  verifier("2. Finance : aucune étape Retour ni Régularisé (rien à afficher)", (await p.locator('[data-parcours-etape="RETOUR"]').count()) === 0 && (await p.locator('[data-parcours-etape="REGULARISE"]').count()) === 0);
  void badge;
  const texte = await p.locator("[data-parcours-etape='REGLE']").first().innerText();
  verifier("2. Finance : le réglé indique montant, mode et bénéficiaire", /FCFA/.test(texte) && /Banque/.test(texte) && /bénéficiaire/.test(texte), texte.replace(/\s+/g, " "));
  await ctx.close();
}
{
  const { ctx, p } = await connecter("collaborateur@simassurances.test");
  await p.goto(`${B}/treso/demandes/${D1}`);
  const badges = await p.locator("[data-parcours-badge]").evaluateAll((els) => els.map((e) => e.getAttribute("data-parcours-badge")));
  verifier("2. collaborateur : voit le parcours de chaque article (A, B réglés, C en attente)", badges.filter((b) => b === "REGLE").length === 2 && badges.includes("EN_ATTENTE"), badges.join(","));
  verifier("2. collaborateur : reçu listé avec l'article payé", (await p.locator("[data-article-reglement-recu]").count()) >= 3);
  await ctx.close();
}
{
  const { ctx, p } = await connecter("dg@simassurances.test");
  await p.goto(`${B}/treso/dg/${D7}`);
  verifier("2. DG : parcours affiché (en attente, chez le DG) sur la page de l'étape DG", (await p.locator('[data-parcours-badge="EN_ATTENTE"]').count()) >= 1 && (await p.content()).includes("Chez le DG"));
  await ctx.close();
}
{
  const { ctx, p } = await connecter("responsable-commercial@simassurances.test");
  await p.goto(`${B}/treso/service/${D1}`);
  const n = await p.locator("[data-parcours-badge]").count();
  // Le responsable du service du demandeur voit la demande (service Commercial) : parcours affiché ; sinon page 404.
  verifier("2. Service : parcours affiché (ou demande hors de son service)", n >= 3 || (await p.content()).includes("404") || (await p.content()).includes("introuvable"), String(n));
  await ctx.close();
}

// ======================================================================================================================
// 3. Garde 8 PAR ARTICLE : l'Assistant est bénéficiaire de A2 (bloqué) mais règle B2 (autre bénéficiaire)
// ======================================================================================================================
const D2 = await demande("2", [
  { libelle: "Article A2", beneficiaireUserId: idAssistant },
  { libelle: "Article B2", beneficiaireUserId: idRh, categorie: "e2e-lotd-cat2" },
], { statut: "VALIDEE_NON_REGLEE" });
const A2 = `${D2}-l1`, B2 = `${D2}-l2`;
{
  const { ctx, p } = await connecter("assistant-finance@simassurances.test");
  await pageFinance(p, D2);
  verifier("3. A2 (dont l'Assistant est bénéficiaire) : phrase de conflit et bouton grisé", (await bloc(p, A2).locator("[data-conflit-interet]").count()) === 1 && (await bloc(p, A2).getByRole("button", { name: "Ajouter un règlement" }).isDisabled()));
  verifier("3. B2 (autre bénéficiaire) : bouton actif, aucune phrase de conflit", (await bloc(p, B2).locator("[data-conflit-interet]").count()) === 0 && !(await bloc(p, B2).getByRole("button", { name: "Ajouter un règlement" }).isDisabled()));
  // Contournement de l'interface : le serveur refuse.
  await creerReglement(p, B2, 1000, "BANQUE", { viser: { demandeId: D2, ligneDemandeId: A2 } });
  await p.waitForTimeout(1500);
  verifier("3. rejeu direct visant A2 : refusé par le serveur (aucun règlement créé)", (await reglementsDe(D2)).length === 0);
  verifier("3. la phrase du serveur est affichée", (await p.content()).includes("demandeur ou le bénéficiaire"));
  await pageFinance(p, D2);
  await creerReglement(p, B2, 10000);
  verifier("3. B2 réglé par ce même compte (garde 8 par article)", await attendre(async () => (await reglementsDe(D2)).some((r) => r.ligneDemandeId === B2)));
  await ctx.close();
}

// ======================================================================================================================
// 4. Règlements antérieurs NON rattachés : demande ambiguë bloquée, rattachement par le script
// ======================================================================================================================
const D3 = await demande("3", [{ libelle: "Article A3" }, { libelle: "Article B3" }], { statut: "VALIDEE_NON_REGLEE" });
const A3 = `${D3}-l1`, B3 = `${D3}-l2`;
const REG3 = `${PREFIXE}reg3`;
const D6 = await demande("6", [{ libelle: "Article A6" }], { statut: "VALIDEE_NON_REGLEE" });
const A6 = `${D6}-l1`;
await q(`INSERT INTO "Reglement"(id, montant, mode, "estConfirme", "demandeId", "auteurId", "confirmeAt") VALUES ($1, 5000, 'BANQUE', true, $2, $3, now())`, [REG3, D3, idAssistant]);
const lancer = (...args) =>
  execFileSync("npx", ["tsx", "prisma/recalculer-reglements-articles.ts", ...args], {
    cwd: path.join(RACINE, "backend"),
    env: { ...process.env, DATABASE_URL: `${DB}?schema=public` },
    encoding: "utf8",
  });
{
  const { ctx, p } = await connecter("assistant-finance@simassurances.test");
  await pageFinance(p, D3);
  verifier("4. règlement non rattaché signalé et phrase de blocage", (await p.locator("[data-reglements-non-rattaches]").count()) === 1);
  verifier("4. boutons « Ajouter un règlement » grisés sur A3 et B3", (await bloc(p, A3).getByRole("button", { name: "Ajouter un règlement" }).isDisabled()) && (await bloc(p, B3).getByRole("button", { name: "Ajouter un règlement" }).isDisabled()));
  await pageFinance(p, D6);
  await creerReglement(p, A6, 1000, "BANQUE", { viser: { demandeId: D3, ligneDemandeId: A3 } });
  await p.waitForTimeout(1500);
  verifier("4. rejeu direct visant la demande ambiguë : refusé par le serveur", (await reglementsDe(D3)).length === 1 && (await reglementsDe(D6)).length === 0);
  await pageFinance(p, D3);
  const sortie = lancer();
  verifier("4. script (simulation) : la demande est listée « AMBIGU »", sortie.includes("[AMBIGU] DEM-LOTD-3") && sortie.includes(REG3));
  verifier("4. script (simulation) : rien n'est écrit", (await reglementsDe(D3))[0].ligneDemandeId === null);
  const refus = lancer("--affecter", `${REG3}:${B3}`.replace(B3, `${PREFIXE}inconnu`), "--appliquer");
  verifier("4. script : article étranger refusé", refus.includes("IMPOSSIBLE"));
  const ok = lancer("--affecter", `${REG3}:${A3}`, "--appliquer");
  verifier("4. script : rattachement manuel appliqué", ok.includes("appliqué") && (await reglementsDe(D3))[0].ligneDemandeId === A3);
  const cs = (await q(`SELECT count(*)::int AS n FROM "JournalCaisse" WHERE "demandeId" = $1`, [D3]))[0].n;
  verifier("4. aucune écriture de caisse touchée", cs === 0);
  await pageFinance(p, D3);
  verifier("4. la demande est débloquée : plus de signalement, boutons actifs", (await p.locator("[data-reglements-non-rattaches]").count()) === 0 && !(await bloc(p, B3).getByRole("button", { name: "Ajouter un règlement" }).isDisabled()));
  await ctx.close();
}
// Cas non ambigu qui aurait échappé à la migration : un seul article validé.
const D4 = await demande("4", [{ libelle: "Article A4" }, { libelle: "Article B4", statut: "REJETEE" }], { statut: "VALIDEE_NON_REGLEE" });
const REG4 = `${PREFIXE}reg4`;
await q(`INSERT INTO "Reglement"(id, montant, mode, "estConfirme", "demandeId", "auteurId", "confirmeAt") VALUES ($1, 3000, 'BANQUE', true, $2, $3, now())`, [REG4, D4, idAssistant]);
{
  const simu = lancer("--automatique");
  verifier("4. un seul article validé : listé « AUTOMATIQUE », simulation sans écriture", simu.includes("[AUTOMATIQUE] DEM-LOTD-4") && (await reglementsDe(D4))[0].ligneDemandeId === null);
  lancer("--automatique", "--appliquer");
  verifier("4. rattaché à l'unique article validé", (await reglementsDe(D4))[0].ligneDemandeId === `${D4}-l1`);
  const rejeu = lancer("--automatique", "--appliquer");
  verifier("4. idempotent : un second passage ne trouve plus rien", !rejeu.includes("[AUTOMATIQUE] DEM-LOTD-4"));
}

// ======================================================================================================================
// 5. Retour de caisse affiché en lecture dans le parcours (règlement Caisse rattaché) + documents PDF
// ======================================================================================================================
const D5 = await demande("5", [{ libelle: "Article A5" }], { statut: "REGLEE" });
const A5 = `${D5}-l1`;
const REG5 = `${PREFIXE}reg5`, RET5 = `${PREFIXE}ret5`;
await q(`INSERT INTO "Reglement"(id, montant, mode, "estConfirme", "demandeId", "ligneDemandeId", "auteurId", "confirmeAt") VALUES ($1, 10000, 'CAISSE', true, $2, $3, $4, now())`, [REG5, D5, A5, idAssistant]);
await q(`INSERT INTO "JournalCaisse"(id, type, montant, source, "refId", "demandeId", "userId") VALUES ($1, 'SORTIE', 10000, 'reglement_caisse', $2, $3, $4)`, [`${PREFIXE}jc5`, REG5, D5, idAssistant]);
await q(`INSERT INTO "RetourCaisse"(id, "montantARetourner", "estReceptionne", "reglementId", "declarantId", "creeParAssistant") VALUES ($1, 3000, false, $2, $3, false)`, [RET5, REG5, idCollab]);
await q(`INSERT INTO "DepenseLigne"(id, montant, objet, date, justification, "retourCaisseId") VALUES ($1, 7000, 'Dépenses', now(), 'FACTURE', $2)`, [`${PREFIXE}dep5`, RET5]);
{
  const { ctx, p } = await connecter("finance@simassurances.test");
  await pageFinance(p, D5);
  verifier("5. retour déclaré non reçu : badge « Retour en attente »", (await p.locator('[data-parcours-badge="RETOUR_EN_ATTENTE"]').count()) === 1);
  const etape = await p.locator('[data-parcours-etape="RETOUR"]').innerText();
  verifier("5. étape Retour : attendu 3 000 / reçu 0", /3\s?000/.test(etape) && /0 FCFA/.test(etape), etape.replace(/\s+/g, " "));
  verifier("5. pas d'étape Régularisé tant que le retour n'est pas reçu", (await p.locator('[data-parcours-etape="REGULARISE"]').count()) === 0);
  await ctx.close();
  await q(`UPDATE "RetourCaisse" SET "estReceptionne" = true, "receptionneAt" = now(), "receptionneParId" = $2 WHERE id = $1`, [RET5, idAssistant]);
  const f = await connecter("finance@simassurances.test");
  await pageFinance(f.p, D5);
  verifier("5. retour reçu et solde nul : badge « Régularisé » et étape Régularisé", (await f.p.locator('[data-parcours-badge="REGULARISE"]').count()) === 1 && (await f.p.locator('[data-parcours-etape="REGULARISE"]').count()) === 1);
  await f.ctx.close();
  const c = await connecter("collaborateur@simassurances.test");
  await c.p.goto(`${B}/treso/demandes/${D5}`);
  verifier("5. collaborateur : même badge « Régularisé » et le repère de l'article dans ses retours", (await c.p.locator('[data-parcours-badge="REGULARISE"]').count()) === 1 && (await c.p.content()).includes("Article «"));
  await c.ctx.close();
}
{
  // Documents : le PDF est lisible (pdftotext) et nomme l'article et rappelle la demande.
  const { ctx, p } = await connecter("finance@simassurances.test");
  const dossier = path.join(RACINE, "e2e", ".pdf-tmp");
  execFileSync("mkdir", ["-p", dossier]);
  const pdf = async (url, nom) => {
    const r = await p.request.get(`${B}${url}`);
    if (r.status() !== 200) return { statut: r.status(), texte: "" };
    const fichier = path.join(dossier, nom);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(fichier, await r.body());
    return { statut: 200, texte: execFileSync("pdftotext", ["-layout", fichier, "-"], { encoding: "utf8" }).replace(/\s+/g, " ") };
  };
  const recu = await pdf(`/api/treso/reglements/${REG5}/recu`, "recu.pdf");
  verifier("6. reçu de règlement : 200, article, bénéficiaire, demandeur et service", recu.statut === 200 && recu.texte.includes("Article A5") && recu.texte.toUpperCase().includes("ARTICLE CONCERNÉ") && recu.texte.includes("Service") && recu.texte.includes("DEM-LOTD-5"), recu.texte.slice(0, 200));
  const bon = await pdf(`/api/treso/reglements/${REG5}/bon-de-caisse`, "bon.pdf");
  verifier("6. bon de caisse : 200, article et rappel de la demande (numéro, demandeur, service)", bon.statut === 200 && bon.texte.includes("Article A5") && bon.texte.includes("Demandeur") && bon.texte.includes("Service") && bon.texte.includes("DEM-LOTD-5"));
  verifier("6. bon de caisse : toujours sans reste à régler ni total réglé de la demande", !bon.texte.includes("Reste à régler") && !bon.texte.includes("Total réglé"));
  const ret = await pdf(`/api/treso/retours/${RET5}/recu`, "retour.pdf");
  verifier("6. reçu de retour : 200, article et service", ret.statut === 200 && ret.texte.includes("Article A5") && ret.texte.includes("Service"));
  // Règlement de la demande D1 (Banque) : reçu sans bon de caisse.
  const regD1 = (await reglementsDe(D1))[0];
  const recuD1 = await pdf(`/api/treso/reglements/${regD1.id}/recu`, "recu1.pdf");
  verifier("6. reçu d'un règlement Banque d'une demande à 3 articles : l'article A, pas B ni C", recuD1.texte.includes("Article A") && !recuD1.texte.includes("Article B") && !recuD1.texte.includes("Article C"));
  await ctx.close();
  execFileSync("rm", ["-rf", dossier]);
}

await nettoyer();
verifier("aucune erreur JavaScript en console", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles réussis.`);
await browser.close();
await db.end();
process.exit(ko === 0 ? 0 : 1);
