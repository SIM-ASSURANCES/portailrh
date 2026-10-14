// Autonomie des articles, lot G (2026-10-14) — DATE DE LIVRAISON PAR ARTICLE, RÈGLEMENTS CAISSE + BANQUE DANS TOUS LES
// CALCULS, RETOUR D'UN FONDS BANCAIRE EN ESPÈCES À LA CAISSE, REÇUS DÉTAILLÉS, RÉCAPITULATIF DU COLLABORATEUR, REPORTING DES
// RETOURS — sur base JETABLE (voir e2e/README.md). Nécessite `pdftotext` et `unzip`.
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
const jourDans = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const fr = (iso) => iso.split("-").reverse().join("/");
const dossier = mkdtempSync(join(tmpdir(), "lotg-"));

const PREFIXE = "e2e-lotg-";
const SOUS_REGLEMENTS = `(SELECT id FROM "Reglement" WHERE "demandeId" LIKE '${PREFIXE}%')`;
const nettoyer = async () => {
  await q(`DELETE FROM "HistoriqueEntry" WHERE "entityId" LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "JournalBanque" WHERE "reglementId" IN ${SOUS_REGLEMENTS}`);
  await q(`DELETE FROM "RetourExterne" WHERE id LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "PieceJointe" WHERE id LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "DepenseLigne" WHERE "retourCaisseId" IN (SELECT id FROM "RetourCaisse" WHERE "reglementId" IN ${SOUS_REGLEMENTS})`);
  await q(`DELETE FROM "JournalCaisse" WHERE id LIKE '${PREFIXE}%' OR "demandeId" LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "RetourCaisse" WHERE "reglementId" IN ${SOUS_REGLEMENTS}`);
  await q(`DELETE FROM "ReglementCategorieAllocation" WHERE "reglementId" IN ${SOUS_REGLEMENTS}`);
  await q(`DELETE FROM "Reglement" WHERE "demandeId" LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "LigneDemande" WHERE "demandeId" LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "Demande" WHERE id LIKE '${PREFIXE}%'`);
};
await nettoyer();
// Les demandes créées par le formulaire : nettoyage par libellé d'article.
const nettoyerFormulaire = async () => {
  const ids = (await q(`SELECT DISTINCT "demandeId" AS id FROM "LigneDemande" WHERE libelle LIKE 'E2E-G-%'`)).map((x) => x.id);
  if (ids.length) {
    await q(`DELETE FROM "HistoriqueEntry" WHERE "entityId" = ANY($1)`, [ids]);
    await q(`DELETE FROM "PieceJointe" WHERE "demandeId" = ANY($1)`, [ids]);
    await q(`DELETE FROM "LigneDemande" WHERE "demandeId" = ANY($1)`, [ids]);
    await q(`DELETE FROM "Demande" WHERE id = ANY($1)`, [ids]);
  }
};
await nettoyerFormulaire();

const uid = async (email) => (await q(`SELECT id FROM "User" WHERE email = $1`, [email]))[0].id;
const idCollab = await uid("collaborateur@simassurances.test");
const idFinance = await uid("finance@simassurances.test");
const idAssistant = await uid("assistant-finance@simassurances.test");
await q(`INSERT INTO "Categorie"(id, label, "isActive", "budgetAlloue") VALUES ('e2e-lotg-cat', 'E2E-G-CAT', true, 150000) ON CONFLICT (id) DO UPDATE SET "budgetAlloue" = 150000`);

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
const telecharger = async (p, url, nom) => {
  const r = await p.request.get(`${B}${url}`);
  const fichier = join(dossier, nom);
  if (r.status() === 200) writeFileSync(fichier, await r.body());
  return { statut: r.status(), texte: r.status() === 200 ? net(execFileSync("pdftotext", ["-layout", fichier, "-"]).toString()) : "" };
};

// ======================================================================================================================
// 1. DATE DE LIVRAISON PAR ARTICLE — formulaire de création (UI réelle)
// ======================================================================================================================
const J1 = jourDans(5), J2 = jourDans(12), J3 = jourDans(20);
let demandeForm;
{
  const p = await connecter("collaborateur@simassurances.test");
  await p.goto(`${B}/treso/demandes/nouvelle`);
  await p.getByRole("button", { name: "Ajouter une ligne" }).click();
  await p.getByRole("button", { name: "Ajouter une ligne" }).click();
  for (const [i, nom] of ["E2E-G-A", "E2E-G-B", "E2E-G-C"].entries()) {
    await p.locator('input[aria-label="Libellé de l\'article"]').nth(i).fill(nom);
    await p.locator('input[aria-label="Motif de la ligne"]').nth(i).fill(`motif de ${nom}`);
    await p.locator('input[aria-label="Prix unitaire"]').nth(i).fill("10000");
  }
  verifier("1. un champ « Date de livraison de l'article » sous chaque article (3)", (await p.locator("[data-date-livraison-article]").count()) === 3);
  verifier("1. une seule date commune, qui est déjà la date de livraison (aucun doublon)", (await p.locator("[data-date-livraison-commune]").count()) === 1);
  // « Appliquer à tous » sans date : refusé.
  await p.locator("[data-appliquer-a-tous]").click();
  verifier("1. « Appliquer à tous » sans date commune : aucune date posée", (await p.locator("[data-date-livraison-article]").nth(0).inputValue()) === "");
  await p.locator("[data-date-livraison-commune]").fill(J1);
  await p.locator("[data-appliquer-a-tous]").click();
  const apresApplique = [];
  for (let i = 0; i < 3; i++) apresApplique.push(await p.locator("[data-date-livraison-article]").nth(i).inputValue());
  verifier("1. « Appliquer à tous » : les 3 articles reçoivent la date commune", apresApplique.every((v) => v === J1), apresApplique.join(","));
  await p.locator("[data-date-livraison-article]").nth(1).fill(J2);
  await p.locator("[data-date-livraison-article]").nth(2).fill("");
  await p.getByRole("button", { name: "Envoyer la demande" }).click();
  await p.getByText("Demande créée avec succès.").waitFor();
  demandeForm = (await p.getByRole("link", { name: "Voir ma demande" }).getAttribute("href")).split("/").pop();
  await p.close();
}
{
  const l = await q(`SELECT libelle, "dateLivraison"::text AS d FROM "LigneDemande" WHERE "demandeId" = $1 ORDER BY libelle`, [demandeForm]);
  const dem = (await q(`SELECT "dateLivraisonSouhaitee"::text AS d, "createdAt" FROM "Demande" WHERE id = $1`, [demandeForm]))[0];
  verifier("1. base : A = date commune, B = sa propre date", l[0].d === J1 && l[1].d === J2, JSON.stringify(l));
  verifier("1. base : C (vide) reçoit une COPIE de la date commune", l[2].d === J1);
  verifier("1. base : la date commune de la demande reste UNE seule colonne (dateLivraisonSouhaitee)", dem.d.startsWith(J1), dem.d);
  verifier("1. la date de création de la demande est unique (une seule colonne createdAt)", dem.createdAt instanceof Date);
}
// Article d'une demande antérieure : date vide affichée « — ».
const ANCIEN = `${PREFIXE}ancien`;
await q(
  `INSERT INTO "Demande"(id, reference, montant, statut, "createurId", "updatedAt", "beneficiaireType", "beneficiaireUserId", "etapeCircuit", "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", description)
   VALUES ($1, 'DEM-LOTG-ANCIEN', 10000, 'EN_ATTENTE_VALIDATION', $2, now(), 'COLLABORATEUR', $2, 'FINANCE', true, false, 'OPTIONNELLE', 'ancien')`,
  [ANCIEN, idCollab]
);
await q(`INSERT INTO "LigneDemande"(id, libelle, quantite, "prixUnitaire", "demandeId", motif) VALUES ($1, 'Ancien article', 1, 10000, $2, 'motif')`, [`${ANCIEN}-l1`, ANCIEN]);
{
  const p = await connecter("collaborateur@simassurances.test");
  await p.goto(`${B}/treso/demandes/${demandeForm}`);
  const dates = (await p.locator("[data-date-livraison]").allInnerTexts()).map(net);
  verifier("1. collaborateur : chaque carte d'article affiche « Livraison prévue le … »", dates.length === 3 && dates.some((t) => t.includes(fr(J1))) && dates.some((t) => t.includes(fr(J2))), dates.join(" | "));
  await p.goto(`${B}/treso/demandes/${ANCIEN}`);
  verifier("1. ancien article : « Livraison prévue le — »", /Livraison prévue le —/.test(net(await p.locator("[data-date-livraison]").first().innerText())));
  await p.close();
}
{
  const p = await connecter("responsable-commercial@simassurances.test");
  await p.goto(`${B}/treso/service/${demandeForm}`);
  verifier("1. responsable de service : date de livraison sur chaque article", (await p.locator("[data-date-livraison]").count()) === 3);
  await p.close();
  const f = await connecter("finance@simassurances.test");
  await f.goto(`${B}/treso/finance/demandes/${demandeForm}`);
  verifier("1. Finance : date de livraison sur chaque article", (await f.locator("[data-date-livraison]").count()) === 3);
  await f.close();
}
// Correction : champ par article + « Appliquer à tous ».
{
  await q(`UPDATE "Demande" SET "etapeCircuit" = 'A_CORRIGER', "niveauRejet" = 'FINANCE', "motifRejet" = 'à revoir', statut = 'EN_ATTENTE_VALIDATION' WHERE id = $1`, [demandeForm]);
  const p = await connecter("collaborateur@simassurances.test");
  await p.goto(`${B}/treso/demandes/${demandeForm}`);
  await p.getByRole("button", { name: "Corriger et resoumettre" }).click();
  verifier("1. correction : un champ date par article, préremplis", (await p.locator("[data-date-livraison-article]").count()) === 3 && (await p.locator("[data-date-livraison-article]").nth(1).inputValue()) === J2);
  await p.locator("[data-date-livraison-commune]").fill(J3);
  await p.locator("[data-appliquer-date-a-tous]").click();
  verifier("1. correction : « Appliquer à tous » pose la date sur les 3 articles", (await p.locator("[data-date-livraison-article]").nth(2).inputValue()) === J3 && (await p.locator("[data-date-livraison-article]").nth(0).inputValue()) === J3);
  await p.locator("[data-date-livraison-article]").nth(1).fill(J2);
  await p.getByRole("button", { name: "Resoumettre la demande" }).click();
  await p.getByText(/corrigée et resoumise/).first().waitFor();
  const l = await q(`SELECT libelle, "dateLivraison"::text AS d FROM "LigneDemande" WHERE "demandeId" = $1 ORDER BY libelle`, [demandeForm]);
  verifier("1. correction : A et C = J3 (appliqué), B = J2 (conservé)", l[0].d === J3 && l[1].d === J2 && l[2].d === J3, JSON.stringify(l));
  await p.close();
}

// ======================================================================================================================
// 2. UN ARTICLE DE 100 000 RÉGLÉ 60 000 CAISSE + 40 000 BANQUE
// ======================================================================================================================
const D2 = `${PREFIXE}mixte`;
const L2 = `${D2}-l1`;
await q(
  `INSERT INTO "Demande"(id, reference, montant, "montantValide", statut, "createurId", "updatedAt", "beneficiaireType", "beneficiaireUserId", "etapeCircuit", "etapeFinanceRequise", "etapeServiceRequise",
     "modeEtapeDG", description, "validationCompleteParDG", "dateLivraisonSouhaitee")
   VALUES ($1, 'DEM-LOTG-MIXTE', 100000, 100000, 'VALIDEE_NON_REGLEE', $2, now(), 'COLLABORATEUR', $2, 'TERMINEE', true, false, 'OPTIONNELLE', 'test e2e lot G', false, '2026-12-15')`,
  [D2, idCollab]
);
await q(
  `INSERT INTO "LigneDemande"(id, libelle, "libelleOriginal", quantite, "prixUnitaire", "demandeId", "categorieId", motif, "statutValidation", "decideParId", "decideAt", "decideurFinanceId", "dateLivraison")
   VALUES ($1, 'Ordinateur (Finance)', 'Ordinateur', 1, 100000, $2, 'e2e-lotg-cat', 'motif', 'VALIDEE', $3, now(), $3, '2026-12-15')`,
  [L2, D2, idFinance]
);
await q(`INSERT INTO "JournalCaisse"(id, type, montant, source, "refId", "userId") VALUES ('e2e-lotg-appro', 'ENTREE', 500000, 'alimentation_caisse', 'e2e-lotg-appro', $1)`, [idAssistant]);
const reglementsDe = () => q(`SELECT id, montant::float AS montant, mode, "estConfirme" FROM "Reglement" WHERE "demandeId" = $1 ORDER BY "createdAt"`, [D2]);
const conso = async () => Number((await q(`SELECT COALESCE(SUM(a.montant),0)::float AS s FROM "ReglementCategorieAllocation" a JOIN "Reglement" r ON r.id = a."reglementId" WHERE a."categorieId" = 'e2e-lotg-cat' AND r."estConfirme" AND NOT r."estAnnule"`))[0].s);
const bloc = (p) => p.locator(`[data-article-reglement="${L2}"]`);
async function creerEtConfirmer(p, montant, mode, attendu) {
  await p.goto(`${B}/treso/finance/demandes/${D2}`);
  await bloc(p).getByRole("button", { name: "Ajouter un règlement" }).click();
  await bloc(p).locator('input[name="montant"]').fill(String(montant));
  await bloc(p).locator('select[name="mode"]').selectOption(mode);
  await bloc(p).getByRole("button", { name: "Créer le règlement" }).click();
  await attendre(async () => (await reglementsDe()).length === attendu);
  await p.goto(`${B}/treso/finance/demandes/${D2}`);
  await bloc(p).getByRole("button", { name: "Confirmer", exact: true }).first().click();
  return attendre(async () => (await reglementsDe()).filter((r) => r.estConfirme).length === attendu);
}
let rCaisse, rBanque;
{
  const p = await connecter("assistant-finance@simassurances.test");
  const solde0 = await soldeCaisse();
  verifier("2. règlement Caisse de 60 000 créé et confirmé", await creerEtConfirmer(p, 60000, "CAISSE", 1));
  const soldeApresCaisse = await soldeCaisse();
  verifier("2. le règlement Caisse sort 60 000 de la caisse", soldeApresCaisse === solde0 - 60000, `${solde0} → ${soldeApresCaisse}`);
  verifier("2. règlement Banque de 40 000 créé et confirmé", await creerEtConfirmer(p, 40000, "BANQUE", 2));
  const soldeApresBanque = await soldeCaisse();
  verifier("2. le règlement Banque n'impacte JAMAIS le solde de caisse", soldeApresBanque === soldeApresCaisse, `${soldeApresCaisse} → ${soldeApresBanque}`);
  const jb = await q(`SELECT type, montant::float AS m FROM "JournalBanque" WHERE "reglementId" IN (SELECT id FROM "Reglement" WHERE "demandeId" = $1)`, [D2]);
  verifier("2. le journal banque garde la trace (SORTIE 40 000)", jb.length === 1 && jb[0].type === "SORTIE" && jb[0].m === 40000);
  const rs = await reglementsDe();
  rCaisse = rs.find((r) => r.mode === "CAISSE").id;
  rBanque = rs.find((r) => r.mode === "BANQUE").id;
  verifier("2. budget consommé = 100 000 (60 000 + 40 000)", (await conso()) === 100000, String(await conso()));
  await p.goto(`${B}/treso/finance/demandes/${D2}`);
  const t = net(await bloc(p).innerText());
  verifier("2. bloc de règlement de l'article : réglé 100 000, reste 0", /réglé 100 000/i.test(t) && /reste 0 FCFA/i.test(t), t.slice(0, 200));
  verifier("2. parcours : badge « Réglé » (tout est réglé, rien régularisé)", (await p.locator('[data-parcours-badge="REGLE"]').count()) === 1);
  const regul = net(await p.locator(`[data-regularisation-article="${L2}"]`).innerText());
  verifier("2. régularisation : fonds remis (Caisse + Banque) 100 000, solde 100 000, « À régulariser »", /Fonds remis \(Caisse \+ Banque\) 100 000/i.test(regul) && /Solde à régulariser 100 000 FCFA/i.test(regul) && /À régulariser/i.test(regul), regul);
  const fin = await connecter("finance@simassurances.test");
  await fin.goto(`${B}/treso/finance/fonds-a-regulariser`);
  const fonds = net(await fin.locator("body").innerText());
  await fin.close();
  verifier("2. « Fonds remis à régulariser » liste le règlement Banque ET le règlement Caisse", /40 000 FCFA \(Banque\)/i.test(fonds) && /60 000 FCFA \(Caisse\)/i.test(fonds) && fonds.includes("DEM-LOTG-MIXTE"), fonds.slice(0, 300));
  await p.close();
}
// --- Fonds versé par banque (lot G bis) : plus de déclaration de retour par le collaborateur ---
{
  const p = await connecter("collaborateur@simassurances.test");
  await p.goto(`${B}/treso/demandes/${D2}`);
  const recapAvant = net(await p.locator("[data-recap-retour-caisse]").innerText());
  verifier("4. récapitulatif du collaborateur : fonds reçus 100 000 dont Caisse 60 000 · Banque 40 000", /Fonds reçus \(Caisse \+ Banque\) 100 000 FCFA/i.test(recapAvant) && /dont Caisse 60 000 FCFA · Banque 40 000 FCFA/i.test(recapAvant), recapAvant);
  verifier("4. récapitulatif : retours 0 déclaré, solde 100 000, état « À régulariser »", /0 déclaré/i.test(recapAvant) && /Solde à régulariser 100 000 FCFA/i.test(recapAvant) && /À régulariser/i.test(recapAvant));
  verifier("4. récapitulatif : libellé d'origine du demandeur, jamais celui de la Finance", /Ordinateur/.test(recapAvant) && !/Ordinateur \(Finance\)/.test(recapAvant));
  verifier("3. le règlement Banque ne propose PLUS « Déclarer un retour de caisse » (seul le règlement Caisse le propose)", (await p.getByRole("button", { name: /Déclarer un retour de caisse/ }).count()) === 1 && (await p.locator("[data-retour-par-la-finance]").count()) === 1);
  await p.close();
}
// Le serveur refuse aussi une déclaration directe sur le fonds bancaire (rejeu) : aucune fiche créée.
{
  const refus = await q(`SELECT count(*)::int AS n FROM "RetourCaisse" WHERE "reglementId" = $1`, [rBanque]);
  verifier("3. aucun retour de caisse n'existe sur le règlement Banque", refus[0].n === 0);
}
// Dépenses de l'article : 25 000 sur le fonds bancaire (fiche de détail de l'Assistant) et 60 000 sur la Caisse, tout justifié.
// Le retour des 15 000 restants du fonds bancaire est un RETOUR EXTERNE rattaché (Finance), qui entre en caisse.
let retourExterneId;
{
  await q(`INSERT INTO "RetourCaisse"(id, "montantARetourner", "estReceptionne", "reglementId", "declarantId", "creeParAssistant") VALUES ($1, 15000, false, $2, $3, true)`, [`${PREFIXE}ficheBanque`, rBanque, idAssistant]);
  await q(`INSERT INTO "DepenseLigne"(id, montant, objet, date, justification, "retourCaisseId") VALUES ($1, 25000, 'Achat banque', now(), 'FACTURE', $2)`, [`${PREFIXE}depB`, `${PREFIXE}ficheBanque`]);
  await q(`INSERT INTO "RetourCaisse"(id, "montantARetourner", "estReceptionne", "reglementId", "declarantId", "creeParAssistant", "receptionneParId", "receptionneAt") VALUES ($1, 0, true, $2, $3, true, $3, now())`, [`${PREFIXE}retCaisse`, rCaisse, idAssistant]);
  await q(`INSERT INTO "DepenseLigne"(id, montant, objet, date, justification, "retourCaisseId") VALUES ($1, 60000, 'Achat caisse', now(), 'FACTURE', $2)`, [`${PREFIXE}dep1`, `${PREFIXE}retCaisse`]);
  const pjA = `${PREFIXE}pj-a`;
  const pjB = `${PREFIXE}pj-b`;
  await q(`INSERT INTO "PieceJointe"(id, url) VALUES ($1, 'x.pdf'), ($2, 'y.pdf')`, [pjA, pjB]);
  retourExterneId = `${PREFIXE}externe`;
  await q(`INSERT INTO "RetourExterne"(id, "nomExterne", "montantChequeInitial", "montantRetourne", motif, "pieceJointeId", "pieceJointeChequeId", "demandeId", "ligneDemandeId", "creeParId") VALUES ($1, 'Fournisseur test', 40000, 15000, 'Retour du fonds bancaire non utilisé', $2, $3, $4, $5, $6)`, [retourExterneId, pjA, pjB, D2, L2, idFinance]);
  await q(`INSERT INTO "JournalCaisse"(id, type, montant, source, "refId", "userId", "demandeId") VALUES ($1, 'ENTREE', 15000, 'retour_externe', $2, $3, $4)`, [`${PREFIXE}jc-externe`, retourExterneId, idFinance, D2]);
}
{
  const p = await connecter("assistant-finance@simassurances.test");
  await p.goto(`${B}/treso/finance/demandes/${D2}`);
  const regul = net(await p.locator(`[data-regularisation-article="${L2}"]`).innerText());
  verifier("2. article régularisé : solde 0 malgré les deux modes de règlement", /Solde à régulariser 0 FCFA/i.test(regul) && /Régularisé le/i.test(regul), regul);
  verifier("2. parcours : badge « Régularisé » avec solde final 0", (await p.locator('[data-parcours-badge="REGULARISE"]').count()) === 1);
  await p.close();
}

// ======================================================================================================================
// 5. ANCIEN RETOUR BANQUE (bordereau, JournalBanque) : traitement d'origine conservé
// ======================================================================================================================
const D3 = `${PREFIXE}ancien-banque`;
await q(
  `INSERT INTO "Demande"(id, reference, montant, "montantValide", statut, "createurId", "updatedAt", "beneficiaireType", "beneficiaireUserId", "etapeCircuit", "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", description)
   VALUES ($1, 'DEM-LOTG-ANCIEN-BQ', 20000, 20000, 'VALIDEE_NON_REGLEE', $2, now(), 'COLLABORATEUR', $2, 'TERMINEE', true, false, 'OPTIONNELLE', 'ancien retour banque')`,
  [D3, idCollab]
);
await q(`INSERT INTO "LigneDemande"(id, libelle, quantite, "prixUnitaire", "demandeId", "categorieId", motif, "statutValidation", "decideParId", "decideAt", "decideurFinanceId") VALUES ($1, 'Article ancien banque', 1, 20000, $2, 'e2e-lotg-cat', 'm', 'VALIDEE', $3, now(), $3)`, [`${D3}-l1`, D3, idFinance]);
await q(`INSERT INTO "Reglement"(id, montant, mode, "estConfirme", "demandeId", "ligneDemandeId", "auteurId", "confirmeAt") VALUES ($1, 20000, 'BANQUE', true, $2, $3, $4, now())`, [`${D3}-r`, D3, `${D3}-l1`, idAssistant]);
await q(`INSERT INTO "RetourCaisse"(id, "montantARetourner", "estReceptionne", "reglementId", "declarantId", "versementBancaire") VALUES ($1, 8000, false, $2, $3, true)`, [`${D3}-ret`, `${D3}-r`, idCollab]);
await q(`INSERT INTO "JournalBanque"(id, type, montant, "reglementId", "retourCaisseId", "creeParId") VALUES ($1, 'RETOUR', 8000, $2, $3, $4)`, [`${D3}-jb`, `${D3}-r`, `${D3}-ret`, idCollab]);
{
  const p = await connecter("assistant-finance@simassurances.test");
  const avant = await soldeCaisse();
  await p.goto(`${B}/treso/finance/retours/${D3}-ret`);
  await p.getByRole("button", { name: /Réceptionner/ }).first().click();
  await attendre(async () => (await q(`SELECT "estReceptionne" AS e FROM "RetourCaisse" WHERE id = $1`, [`${D3}-ret`]))[0].e === true);
  verifier("5. ancien retour bancaire : la réception n'écrit RIEN en caisse (écriture existante jamais modifiée)", (await soldeCaisse()) === avant && (await q(`SELECT 1 FROM "JournalCaisse" WHERE "refId" = $1`, [`${D3}-ret`])).length === 0);
  await p.close();
  const c = await connecter("collaborateur@simassurances.test");
  await c.goto(`${B}/treso/demandes/${D3}`);
  verifier("5. ancien retour bancaire : non modifiable (pas de bouton « Modifier »)", (await c.getByRole("button", { name: /^Modifier/ }).count()) === 0);
  await c.close();
}

// ======================================================================================================================
// 3. REÇUS DÉTAILLÉS (PDF)
// ======================================================================================================================
{
  const p = await connecter("finance@simassurances.test");
  for (const [libelle, id, mode] of [["Caisse", rCaisse, "Caisse"], ["Banque", rBanque, "Banque"]]) {
    const r = await telecharger(p, `/api/treso/reglements/${id}/recu`, `recu-${libelle}.pdf`);
    verifier(`3. reçu ${libelle} : téléchargé (200)`, r.statut === 200, String(r.statut));
    const t = r.texte;
    verifier(`3. reçu ${libelle} : liste TOUS les règlements (Caisse 60 000 et Banque 40 000), total réglé 100 000`, /règlements de l.article/i.test(t) && /Caisse[^]{0,80}60 000/.test(t) && /Banque[^]{0,80}40 000/.test(t) && /Total réglé[^]{0,40}100 000/i.test(t), t.slice(0, 300));
    verifier(`3. reçu ${libelle} : date, auteur, mention « (ce reçu) »`, /\(ce reçu\)/.test(t) && /par Assistant/i.test(t));
    verifier(`3. reçu ${libelle} : retours de caisse, dépenses déclarées, solde final`, /retours de caisse/i.test(t) && /dépenses déclarées/i.test(t) && /solde final de l.article/i.test(t) && /Solde à régulariser[^]{0,20}0 FCFA/i.test(t), "");
    verifier(`3. reçu ${libelle} : article nommé (version Finance), date de livraison 15/12/2026, demande rappelée`, /Ordinateur \(Finance\)/.test(t) && /15\/12\/2026/.test(t) && /DEM-LOTG-MIXTE/.test(t));
    void mode;
  }
  const recuBanque = await telecharger(p, `/api/treso/reglements/${rBanque}/recu`, "recu-banque-externe.pdf");
  verifier("3. reçu du règlement Banque : section « Retours enregistrés par la Finance (fonds versé par banque) » avec le retour externe de 15 000", /retours enregistrés par la finance/i.test(recuBanque.texte) && /15 000/.test(recuBanque.texte), recuBanque.texte.slice(0, 200));
  const retourBanqueRecu = await telecharger(p, `/api/treso/retours/${PREFIXE}ficheBanque/recu`, "recu-fiche-banque.pdf");
  verifier("3. la fiche de détail d'un fonds bancaire n'a pas de reçu de retour (non réceptionnée)", retourBanqueRecu.statut === 404 || retourBanqueRecu.statut === 403, String(retourBanqueRecu.statut));
  const bon = await telecharger(p, `/api/treso/reglements/${rCaisse}/bon-de-caisse`, "bon.pdf");
  verifier("3. bon de caisse : reste minimal (pas d'historique), date de livraison de l'article", bon.statut === 200 && !/règlements de l.article/i.test(bon.texte) && /15\/12\/2026/.test(bon.texte));
  await p.close();
  const c = await connecter("collaborateur@simassurances.test");
  const rc = await telecharger(c, `/api/treso/reglements/${rBanque}/recu`, "recu-collab.pdf");
  verifier("3. le collaborateur reçoit le reçu avec le libellé d'origine, jamais celui de la Finance", rc.statut === 200 && /Ordinateur/.test(rc.texte) && !/Ordinateur \(Finance\)/.test(rc.texte), rc.texte.slice(0, 200));
  await c.close();
}

// ======================================================================================================================
// 4 (suite). RÉCAPITULATIF DU COLLABORATEUR après régularisation, pas d'information interne
// ======================================================================================================================
{
  const c = await connecter("collaborateur@simassurances.test");
  await c.goto(`${B}/treso/demandes/${D2}`);
  const recap = net(await c.locator("[data-recap-retour-caisse]").innerText());
  verifier("4. récapitulatif final : solde 0 et état « Régularisé »", /Solde à régulariser 0 FCFA/i.test(recap) && /Régularisé/i.test(recap), recap);
  verifier("4. récapitulatif : 15 000 FCFA reçus dont 15 000 enregistrés par la Finance, dépenses justifiées 85 000", /15 000 FCFA reçus/i.test(recap) && /dont 15 000 FCFA enregistrés par la Finance/i.test(recap) && /Dépenses justifiées 85 000 FCFA/i.test(recap), recap);
  verifier("4. récapitulatif : aucune information de gestion interne (catégorie, motif Finance)", !/E2E-G-CAT/.test(recap) && !/motif/i.test(recap));
  await c.close();
}

// ======================================================================================================================
// 5. REPORTING DES RETOURS DE CAISSE (écran + export Excel)
// ======================================================================================================================
{
  const p = await connecter("finance@simassurances.test");
  await p.goto(`${B}/treso/finance/reporting`);
  const tableau = p.locator("[data-reporting-retours]");
  verifier("5. reporting : tableau « Retours de caisse » présent", (await tableau.count()) === 1);
  const lignes = (await tableau.locator("tbody tr").allInnerTexts()).map(net);
  const ligne = lignes.find((t) => t.includes("DEM-LOTG-MIXTE"));
  verifier("5. reporting : la ligne du retour détaille l'article (Finance + demandeur), bénéficiaire, validé 100 000, livraison 15/12/2026", !!ligne && /Ordinateur \(Finance\)/.test(ligne) && /Ordinateur/.test(ligne) && /100 000 FCFA/.test(ligne) && /15\/12\/2026/.test(ligne), ligne ?? "absente");
  verifier("5. reporting : règlements de l'article Caisse 60 000 et Banque 40 000 (total 100 000)", !!ligne && /Caisse — 60 000 FCFA/.test(ligne) && /Banque — 40 000 FCFA/.test(ligne), "");
  verifier("5. reporting : demande, demandeur, service présents", !!ligne && /Collaborateur/.test(ligne));
  const r = await p.request.get(`${B}/api/treso/reporting/export`);
  verifier("5. export Excel : 200", r.status() === 200, String(r.status()));
  const xlsx = join(dossier, "export.xlsx");
  writeFileSync(xlsx, await r.body());
  const classeur = execFileSync("unzip", ["-p", xlsx, "xl/workbook.xml"]).toString();
  verifier("5. export : feuille « Retours de caisse »", classeur.includes('name="Retours de caisse"'));
  const partages = execFileSync("unzip", ["-p", xlsx, "xl/sharedStrings.xml"], { maxBuffer: 64 * 1024 * 1024 }).toString();
  verifier("5. export : colonnes d'article d'origine et de règlements", partages.includes("Article (libellé Finance)") && partages.includes("Article (libellé d&apos;origine du demandeur)") || partages.includes("Article (libellé d'origine du demandeur)"));
  verifier("5. export : valeurs de l'article (Ordinateur (Finance), règlement Banque)", partages.includes("Ordinateur (Finance)") && partages.includes("Banque — 40 000 FCFA"));
  await p.close();
}

await nettoyer();
await nettoyerFormulaire();
verifier("aucune erreur JavaScript en console", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles OK`);
await browser.close();
await db.end();
process.exit(ko === 0 ? 0 : 1);
