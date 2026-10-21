// Autonomie des articles, lot B (2026-10-15) — décision Finance PAR ARTICLE, statut et étape déduits des articles,
// files par article, sur base JETABLE (voir e2e/README.md).
//
// Scénario principal : demande à 3 articles (A, B, C). La Finance valide A, rejette B, soumet C au DG ; le DG valide C ;
// la Finance le confirme. À chaque étape on vérifie la base ET l'écran : statut « En cours (x/n traités) », étape,
// files de la Finance et du DG, frise et compteur, chronomètre de rappel remis à zéro. Puis : cas « tous rejetés »
// (retour au demandeur), refus de rejeter la demande entière après une validation, bénéficiaire d'un article qui ne
// le décide pas, et script de reprise (simulation, application, idempotence).
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import pg from "pg";
import { assurerSignatures } from "./signatures-auto.mjs";
import { MOTIF, remplirMotif, remplirMotifArticle, remplirMotifDans } from "./motifs.mjs";

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

// --- Données de test (idempotentes : on repart de zéro à chaque lancement) --------------------------------------
const PREFIXE = "e2e-lotb-";
await q(`DELETE FROM "HistoriqueEntry" WHERE "entityId" LIKE '${PREFIXE}%' OR "entityId" IN (SELECT id FROM "LigneDemande" WHERE "demandeId" LIKE '${PREFIXE}%')`);
await q(`DELETE FROM "Notification" WHERE lien LIKE '%${PREFIXE}%'`);
await q(`DELETE FROM "LigneDemande" WHERE "demandeId" LIKE '${PREFIXE}%'`);
await q(`DELETE FROM "Demande" WHERE id LIKE '${PREFIXE}%'`);

const uid = async (email) => (await q(`SELECT id FROM "User" WHERE email = $1`, [email]))[0].id;
const idFinance = await uid("finance@simassurances.test");
const idDG = await uid("dg@simassurances.test");
const categorie = (await q(`SELECT id FROM "Categorie" LIMIT 1`))[0].id;

async function demande(suffixe, { createur = "collaborateur@simassurances.test", statut = "EN_ATTENTE_VALIDATION", etape = "FINANCE", mode = "OPTIONNELLE", lignes }) {
  const id = `${PREFIXE}${suffixe}`;
  const createurId = await uid(createur);
  await q(
    `INSERT INTO "Demande"(id, reference, montant, statut, "createurId", "updatedAt", "beneficiaireType", "etapeCircuit",
       "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", description)
     VALUES ($1, $2, $3, $4, $5, now(), 'COLLABORATEUR', $6, $7, false, $8, 'test e2e lot B')`,
    [id, `DEM-LOTB-${suffixe.toUpperCase()}`, lignes.length * 10000, statut, createurId, etape, mode !== "OBLIGATOIRE", mode]
  );
  for (const [i, l] of lignes.entries()) {
    await q(
      `INSERT INTO "LigneDemande"(id, libelle, quantite, "prixUnitaire", "demandeId", "categorieId", motif, "statutValidation", "beneficiaireType", "beneficiaireUserId")
       VALUES ($1, $2, 1, 10000, $3, $4, 'motif', $5, $6, $7)`,
      [`${id}-l${i + 1}`, l.libelle, id, categorie, l.statut ?? "EN_ATTENTE", l.beneficiaireUserId ? "COLLABORATEUR" : null, l.beneficiaireUserId ?? null]
    );
  }
  return id;
}
const ARTICLES = [{ libelle: "Article A" }, { libelle: "Article B" }, { libelle: "Article C" }];
const lecture = async (id) =>
  (await q(`SELECT statut, "etapeCircuit", "montantValide", "niveauRejet", "validationCompleteParDG", "etapeCircuitDepuis" FROM "Demande" WHERE id = $1`, [id]))[0];
const lignesDe = async (id) => await q(`SELECT id, libelle, "statutValidation", "decideParId", "decideurFinanceId", "soumiseAuDG", "decisionDG", "decisionDGParId", "motifRejet" FROM "LigneDemande" WHERE "demandeId" = $1 ORDER BY libelle`, [id]);
const vieillirChrono = (id) => q(`UPDATE "Demande" SET "etapeCircuitDepuis" = now() - interval '3 days' WHERE id = $1`, [id]);
const chronoRecent = async (id) => new Date((await lecture(id)).etapeCircuitDepuis).getTime() > Date.now() - 2 * 60 * 1000;

// Une seule connexion par compte (le portail limite le nombre de connexions par IP) : les contextes sont réutilisés.
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
  return { ctx: { close: () => p.close() }, p };
}
const pageFinance = (p, id) => p.goto(`${B}/treso/finance/demandes/${id}`);
const carte = (p, libelle) => p.locator("div.card-shadow-hover", { hasText: libelle }).first();
const statutFrise = (p, etape) => p.locator(`[data-etape="${etape}"]`).getAttribute("data-statut");
const texteFile = async (p, idFile) => (await p.locator(`section[aria-labelledby="${idFile}"]`).innerText());
const enregistrer = (p) => p.getByRole("button", { name: /^Enregistrer les décisions/ });

// ======================================================================================================================
// 1. Scénario principal : A validé, B rejeté, C soumis au DG puis validé par le DG puis confirmé par la Finance
// ======================================================================================================================
const A = await demande("a", { lignes: ARTICLES });
const REF_A = "DEM-LOTB-A";
{
  const { ctx, p } = await connecter("finance@simassurances.test");
  await pageFinance(p, A);
  verifier("1. départ : statut affiché « En cours (0/3 traité) »", (await p.getByText("En cours (0/3 traité)").count()) >= 1);
  verifier("1. départ : compteur d'articles « 0/3 article traité »", (await p.locator("[data-compteur-articles]").innerText()).includes("0/3"));
  verifier("1. départ : frise — Finance en cours, DG non requise", (await statutFrise(p, "FINANCE")) === "EN_COURS" && (await statutFrise(p, "DG")) === "NON_REQUISE");
  verifier("1. départ : « Enregistrer » désactivé sans décision", await enregistrer(p).isDisabled());

  // Décision d'un SOUS-ENSEMBLE : A validé, B rejeté, C laissé de côté.
  await vieillirChrono(A);
  await carte(p, "Article A").getByRole("button", { name: "Valider", exact: true }).click();
  await carte(p, "Article B").getByRole("button", { name: "Rejeter", exact: true }).click();
  await carte(p, "Article B").getByLabel("Motif du rejet de la ligne").fill("Hors budget validé");
  verifier("1. sous-ensemble : « Enregistrer (2 articles) » actif sans décider C", !(await enregistrer(p).isDisabled()) && (await enregistrer(p).innerText()).includes("2 articles"));
  await enregistrer(p).click();
  verifier("1. décision enregistrée en base", await attendre(async () => (await lignesDe(A)).filter((l) => l.statutValidation !== "EN_ATTENTE").length === 2));
  let l = await lignesDe(A);
  const par = (lib) => l.find((x) => x.libelle === lib);
  const d = await lecture(A);
  verifier("1. A validé, B rejeté (motif), C toujours à décider", par("Article A").statutValidation === "VALIDEE" && par("Article B").statutValidation === "REJETEE" && par("Article B").motifRejet === "Hors budget validé" && par("Article C").statutValidation === "EN_ATTENTE");
  verifier("1. décideur Finance enregistré sur A (validation), pas sur B (rejet)", par("Article A").decideurFinanceId === idFinance && par("Article B").decideurFinanceId === null);
  verifier("1. montant validé = 10 000 (somme des articles validés)", Number(d.montantValide) === 10000);
  verifier("1. statut « Partiellement validée » (affichée « En cours »), étape Finance", d.statut === "PARTIELLEMENT_VALIDEE" && d.etapeCircuit === "FINANCE");
  verifier("1. chronomètre de rappel remis à zéro par la décision", await chronoRecent(A));
  await p.reload();
  verifier("1. écran : « En cours (2/3 traités) »", (await p.getByText("En cours (2/3 traités)").count()) >= 1);
  verifier("1. écran : compteur « 2/3 articles traités »", (await p.locator("[data-compteur-articles]").innerText()).includes("2/3"));
  verifier("1. écran : Assistant « en cours » dès qu'un article est validé (règlement possible)", (await statutFrise(p, "ASSISTANT")) === "EN_COURS");
  verifier("1. écran : le règlement est proposé (pot commun du montant validé)", (await p.getByRole("button", { name: "Ajouter un règlement" }).count()) >= 1);
  verifier("1. écran : A et B figés (« Validée » / « Rejetée »), plus de boutons de décision sur eux", (await carte(p, "Article A").getByRole("button", { name: "Valider", exact: true }).count()) === 0 && (await carte(p, "Article B").getByRole("button", { name: "Rejeter", exact: true }).count()) === 0);
  verifier("1. écran : montant déjà validé affiché", (await p.getByText(/Déjà validé :\s*10[\s  ]000 FCFA/).count()) >= 1);

  // File de la Finance : la demande y est (article C à décider).
  await p.goto(`${B}/treso/finance/demandes`);
  verifier("1. file « Étape Finance » : la demande y figure (C à décider)", (await texteFile(p, "file-etape-finance")).includes(REF_A));

  // La Finance soumet C au DG (son bouton).
  await pageFinance(p, A);
  await vieillirChrono(A);
  await remplirMotifArticle(p, `${A}-l3`);
  await p.locator(`[data-soumettre-article="${A}-l3"]`).click();
  verifier("1. C soumis au DG en base", await attendre(async () => (await lignesDe(A)).find((x) => x.libelle === "Article C").soumiseAuDG === true));
  const apresSoumission = await lecture(A);
  verifier("1. plus aucun article pour la Finance : étape DG, statut inchangé", apresSoumission.etapeCircuit === "DG" && apresSoumission.statut === "PARTIELLEMENT_VALIDEE");
  verifier("1. chronomètre remis à zéro par la soumission", await chronoRecent(A));
  await p.goto(`${B}/treso/finance/demandes`);
  verifier("1. files de la Finance : la demande n'y est plus (tout est chez le DG)", !(await p.locator("main").innerText()).includes(REF_A));
  await pageFinance(p, A);
  verifier("1. frise : Finance faite, DG en cours", (await statutFrise(p, "FINANCE")) === "FAITE" && (await statutFrise(p, "DG")) === "EN_COURS");
  verifier("1. écran : « En cours (2/3 traités) » toujours (C chez le DG)", (await p.getByText("En cours (2/3 traités)").count()) >= 1);
  await ctx.close();
}

{
  const { ctx, p } = await connecter("dg@simassurances.test");
  await p.goto(`${B}/treso/dg`);
  verifier("1. file du DG : la demande y figure", (await p.locator("main").innerText()).includes(REF_A));
  await p.goto(`${B}/treso/dg/${A}`);
  const lignesDG = await p.locator("[data-ligne-dg]").count();
  verifier("1. DG : il ne voit que l'article soumis (C)", lignesDG === 1 && (await p.locator('[data-ligne-dg="Article C"]').count()) === 1, `${lignesDG} ligne(s)`);
  await vieillirChrono(A);
  await remplirMotifDans(p.locator('[data-ligne-dg="Article C"]'));
  await p.locator('[data-ligne-dg="Article C"]').getByRole("button", { name: "Valider", exact: true }).click();
  verifier("1. DG : décision enregistrée", await attendre(async () => (await lignesDe(A)).find((x) => x.libelle === "Article C").decisionDG === "VALIDEE"));
  const c = (await lignesDe(A)).find((x) => x.libelle === "Article C");
  const d = await lecture(A);
  verifier("1. DG définitif : C validé par le DG mais PAS encore validé (la Finance confirme)", c.decisionDGParId === idDG && c.statutValidation === "EN_ATTENTE");
  verifier("1. étape déduite : Finance (article à confirmer)", d.etapeCircuit === "FINANCE");
  verifier("1. chronomètre remis à zéro par la décision du DG", await chronoRecent(A));
  await ctx.close();
}

{
  const { ctx, p } = await connecter("finance@simassurances.test");
  await p.goto(`${B}/treso/finance/demandes`);
  verifier("1. file « Décision finale » : la demande y figure (C validé par le DG)", (await texteFile(p, "file-decision-finale")).includes(REF_A));
  await pageFinance(p, A);
  verifier("1. écran Finance : C « Validée par le DG », bouton « Confirmer la validation »", (await p.locator(`[data-confirmer-article="${A}-l3"]`).count()) === 1);
  verifier("1. écran Finance : pas de bouton Rejeter pour C (DG définitif)", (await carte(p, "Article C").getByRole("button", { name: "Rejeter", exact: true }).count()) === 0);
  await p.locator(`[data-confirmer-article="${A}-l3"]`).click();
  await enregistrer(p).click();
  verifier("1. C confirmé : toutes les décisions prises", await attendre(async () => (await lignesDe(A)).find((x) => x.libelle === "Article C").statutValidation === "VALIDEE"));
  const c = (await lignesDe(A)).find((x) => x.libelle === "Article C");
  const d = await lecture(A);
  verifier("1. C garde l'auteur DG (decideParId) et le décideur Finance est enregistré", c.decideParId === idDG && c.decideurFinanceId === idFinance);
  verifier("1. montant validé = 20 000, étape Terminée", Number(d.montantValide) === 20000 && d.etapeCircuit === "TERMINEE");
  verifier("1. statut « Validée, non réglée » (plus « En cours », un article rejeté ne l'empêche pas)", d.statut === "VALIDEE_NON_REGLEE");
  verifier("1. clôture : approbation du DG encore due (A validé par la Finance seule)", d.validationCompleteParDG === false);
  await p.reload();
  verifier("1. écran : « Validée, non réglée » et plus de « En cours »", (await p.getByText("Validée, non réglée").count()) >= 1 && (await p.getByText(/^En cours \(\d+\/\d+/).count()) === 0);
  verifier("1. frise : Service non requise, Finance faite, DG faite, Assistant en cours", (await statutFrise(p, "FINANCE")) === "FAITE" && (await statutFrise(p, "DG")) === "FAITE" && (await statutFrise(p, "ASSISTANT")) === "EN_COURS");
  const hist = await q(`SELECT action FROM "HistoriqueEntry" WHERE "entityId" = $1 AND action IN ('decision_circuit','soumission_lignes_dg','validation_ligne_dg')`, [A]);
  verifier("1. historique : décisions, soumission et décision du DG tracées", hist.length >= 3, hist.map((h) => h.action).join(","));
  await ctx.close();
}
{
  const { ctx, p } = await connecter("collaborateur@simassurances.test");
  await p.goto(`${B}/treso/demandes`);
  verifier("1. demandeur : sa liste affiche le statut réel", (await p.locator("main").innerText()).includes("Validée, non réglée"));
  await ctx.close();
}

// ======================================================================================================================
// 2. Libellé « En cours » côté demandeur, pendant que des articles attendent
// ======================================================================================================================
const E = await demande("e", { lignes: ARTICLES });
await q(`UPDATE "LigneDemande" SET "statutValidation" = 'VALIDEE', "decideParId" = $2, "decideurFinanceId" = $2 WHERE id = $1`, [`${E}-l1`, idFinance]);
await q(`UPDATE "Demande" SET statut = 'PARTIELLEMENT_VALIDEE', "montantValide" = 10000 WHERE id = $1`, [E]);
{
  const { ctx, p } = await connecter("collaborateur@simassurances.test");
  await p.goto(`${B}/treso/demandes`);
  verifier("2. demandeur : « En cours (1/3 traité) » dans sa liste", (await p.locator("main").innerText()).includes("En cours (1/3 traité)"));
  await p.goto(`${B}/treso/demandes/${E}`);
  verifier("2. demandeur : « En cours (1/3 traité) » sur le détail", (await p.getByText("En cours (1/3 traité)").count()) >= 1);
  await ctx.close();
}

// ======================================================================================================================
// 3. Tous les articles rejetés : la demande repart en correction
// ======================================================================================================================
const T = await demande("t", { lignes: ARTICLES });
{
  const { ctx, p } = await connecter("finance@simassurances.test");
  await pageFinance(p, T);
  for (const lib of ["Article A", "Article B", "Article C"]) {
    await carte(p, lib).getByRole("button", { name: "Rejeter", exact: true }).click();
    await carte(p, lib).getByLabel("Motif du rejet de la ligne").fill(`Refus de ${lib}`);
  }
  await enregistrer(p).click();
  verifier("3. tous rejetés : la demande repart en correction (niveau Finance)", await attendre(async () => (await lecture(T)).etapeCircuit === "A_CORRIGER"));
  const d = await lecture(T);
  verifier("3. montant validé 0, niveau de rejet Finance, statut en attente de validation", Number(d.montantValide) === 0 && d.niveauRejet === "FINANCE" && d.statut === "EN_ATTENTE_VALIDATION");
  await ctx.close();
}
{
  const { ctx, p } = await connecter("collaborateur@simassurances.test");
  await p.goto(`${B}/treso/demandes/${T}`);
  verifier("3. demandeur : la demande est « À corriger »", (await p.getByText("À corriger").count()) >= 1);
  await ctx.close();
}

// ======================================================================================================================
// 4. Rejeter la demande ENTIÈRE : possible tant qu'aucun article n'est décidé, interdit après une validation
// ======================================================================================================================
const R = await demande("r", { lignes: ARTICLES });
{
  const { ctx, p } = await connecter("finance@simassurances.test");
  await pageFinance(p, R);
  const rejeter = p.getByRole("button", { name: "Rejeter la demande", exact: true });
  verifier("4. rien de décidé : « Rejeter la demande » actif", (await rejeter.count()) === 1 && !(await rejeter.isDisabled()));
  await carte(p, "Article A").getByRole("button", { name: "Valider", exact: true }).click();
  await enregistrer(p).click();
  await attendre(async () => (await lignesDe(R)).some((x) => x.statutValidation === "VALIDEE"));
  await p.reload();
  const r2 = p.getByRole("button", { name: "Rejeter la demande", exact: true });
  verifier("4. après une validation : « Rejeter la demande » grisé", (await r2.count()) === 1 && (await r2.isDisabled()));
  const phrase = (await p.locator("[data-raison-circuit]").first().innerText()).trim();
  verifier("4. la phrase explique pourquoi", phrase.includes("déjà validés"), phrase);
  verifier("4. la demande n'est pas partie en correction", (await lecture(R)).etapeCircuit === "FINANCE");
  await ctx.close();
}

// ======================================================================================================================
// 5. Le bénéficiaire d'un article ne le décide pas
// ======================================================================================================================
const G = await demande("g", { lignes: [{ libelle: "Article A", beneficiaireUserId: idFinance }, { libelle: "Article B" }] });
{
  const { ctx, p } = await connecter("finance@simassurances.test");
  await pageFinance(p, G);
  const bA = carte(p, "Article A").getByRole("button", { name: "Valider", exact: true });
  const bB = carte(p, "Article B").getByRole("button", { name: "Valider", exact: true });
  verifier("5. article dont Finance est bénéficiaire : Valider grisé", await bA.isDisabled());
  const raison = (await carte(p, "Article A").locator("[data-raison-decision-article]").innerText()).trim();
  verifier("5. phrase « Vous êtes le bénéficiaire de l'article… »", raison.startsWith("Vous êtes le bénéficiaire de l'article « Article A »"), raison);
  verifier("5. l'autre article reste décidable", !(await bB.isDisabled()));
  await ctx.close();
}

// ======================================================================================================================
// 6. Script de reprise : simulation, application, idempotence
// ======================================================================================================================
const S = await demande("s", { statut: "PARTIELLEMENT_VALIDEE", etape: "TERMINEE", lignes: ARTICLES });
await q(`UPDATE "LigneDemande" SET "statutValidation" = 'VALIDEE' WHERE id IN ($1, $2)`, [`${S}-l1`, `${S}-l2`]);
await q(`UPDATE "LigneDemande" SET "statutValidation" = 'REJETEE', "motifRejet" = 'non' WHERE id = $1`, [`${S}-l3`]);
await q(`UPDATE "Demande" SET "montantValide" = 20000 WHERE id = $1`, [S]);
const env = { ...process.env, DATABASE_URL: `${DB.split("?")[0]}?schema=public` };
const lancerReprise = (...args) =>
  execFileSync("npx", ["tsx", "prisma/recalculer-statuts-articles.ts", ...args], { cwd: path.join(RACINE, "backend"), env, encoding: "utf8" });
const sim = lancerReprise();
verifier("6. reprise en simulation : liste le changement sans écrire", sim.includes("DEM-LOTB-S") && (await lecture(S)).statut === "PARTIELLEMENT_VALIDEE", sim.split("\n").find((x) => x.includes("DEM-LOTB-S")) ?? "");
const app = lancerReprise("--appliquer");
verifier("6. reprise appliquée : « Validée, non réglée » (tous les articles sont traités)", app.includes("corrigée(s)") && (await lecture(S)).statut === "VALIDEE_NON_REGLEE");
const encore = lancerReprise();
verifier("6. reprise idempotente : second passage sans changement", !encore.includes("DEM-LOTB-S"), encore.trim().split("\n").pop());

// ======================================================================================================================
// 7. Demande émise par la Finance (cas b) : le DG décide les articles par sous-ensemble (décision définitive)
// ======================================================================================================================
const BB = await demande("b", { createur: "assistant-finance@simassurances.test", etape: "DG", mode: "OBLIGATOIRE", lignes: ARTICLES });
{
  const { ctx, p } = await connecter("dg@simassurances.test");
  await p.goto(`${B}/treso/dg`);
  verifier("7. cas b : la demande figure dans la file du DG", (await p.locator("main").innerText()).includes("DEM-LOTB-B"));
  await p.goto(`${B}/treso/dg/${BB}`);
  await carte(p, "Article A").getByRole("button", { name: "Valider", exact: true }).click();
  await carte(p, "Article B").getByRole("button", { name: "Rejeter", exact: true }).click();
  await carte(p, "Article B").getByLabel("Motif du rejet de la ligne").fill("Non prioritaire");
  await remplirMotif(p, MOTIF, "motifDG");
  await enregistrer(p).click();
  verifier("7. cas b : DG décide A et B sans C", await attendre(async () => (await lignesDe(BB)).filter((x) => x.statutValidation !== "EN_ATTENTE").length === 2));
  let d = await lecture(BB);
  let l = await lignesDe(BB);
  verifier("7. cas b : A validé par le DG (aucun décideur Finance), montant validé 10 000, reste à l'étape DG", l.find((x) => x.libelle === "Article A").decideParId === idDG && l.find((x) => x.libelle === "Article A").decideurFinanceId === null && Number(d.montantValide) === 10000 && d.etapeCircuit === "DG");
  verifier("7. cas b : approbation de clôture pas encore donnée (demande en cours)", d.validationCompleteParDG === false);
  await p.reload();
  await carte(p, "Article C").getByRole("button", { name: "Valider", exact: true }).click();
  await remplirMotif(p, MOTIF, "motifDG");
  await enregistrer(p).click();
  verifier("7. cas b : dernier article décidé → Terminée", await attendre(async () => (await lecture(BB)).etapeCircuit === "TERMINEE"));
  d = await lecture(BB);
  const approb = (await q(`SELECT "dgApprobateurId" FROM "Demande" WHERE id = $1`, [BB]))[0].dgApprobateurId;
  verifier("7. cas b : la décision du DG vaut approbation de clôture (au nom du DG), statut « Validée, non réglée »", d.validationCompleteParDG === true && approb === idDG && d.statut === "VALIDEE_NON_REGLEE" && Number(d.montantValide) === 20000);
  await ctx.close();
}

// ======================================================================================================================
// 8. Dépense directe (sans article) : comportement d'origine inchangé
// ======================================================================================================================
{
  const objet = (await q(`SELECT id, "categorieId" FROM "Objet" LIMIT 1`))[0];
  const idDD = `${PREFIXE}dd`;
  await q(
    `INSERT INTO "Demande"(id, reference, montant, statut, "createurId", "updatedAt", "beneficiaireType", "etapeCircuit", "etapeFinanceRequise",
       "etapeServiceRequise", "modeEtapeDG", description, "typeDemande", "natureDepenseDirecte", "categorieId", "objetId")
     VALUES ($1, 'DEM-LOTB-DD', 30000, 'EN_ATTENTE_VALIDATION', $2, now(), 'COLLABORATEUR', 'FINANCE', true, false, 'OPTIONNELLE', 'dépense directe e2e',
       'DEPENSE_DIRECTE', 'AUTRE', $3, $4)`,
    [idDD, await uid("collaborateur@simassurances.test"), objet.categorieId, objet.id]
  );
  const { ctx, p } = await connecter("finance@simassurances.test");
  await pageFinance(p, idDD);
  await p.getByRole("button", { name: "Valider totalement", exact: true }).click();
  await p.getByRole("button", { name: "Confirmer la validation totale" }).click();
  verifier("8. dépense directe : validation totale → Terminée", await attendre(async () => (await lecture(idDD)).etapeCircuit === "TERMINEE"));
  const d = await lecture(idDD);
  verifier("8. dépense directe : montant validé 30 000, statut « Validée, non réglée »", Number(d.montantValide) === 30000 && d.statut === "VALIDEE_NON_REGLEE");
  await ctx.close();
}

await db.end();
await browser.close();
console.log(resultats.join("\n"));
if (erreursJs.length) console.log(`KO erreurs JavaScript : ${erreursJs.join(" | ")}`);
const ko = resultats.filter((r) => r.startsWith("KO")).length + (erreursJs.length ? 1 : 0);
console.log(`\n${resultats.length - resultats.filter((r) => r.startsWith("KO")).length}/${resultats.length} contrôles OK${erreursJs.length ? ", erreurs JS présentes" : ", aucune erreur JavaScript"}`);
process.exit(ko ? 1 : 0);
