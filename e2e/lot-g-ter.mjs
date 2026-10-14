// Autonomie des articles, lot G ter — REGULARISATION D'UN ARTICLE RÉGLÉ EN CAISSE + BANQUE : le reste non détaillé inclut le fonds
// versé par banque, chaque règlement a son sous-bloc, « Détailler » existe pour le fonds banque, le détail ramène le solde à 0. Sur base JETABLE (voir e2e/README.md). Nécessite `pdftotext` et `unzip`.
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
const dossier = mkdtempSync(join(tmpdir(), "lotgter-"));

const PREFIXE = "e2e-lotgt-";
const nettoyer = async () => {
  await q(`DELETE FROM "Notification" WHERE message LIKE '%DEM-LOTGT-%'`);
  await q(`DELETE FROM "HistoriqueEntry" WHERE "entityId" LIKE '${PREFIXE}%' OR detail LIKE '%DEM-LOTGT-%'`);
  await q(`DELETE FROM "JournalCaisse" WHERE id LIKE '${PREFIXE}%' OR "demandeId" LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "PieceJointe" WHERE id LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "DepenseLigne" WHERE "retourCaisseId" IN (SELECT id FROM "RetourCaisse" WHERE "reglementId" IN (SELECT id FROM "Reglement" WHERE "demandeId" LIKE '${PREFIXE}%'))`);
  await q(`DELETE FROM "RetourCaisse" WHERE "reglementId" IN (SELECT id FROM "Reglement" WHERE "demandeId" LIKE '${PREFIXE}%')`);
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
// Fixture : article FORMATION de 571 000 = 471 000 Caisse + 100 000 Banque ; 100 000 retournés (retour de caisse
// réceptionné) ; dépenses 300 000 justifiées + 71 000 sans pièce ; le fonds bancaire n'a ni retour ni détail.
// Attendu : solde 100 000 ; reste non détaillé 100 000 (le fonds banque) ; bouton « Détailler » pour le fonds banque.
// ---------------------------------------------------------------------------------------------------------------------
await q(`INSERT INTO "Categorie"(id, label, "isActive") VALUES ('e2e-lotgt-cat', 'E2E-GT-CAT', true) ON CONFLICT (id) DO NOTHING`);
const D = `${PREFIXE}D`;
const LIGNE = `${D}-l1`;
await q(
  `INSERT INTO "Demande"(id, reference, montant, "montantValide", statut, "createurId", "updatedAt", "beneficiaireType", "beneficiaireUserId", "etapeCircuit", "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", description)
   VALUES ($1, 'DEM-LOTGT-1', 571000, 571000, 'REGLEE', $2, now(), 'COLLABORATEUR', $2, 'TERMINEE', true, false, 'OPTIONNELLE', 'test e2e lot G ter')`,
  [D, idCollab]
);
await q(
  `INSERT INTO "LigneDemande"(id, libelle, "libelleOriginal", quantite, "prixUnitaire", "demandeId", "categorieId", motif, "statutValidation", "decideParId", "decideAt", "decideurFinanceId")
   VALUES ($1, 'FORMATION', 'FORMATION', 1, 571000, $2, 'e2e-lotgt-cat', 'motif', 'VALIDEE', $3, now(), $3)`,
  [LIGNE, D, idFinance]
);
await q(`INSERT INTO "JournalCaisse"(id, type, montant, source, "refId", "userId") VALUES ('e2e-lotgt-appro', 'ENTREE', 2000000, 'alimentation_caisse', 'e2e-lotgt-appro', $1)`, [idAssistant]);
const reglement = (id, montant, mode) =>
  q(`INSERT INTO "Reglement"(id, montant, mode, "estConfirme", "demandeId", "ligneDemandeId", "auteurId", "confirmeAt") VALUES ($1, $2, $3, true, $4, $5, $6, now())`, [id, montant, mode, D, LIGNE, idAssistant]);
await reglement(`${PREFIXE}rCaisse`, 471000, "CAISSE");
await q(`INSERT INTO "JournalCaisse"(id, type, montant, source, "refId", "userId", "demandeId") VALUES ('e2e-lotgt-sortie', 'SORTIE', 471000, 'reglement_caisse', $1, $2, $3)`, [`${PREFIXE}rCaisse`, idAssistant, D]);
await reglement(`${PREFIXE}rBanque`, 100000, "BANQUE");
await q(`INSERT INTO "RetourCaisse"(id, "montantARetourner", "estReceptionne", "reglementId", "declarantId", "receptionneParId", "receptionneAt") VALUES ($1, 100000, true, $2, $3, $4, now())`, [`${PREFIXE}ret`, `${PREFIXE}rCaisse`, idCollab, idAssistant]);
await q(`INSERT INTO "JournalCaisse"(id, type, montant, source, "refId", "userId", "demandeId") VALUES ('e2e-lotgt-entree', 'ENTREE', 100000, 'retour_caisse', $1, $2, $3)`, [`${PREFIXE}ret`, idAssistant, D]);
await q(`INSERT INTO "DepenseLigne"(id, montant, objet, date, justification, "retourCaisseId") VALUES ($1, 300000, 'Formation justifiée', now(), 'FACTURE', $2)`, [`${PREFIXE}dep1`, `${PREFIXE}ret`]);
await q(`INSERT INTO "DepenseLigne"(id, montant, objet, date, justification, "motifNonJustifie", "motifNonJustifieParId", "motifNonJustifieAt", "retourCaisseId") VALUES ($1, 71000, 'Frais sans pièce', now(), 'SANS_PIECE', 'pas de reçu', $3, now(), $2)`, [`${PREFIXE}dep2`, `${PREFIXE}ret`, idAssistant]);
const caisseAvant = await soldeCaisse();

// ======================================================================================================================
// 1. Avant le détail : le reste non détaillé inclut le fonds banque
// ======================================================================================================================
{
  const a = await connecter("assistant-finance@simassurances.test");
  await a.goto(`${B}/treso/finance/demandes/${D}`);
  const bloc = net(await a.locator(`[data-regularisation-article="${LIGNE}"]`).innerText());
  verifier("1. article : fonds remis (Caisse + Banque) 571 000", /Fonds remis \(Caisse \+ Banque\) 571 000 FCFA/i.test(bloc), bloc.slice(0, 300));
  verifier("1. article : reste non détaillé 100 000 (le fonds banque), plus 0", /Reste non détaillé 100 000 FCFA/i.test(bloc), bloc.slice(0, 400));
  verifier("1. article : solde à régulariser 100 000, état « À régulariser »", /Solde à régulariser 100 000 FCFA/i.test(bloc) && /À régulariser/i.test(bloc));
  const caisse = net(await a.locator(`[data-regularisation-reglement="${PREFIXE}rCaisse"]`).innerText());
  const banque = net(await a.locator(`[data-regularisation-reglement="${PREFIXE}rBanque"]`).innerText());
  verifier("1. sous-bloc « Règlement Caisse — 471 000 FCFA » : REMIS 471 000, DÉTAILLÉ 371 000, SANS PIÈCE 71 000, RETOURNÉ 100 000", /Règlement Caisse — 471 000 FCFA/i.test(caisse) && /Remis 471 000/i.test(caisse) && /Détaillé 371 000/i.test(caisse) && /Sans pièce formelle 71 000/i.test(caisse) && /Retourné 100 000/i.test(caisse), caisse.slice(0, 300));
  verifier("1. sous-bloc « Règlement Banque — 100 000 FCFA » : REMIS 100 000, RESTE NON DÉTAILLÉ 100 000, RETOURNÉ 0", /Règlement Banque — 100 000 FCFA/i.test(banque) && /Remis 100 000/i.test(banque) && /Reste non détaillé 100 000/i.test(banque) && /Retourné 0/i.test(banque), banque.slice(0, 300));
  const bandeTotal = net(await a.locator(`[data-regularisation-article="${LIGNE}"] [data-bande-total-article]`).innerText().catch(() => ""));
  verifier("1. bande « Total de l'article » : Remis 571 000, Détaillé 371 000, Reste 100 000, Sans pièce 71 000, Retourné 100 000", /Total de l'article/i.test(bandeTotal) && /Remis \(Caisse \+ Banque\) 571 000/i.test(bandeTotal) && /Détaillé 371 000/i.test(bandeTotal) && /Reste non détaillé 100 000/i.test(bandeTotal) && /Sans pièce formelle 71 000/i.test(bandeTotal) && /Retourné 100 000/i.test(bandeTotal), bandeTotal);
  const ordre = await a.evaluate((l) => { const art = document.querySelector(`[data-regularisation-article="${l}"]`); const b = art.querySelector("[data-bande-total-article]"); const r = art.querySelector("[data-regularisation-reglement]"); return !!b && !!r && !!(b.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING); }, LIGNE);
  verifier("1. la bande « Total de l'article » est AU-DESSUS des sous-blocs par règlement", ordre);
  verifier("1. sous-blocs rebaptisés « Détail du règlement Caisse / Banque »", /Détail du règlement Caisse — 471 000 FCFA/i.test(caisse) && /Détail du règlement Banque — 100 000 FCFA/i.test(banque));
  verifier("1. bouton « Détailler les dépenses » dans le bloc de l'article, sur le fonds banque", (await a.locator(`[data-regularisation-article="${LIGNE}"] [data-regularisation-reglement="${PREFIXE}rBanque"]`).getByRole("button", { name: "Détailler les dépenses" }).count()) === 1);
  await a.close();

  const f = await connecter("finance@simassurances.test");
  await f.goto(`${B}/treso/finance/demandes/${D}`);
  const blocF = net(await f.locator(`[data-regularisation-article="${LIGNE}"]`).innerText());
  verifier("1. Responsable Finance : mêmes chiffres (reste non détaillé 100 000, solde 100 000), aucun bouton « Détailler les dépenses »", /Reste non détaillé 100 000 FCFA/i.test(blocF) && /Solde à régulariser 100 000 FCFA/i.test(blocF) && (await f.getByRole("button", { name: "Détailler les dépenses" }).first().isVisible().catch(() => false)) === false);
  await f.goto(`${B}/treso/finance/fonds-a-regulariser`);
  verifier("1. « Fonds remis à régulariser » : la demande y figure (solde 100 000)", net(await f.locator("body").innerText()).includes("DEM-LOTGT-1"));
  const recu = await f.request.get(`${B}/api/treso/reglements/${PREFIXE}rBanque/recu`);
  const pdf = join(dossier, "recu1.pdf");
  writeFileSync(pdf, await recu.body());
  const t = net(execFileSync("pdftotext", ["-layout", pdf, "-"]).toString());
  verifier("1. reçu PDF : fonds remis 571 000, solde à régulariser 100 000, « Dont reste non détaillé » 100 000", recu.status() === 200 && /571 000/.test(t) && /Solde à régulariser[^]{0,30}100 000/i.test(t) && /reste non détaillé[^]{0,60}100 000/i.test(t), t.slice(0, 300));
  await f.close();

  const c = await connecter("collaborateur@simassurances.test");
  await c.goto(`${B}/treso/demandes/${D}`);
  const recap = net(await c.locator("[data-recap-retour-caisse]").innerText());
  verifier("1. récapitulatif du collaborateur : reste non détaillé 100 000, solde 100 000", /Reste non détaillé[^]{0,20}100 000/i.test(recap) && /Solde à régulariser[^]{0,20}100 000/i.test(recap), recap.slice(0, 400));
  await c.close();
}

// ======================================================================================================================
// 2. L'Assistant détaille le fonds banque depuis le bloc de l'article : solde 0, article Régularisé
// ======================================================================================================================
{
  const a = await connecter("assistant-finance@simassurances.test");
  await a.goto(`${B}/treso/finance/demandes/${D}`);
  const zone = a.locator(`[data-regularisation-reglement="${PREFIXE}rBanque"]`);
  await zone.getByRole("button", { name: "Détailler les dépenses" }).click();
  await zone.getByLabel("Type").selectOption("sans_piece");
  await zone.getByLabel("Montant").fill("100000");
  await zone.getByLabel("Motif").fill("Prestataire payé par virement, pas de reçu");
  await zone.getByRole("button", { name: "Enregistrer le détail" }).click();
  verifier("2. détail enregistré (une dépense de 100 000 sur le règlement Banque)", await attendre(async () => (await q(`SELECT 1 FROM "DepenseLigne" d JOIN "RetourCaisse" r ON r.id = d."retourCaisseId" WHERE r."reglementId" = $1 AND d.montant = 100000`, [`${PREFIXE}rBanque`])).length === 1));
  await a.goto(`${B}/treso/finance/demandes/${D}`);
  const bloc = net(await a.locator(`[data-regularisation-article="${LIGNE}"]`).innerText());
  verifier("2. article : reste non détaillé 0, solde à régulariser 0, badge « Régularisé »", /Reste non détaillé 0 FCFA/i.test(bloc) && /Solde à régulariser 0 FCFA/i.test(bloc) && /Régularisé/i.test(bloc), bloc.slice(0, 400));
  verifier("2. dépenses sans pièce formelle de l'article : 71 000 + 100 000 = 171 000", /Dépenses sans pièce formelle 171 000 FCFA/i.test(bloc), bloc.slice(0, 400));
  const bandeApres = net(await a.locator(`[data-regularisation-article="${LIGNE}"] [data-bande-total-article]`).innerText().catch(() => ""));
  verifier("2. bande « Total de l'article » après détail : Détaillé 571 000... Reste 0, Sans pièce 171 000", /Détaillé 471 000|Détaillé 571 000/i.test(bandeApres) && /Reste non détaillé 0 FCFA/i.test(bandeApres) && /Sans pièce formelle 171 000/i.test(bandeApres), bandeApres);
  verifier("2. parcours : badge « Régularisé »", (await a.locator('[data-parcours-badge="REGULARISE"]').count()) === 1);
  const banque = net(await a.locator(`[data-regularisation-reglement="${PREFIXE}rBanque"]`).innerText());
  verifier("2. fonds banque : reste non détaillé 0, plus de bouton « Détailler »", /Reste non détaillé 0 FCFA/i.test(banque) && (await a.locator(`[data-regularisation-reglement="${PREFIXE}rBanque"]`).getByRole("button", { name: /Détailler/ }).count()) === 0, banque.slice(0, 300));
  verifier("2. aucune écriture de caisse créée par le détail (solde de caisse inchangé)", (await soldeCaisse()) === caisseAvant, `${caisseAvant} → ${await soldeCaisse()}`);
  verifier("2. la fiche du fonds bancaire n'est ni « en attente de réception » ni dans « Retours en attente »", (await q(`SELECT 1 FROM "RetourCaisse" WHERE "reglementId" = $1 AND "estReceptionne" = false`, [`${PREFIXE}rBanque`])).length === 1);
  await a.goto(`${B}/treso/finance/retours`);
  verifier("2. « Retours en attente » : la demande n'y figure pas", !net(await a.locator("body").innerText()).includes("DEM-LOTGT-1"));
  await a.close();

  const f = await connecter("finance@simassurances.test");
  await f.goto(`${B}/treso/finance/fonds-a-regulariser`);
  verifier("2. « Fonds remis à régulariser » : la demande n'y figure plus", !net(await f.locator("body").innerText()).includes("DEM-LOTGT-1"));
  const recu = await f.request.get(`${B}/api/treso/reglements/${PREFIXE}rBanque/recu`);
  const pdf = join(dossier, "recu2.pdf");
  writeFileSync(pdf, await recu.body());
  const t = net(execFileSync("pdftotext", ["-layout", pdf, "-"]).toString());
  verifier("2. reçu PDF : solde à régulariser 0, plus de « reste non détaillé »", recu.status() === 200 && /Solde à régulariser[^]{0,30}0 FCFA/i.test(t) && !/reste non détaillé/i.test(t), t.slice(0, 300));
  await f.close();

  const c = await connecter("collaborateur@simassurances.test");
  await c.goto(`${B}/treso/demandes/${D}`);
  const recap = net(await c.locator("[data-recap-retour-caisse]").innerText());
  verifier("2. récapitulatif du collaborateur : reste non détaillé 0, solde 0", /Reste non détaillé[^]{0,20}0 FCFA/i.test(recap) && /Solde à régulariser[^]{0,20}0 FCFA/i.test(recap), recap.slice(0, 400));
  await c.close();
}

// ======================================================================================================================
// 3. Cas du lot G quater : 471 000 Caisse + 100 000 Banque, 100 000 retournés, 400 000 justifiées + 71 000 sans pièce
// ======================================================================================================================
const D2 = `${PREFIXE}D2`;
const L2 = `${D2}-l1`;
await q(
  `INSERT INTO "Demande"(id, reference, montant, "montantValide", statut, "createurId", "updatedAt", "beneficiaireType", "beneficiaireUserId", "etapeCircuit", "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", description)
   VALUES ($1, 'DEM-LOTGT-2', 571000, 571000, 'REGLEE', $2, now(), 'COLLABORATEUR', $2, 'TERMINEE', true, false, 'OPTIONNELLE', 'test e2e lot G quater')`,
  [D2, idCollab]
);
await q(
  `INSERT INTO "LigneDemande"(id, libelle, "libelleOriginal", quantite, "prixUnitaire", "demandeId", "categorieId", motif, "statutValidation", "decideParId", "decideAt", "decideurFinanceId")
   VALUES ($1, 'FORMATION 2', 'FORMATION 2', 1, 571000, $2, 'e2e-lotgt-cat', 'motif', 'VALIDEE', $3, now(), $3)`,
  [L2, D2, idFinance]
);
const reglement2 = (id, montant, mode, demandeId, ligne) =>
  q(`INSERT INTO "Reglement"(id, montant, mode, "estConfirme", "demandeId", "ligneDemandeId", "auteurId", "confirmeAt") VALUES ($1, $2, $3, true, $4, $5, $6, now())`, [id, montant, mode, demandeId, ligne, idAssistant]);
await reglement2(`${PREFIXE}r2Caisse`, 471000, "CAISSE", D2, L2);
await reglement2(`${PREFIXE}r2Banque`, 100000, "BANQUE", D2, L2);
await q(`INSERT INTO "RetourCaisse"(id, "montantARetourner", "estReceptionne", "reglementId", "declarantId", "receptionneParId", "receptionneAt") VALUES ($1, 100000, true, $2, $3, $4, now())`, [`${PREFIXE}ret2`, `${PREFIXE}r2Caisse`, idCollab, idAssistant]);
await q(`INSERT INTO "DepenseLigne"(id, montant, objet, date, justification, "retourCaisseId") VALUES ($1, 400000, 'Formation justifiée', now(), 'FACTURE', $2)`, [`${PREFIXE}dep21`, `${PREFIXE}ret2`]);
await q(`INSERT INTO "DepenseLigne"(id, montant, objet, date, justification, "motifNonJustifie", "motifNonJustifieParId", "motifNonJustifieAt", "retourCaisseId") VALUES ($1, 71000, 'Frais sans pièce', now(), 'SANS_PIECE', 'pas de reçu', $3, now(), $2)`, [`${PREFIXE}dep22`, `${PREFIXE}ret2`, idAssistant]);
// 400 000 + 71 000 = 471 000 détaillés, 100 000 retournés : 571 000 expliqués, reste 0.
{
  const a = await connecter("assistant-finance@simassurances.test");
  await a.goto(`${B}/treso/finance/demandes/${D2}`);
  const bande = net(await a.locator(`[data-regularisation-article="${L2}"] [data-bande-total-article]`).innerText().catch(() => ""));
  verifier("3. Total de l'article : Remis 571 000, Détaillé 471 000, Sans pièce 71 000, Retourné 100 000", /Remis \(Caisse \+ Banque\) 571 000/i.test(bande) && /Détaillé 471 000/i.test(bande) && /Sans pièce formelle 71 000/i.test(bande) && /Retourné 100 000/i.test(bande), bande);
  verifier("3. Total de l'article : reste non détaillé 0, identique au « Reste non détaillé » de l'article", /Reste non détaillé 0 FCFA/i.test(bande) && /Reste non détaillé 0 FCFA SOLDE À RÉGULARISER 0 FCFA/i.test(net(await a.locator(`[data-regularisation-article="${L2}"]`).first().innerText())), bande);
  const caisse = net(await a.locator(`[data-regularisation-reglement="${PREFIXE}r2Caisse"]`).innerText());
  verifier("3. le sous-bloc « Détail du règlement Caisse » garde SA bande (Remis 471 000, Retourné 100 000)", /Détail du règlement Caisse — 471 000/i.test(caisse) && /Remis 471 000/i.test(caisse) && /Retourné 100 000/i.test(caisse), caisse.slice(0, 250));
  await a.close();
}

// ======================================================================================================================
// 4. Article à UN SEUL règlement : pas de bande « Total de l'article »
// ======================================================================================================================
const D3 = `${PREFIXE}D3`;
const L3 = `${D3}-l1`;
await q(
  `INSERT INTO "Demande"(id, reference, montant, "montantValide", statut, "createurId", "updatedAt", "beneficiaireType", "beneficiaireUserId", "etapeCircuit", "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", description)
   VALUES ($1, 'DEM-LOTGT-3', 50000, 50000, 'REGLEE', $2, now(), 'COLLABORATEUR', $2, 'TERMINEE', true, false, 'OPTIONNELLE', 'test e2e lot G quater')`,
  [D3, idCollab]
);
await q(
  `INSERT INTO "LigneDemande"(id, libelle, "libelleOriginal", quantite, "prixUnitaire", "demandeId", "categorieId", motif, "statutValidation", "decideParId", "decideAt", "decideurFinanceId")
   VALUES ($1, 'ARTICLE UNIQUE', 'ARTICLE UNIQUE', 1, 50000, $2, 'e2e-lotgt-cat', 'motif', 'VALIDEE', $3, now(), $3)`,
  [L3, D3, idFinance]
);
await reglement2(`${PREFIXE}r3Caisse`, 50000, "CAISSE", D3, L3);
{
  const a = await connecter("assistant-finance@simassurances.test");
  await a.goto(`${B}/treso/finance/demandes/${D3}`);
  verifier("4. un seul règlement : aucune bande « Total de l'article »", (await a.locator(`[data-regularisation-article="${L3}"] [data-bande-total-article]`).count()) === 0 && (await a.locator(`[data-regularisation-article="${L3}"] [data-regularisation-reglement]`).count()) === 1);
  await a.close();
}
verifier("aucune écriture de caisse créée par ces affichages (solde inchangé)", (await soldeCaisse()) === caisseAvant);

await nettoyer();
verifier("aucune erreur JavaScript en console", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles OK`);
await browser.close();
await db.end();
process.exit(ko === 0 ? 0 : 1);
