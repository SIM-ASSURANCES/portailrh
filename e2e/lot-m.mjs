// Lot M (2026-10-29) — motif obligatoire dans les deux sens Finance <-> DG, vocabulaire « Rejeter », saisie souple des montants.
// Sur base JETABLE (voir e2e/README.md). Parties :
//  1. Finance -> DG : « Soumettre au DG » d'un article exige un motif (10 à 300) — écran ET appel direct du serveur ; conservé,
//     visible dans l'historique, la notification du DG et l'écran du DG.
//  2. DG -> Finance : valider comme rejeter exige un motif — écran ET appel direct ; conservé et affiché chez la Finance.
//  3. Anciens échanges (avant le lot M) : « Non renseigné », jamais marqué anormal.
//  4. Validation complète du DG (approbation) avec motif ; budgets (seuils de caisse) : soumission et décision avec motif.
//  5. Vocabulaire : « Rejeter » partout, aucun « Refuser/Refus/Refusé » à l'écran.
//  6. Montants : 1500000, 1.500.000, 1 500 000, 1.500.000,50, 1 500 000,50 — champ, écho « 1 500 000 FCFA », devises, serveur.
import { chromium } from "playwright";
import pg from "pg";
import { assurerSignatures } from "./signatures-auto.mjs";
import { MOTIF, MOTIF_COURT, MOTIF_LONG, remplirMotif, remplirMotifArticle, remplirMotifDans } from "./motifs.mjs";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");

const db = new pg.Client({ connectionString: DB });
await db.connect();
await assurerSignatures(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const erreursJs = [];
const sessions = new Map();

async function ouvrir(email) {
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

async function idAction(page, nomAction) {
  const ressources = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name).filter((u) => u.includes("/_next/static/") && u.endsWith(".js")));
  for (const url of ressources) {
    const texte = await (await fetch(url)).text();
    const m = new RegExp(`createServerReference\\)?\\(\\s*"([0-9a-f]{20,})"[^)]*?"${nomAction}"`).exec(texte);
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
const refuse = (r, motif) => !r.succes && new RegExp(motif, "i").test(r.message);
const journalEmpreinte = async () => (await q(`SELECT COALESCE(md5(string_agg(id || ':' || type || ':' || montant::text, ',' ORDER BY id)), '') AS h, count(*)::int AS n FROM "JournalCaisse"`))[0];
const uid = async (email) => (await q(`SELECT id FROM "User" WHERE email = $1`, [email]))[0].id;
const idCollab = await uid("collaborateur@simassurances.test");
const idFinance = await uid("finance@simassurances.test");
const idDG = await uid("dg@simassurances.test");
const categorie = (await q(`SELECT id FROM "Categorie" LIMIT 1`))[0].id;
const journalAvant = await journalEmpreinte();

// Pas de catégorisation obligatoire dans ce scénario (articles catégorisés de toute façon).
await q(`UPDATE "ParametreTresorerie" SET "valeurDate" = NULL WHERE cle = 'categorisation.obligatoire_a_partir_du'`);

// --- Données (idempotentes) --------------------------------------------------------------------------------------
const PREF = "e2e-lotm-";
await q(`DELETE FROM "HistoriqueEntry" WHERE "entityId" LIKE $1 OR "entityId" IN (SELECT id FROM "LigneDemande" WHERE "demandeId" LIKE $1)`, [`${PREF}%`]);
await q(`DELETE FROM "Notification" WHERE lien LIKE $1`, [`%${PREF}%`]);
await q(`DELETE FROM "BudgetDepassement" WHERE "demandeId" LIKE $1`, [`${PREF}%`]);
await q(`DELETE FROM "LigneDemande" WHERE "demandeId" LIKE $1`, [`${PREF}%`]);
await q(`DELETE FROM "Demande" WHERE id LIKE $1`, [`${PREF}%`]);
await q(`DELETE FROM "BudgetParametrage" WHERE portee = 'GLOBAL'`);

async function demande(suffixe, numero, articles, extra = {}) {
  const D = `${PREF}${suffixe}`;
  const total = articles.reduce((s, a) => s + a.montant, 0);
  const valide = articles.filter((a) => a.statut === "VALIDEE").reduce((s, a) => s + a.montant, 0);
  await q(
    `INSERT INTO "Demande"(id, reference, montant, "montantValide", statut, "createurId", "updatedAt", "beneficiaireType", "beneficiaireUserId", "etapeCircuit", "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", "typeDemande", "etapeCircuitDepuis", "soumiseAuDG", "descriptionOriginale", "validationCompleteParDG")
     VALUES ($1, $2, $3, $4, $5, $6, now(), 'COLLABORATEUR', $6, $7, true, false, $8, 'STANDARD', now(), $9, 'test e2e lot M', false)`,
    [D, `DEM-LOTM-${numero}`, total, valide, extra.statut ?? "EN_ATTENTE_VALIDATION", idCollab, extra.etape ?? "FINANCE", extra.mode ?? "OPTIONNELLE", extra.soumiseAuDG ?? false]
  );
  for (const [i, a] of articles.entries()) {
    await q(
      `INSERT INTO "LigneDemande"(id, libelle, "libelleOriginal", quantite, "prixUnitaire", "demandeId", motif, "categorieId", "statutValidation", "decideParId", "decideAt", "decideurFinanceId", "soumiseAuDG", "decisionDG", "decisionDGParId", "decisionDGAt")
       VALUES ($1,$2,$2,1,$3,$4,'motif e2e',$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        `${D}-l${i + 1}`,
        a.libelle,
        a.montant,
        D,
        categorie,
        a.statut ?? "EN_ATTENTE",
        a.statut === "VALIDEE" ? idFinance : null,
        a.statut === "VALIDEE" ? new Date() : null,
        a.statut === "VALIDEE" && !a.decisionDG ? idFinance : null,
        a.soumiseAuDG ?? a.decisionDG != null,
        a.decisionDG ?? null,
        a.decisionDG ? idDG : null,
        a.decisionDG ? new Date() : null,
      ]
    );
  }
  return D;
}
const lig = async (id) => (await q(`SELECT * FROM "LigneDemande" WHERE id = $1`, [id]))[0];
const histo = async (entityId, action) => q(`SELECT detail FROM "HistoriqueEntry" WHERE "entityId" = $1 AND action = $2 ORDER BY "createdAt"`, [entityId, action]);

const D1 = await demande("d1", "1", [{ libelle: "Article M1", montant: 10000 }, { libelle: "Article M2", montant: 20000 }, { libelle: "Article M3", montant: 30000 }]);
const L = (n) => `${D1}-l${n}`;
const MOTIF_ENVOI = "Achat urgent pour la direction commerciale";
const MOTIF_DG_OK = "Validé : dans le budget du trimestre";
const MOTIF_DG_KO = "Rejeté : montant disproportionné";

// ======================================================================================================================
// 1. Finance -> DG : « Soumettre au DG » d'un article
// ======================================================================================================================
{
  const p = await ouvrir("finance@simassurances.test");
  await p.goto(`${B}/treso/finance/demandes/${D1}`);
  const bouton = (n) => p.locator(`[data-soumettre-article="${L(n)}"]`);
  const champ = (n) => p.locator(`[data-motif-echange][name="motifSoumission-${L(n)}"]`);
  verifier("1a. un champ « Motif de l'envoi au DG » est visible sous chaque article soumissible (3)", (await p.locator('[data-motif-echange][name^="motifSoumission-"]').count()) === 3);
  verifier("1a. bouton « Soumettre au DG » GRISÉ tant que le motif est vide", await bouton(1).isDisabled());
  await champ(1).fill(MOTIF_COURT);
  verifier("1a. motif de 9 caractères : bouton grisé et message « au moins 10 caractères »", (await bouton(1).isDisabled()) && /au moins 10 caractères/.test(await p.locator("main").innerText()));
  await champ(1).fill(MOTIF_LONG);
  verifier("1a. motif de 301 caractères : bouton grisé et message « 300 caractères »", (await bouton(1).isDisabled()) && /dépasser 300 caractères/.test(await p.locator("main").innerText()));
  await champ(1).fill(MOTIF_ENVOI);
  verifier("1a. motif valable : bouton actif", !(await bouton(1).isDisabled()));

  // Appels directs du serveur (interface contournée) sur l'article 2 : refusés sans motif valable.
  const idSoumettre = await idAction(p, "soumettreLignesAuDGAction");
  verifier("1b. identifiant de l'action « soumettre au DG » retrouvé", !!idSoumettre);
  if (idSoumettre) {
    const sansMotif = await appelerAction(p, idSoumettre, [D1, [L(2)]]);
    verifier("1b. SERVEUR : appel direct sans motif refusé", refuse(sansMotif, "motif"), sansMotif.message);
    const vide = await appelerAction(p, idSoumettre, [D1, [L(2)], ""]);
    verifier("1b. SERVEUR : motif vide refusé", refuse(vide, "motif"), vide.message);
    const court = await appelerAction(p, idSoumettre, [D1, [L(2)], MOTIF_COURT]);
    verifier("1b. SERVEUR : motif de 9 caractères refusé", refuse(court, "10 caractères"), court.message);
    const long = await appelerAction(p, idSoumettre, [D1, [L(2)], MOTIF_LONG]);
    verifier("1b. SERVEUR : motif de 301 caractères refusé", refuse(long, "300 caractères"), long.message);
    verifier("1b. aucun article soumis par ces appels refusés", (await lig(L(2))).soumiseAuDG === false);
  }

  // Soumission réelle de l'article 1 (le motif saisi à l'écran).
  await bouton(1).click();
  await p.locator('[data-sonner-toast][data-type="success"]').first().waitFor();
  const l1 = await lig(L(1));
  verifier("1c. article 1 soumis, motif conservé avec l'action (LigneDemande.motifSoumissionDG)", l1.soumiseAuDG === true && l1.motifSoumissionDG === MOTIF_ENVOI, String(l1.motifSoumissionDG));
  const h = await histo(L(1), "soumission_lignes_dg").then((x) => (x.length ? x : histo(D1, "soumission_lignes_dg")));
  verifier("1c. historique : l'entrée de soumission porte le motif", h.some((e) => e.detail.includes(MOTIF_ENVOI)), h.map((e) => e.detail).join(" | ").slice(0, 160));
  await p.reload();
  const texte = (await p.locator("main").innerText()).replace(/\s+/g, " ");
  verifier("1d. écran Finance : « Motif de la Finance » affiché sur l'article soumis", texte.includes(`Motif de la Finance : ${MOTIF_ENVOI}`));
  const notifs = await q(`SELECT message FROM "Notification" WHERE "userId" = $1 AND message LIKE $2`, [idDG, `%${MOTIF_ENVOI}%`]);
  verifier("1e. notification du DG : contient le motif de la Finance", notifs.length >= 1 && notifs.some((n) => n.message.includes("Motif de la Finance")), `${notifs.length} notification(s)`);
  await p.close();
}

// ======================================================================================================================
// 2. DG -> Finance : valider ou rejeter un article soumis
// ======================================================================================================================
{
  // Le DG voit l'article 1 soumis ; on soumet aussi l'article 2 (par la Finance) pour disposer de deux décisions.
  const fin = await ouvrir("finance@simassurances.test");
  await fin.goto(`${B}/treso/finance/demandes/${D1}`);
  await remplirMotifArticle(fin, L(2), MOTIF_ENVOI);
  await fin.locator(`[data-soumettre-article="${L(2)}"]`).click();
  await fin.locator('[data-sonner-toast][data-type="success"]').first().waitFor();
  await fin.close();

  const p = await ouvrir("dg@simassurances.test");
  await p.goto(`${B}/treso/dg/${D1}`);
  const carte = (n) => p.locator(`[data-ligne-dg="Article M${n}"]`);
  const valider = (n) => carte(n).getByRole("button", { name: "Valider", exact: true });
  const rejeter = (n) => carte(n).getByRole("button", { name: "Rejeter", exact: true });
  verifier("2a. écran du DG : « Valider » et « Rejeter » GRISÉS tant que le motif est vide", (await valider(1).isDisabled()) && (await rejeter(1).isDisabled()));
  verifier("2a. le DG voit le motif d'envoi de la Finance", (await carte(1).innerText()).includes(MOTIF_ENVOI));
  await carte(1).locator("[data-motif-echange]").fill(MOTIF_COURT);
  verifier("2a. motif de 9 caractères : toujours grisés", (await valider(1).isDisabled()) && (await rejeter(1).isDisabled()));
  await carte(1).locator("[data-motif-echange]").fill(MOTIF_DG_OK);
  verifier("2a. motif valable : les deux boutons actifs", !(await valider(1).isDisabled()) && !(await rejeter(1).isDisabled()));

  const idDecider = await idAction(p, "deciderLigneDGAction");
  verifier("2b. identifiant de l'action « décision du DG » retrouvé", !!idDecider);
  if (idDecider) {
    const v0 = await appelerAction(p, idDecider, [L(2), true]);
    verifier("2b. SERVEUR : VALIDER sans motif refusé", refuse(v0, "motif"), v0.message);
    const r0 = await appelerAction(p, idDecider, [L(2), false]);
    verifier("2b. SERVEUR : REJETER sans motif refusé", refuse(r0, "motif"), r0.message);
    const v1 = await appelerAction(p, idDecider, [L(2), true, MOTIF_COURT]);
    verifier("2b. SERVEUR : VALIDER avec 9 caractères refusé", refuse(v1, "10 caractères"), v1.message);
    const r1 = await appelerAction(p, idDecider, [L(2), false, MOTIF_LONG]);
    verifier("2b. SERVEUR : REJETER avec 301 caractères refusé", refuse(r1, "300 caractères"), r1.message);
    verifier("2b. aucune décision enregistrée par ces appels refusés", (await lig(L(2))).decisionDG === null);
  }

  await valider(1).click();
  await p.locator('[data-sonner-toast][data-type="success"]').first().waitFor();
  await rejeter(2).waitFor();
  await carte(2).locator("[data-motif-echange]").fill(MOTIF_DG_KO);
  await rejeter(2).click();
  await p.locator('[data-sonner-toast][data-type="success"]').nth(1).waitFor().catch(() => {});
  await p.waitForTimeout(1200);
  const l1 = await lig(L(1));
  const l2 = await lig(L(2));
  verifier("2c. article 1 validé par le DG : motif conservé (motifDecisionDG)", l1.decisionDG === "VALIDEE" && l1.motifDecisionDG === MOTIF_DG_OK, String(l1.motifDecisionDG));
  verifier("2c. article 2 rejeté par le DG : motif conservé (motifDecisionDG et motif du rejet)", l2.decisionDG === "REFUSEE" && l2.motifDecisionDG === MOTIF_DG_KO && l2.motifRefusDG === MOTIF_DG_KO, `${l2.decisionDG} / ${l2.motifDecisionDG}`);
  const hv = await histo(L(1), "validation_ligne_dg");
  const hr = await histo(L(2), "refus_ligne_dg");
  const hv2 = hv.length ? hv : await histo(D1, "validation_ligne_dg");
  const hr2 = hr.length ? hr : await histo(D1, "refus_ligne_dg");
  verifier("2d. historique : la validation du DG porte son motif", hv2.some((e) => e.detail.includes(MOTIF_DG_OK)), hv2.map((e) => e.detail).join(" | ").slice(0, 200));
  verifier("2d. historique : le rejet du DG porte son motif", hr2.some((e) => e.detail.includes(MOTIF_DG_KO)), hr2.map((e) => e.detail).join(" | ").slice(0, 200));
  const notif = await q(`SELECT message FROM "Notification" WHERE "userId" = $1 AND (message LIKE $2 OR message LIKE $3)`, [idFinance, `%${MOTIF_DG_OK}%`, `%${MOTIF_DG_KO}%`]);
  verifier("2e. notification de la Finance : contient le motif du DG", notif.length >= 1 && notif.some((n) => /motif du DG/i.test(n.message)), `${notif.length} notification(s)`);
  await p.close();

  // Côté Finance : motifs affichés, parcours, vocabulaire « rejeté ».
  const f = await ouvrir("finance@simassurances.test");
  await f.goto(`${B}/treso/finance/demandes/${D1}`);
  const t = (await f.locator("main").innerText()).replace(/\s+/g, " ");
  verifier("2f. Finance : « Motif du DG » de la validation affiché", t.includes(`Motif du DG : ${MOTIF_DG_OK}`));
  verifier("2f. Finance : « Motif du DG » du rejet affiché", t.includes(`Motif du DG : ${MOTIF_DG_KO}`));
  verifier("2f. Finance : l'article rejeté par le DG est dit « Rejetée par le DG »", /Rejetée par le DG/.test(t));
  verifier("2f. Finance : un article rejeté par le DG propose « Rejeter définitivement »", (await f.getByRole("button", { name: "Rejeter définitivement" }).count()) === 1);
  await f.close();

  // Reporting (Excel) : colonne « Décision DG » = existante, avec les deux motifs.
  const fx = await ouvrir("finance@simassurances.test");
  const rep = await fx.context().request.get(`${B}/api/treso/reporting/export`);
  verifier("2g. export Excel du reporting : 200", rep.status() === 200);
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await rep.body());
  const ws = wb.getWorksheet("Reporting");
  const entetes = ws.getRow(1).values.slice(1);
  const iDG = entetes.indexOf("Décision DG");
  const iArt = entetes.indexOf("Article");
  const iRef = entetes.indexOf("Référence demande");
  let ligneM1 = null;
  let ligneM2 = null;
  ws.eachRow((row) => {
    const v = row.values.slice(1);
    if (String(v[iRef] ?? "") === "DEM-LOTM-1" && v[iArt] === "Article M1") ligneM1 = String(v[iDG] ?? "");
    if (String(v[iRef] ?? "") === "DEM-LOTM-1" && v[iArt] === "Article M2") ligneM2 = String(v[iDG] ?? "");
  });
  verifier("2g. reporting : « Décision DG » de l'article validé = les deux motifs", !!ligneM1 && ligneM1.includes(MOTIF_ENVOI) && ligneM1.includes(MOTIF_DG_OK), String(ligneM1));
  verifier("2g. reporting : « Décision DG » de l'article rejeté = « Rejeté » + les deux motifs", !!ligneM2 && /^Rejeté/.test(ligneM2) && ligneM2.includes(MOTIF_DG_KO) && !/Refus/i.test(ligneM2), String(ligneM2));
  await fx.close();
}

// ======================================================================================================================
// 3. Anciens échanges (avant le lot M) : « Non renseigné », jamais marqué anormal
// ======================================================================================================================
{
  const D3 = await demande("d3", "3", [{ libelle: "Article ancien", montant: 15000, statut: "VALIDEE", decisionDG: "VALIDEE", soumiseAuDG: true }], { etape: "DECISION_FINALE", mode: "OPTIONNELLE", soumiseAuDG: true });
  await q(`INSERT INTO "HistoriqueEntry"(id, entity, "entityId", action, detail, "userId", "createdAt") VALUES (gen_random_uuid()::text, 'Demande', $1, 'validation_ligne_dg', 'DG — ligne « Article ancien » validée', $2, now() - interval '3 days')`, [D3, idDG]);
  await q(`INSERT INTO "HistoriqueEntry"(id, entity, "entityId", action, detail, "userId", "createdAt") VALUES (gen_random_uuid()::text, 'Demande', $1, 'refus_ligne_dg', 'DG — ligne « Article ancien » refusée — motif : ancien motif de rejet', $2, now() - interval '2 days')`, [D3, idDG]);
  const p = await ouvrir("finance@simassurances.test");
  await p.goto(`${B}/treso/finance/demandes/${D3}`);
  const t = (await p.locator("main").innerText()).replace(/\s+/g, " ");
  verifier("3a. ancien échange : « Motif de la Finance : Non renseigné » sur l'article", t.includes("Motif de la Finance : Non renseigné"));
  verifier("3a. ancien échange : « Motif du DG : Non renseigné » sur l'article", t.includes("Motif du DG : Non renseigné"));
  verifier("3b. historique d'une validation du DG sans motif : « motif : Non renseigné »", /Ligne validée par le DG[^|]*motif : Non renseigné/.test(t) || /validée — motif : Non renseigné/.test(t));
  verifier("3c. ancien texte « refusée » affiché « rejetée » à la lecture (rien n'est réécrit en base)", /ligne « Article ancien » rejetée/.test(t) && !/refus/i.test(t));
  const base = await histo(D3, "refus_ligne_dg");
  verifier("3c. la base garde l'ancien texte (aucune réécriture)", base.length === 1 && base[0].detail.includes("refusée"));
  await p.close();
}

// ======================================================================================================================
// 4. Validation complète (approbation de clôture) du DG : motif obligatoire
// ======================================================================================================================
{
  const D4 = await demande("d4", "4", [{ libelle: "Article clôture", montant: 12000, statut: "VALIDEE" }], { etape: "TERMINEE", statut: "VALIDEE_NON_REGLEE" });
  await q(`UPDATE "Demande" SET "decideurFinanceId" = $2 WHERE id = $1`, [D4, idFinance]);
  const p = await ouvrir("dg@simassurances.test");
  await p.goto(`${B}/treso/finance/demandes/${D4}`);
  const approuver = p.getByRole("button", { name: "Approuver la validation complète" });
  if ((await approuver.count()) === 0) {
    verifier("4a. bouton « Approuver la validation complète » présent pour le DG", false, "absent");
  } else {
    verifier("4a. « Approuver la validation complète » GRISÉ sans motif", await approuver.isDisabled());
    const idAppr = await idAction(p, "approuverValidationCompleteAction");
    if (idAppr) {
      const sans = await appelerAction(p, idAppr, [D4]);
      verifier("4b. SERVEUR : approbation sans motif refusée", refuse(sans, "motif"), sans.message);
      const court = await appelerAction(p, idAppr, [D4, MOTIF_COURT]);
      verifier("4b. SERVEUR : approbation avec 9 caractères refusée", refuse(court, "10 caractères"), court.message);
    }
    await remplirMotif(p, MOTIF_DG_OK);
    verifier("4a. motif valable : bouton actif", !(await approuver.isDisabled()));
    await approuver.click();
    await p.locator('[data-sonner-toast][data-type="success"]').first().waitFor();
    const d = (await q(`SELECT "validationCompleteParDG", "motifDecisionDG" FROM "Demande" WHERE id = $1`, [D4]))[0];
    verifier("4c. approbation enregistrée avec son motif", d.validationCompleteParDG === true && d.motifDecisionDG === MOTIF_DG_OK, String(d.motifDecisionDG));
    const h = await histo(D4, "validation_complete_dg");
    verifier("4c. historique : l'approbation porte le motif", h.some((e) => e.detail.includes(MOTIF_DG_OK)), h.map((e) => e.detail).join(" | ").slice(0, 160));
  }
  await p.close();
}

// ======================================================================================================================
// 5. Budgets : seuils de caisse soumis (Finance) puis rejetés (DG), motif dans les deux sens
// ======================================================================================================================
{
  const f = await ouvrir("finance@simassurances.test");
  await f.goto(`${B}/treso/finance/budgets`);
  const form = f.locator("[data-parametrage-caisse-form]");
  const soumettre = form.locator("[data-soumettre-caisse]");
  verifier("5a. seuils de caisse : « Soumettre les seuils au DG » GRISÉ sans motif", await soumettre.isDisabled());
  const idSoum = await idAction(f, "soumettreSeuilsCaisseAction");
  if (idSoum) {
    const saisie = { portee: "GLOBAL", categorieId: null, montant: null, dateDebut: new Date(Date.now() + 86400000).toISOString().slice(0, 10), dateFin: null, seuil: { mode: "MONTANT", orange: "200000", rouge: "50000" } };
    const sans = await appelerAction(f, idSoum, [saisie]);
    verifier("5b. SERVEUR : soumission des seuils sans motif refusée", refuse(sans, "motif"), sans.message);
    const court = await appelerAction(f, idSoum, [saisie, MOTIF_COURT]);
    verifier("5b. SERVEUR : soumission avec 9 caractères refusée", refuse(court, "10 caractères"), court.message);
    verifier("5b. aucun paramétrage créé par ces appels refusés", (await q(`SELECT count(*)::int AS n FROM "BudgetParametrage" WHERE portee = 'GLOBAL'`))[0].n === 0);
  }
  await form.locator("[data-motif-echange]").fill(MOTIF_ENVOI);
  verifier("5a. motif valable : bouton actif", !(await soumettre.isDisabled()));
  await soumettre.click();
  await f.locator('[data-sonner-toast][data-type="success"]').first().waitFor();
  const pg = (await q(`SELECT id, statut, "motifSoumission" FROM "BudgetParametrage" WHERE portee = 'GLOBAL' ORDER BY "soumisAt" DESC LIMIT 1`))[0];
  verifier("5c. paramétrage créé « en attente » avec le motif de la Finance", pg?.statut === "EN_ATTENTE" && pg.motifSoumission === MOTIF_ENVOI, JSON.stringify(pg));
  await f.close();

  const dg = await ouvrir("dg@simassurances.test");
  await dg.goto(`${B}/treso/finance/budgets`);
  const bloc = dg.locator(`[data-section-caisse] [data-parametrage-attente="${pg.id}"]`);
  verifier("5d. DG : le motif de la Finance est affiché", (await bloc.innerText()).includes(MOTIF_ENVOI));
  verifier("5d. DG : « Valider » et « Rejeter » GRISÉS sans motif", (await bloc.locator("[data-valider-parametrage]").isDisabled()) && (await bloc.locator("[data-refuser-parametrage]").isDisabled()));
  verifier("5d. DG : le bouton s'appelle « Rejeter » (plus « Refuser »)", (await bloc.locator("[data-refuser-parametrage]").innerText()).trim() === "Rejeter");
  const idDec = await idAction(dg, "deciderSeuilsCaisseAction");
  if (idDec) {
    const v = await appelerAction(dg, idDec, [[{ id: pg.id }], true]);
    verifier("5e. SERVEUR : VALIDER les seuils sans motif refusé", refuse(v, "motif"), v.message);
    const r = await appelerAction(dg, idDec, [[{ id: pg.id }], false, MOTIF_COURT]);
    verifier("5e. SERVEUR : REJETER les seuils avec 9 caractères refusé", refuse(r, "10 caractères"), r.message);
    verifier("5e. paramétrage toujours en attente", (await q(`SELECT statut FROM "BudgetParametrage" WHERE id = $1`, [pg.id]))[0].statut === "EN_ATTENTE");
  }
  await remplirMotifDans(bloc, MOTIF_DG_KO);
  await bloc.locator("[data-refuser-parametrage]").click();
  await dg.locator('[data-sonner-toast][data-type="success"]').first().waitFor();
  const apres = (await q(`SELECT statut, "motifDecision", "motifRefus" FROM "BudgetParametrage" WHERE id = $1`, [pg.id]))[0];
  verifier("5f. rejet enregistré : statut REFUSE (valeur interne inchangée) et motif du DG conservé", apres.statut === "REFUSE" && apres.motifDecision === MOTIF_DG_KO && apres.motifRefus === MOTIF_DG_KO, JSON.stringify(apres));
  const hb = await q(`SELECT detail FROM "HistoriqueEntry" WHERE action = 'budget_refuse' ORDER BY "createdAt" DESC LIMIT 1`);
  verifier("5f. historique : « Rejeté par le DG » + motif", hb.length === 1 && /Rejeté par le DG/.test(hb[0].detail) && hb[0].detail.includes(MOTIF_DG_KO), hb[0]?.detail?.slice(0, 160));
  const notif = await q(`SELECT titre, message FROM "Notification" WHERE "userId" = $1 AND message LIKE $2`, [idFinance, `%${MOTIF_DG_KO}%`]);
  verifier("5g. notification de la Finance : contient le motif du DG, vocabulaire « rejeté »", notif.length >= 1 && /rejet/i.test(notif[0].titre + notif[0].message) && !/refus/i.test(notif[0].titre + notif[0].message), notif[0]?.titre);
  await dg.reload();
  const suivi = (await dg.locator("[data-historique-caisse]").innerText()).replace(/\s+/g, " ");
  verifier("5h. historique des seuils : « Rejeté par le DG » + les deux motifs", /Rejeté par le DG/.test(suivi) && suivi.includes(`Motif de la Finance : ${MOTIF_ENVOI}`) && suivi.includes(`Motif du DG : ${MOTIF_DG_KO}`));
  await dg.close();
}

// ======================================================================================================================
// 6. Vocabulaire : « Rejeter » partout, plus de « Refuser / Refus / Refusé » à l'écran
// ======================================================================================================================
{
  const pages = [
    ["finance@simassurances.test", `/treso/finance/demandes/${D1}`],
    ["dg@simassurances.test", `/treso/dg/${D1}`],
    ["finance@simassurances.test", "/treso/finance/budgets"],
    ["finance@simassurances.test", "/treso/finance/demandes"],
    ["rh@simassurances.test", "/pointage/justifications"],
  ];
  for (const [email, url] of pages) {
    const p = await ouvrir(email);
    await p.goto(`${B}${url}`);
    const t = await p.locator("body").innerText();
    verifier(`6. ${url} (${email.split("@")[0]}) : aucun « refus / refuser / refusé »`, !/\brefus/i.test(t), (t.match(/.{0,40}\brefus.{0,40}/i) ?? [""])[0]);
    await p.close();
  }
  const p = await ouvrir("dg@simassurances.test");
  await p.goto(`${B}/treso/finance/budgets`);
  verifier("6. budgets (DG) : plus aucun bouton « Refuser »", (await p.getByRole("button", { name: /Refuser/ }).count()) === 0);
  await p.close();
}

// ======================================================================================================================
// 7. Saisie souple des montants
// ======================================================================================================================
{
  const norm = (s) => s.replace(/[   ]/g, " ");
  const p = await ouvrir("finance@simassurances.test");
  await p.goto(`${B}/treso/finance/depenses-directes/nouvelle`);
  const champ = p.locator('[data-input-montant]').first();
  const echo = p.locator("[data-echo-montant]").first();
  const saisir = async (texte) => {
    await champ.fill("");
    await champ.pressSequentially(texte);
    return norm(await champ.inputValue());
  };
  verifier("7a. FCFA : « 1500000 » → affiché « 1 500 000 »", (await saisir("1500000")) === "1 500 000");
  verifier("7a. écho « 1 500 000 FCFA »", norm(await echo.innerText()).includes("1 500 000 FCFA"));
  verifier("7a. FCFA : « 1.500.000 » → affiché « 1 500 000 » (points = milliers)", (await saisir("1.500.000")) === "1 500 000");
  verifier("7a. FCFA : « 1 500 000 » → conservé", (await saisir("1 500 000")) === "1 500 000");
  verifier("7a. FCFA : « 1.500 » → 1 500 (cas ambigu : toujours des milliers en FCFA)", (await saisir("1.500")) === "1 500");
  await champ.fill("1 500 000,50");
  const msg = await champ.evaluate((el) => el.validationMessage);
  verifier("7b. FCFA : « 1 500 000,50 » refusé avec un message clair (pas de décimales en FCFA)", /décimales/.test(msg) && /FCFA/.test(msg), msg);
  await champ.fill("12abc");
  verifier("7b. lettres refusées", /chiffres/.test(await champ.evaluate((el) => el.validationMessage)));
  await champ.fill("-500");
  verifier("7b. signe négatif refusé", /négatif/.test(await champ.evaluate((el) => el.validationMessage)));
  await champ.fill("1,2345,6");
  verifier("7b. séparateurs mal placés refusés", (await champ.evaluate((el) => el.validationMessage)) !== "");
  verifier("7c. attribut inputMode=\"decimal\" (clavier numérique sur mobile)", (await champ.getAttribute("inputmode")) === "decimal");
  // Caret : insertion d'un chiffre au milieu, le curseur reste à sa place.
  await champ.fill("1 500 000");
  await champ.evaluate((el) => el.setSelectionRange(3, 3));
  await p.keyboard.type("9");
  verifier("7d. caret conservé : frappe au milieu d'un nombre", norm(await champ.inputValue()) === "15 900 000" && (await champ.evaluate((el) => el.selectionStart)) === 4, `${norm(await champ.inputValue())} @${await champ.evaluate((el) => el.selectionStart)}`);
  await p.close();

  // Création d'une demande par le vrai formulaire : XOF « 1.500.000 », puis EUR « 1 500 000,50 ».
  const c = await ouvrir("collaborateur@simassurances.test");
  const creer = async (devise, prix, libelle) => {
    await c.goto(`${B}/treso/demandes/nouvelle`);
    await c.getByLabel("Devise").selectOption(devise);
    await c.locator('input[aria-label="Libellé de l\'article"]').first().fill(libelle);
    await c.locator('input[aria-label="Motif de la ligne"]').first().fill("motif e2e montants");
    await c.locator('input[aria-label="Prix unitaire"]').first().fill(prix);
    await c.getByRole("button", { name: "Envoyer la demande" }).click();
    await c.getByText("Demande créée avec succès.").waitFor();
    return (await q(`SELECT l."prixUnitaire", d.devise FROM "LigneDemande" l JOIN "Demande" d ON d.id = l."demandeId" WHERE l.libelle = $1`, [libelle]))[0];
  };
  await q(`DELETE FROM "LigneDemande" WHERE libelle LIKE 'E2E-MONTANT-%'`).catch(() => {});
  const x = await creer("XOF", "1.500.000", "E2E-MONTANT-XOF");
  verifier("7e. demande XOF « 1.500.000 » enregistrée = 1 500 000", x && Number(x.prixUnitaire) === 1500000 && x.devise === "XOF", JSON.stringify(x));
  const e1 = await creer("EUR", "1 500 000,50", "E2E-MONTANT-EUR");
  verifier("7e. demande EUR « 1 500 000,50 » enregistrée = 1 500 000,50 (décimales admises)", e1 && Number(e1.prixUnitaire) === 1500000.5 && e1.devise === "EUR", JSON.stringify(e1));
  const e2 = await creer("EUR", "1.500.000,5", "E2E-MONTANT-EUR2");
  verifier("7e. demande EUR « 1.500.000,5 » enregistrée = 1 500 000,50", e2 && Number(e2.prixUnitaire) === 1500000.5, JSON.stringify(e2));
  const e3 = await creer("EUR", "1500000,5", "E2E-MONTANT-EUR3");
  verifier("7e. demande EUR « 1500000,5 » enregistrée = 1 500 000,50", e3 && Number(e3.prixUnitaire) === 1500000.5, JSON.stringify(e3));

  // Appel direct : le serveur ne fait pas confiance au navigateur (texte non conforme refusé).
  await c.goto(`${B}/treso/demandes/nouvelle`);
  const idCreer = await idAction(c, "creerDemandeAction");
  if (idCreer) {
    const entree = (prix, devise = "XOF") => [{ beneficiaire: { type: "MOI" }, devise, lignes: [{ libelle: "E2E-MONTANT-DIRECT", motif: "motif e2e montants", quantite: 1, prixUnitaire: prix }] }];
    const r1 = await appelerAction(c, idCreer, entree("1 500 000,50"));
    verifier("7f. SERVEUR : XOF « 1 500 000,50 » refusé (décimales interdites en FCFA)", !r1.succes, r1.message);
    const r2 = await appelerAction(c, idCreer, entree("12abc"));
    verifier("7f. SERVEUR : « 12abc » refusé", !r2.succes, r2.message);
    verifier("7f. aucune demande créée par ces appels refusés", (await q(`SELECT count(*)::int AS n FROM "LigneDemande" WHERE libelle = 'E2E-MONTANT-DIRECT'`))[0].n === 0);
  }
  await c.close();
  await q(`DELETE FROM "HistoriqueEntry" WHERE "entityId" IN (SELECT "demandeId" FROM "LigneDemande" WHERE libelle LIKE 'E2E-MONTANT-%')`);
  await q(`DELETE FROM "Notification" WHERE lien LIKE ANY (SELECT '%' || "demandeId" || '%' FROM "LigneDemande" WHERE libelle LIKE 'E2E-MONTANT-%')`);
  const ids = (await q(`SELECT DISTINCT "demandeId" FROM "LigneDemande" WHERE libelle LIKE 'E2E-MONTANT-%'`)).map((r) => r.demandeId);
  await q(`DELETE FROM "PieceJointe" WHERE "demandeId" = ANY($1)`, [ids]).catch(() => {});
  await q(`DELETE FROM "LigneDemande" WHERE "demandeId" = ANY($1)`, [ids]);
  await q(`DELETE FROM "Demande" WHERE id = ANY($1)`, [ids]);
}

// --- Aucune écriture de caisse ------------------------------------------------------------------------------------
const journalApres = await journalEmpreinte();
verifier("8. journal de caisse strictement identique (aucune écriture créée ni modifiée)", journalApres.h === journalAvant.h && journalApres.n === journalAvant.n);

await db.end();
await browser.close();
console.log(resultats.join("\n"));
if (erreursJs.length) console.log(`KO erreurs JavaScript : ${erreursJs.join(" | ")}`);
const ko = resultats.filter((r) => r.startsWith("KO")).length + (erreursJs.length ? 1 : 0);
console.log(`\n${resultats.length - resultats.filter((r) => r.startsWith("KO")).length}/${resultats.length} contrôles OK${erreursJs.length ? ", erreurs JS présentes" : ", aucune erreur JavaScript"}`);
process.exit(ko ? 1 : 0);
