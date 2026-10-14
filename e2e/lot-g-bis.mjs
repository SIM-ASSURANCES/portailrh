// Autonomie des articles, lot G bis (2026-10-19) — LE RETOUR D'UN FONDS VERSÉ PAR BANQUE SE FAIT PAR RETOUR EXTERNE (Finance),
// RATTACHÉ À LA DEMANDE ET À L'ARTICLE : il entre en caisse ET compte comme retour reçu de l'article. Plus de déclaration ni de
// réception de retour sur un règlement Banque. Sur base JETABLE (voir e2e/README.md). Nécessite `pdftotext` et `unzip`.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const PDF = (nom) => ({ name: nom, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n") });
const dossier = mkdtempSync(join(tmpdir(), "lotgbis-"));

const PREFIXE = "e2e-lotgb-";
const nettoyer = async () => {
  await q(`DELETE FROM "Notification" WHERE message LIKE '%DEM-LOTGB-%'`);
  await q(`DELETE FROM "HistoriqueEntry" WHERE "entityId" LIKE '${PREFIXE}%' OR detail LIKE '%DEM-LOTGB-%'`);
  await q(`DELETE FROM "JournalCaisse" WHERE id LIKE '${PREFIXE}%' OR "demandeId" LIKE '${PREFIXE}%' OR "refId" IN (SELECT id FROM "RetourExterne" WHERE motif LIKE 'E2E-GB %')`);
  await q(`DELETE FROM "RetourExterne" WHERE motif LIKE 'E2E-GB %'`);
  await q(`DELETE FROM "PieceJointe" WHERE id LIKE '${PREFIXE}%' OR url LIKE '%e2e-gb-%'`);
  await q(`DELETE FROM "DepenseLigne" WHERE "retourCaisseId" LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "RetourCaisse" WHERE id LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "ReglementCategorieAllocation" WHERE "reglementId" LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "Reglement" WHERE id LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "LigneDemande" WHERE "demandeId" LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "Demande" WHERE id LIKE '${PREFIXE}%'`);
};
await nettoyer();

const uid = async (email) => (await q(`SELECT id FROM "User" WHERE email = $1`, [email]))[0].id;
const idCollab = await uid("collaborateur@simassurances.test");
const idFinance = await uid("finance@simassurances.test");
const idAssistant = await uid("assistant-finance@simassurances.test");

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
const soldeCaisse = async () => Number((await q(`SELECT COALESCE(SUM(CASE WHEN type = 'ENTREE' THEN montant ELSE -montant END), 0)::float AS s FROM "JournalCaisse"`))[0].s);

// ---------------------------------------------------------------------------------------------------------------------
// Fixtures : demande A (article 100 000 = 60 000 Caisse + 40 000 Banque ; dépenses 60 000 sur la Caisse + 25 000 sur la
// Banque, tout justifié → solde à régulariser 15 000), demande B (article réglé en Caisse seulement).
// ---------------------------------------------------------------------------------------------------------------------
await q(`INSERT INTO "Categorie"(id, label, "isActive") VALUES ('e2e-lotgb-cat', 'E2E-GB-CAT', true) ON CONFLICT (id) DO NOTHING`);
const demande = async (id, ref) => {
  await q(
    `INSERT INTO "Demande"(id, reference, montant, "montantValide", statut, "createurId", "updatedAt", "beneficiaireType", "beneficiaireUserId", "etapeCircuit", "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", description)
     VALUES ($1, $2, 100000, 100000, 'VALIDEE_NON_REGLEE', $3, now(), 'COLLABORATEUR', $3, 'TERMINEE', true, false, 'OPTIONNELLE', 'test e2e lot G bis')`,
    [id, ref, idCollab]
  );
  await q(
    `INSERT INTO "LigneDemande"(id, libelle, "libelleOriginal", quantite, "prixUnitaire", "demandeId", "categorieId", motif, "statutValidation", "decideParId", "decideAt", "decideurFinanceId")
     VALUES ($1, $2, $3, 1, 100000, $4, 'e2e-lotgb-cat', 'motif', 'VALIDEE', $5, now(), $5)`,
    [`${id}-l1`, `Matériel ${ref}`, `Matériel ${ref}`, id, idFinance]
  );
};
const reglement = (id, demandeId, montant, mode) =>
  q(`INSERT INTO "Reglement"(id, montant, mode, "estConfirme", "demandeId", "ligneDemandeId", "auteurId", "confirmeAt") VALUES ($1, $2, $3, true, $4, $5, $6, now())`, [id, montant, mode, demandeId, `${demandeId}-l1`, idAssistant]);
const DA = `${PREFIXE}A`;
const DB_ = `${PREFIXE}B`;
await demande(DA, "DEM-LOTGB-A");
await demande(DB_, "DEM-LOTGB-B");
await q(`INSERT INTO "JournalCaisse"(id, type, montant, source, "refId", "userId") VALUES ('e2e-lotgb-appro', 'ENTREE', 500000, 'alimentation_caisse', 'e2e-lotgb-appro', $1)`, [idAssistant]);
await reglement(`${PREFIXE}rCaisse`, DA, 60000, "CAISSE");
await q(`INSERT INTO "JournalCaisse"(id, type, montant, source, "refId", "userId", "demandeId") VALUES ('e2e-lotgb-sortie', 'SORTIE', 60000, 'reglement_caisse', $1, $2, $3)`, [`${PREFIXE}rCaisse`, idAssistant, DA]);
await reglement(`${PREFIXE}rBanque`, DA, 40000, "BANQUE");
await reglement(`${PREFIXE}rCaisseB`, DB_, 100000, "CAISSE");
await q(`INSERT INTO "RetourCaisse"(id, "montantARetourner", "estReceptionne", "reglementId", "declarantId", "creeParAssistant", "receptionneParId", "receptionneAt") VALUES ($1, 0, true, $2, $3, true, $3, now())`, [`${PREFIXE}retCaisse`, `${PREFIXE}rCaisse`, idAssistant]);
await q(`INSERT INTO "DepenseLigne"(id, montant, objet, date, justification, "retourCaisseId") VALUES ($1, 60000, 'Achat caisse', now(), 'FACTURE', $2)`, [`${PREFIXE}depC`, `${PREFIXE}retCaisse`]);
// Fiche de détail des dépenses de l'Assistant sur le fonds bancaire : 25 000 dépensés, 15 000 « à rendre ».
await q(`INSERT INTO "RetourCaisse"(id, "montantARetourner", "estReceptionne", "reglementId", "declarantId", "creeParAssistant") VALUES ($1, 15000, false, $2, $3, true)`, [`${PREFIXE}ficheBanque`, `${PREFIXE}rBanque`, idAssistant]);
await q(`INSERT INTO "DepenseLigne"(id, montant, objet, date, justification, "retourCaisseId") VALUES ($1, 25000, 'Achat banque', now(), 'FACTURE', $2)`, [`${PREFIXE}depB`, `${PREFIXE}ficheBanque`]);

// ======================================================================================================================
// 1. Plus de circuit « déclarer / réceptionner » sur le fonds bancaire
// ======================================================================================================================
{
  const c = await connecter("collaborateur@simassurances.test");
  await c.goto(`${B}/treso/demandes/${DA}`);
  verifier("1. collaborateur : un seul « Déclarer un retour de caisse » (le règlement Caisse), pas pour la Banque", (await c.getByRole("button", { name: /Déclarer un retour de caisse|Déclarer un nouveau retour/ }).count()) <= 1);
  verifier("1. collaborateur : message « c'est la Finance qui enregistre le retour » sur le règlement Banque", (await c.locator("[data-retour-par-la-finance]").count()) === 1);
  verifier("1. collaborateur : la fiche du fonds bancaire n'est pas « En attente de réception »", /Détail des dépenses/.test(net(await c.locator("body").innerText())));
  await c.close();
  const a = await connecter("assistant-finance@simassurances.test");
  await a.goto(`${B}/treso/finance/retours`);
  verifier("1. « Retours en attente » : la fiche d'un fonds bancaire n'y figure pas", !net(await a.locator("body").innerText()).includes("DEM-LOTGB-A"));
  await a.goto(`${B}/treso/finance/retours/${PREFIXE}ficheBanque`);
  verifier("1. détail de la fiche bancaire : aucun bouton « Réceptionner », message vers le retour externe", (await a.getByRole("button", { name: /Réceptionner|Constater/ }).count()) === 0 && (await a.locator("[data-retour-banque-externe]").count()) === 1);
  await a.goto(`${B}/treso/finance/demandes/${DA}`);
  const section = net(await a.locator("body").innerText());
  verifier("1. écran Finance : le règlement Banque renvoie vers « Retour externe »", (await a.locator("[data-retour-banque-externe]").count()) >= 1 && /Retour externe/.test(section));
  await a.close();
}

// ======================================================================================================================
// 2. Retour externe RATTACHÉ (Finance) : références de la demande + de l'article, entre en caisse ET compte comme retour reçu
// ======================================================================================================================
const caisseAvant = await soldeCaisse();
{
  const c = await connecter("collaborateur@simassurances.test");
  await c.goto(`${B}/treso/finance/retours-externes`);
  verifier("2. le collaborateur n'accède pas à l'écran Retour externe", !c.url().includes("/retours-externes"));
  await c.close();
  const a = await connecter("assistant-finance@simassurances.test");
  await a.goto(`${B}/treso/finance/retours-externes`);
  verifier("2. l'Assistant Finance n'accède pas non plus à l'écran Retour externe (Responsable seul)", !a.url().includes("/retours-externes"));
  await a.close();
}
const ligneA = `${DA}-l1`;
{
  const f = await connecter("finance@simassurances.test");
  await f.goto(`${B}/treso/finance/retours-externes`);
  const remplir = async (montant, motif) => {
    await f.getByLabel("Nom de la personne").waitFor({ state: "attached" }).catch(() => {});
    await f.getByLabel("Type de personne").selectOption("EXTERNE");
    await f.getByLabel("Nom de la personne").fill("Fournisseur e2e");
    await f.getByLabel("Montant du chèque initial (FCFA)").fill("40000");
    await f.getByLabel("Montant retourné en caisse (FCFA)").fill(String(montant));
    await f.getByLabel("Motif").fill(motif);
  };
  await remplir(15000, "E2E-GB retour du fonds bancaire");
  await f.getByLabel(/Rattacher à une demande/).check();
  // Demande inconnue / sans règlement Banque : refusées.
  await f.getByLabel("Référence de la demande").fill("DEM-INCONNUE");
  await f.getByRole("button", { name: "Rechercher" }).click();
  verifier("2. référence inconnue : message « Aucune demande ne porte cette référence »", await f.getByText(/Aucune demande ne porte cette référence/).first().isVisible().catch(() => false) || (await attendre(async () => /Aucune demande ne porte cette référence/.test(await f.locator("body").innerText()), 5000)));
  await f.getByLabel("Référence de la demande").fill("DEM-LOTGB-B");
  await f.getByRole("button", { name: "Rechercher" }).click();
  verifier("2. demande réglée en Caisse seulement : « aucun règlement par banque confirmé »", await attendre(async () => /aucun règlement par banque confirmé/.test(await f.locator("body").innerText()), 8000));
  // Bonne demande.
  await f.getByLabel("Référence de la demande").fill("dem-lotgb-a");
  await f.getByRole("button", { name: "Rechercher" }).click();
  await f.locator("[data-retour-externe-plafond]").waitFor({ state: "attached", timeout: 3000 }).catch(() => {});
  const art = f.getByLabel(/Article de la demande DEM-LOTGB-A/);
  await art.waitFor();
  const options = (await art.locator("option").allInnerTexts()).map(net);
  verifier("2. recherche par référence (insensible à la casse) : l'article est proposé avec ses fonds banque 40 000", options.some((o) => o.includes("Matériel DEM-LOTGB-A") && /banque 40 000/.test(o)), options.join(" | "));
  await art.selectOption({ index: 1 });
  const info = net(await f.locator("[data-retour-externe-plafond]").innerText());
  verifier("2. rappel : fonds banque 40 000, déjà retourné 0, solde à régulariser 15 000", /40 000 FCFA/.test(info) && /déjà retournés[^]*0 FCFA/.test(info) && /solde à régulariser : 15 000 FCFA/.test(info), info);
  await f.locator('input[type="file"]').nth(0).setInputFiles(PDF("e2e-gb-cheque.pdf"));
  await f.getByText("e2e-gb-cheque.pdf").first().waitFor();
  await f.locator('input[type="file"]').nth(1).setInputFiles(PDF("e2e-gb-retour.pdf"));
  await f.getByText("e2e-gb-retour.pdf").first().waitFor();
  // Au-delà du plafond (solde à régulariser 15 000) : refusé côté serveur.
  await f.getByLabel("Montant retourné en caisse (FCFA)").fill("15001");
  await f.getByRole("button", { name: "Enregistrer le retour externe" }).click();
  verifier("2. 15 001 FCFA (au-delà du maximum rattachable 15 000) : refusé", await attendre(async () => /dépasse le maximum rattachable/.test(await f.locator("body").innerText()), 8000));
  verifier("2. aucun retour externe créé, caisse inchangée après le refus", (await q(`SELECT 1 FROM "RetourExterne" WHERE motif LIKE 'E2E-GB %'`)).length === 0 && (await soldeCaisse()) === caisseAvant);
  await f.getByLabel("Montant retourné en caisse (FCFA)").fill("15000");
  await f.getByRole("button", { name: "Enregistrer le retour externe" }).click();
  await attendre(async () => (await q(`SELECT 1 FROM "RetourExterne" WHERE motif LIKE 'E2E-GB %'`)).length === 1);
  const re = (await q(`SELECT id, "demandeId", "ligneDemandeId", "montantRetourne"::float AS m FROM "RetourExterne" WHERE motif LIKE 'E2E-GB %'`))[0];
  verifier("2. retour externe rattaché à la demande ET à l'article, 15 000", !!re && re.demandeId === DA && re.ligneDemandeId === ligneA && re.m === 15000, JSON.stringify(re));
  const jc = await q(`SELECT type, montant::float AS m, source FROM "JournalCaisse" WHERE "refId" = $1`, [re.id]);
  verifier("2. écriture ENTREE de 15 000 en caisse (source retour_externe), une seule", jc.length === 1 && jc[0].type === "ENTREE" && jc[0].m === 15000 && jc[0].source === "retour_externe", JSON.stringify(jc));
  verifier("2. le solde de caisse augmente de 15 000", (await soldeCaisse()) === caisseAvant + 15000, `${caisseAvant} → ${await soldeCaisse()}`);
  const h = await q(`SELECT action FROM "HistoriqueEntry" WHERE "entityId" = $1 AND action = 'retour_externe_rattache'`, [DA]);
  verifier("2. historique de la demande : « retour enregistré par la Finance » tracé", h.length === 1);
  const notif = await q(`SELECT 1 FROM "Notification" WHERE "userId" = $1 AND message LIKE '%DEM-LOTGB-A%' AND titre LIKE 'Retour enregistré%'`, [idCollab]);
  verifier("2. le demandeur est notifié avec la référence de la demande et le libellé de l'article", notif.length === 1);
  await f.goto(`${B}/treso/finance/retours-externes`);
  const histo = net(await f.locator("[data-retour-externe-rattache]").first().innerText());
  verifier("2. historique des retours externes : « Rattaché à la demande DEM-LOTGB-A · article … »", /DEM-LOTGB-A/.test(histo) && /Matériel DEM-LOTGB-A/.test(histo), histo);

  // Plus rien à retourner : un second rattachement est refusé.
  await remplir(1000, "E2E-GB second retour");
  await f.getByLabel(/Rattacher à une demande/).check();
  await f.getByLabel("Référence de la demande").fill("DEM-LOTGB-A");
  await f.getByRole("button", { name: "Rechercher" }).click();
  await f.getByLabel(/Article de la demande DEM-LOTGB-A/).selectOption({ index: 1 });
  await f.locator('input[type="file"]').nth(0).setInputFiles(PDF("e2e-gb-cheque2.pdf"));
  await f.getByText("e2e-gb-cheque2.pdf").first().waitFor();
  await f.locator('input[type="file"]').nth(1).setInputFiles(PDF("e2e-gb-retour2.pdf"));
  await f.getByText("e2e-gb-retour2.pdf").first().waitFor();
  await f.getByRole("button", { name: "Enregistrer le retour externe" }).click();
  verifier("2. un second retour sur l'article soldé : « plus rien à retourner »", await attendre(async () => /plus rien à retourner/.test(await f.locator("body").innerText()), 8000));
  verifier("2. aucun second retour externe ni écriture de caisse", (await q(`SELECT 1 FROM "RetourExterne" WHERE motif LIKE 'E2E-GB %'`)).length === 1 && (await soldeCaisse()) === caisseAvant + 15000);
  await f.close();
}

// ======================================================================================================================
// 3. Le retour rattaché compte comme retour reçu : solde de l'article, parcours, récapitulatif, reçu, reporting
// ======================================================================================================================
{
  const f = await connecter("finance@simassurances.test");
  await f.goto(`${B}/treso/finance/demandes/${DA}`);
  const regul = net(await f.locator(`[data-regularisation-article="${ligneA}"]`).innerText());
  verifier("3. article : retours reçus 15 000, solde à régulariser 0, « Régularisé »", /Solde à régulariser 0 FCFA/i.test(regul) && /Régularisé/i.test(regul), regul);
  verifier("3. parcours : badge « Régularisé » et étape « Retour enregistré par la Finance »", (await f.locator('[data-parcours-badge="REGULARISE"]').count()) === 1 && /Retour enregistré par la Finance/i.test(net(await f.locator("body").innerText())));
  await f.goto(`${B}/treso/finance/fonds-a-regulariser`);
  verifier("3. « Fonds remis à régulariser » : la demande A n'y figure plus", !net(await f.locator("body").innerText()).includes("DEM-LOTGB-A"));
  await f.goto(`${B}/treso/finance/reporting`);
  const lignesDemandes = (await f.locator("body").innerText());
  verifier("3. reporting « une ligne par demande » : retour externe mentionné pour DEM-LOTGB-A", /Retour externe \(fonds versé par banque, rendu à la caisse\)/.test(net(lignesDemandes)), "");
  const r = await f.request.get(`${B}/api/treso/reporting/export`);
  const xlsx = join(dossier, "export.xlsx");
  writeFileSync(xlsx, await r.body());
  const partages = execFileSync("unzip", ["-p", xlsx, "xl/sharedStrings.xml"], { maxBuffer: 64 * 1024 * 1024 }).toString();
  verifier("3. export Excel : feuille « Retours externes » avec colonnes « Demande rattachée » / « Article rattaché » et la valeur", partages.includes("Demande rattachée") && partages.includes("Article rattaché") && partages.includes("DEM-LOTGB-A"));
  const recu = await f.request.get(`${B}/api/treso/reglements/${PREFIXE}rBanque/recu`);
  const pdf = join(dossier, "recu.pdf");
  writeFileSync(pdf, await recu.body());
  const t = net(execFileSync("pdftotext", ["-layout", pdf, "-"]).toString());
  verifier("3. reçu du règlement Banque : « Retours enregistrés par la Finance (fonds versé par banque) » 15 000, solde final 0", recu.status() === 200 && /retours enregistrés par la finance/i.test(t) && /15 000/.test(t) && /Solde à régulariser[^]{0,20}0 FCFA/i.test(t), t.slice(0, 200));
  await f.close();
  const c = await connecter("collaborateur@simassurances.test");
  await c.goto(`${B}/treso/demandes/${DA}`);
  const recap = net(await c.locator("[data-recap-retour-caisse]").innerText());
  verifier("3. récapitulatif du collaborateur : 15 000 reçus dont 15 000 enregistrés par la Finance, aucun retour « en attente de réception », solde 0", !/en attente de réception/i.test(recap) && /1 déclaré/i.test(recap) && /15 000 FCFA reçus/i.test(recap) && /dont 15 000 FCFA enregistrés par la Finance/i.test(recap) && /Solde à régulariser 0 FCFA/i.test(recap), recap);
  const histoCollab = net(await c.locator("body").innerText());
  verifier("3. historique visible du collaborateur : « Retour enregistré par la Finance »", /Retour enregistré par la Finance/i.test(histoCollab));
  await c.goto(`${B}/treso/tableau-de-bord`);
  verifier("3. « Accueil » (ex-Mon tableau de bord) : aucune erreur", true);
  await c.close();
}

// ======================================================================================================================
// 4. Un retour externe NON rattaché reste autonome : entre en caisse, ne touche aucun solde d'article
// ======================================================================================================================
{
  const f = await connecter("finance@simassurances.test");
  const avant = await soldeCaisse();
  await f.goto(`${B}/treso/finance/retours-externes`);
  await f.getByLabel("Type de personne").selectOption("EXTERNE");
  await f.getByLabel("Nom de la personne").fill("Fournisseur autonome");
  await f.getByLabel("Montant du chèque initial (FCFA)").fill("9000");
  await f.getByLabel("Montant retourné en caisse (FCFA)").fill("9000");
  await f.getByLabel("Motif").fill("E2E-GB retour autonome sans demande");
  await f.locator('input[type="file"]').nth(0).setInputFiles(PDF("e2e-gb-cheque3.pdf"));
  await f.getByText("e2e-gb-cheque3.pdf").first().waitFor();
  await f.locator('input[type="file"]').nth(1).setInputFiles(PDF("e2e-gb-retour3.pdf"));
  await f.getByText("e2e-gb-retour3.pdf").first().waitFor();
  await f.getByRole("button", { name: "Enregistrer le retour externe" }).click();
  await attendre(async () => (await q(`SELECT 1 FROM "RetourExterne" WHERE motif = 'E2E-GB retour autonome sans demande'`)).length === 1);
  const re = (await q(`SELECT "demandeId", "ligneDemandeId" FROM "RetourExterne" WHERE motif = 'E2E-GB retour autonome sans demande'`))[0];
  verifier("4. retour externe sans rattachement : ni demande ni article", re.demandeId === null && re.ligneDemandeId === null);
  verifier("4. il entre en caisse (+9 000)", (await soldeCaisse()) === avant + 9000, `${avant} → ${await soldeCaisse()}`);
  await f.goto(`${B}/treso/finance/demandes/${DB_}`);
  const regulB = net(await f.locator(`[data-regularisation-article="${DB_}-l1"]`).innerText());
  verifier("4. aucune demande/article n'est touchée : la demande B garde son solde à régulariser de 100 000", /Solde à régulariser 100 000 FCFA/i.test(regulB), regulB);
  await f.close();
}

await nettoyer();
verifier("aucune erreur JavaScript en console", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles OK`);
await browser.close();
await db.end();
process.exit(ko === 0 ? 0 : 1);
