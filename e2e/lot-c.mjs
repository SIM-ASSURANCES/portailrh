// Autonomie des articles, lot C (2026-10-20) — décision du DG par article, notifications nommant l'article, rappel unique,
// clôture « tous les articles terminés » et clôture forcée, sur base JETABLE (voir e2e/README.md). Nécessite `unzip`.
//
// Scénario principal (demande à 3 articles) : A soumis puis validé par le DG puis confirmé par la Finance ; B soumis, refusé
// par le DG, resoumis puis validé ; C rejeté par la Finance. Puis : clôture bloquée tant qu'un article n'est pas régularisé
// (message qui liste les articles et ce qui manque), clôture forcée (motif de 10 caractères, garde 8, historique,
// notifications, reporting/export, caisse intacte), clôture ordinaire possible une fois tout régularisé, rappel unique
// nommant les articles et remis à zéro à chaque événement.
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import pg from "pg";
import { assurerSignatures } from "./signatures-auto.mjs";
import { MOTIF, remplirMotif, remplirMotifArticle, remplirMotifDans } from "./motifs.mjs";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");

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
// `toLocaleString("fr-FR")` insère des espaces insécables fines : on compare avec des espaces ordinaires.
const norm = (s) => String(s).replace(/[  ]/g, " ");

// --- Données de test (idempotentes : on repart de zéro à chaque lancement) --------------------------------------
const PREFIXE = "e2e-lotc-";
const IDS = `SELECT id FROM "Demande" WHERE id LIKE '${PREFIXE}%'`;
await q(`DELETE FROM "DepenseLigne" WHERE "retourCaisseId" LIKE '${PREFIXE}%'`);
await q(`DELETE FROM "RetourCaisse" WHERE id LIKE '${PREFIXE}%'`);
await q(`DELETE FROM "Reglement" WHERE "demandeId" LIKE '${PREFIXE}%'`);
await q(`DELETE FROM "HistoriqueEntry" WHERE "entityId" LIKE '${PREFIXE}%' OR "entityId" IN (SELECT id FROM "LigneDemande" WHERE "demandeId" LIKE '${PREFIXE}%')`);
await q(`DELETE FROM "Notification" WHERE lien LIKE '%${PREFIXE}%'`);
await q(`DELETE FROM "LigneDemande" WHERE "demandeId" LIKE '${PREFIXE}%'`);
await q(`DELETE FROM "Demande" WHERE id LIKE '${PREFIXE}%'`);

const uid = async (email) => (await q(`SELECT id FROM "User" WHERE email = $1`, [email]))[0].id;
const idFinance = await uid("finance@simassurances.test");
const idDG = await uid("dg@simassurances.test");
const idCollab = await uid("collaborateur@simassurances.test");
const idAssistant = await uid("assistant-finance@simassurances.test");
const categorie = (await q(`SELECT id FROM "Categorie" LIMIT 1`))[0].id;

async function demande(suffixe, { statut = "EN_ATTENTE_VALIDATION", etape = "FINANCE", mode = "OPTIONNELLE", validationDG = false, lignes }) {
  const id = `${PREFIXE}${suffixe}`;
  const valides = lignes.filter((l) => l.statut === "VALIDEE").length;
  await q(
    `INSERT INTO "Demande"(id, reference, montant, "montantValide", statut, "createurId", "updatedAt", "beneficiaireType", "etapeCircuit",
       "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", description, "validationCompleteParDG", "dgApprobateurId")
     VALUES ($1, $2, $3, $4, $5, $6, now(), 'COLLABORATEUR', $7, $8, false, $9, 'test e2e lot C', $10, $11)`,
    [id, `DEM-LOTC-${suffixe.toUpperCase()}`, lignes.length * 10000, valides * 10000, statut, idCollab, etape, mode !== "OBLIGATOIRE", mode, validationDG, validationDG ? idDG : null]
  );
  for (const [i, l] of lignes.entries()) {
    await q(
      `INSERT INTO "LigneDemande"(id, libelle, quantite, "prixUnitaire", "demandeId", "categorieId", motif, "statutValidation", "decideParId", "decideurFinanceId")
       VALUES ($1, $2, 1, 10000, $3, $4, 'motif', $5, $6, $6)`,
      [`${id}-l${i + 1}`, l.libelle, id, categorie, l.statut ?? "EN_ATTENTE", l.statut === "VALIDEE" ? idFinance : null]
    );
  }
  return id;
}
const lignesDe = (id) =>
  q(`SELECT id, libelle, "statutValidation", "decideurFinanceId", "soumiseAuDG", "decisionDG", "motifRefusDG" FROM "LigneDemande" WHERE "demandeId" = $1 ORDER BY libelle`, [id]);
const lecture = async (id) =>
  (await q(`SELECT statut, "etapeCircuit", "montantValide", "validationCompleteParDG", "etapeCircuitDepuis", "dernierRappelAt", "clotureForcee", "clotureForceeParId", "clotureForceeArticles", "motifCloture" FROM "Demande" WHERE id = $1`, [id]))[0];
const vieillirChrono = (id) => q(`UPDATE "Demande" SET "etapeCircuitDepuis" = now() - interval '3 days', "dernierRappelAt" = NULL WHERE id = $1`, [id]);
const chronoRecent = async (id) => new Date((await lecture(id)).etapeCircuitDepuis).getTime() > Date.now() - 2 * 60 * 1000;
const notifs = (depuis, userId, motif) =>
  q(`SELECT titre, message FROM "Notification" WHERE "userId" = $1 AND "createdAt" >= $2 AND message ILIKE $3 ORDER BY "createdAt"`, [userId, depuis, motif]);
const soldeCaisse = async () => Number((await q(`SELECT COALESCE(SUM(CASE WHEN type = 'ENTREE' THEN montant ELSE -montant END), 0) AS s FROM "JournalCaisse"`))[0].s);

// Règlement (Banque : aucun impact sur la caisse) d'un article, avec ou sans détail de dépenses.
async function reglerArticle(demandeId, ligneId, { depenses }) {
  const rid = `${ligneId}-rg`;
  await q(`INSERT INTO "Reglement"(id, montant, mode, "estConfirme", "demandeId", "ligneDemandeId", "auteurId", "confirmeAt") VALUES ($1, 10000, 'BANQUE', true, $2, $3, $4, now())`, [rid, demandeId, ligneId, idAssistant]);
  if (depenses) {
    await q(`INSERT INTO "RetourCaisse"(id, "montantARetourner", "estReceptionne", "reglementId", "declarantId", "receptionneParId", "receptionneAt") VALUES ($1, 0, true, $2, $3, $4, now())`, [`${rid}-ret`, rid, idCollab, idAssistant]);
    await q(`INSERT INTO "DepenseLigne"(id, montant, objet, date, justification, "retourCaisseId") VALUES ($1, 10000, 'Dépense justifiée', now(), 'FACTURE', $2)`, [`${rid}-dep`, `${rid}-ret`]);
  }
}

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
const carte = (p, libelle) => p.locator("div.card-shadow-hover", { hasText: libelle }).first();
const enregistrer = (p) => p.getByRole("button", { name: /^Enregistrer/ });

// ======================================================================================================================
// 1. Décision du DG par article : A validé + confirmé, B refusé puis resoumis puis validé, C rejeté
// ======================================================================================================================
const D = await demande("d", { lignes: [{ libelle: "Article A" }, { libelle: "Article B" }, { libelle: "Article C" }] });
const [LA, LB, LC] = [`${D}-l1`, `${D}-l2`, `${D}-l3`];
const t1 = new Date();
{
  const { ctx, p } = await connecter("finance@simassurances.test");
  await pageFinance(p, D);
  // La Finance rejette C (définitif), soumet A puis B au DG (deux gestes, un par article).
  await carte(p, "Article C").getByRole("button", { name: "Rejeter", exact: true }).click();
  await carte(p, "Article C").getByLabel("Motif du rejet de la ligne").fill("Hors périmètre");
  await enregistrer(p).click();
  verifier("1. C rejeté (définitif)", await attendre(async () => (await lignesDe(D)).find((l) => l.libelle === "Article C").statutValidation === "REJETEE"));
  await p.reload();
  await vieillirChrono(D);
  await remplirMotifArticle(p, `${LA}`);
  await p.locator(`[data-soumettre-article="${LA}"]`).click();
  verifier("1. A soumis au DG", await attendre(async () => (await lignesDe(D)).find((l) => l.libelle === "Article A").soumiseAuDG === true));
  await p.reload();
  await remplirMotifArticle(p, `${LB}`);
  await p.locator(`[data-soumettre-article="${LB}"]`).click();
  verifier("1. B soumis au DG", await attendre(async () => (await lignesDe(D)).find((l) => l.libelle === "Article B").soumiseAuDG === true));
  verifier("1. chronomètre unique remis à zéro par la soumission", await chronoRecent(D));
  await ctx.close();
}
{
  const n = await notifs(t1, idDG, "%DEM-LOTC-D%");
  const messageA = n.map((x) => norm(x.message)).find((m) => m.includes("Article A"));
  verifier("2. DG notifié à la soumission de A en nommant l'article, son bénéficiaire et le montant", !!messageA && messageA.includes("bénéficiaire") && messageA.includes("10 000 FCFA") && messageA.includes("DEM-LOTC-D") && messageA.includes("service"), messageA?.slice(0, 160));
  verifier("2. aucune notification du DG ne mélange un article rejeté (C)", n.every((x) => !x.message.includes("Article C")));
}
{
  const { ctx, p } = await connecter("dg@simassurances.test");
  await p.goto(`${B}/treso/dg/${D}`);
  verifier("3. DG : il voit les deux articles soumis (A et B), pas C", (await p.locator("[data-ligne-dg]").count()) === 2 && (await p.locator('[data-ligne-dg="Article C"]').count()) === 0);
  await vieillirChrono(D);
  const t2 = new Date();
  // A validé, B refusé : décisions indépendantes l'une de l'autre.
  await remplirMotifDans(p.locator('[data-ligne-dg="Article A"]'));
  await p.locator('[data-ligne-dg="Article A"]').getByRole("button", { name: "Valider", exact: true }).click();
  verifier("3. DG : A validé", await attendre(async () => (await lignesDe(D)).find((l) => l.libelle === "Article A").decisionDG === "VALIDEE"));
  verifier("3. DG : B toujours en attente (décision indépendante)", (await lignesDe(D)).find((l) => l.libelle === "Article B").decisionDG === null);
  verifier("3. chronomètre remis à zéro par la décision du DG", await chronoRecent(D));
  await p.reload();
  const carteB = p.locator('[data-ligne-dg="Article B"]');
  await remplirMotifDans(carteB, "Hors budget");
  await carteB.getByRole("button", { name: "Rejeter", exact: true }).click();
  verifier("3. DG : B rejeté avec motif", await attendre(async () => (await lignesDe(D)).find((l) => l.libelle === "Article B").decisionDG === "REFUSEE"));
  await ctx.close();
  // La Finance est prévenue du refus de B (nommé) et, le DG ayant fini, de A à confirmer / B à trancher — pas deux fois la même.
  await attendre(async () => (await notifs(t2, idFinance, "%DEM-LOTC-D%")).length >= 1);
  const n = (await notifs(t2, idFinance, "%DEM-LOTC-D%")).map((x) => ({ titre: x.titre, message: norm(x.message) }));
  // B étant la DERNIÈRE ligne en attente du DG, son refus n'envoie PAS une seconde notification « ligne refusée » : la
  // notification d'examen terminé porte déjà l'article refusé, son bénéficiaire, son montant et le motif.
  const refus = n.find((x) => x.message.includes("Article B") && x.message.includes("rejeté par le DG"));
  verifier("3. Finance prévenue du refus : article B nommé avec bénéficiaire et montant, motif transmis", !!refus && refus.message.includes("bénéficiaire") && refus.message.includes("10 000 FCFA") && refus.message.includes("Hors budget"), refus?.message.slice(0, 160));
  const fin = n.find((x) => x.titre === "Demande à décider (Finance)");
  verifier("3. Finance prévenue de l'examen terminé : A à confirmer, B refusé à trancher (une seule notification)", !!fin && fin.message.includes("Article A") && fin.message.includes("Article B") && n.length === 1, fin?.message.slice(0, 200));
}
{
  const { ctx, p } = await connecter("finance@simassurances.test");
  await pageFinance(p, D);
  verifier("4. Finance : A « à confirmer » — bouton Confirmer, jamais Rejeter (DG définitif)", (await p.locator(`[data-confirmer-article="${LA}"]`).count()) === 1 && (await carte(p, "Article A").getByRole("button", { name: /^Rejeter/ }).count()) === 0);
  verifier("4. Finance : B rejeté par le DG — Resoumettre disponible, rejet définitif possible", (await p.locator(`[data-soumettre-article="${LB}"]`).count()) === 1 && (await carte(p, "Article B").getByRole("button", { name: "Rejeter définitivement" }).count()) === 1);
  await p.locator(`[data-confirmer-article="${LA}"]`).click();
  await enregistrer(p).click();
  verifier("4. A confirmé par la Finance (validé)", await attendre(async () => (await lignesDe(D)).find((l) => l.libelle === "Article A").statutValidation === "VALIDEE"));
  await p.reload();
  const t4 = new Date();
  await vieillirChrono(D);
  await remplirMotifArticle(p, `${LB}`);
  await p.locator(`[data-soumettre-article="${LB}"]`).click();
  verifier("4. B resoumis au DG (resoumission après refus)", await attendre(async () => (await lignesDe(D)).find((l) => l.libelle === "Article B").decisionDG === null && (await lignesDe(D)).find((l) => l.libelle === "Article B").soumiseAuDG === true));
  verifier("4. chronomètre remis à zéro par la resoumission", await chronoRecent(D));
  await attendre(async () => (await notifs(t4, idDG, "%DEM-LOTC-D%")).length >= 1);
  const n = (await notifs(t4, idDG, "%DEM-LOTC-D%")).map((x) => norm(x.message));
  verifier("4. DG notifié de la resoumission : B nommé, « resoumis après refus »", n.some((m) => m.includes("Article B") && m.includes("resoumis")), n[0]?.slice(0, 200));
  await ctx.close();
}
{
  const { ctx, p } = await connecter("dg@simassurances.test");
  await p.goto(`${B}/treso/dg/${D}`);
  await remplirMotifDans(p.locator('[data-ligne-dg="Article B"]'));
  await p.locator('[data-ligne-dg="Article B"]').getByRole("button", { name: "Valider", exact: true }).click();
  verifier("4. DG : B (resoumis) validé", await attendre(async () => (await lignesDe(D)).find((l) => l.libelle === "Article B").decisionDG === "VALIDEE"));
  await ctx.close();
}
{
  const { ctx, p } = await connecter("finance@simassurances.test");
  await pageFinance(p, D);
  await p.locator(`[data-confirmer-article="${LB}"]`).click();
  await enregistrer(p).click();
  verifier("4. B confirmé par la Finance", await attendre(async () => (await lignesDe(D)).find((l) => l.libelle === "Article B").statutValidation === "VALIDEE"));
  const d = await lecture(D);
  verifier("4. toutes les décisions prises : A et B validés, C rejeté, étape Terminée, montant validé 20 000", d.etapeCircuit === "TERMINEE" && Number(d.montantValide) === 20000);
  verifier("4. approbation du DG acquise (articles validés par le DG)", d.validationCompleteParDG === true);
  await ctx.close();
}

// ======================================================================================================================
// 5. Clôture bloquée tant qu'un article n'est pas réglé ET à solde nul
// ======================================================================================================================
{
  const { ctx, p } = await connecter("finance@simassurances.test");
  await pageFinance(p, D);
  verifier("5. aucun règlement : clôture bloquée, les deux articles validés sont listés avec ce qui manque", (await p.locator("[data-cloture-bloquee]").count()) === 1 && (await p.locator("[data-article-bloquant]").count()) === 2);
  const txt = norm(await p.locator("[data-cloture-bloquee]").innerText());
  verifier("5. message : « Article A », « Article B », « reste à régler 10 000 FCFA », jamais C (rejeté, terminé)", txt.includes("Article A") && txt.includes("Article B") && txt.includes("reste à régler 10 000 FCFA") && !txt.includes("Article C"), txt.slice(0, 220));
  verifier("5. boutons de clôture normale grisés", (await p.getByRole("button", { name: "Clôturer totalement" }).isDisabled()) && (await p.getByRole("button", { name: "Clôturer partiellement" }).isDisabled()));
  await ctx.close();
}
// A réglé en entier et régularisé (dépenses = fonds remis) ; B réglé mais dépenses pas détaillées.
await reglerArticle(D, LA, { depenses: true });
await reglerArticle(D, LB, { depenses: false });
{
  const { ctx, p } = await connecter("finance@simassurances.test");
  await pageFinance(p, D);
  const items = await p.locator("[data-article-bloquant]").allInnerTexts();
  verifier("5. A régularisé : il disparaît de la liste, seul B bloque", items.length === 1 && items[0].includes("Article B"), items.join(" | "));
  const txt = norm(items[0] ?? "");
  verifier("5. B : « dépenses à détailler 10 000 FCFA » et « solde à régulariser 10 000 FCFA » (plus de « reste à régler »)", txt.includes("dépenses à détailler 10 000 FCFA") && txt.includes("solde à régulariser 10 000 FCFA") && !txt.includes("reste à régler"), txt);

  // Garde 8 : le demandeur ne force pas la clôture de SA demande (on le simule en lui faisant créer la demande).
  await q(`UPDATE "Demande" SET "createurId" = $2 WHERE id = $1`, [D, idFinance]);
  await p.reload();
  verifier("6. garde 8 : « Forcer la clôture » grisé pour le demandeur, avec la phrase", (await p.locator("[data-forcer-cloture]").isDisabled()) && norm(await p.locator("main").innerText()).includes("demandeur ou le bénéficiaire de cette demande"));
  await q(`UPDATE "Demande" SET "createurId" = $2 WHERE id = $1`, [D, idCollab]);
  await p.reload();

  // Clôture forcée : motif trop court refusé, puis motif valide.
  const caisseAvant = await soldeCaisse();
  const journalAvant = Number((await q(`SELECT count(*) AS n FROM "JournalCaisse"`))[0].n);
  const t6 = new Date();
  await p.locator("[data-forcer-cloture]").click();
  await p.getByLabel(/Motif de la clôture forcée/).fill("trop cour");
  await p.getByRole("button", { name: "Confirmer la clôture forcée" }).click();
  verifier("6. motif de 9 caractères refusé (10 minimum) — la demande n'est pas clôturée", (await p.getByText("10 caractères minimum").count()) >= 1 && (await lecture(D)).statut !== "CLOTUREE");
  await p.getByLabel(/Motif de la clôture forcée/).fill("Le fournisseur de B a disparu, aucun justificatif ne viendra");
  await p.getByRole("button", { name: "Confirmer la clôture forcée" }).click();
  verifier("6. clôture forcée enregistrée", await attendre(async () => (await lecture(D)).statut === "CLOTUREE"));
  const d = await lecture(D);
  const snap = JSON.stringify(d.clotureForceeArticles);
  verifier("6. base : clôturée de force par la Finance, motif conservé", d.clotureForcee === true && d.clotureForceeParId === idFinance && (d.motifCloture ?? "").includes("fournisseur de B"));
  verifier("6. instantané : seul l'article non régularisé (B) avec son solde restant de 10 000", snap.includes("Article B") && !snap.includes("Article A") && snap.includes("10000"), snap);
  const hist = await q(`SELECT detail, "userId" FROM "HistoriqueEntry" WHERE "entityId" = $1 AND action = 'cloture_forcee'`, [D]);
  const hd = norm(hist[0]?.detail ?? "");
  verifier("6. historique : qui, motif et liste des articles non régularisés avec soldes", hist.length === 1 && hist[0].userId === idFinance && hd.includes("fournisseur de B") && hd.includes("Article B") && hd.includes("solde restant 10 000 FCFA"), hd.slice(0, 220));
  verifier("6. caisse : aucune écriture créée ni modifiée, solde identique", (await soldeCaisse()) === caisseAvant && Number((await q(`SELECT count(*) AS n FROM "JournalCaisse"`))[0].n) === journalAvant);
  await attendre(async () => (await notifs(t6, idCollab, "%DEM-LOTC-D%")).length >= 1 && (await notifs(t6, idDG, "%DEM-LOTC-D%")).length >= 1);
  const nc = await notifs(t6, idCollab, "%DEM-LOTC-D%");
  const nd = await notifs(t6, idDG, "%DEM-LOTC-D%");
  verifier("6. demandeur notifié (motif, article non régularisé)", nc.some((x) => x.titre === "Demande clôturée sans régularisation" && x.message.includes("Article B") && x.message.includes("fournisseur de B")));
  verifier("6. DG notifié", nd.some((x) => x.titre === "Demande clôturée de force"));
  verifier("6. l'auteur de la clôture n'est pas notifié", (await notifs(t6, idFinance, "%DEM-LOTC-D%")).length === 0);
  await pageFinance(p, D);
  verifier("6. écran Finance : bandeau « Clôturée sans régularisation complète », motif et article B", (await p.locator("[data-cloture-forcee]").count()) === 1 && norm(await p.locator("[data-articles-non-regularises]").innerText()).includes("Article B"));
  verifier("6. écran Finance : B « Clôturé sans régularisation » avec son solde restant, A non marqué", norm(await carte(p, "Article B").innerText()).includes("Clôturé sans régularisation") && norm(await carte(p, "Article B").innerText()).includes("10 000 FCFA") && !(await carte(p, "Article A").innerText()).includes("Clôturé sans régularisation"));
  verifier("6. plus aucun bouton de clôture", (await p.getByRole("button", { name: "Clôturer totalement" }).count()) === 0 && (await p.locator("[data-forcer-cloture]").count()) === 0);
  // Reporting et export.
  await p.goto(`${B}/treso/finance/reporting`);
  verifier("6. reporting : colonne « Clôture sans régularisation » et la mention sur la demande", (await p.locator("main").innerText()).includes("Clôture sans régularisation") && (await p.locator('table[data-reporting-arbre] tr[data-niveau="0"]', { hasText: "Clôturée de force" }).count()) >= 1);
  const x = await p.request.get(`${B}/api/treso/reporting/export`);
  const dossier = mkdtempSync(join(tmpdir(), "lotc-"));
  const xlsx = join(dossier, "export.xlsx");
  writeFileSync(xlsx, await x.body());
  const partages = norm(execFileSync("unzip", ["-p", xlsx, "xl/sharedStrings.xml"], { maxBuffer: 64 * 1024 * 1024 }).toString());
  verifier("6. export Excel : en-tête et ligne « Clôturée de force … motif … articles non régularisés »", x.status() === 200 && partages.includes("Clôture sans régularisation") && partages.includes("Clôturée de force") && partages.includes("fournisseur de B"));
  await ctx.close();
}
{
  const { ctx, p } = await connecter("collaborateur@simassurances.test");
  await p.goto(`${B}/treso/demandes/${D}`);
  verifier("6. demandeur : voit le bandeau et « Clôturé sans régularisation » sur B", (await p.locator("[data-cloture-forcee]").count()) === 1 && (await p.getByText("Clôturé sans régularisation").count()) >= 1);
  await ctx.close();
}

// ======================================================================================================================
// 7. Clôture ordinaire possible une fois tous les articles terminés
// ======================================================================================================================
const N = await demande("n", { statut: "REGLEE", etape: "TERMINEE", validationDG: true, lignes: [{ libelle: "Article A", statut: "VALIDEE" }, { libelle: "Article B", statut: "VALIDEE" }, { libelle: "Article C", statut: "REJETEE" }] });
await reglerArticle(N, `${N}-l1`, { depenses: true });
await reglerArticle(N, `${N}-l2`, { depenses: true });
{
  const { ctx, p } = await connecter("finance@simassurances.test");
  await pageFinance(p, N);
  verifier("7. tout est terminé : aucun blocage, clôture totale active, pas de bouton « Forcer »", (await p.locator("[data-cloture-bloquee]").count()) === 0 && !(await p.getByRole("button", { name: "Clôturer totalement" }).isDisabled()) && (await p.locator("[data-forcer-cloture]").count()) === 0);
  await p.getByRole("button", { name: "Clôturer totalement" }).click();
  await p.getByRole("button", { name: "Confirmer la clôture totale" }).click();
  verifier("7. clôture ordinaire enregistrée (pas de clôture forcée)", await attendre(async () => (await lecture(N)).statut === "CLOTUREE"));
  verifier("7. la clôture ordinaire ne marque aucune clôture forcée", (await lecture(N)).clotureForcee === false);
  await ctx.close();
}
// Un article réglé en partie seulement bloque, et « tous rejetés sauf un jamais réglé » aussi.
const P = await demande("p", { statut: "VALIDEE_NON_REGLEE", etape: "TERMINEE", validationDG: true, lignes: [{ libelle: "Article A", statut: "VALIDEE" }, { libelle: "Article B", statut: "REJETEE" }] });
await q(`INSERT INTO "Reglement"(id, montant, mode, "estConfirme", "demandeId", "ligneDemandeId", "auteurId", "confirmeAt") VALUES ($1, 4000, 'BANQUE', true, $2, $3, $4, now())`, [`${P}-rg`, P, `${P}-l1`, idAssistant]);
{
  const { ctx, p } = await connecter("finance@simassurances.test");
  await pageFinance(p, P);
  const txt = norm(await p.locator("[data-cloture-bloquee]").innerText());
  verifier("7. article réglé en partie : « reste à régler 6 000 FCFA » listé, clôture bloquée", txt.includes("Article A") && txt.includes("reste à régler 6 000 FCFA") && !txt.includes("Article B"), txt.slice(0, 200));
  await ctx.close();
}

// ======================================================================================================================
// 8. Rappel : un seul chrono par demande, une seule relance, nommant les articles qui attendent
// ======================================================================================================================
const R = await demande("r", { lignes: [{ libelle: "Article A" }, { libelle: "Article B" }] });
await vieillirChrono(R);
const t8 = new Date();
{
  const { ctx, p } = await connecter("collaborateur@simassurances.test");
  await p.goto(`${B}/treso/demandes`); // l'affichage d'une page du portail déclenche le calcul des rappels dus
  verifier("8. rappel envoyé à la Finance, nommant les deux articles en attente", await attendre(async () => (await notifs(t8, idFinance, "%DEM-LOTC-R%")).length >= 1));
  const n = (await notifs(t8, idFinance, "%DEM-LOTC-R%")).map((x) => ({ titre: x.titre, message: norm(x.message) }));
  verifier("8. le rappel cite « Article A » et « Article B » avec la demande", n.some((x) => x.titre.startsWith("Rappel") && x.message.includes("Article A") && x.message.includes("Article B") && x.message.includes("DEM-LOTC-R")), n[0]?.message.slice(0, 200));
  await p.reload();
  await new Promise((r) => setTimeout(r, 3000));
  verifier("8. un seul rappel (24 h minimum entre deux)", (await notifs(t8, idFinance, "%DEM-LOTC-R%")).filter((x) => x.titre.startsWith("Rappel")).length === 1);
  await ctx.close();
}
{
  const { ctx, p } = await connecter("finance@simassurances.test");
  await pageFinance(p, R);
  await carte(p, "Article A").getByRole("button", { name: "Rejeter", exact: true }).click();
  await carte(p, "Article A").getByLabel("Motif du rejet de la ligne").fill("Doublon");
  await enregistrer(p).click();
  await attendre(async () => (await lignesDe(R)).find((l) => l.libelle === "Article A").statutValidation === "REJETEE");
  verifier("8. la décision d'un article remet le chronomètre de la demande à zéro", await chronoRecent(R));
  await ctx.close();
}
// Demande terminée dont un article attend son règlement : le rappel nomme l'article et ce qui manque.
const T = await demande("t", { statut: "VALIDEE_NON_REGLEE", etape: "TERMINEE", validationDG: true, lignes: [{ libelle: "Article A", statut: "VALIDEE" }, { libelle: "Article B", statut: "VALIDEE" }] });
await reglerArticle(T, `${T}-l2`, { depenses: true });
await vieillirChrono(T);
const t9 = new Date();
{
  const { ctx, p } = await connecter("collaborateur@simassurances.test");
  await p.goto(`${B}/treso/demandes`);
  verifier("8. demande terminée : rappel à l'Assistant pour l'article A à régler", await attendre(async () => (await notifs(t9, idAssistant, "%DEM-LOTC-T%")).length >= 1));
  const n = (await notifs(t9, idAssistant, "%DEM-LOTC-T%")).map((x) => norm(x.message));
  verifier("8. le rappel cite A et « reste à régler 10 000 FCFA », pas B (déjà réglé et régularisé)", n.some((m) => m.includes("Article A") && m.includes("reste à régler 10 000 FCFA") && !m.includes("Article B")), n[0]?.slice(0, 200));
  await ctx.close();
}

// --- Bilan ---------------------------------------------------------------------------------------------------------
verifier("aucune erreur JavaScript", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));
console.log(resultats.join("\n"));
console.log(`${resultats.filter((r) => r.startsWith("OK ")).length}/${resultats.length}`);
await browser.close();
await db.end();
process.exit(resultats.some((r) => r.startsWith("KO ")) ? 1 : 0);
