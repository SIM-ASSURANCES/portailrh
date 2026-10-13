// Autonomie des articles, lot E (2026-10-17) — RETOUR DE CAISSE ET RÉGULARISATION PAR ARTICLE, sur base JETABLE
// (voir e2e/README.md).
//
// Scénario principal : demande à 3 articles. A réglé + retour reçu + dépenses (régularisé), B réglé avec dépenses SANS
// retour (solde ouvert), C en attente. Chaque bloc nomme son article, les soldes sont indépendants, la demande ne se
// clôture qu'une fois tous les articles décidés. Puis : « Retours en attente » et « À régulariser » nomment l'article,
// retour exceptionnel post-clôture rattaché à UN article (plafond, validation, dépenses réduites sur cet article seul),
// ancien retour exceptionnel sans article (reste non rattaché), règlements non rattachés (blocage), vue du demandeur.
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
const net = (t) => t.replace(/ | /g, " ").replace(/\s+/g, " ");

// --- Données de test (idempotentes) ---------------------------------------------------------------------------------
const PREFIXE = "e2e-lote-";
const nettoyer = async () => {
  await q(`DELETE FROM "HistoriqueEntry" WHERE "entityId" LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "PieceJointe" WHERE "demandeId" LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "RetourExceptionnel" WHERE "demandeId" LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "DepenseLigne" WHERE "retourCaisseId" LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "RetourCaisse" WHERE id LIKE '${PREFIXE}%'`);
  await q(`DELETE FROM "JournalCaisse" WHERE "demandeId" LIKE '${PREFIXE}%'`);
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

/** Demande à articles de 10 000 FCFA chacun, `statut` par article ('VALIDEE' par défaut). */
async function demande(suffixe, lignes, { statut = "PARTIELLEMENT_VALIDEE", cloturee = false, dgOk = false } = {}) {
  const id = `${PREFIXE}${suffixe}`;
  const valide = lignes.filter((l) => (l.statut ?? "VALIDEE") === "VALIDEE").length * 10000;
  await q(
    `INSERT INTO "Demande"(id, reference, montant, "montantValide", statut, "createurId", "updatedAt", "beneficiaireType", "beneficiaireUserId",
       "etapeCircuit", "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", description, "validationCompleteParDG", "dgApprobateurId")
     VALUES ($1, $2, $3, $4, $5, $6, now(), 'COLLABORATEUR', $6, 'FINANCE', true, false, 'OPTIONNELLE', 'test e2e lot E', $7, $8)`,
    [id, `DEM-LOTE-${suffixe.toUpperCase()}`, lignes.length * 10000, valide, cloturee ? "CLOTUREE" : statut, idCollab, dgOk, dgOk ? await uid("dg@simassurances.test") : null]
  );
  for (const [i, l] of lignes.entries()) {
    const st = l.statut ?? "VALIDEE";
    await q(
      `INSERT INTO "LigneDemande"(id, libelle, quantite, "prixUnitaire", "demandeId", motif, "statutValidation", "beneficiaireType", "beneficiaireUserId",
         "decideParId", "decideAt", "decideurFinanceId", "motifRejet")
       VALUES ($1, $2, 1, 10000, $3, 'motif', $4, $5, $6, $7, $8, $7, $9)`,
      [`${id}-l${i + 1}`, l.libelle, id, st, l.beneficiaireUserId ? "COLLABORATEUR" : null, l.beneficiaireUserId ?? null, st === "EN_ATTENTE" ? null : idFinance, st === "EN_ATTENTE" ? null : new Date(), st === "REJETEE" ? "rejet e2e" : null]
    );
  }
  return id;
}
async function reglementCaisse(id, demandeId, ligneId, montant, { auteur = idAssistant } = {}) {
  await q(`INSERT INTO "Reglement"(id, montant, mode, "estConfirme", "demandeId", "ligneDemandeId", "auteurId", "confirmeAt") VALUES ($1, $2, 'CAISSE', true, $3, $4, $5, now())`, [id, montant, demandeId, ligneId, auteur]);
  await q(`INSERT INTO "JournalCaisse"(id, type, montant, source, "refId", "demandeId", "userId") VALUES ($1, 'SORTIE', $2, 'reglement_caisse', $3, $4, $5)`, [`${id}-jc`, montant, id, demandeId, auteur]);
}
async function retour(id, reglementId, { montant, recu = false, assistant = false }) {
  await q(`INSERT INTO "RetourCaisse"(id, "montantARetourner", "estReceptionne", "reglementId", "declarantId", "creeParAssistant", "receptionneParId", "receptionneAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [id, montant, recu, reglementId, assistant ? idAssistant : idCollab, assistant, recu ? idAssistant : null, recu ? new Date() : null]);
}
async function depense(id, retourId, montant, objet, justification, motif = null) {
  await q(`INSERT INTO "DepenseLigne"(id, montant, objet, date, justification, "motifNonJustifie", "motifNonJustifieParId", "retourCaisseId") VALUES ($1, $2, $3, now(), $4, $5, $6, $7)`, [id, montant, objet, justification, motif, motif ? idAssistant : null, retourId]);
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
  return p;
}
const blocArticle = (p, ligneId) => p.locator(`[data-regularisation-article="${ligneId}"]`);

// ======================================================================================================================
// 1. Demande à 3 articles : A régularisé, B solde ouvert, C en attente
// ======================================================================================================================
const D1 = await demande("1", [{ libelle: "Article A" }, { libelle: "Article B", beneficiaireUserId: idRh }, { libelle: "Article C", statut: "EN_ATTENTE" }], {
  dgOk: true,
});
const A1 = `${D1}-l1`, B1 = `${D1}-l2`, C1 = `${D1}-l3`;
await reglementCaisse(`${D1}-rA`, D1, A1, 10000);
await retour(`${D1}-retA`, `${D1}-rA`, { montant: 4000, recu: true });
await depense(`${D1}-dA1`, `${D1}-retA`, 4000, "Achat A", "FACTURE");
await depense(`${D1}-dA2`, `${D1}-retA`, 2000, "Taxi A", "SANS_PIECE", "Reçu perdu");
await reglementCaisse(`${D1}-rB`, D1, B1, 10000);
await retour(`${D1}-retB`, `${D1}-rB`, { montant: 7000, assistant: true });
await depense(`${D1}-dB1`, `${D1}-retB`, 3000, "Achat B", "FACTURE");

{
  const p = await connecter("assistant-finance@simassurances.test");
  await p.goto(`${B}/treso/finance/demandes/${D1}`);
  const a = blocArticle(p, A1), b = blocArticle(p, B1);
  verifier("1. un bloc de régularisation par article validé (A, B), aucun pour C", (await a.count()) === 1 && (await b.count()) === 1 && (await blocArticle(p, C1).count()) === 0);
  const ta = net(await a.innerText()), tb = net(await b.innerText());
  verifier("1. le bloc A nomme son article, son bénéficiaire et son montant validé", /Article : Article A/i.test(ta) && /Bénéficiaire/i.test(ta) && /Montant validé : 10 000 FCFA/i.test(ta), ta.slice(0, 120));
  verifier("1. le bloc B nomme SON article et SON bénéficiaire (rh@)", /Article : Article B/i.test(tb) && /Bénéficiaire/i.test(tb));
  verifier("1. A : Fonds remis 10 000, Retours reçus 4 000, justifiées 4 000, sans pièce formelle 2 000", /Fonds remis \(Caisse \+ Banque\) 10 000/i.test(ta) && /Retours reçus 4 000/i.test(ta) && /Dépenses justifiées 4 000/i.test(ta) && /Dépenses sans pièce formelle 2 000/i.test(ta), ta);
  verifier("1. A : solde à régulariser 0, badge « Régularisé le … »", /Solde à régulariser 0 FCFA/i.test(ta) && /Régularisé le/i.test(ta));
  verifier("1. B : dépenses justifiées 3 000, solde 7 000 (indépendant de A), badge « À régulariser »", /Dépenses justifiées 3 000/i.test(tb) && /Solde à régulariser 7 000 FCFA/i.test(tb) && /À régulariser/i.test(tb), tb);
  const total = net(await p.locator("[data-regularisation-total]").innerText());
  verifier("1. total de la demande = somme des articles (solde 7 000), « 1 article régularisé sur 3 » (C pas encore décidé)", /Solde à régulariser 7 000 FCFA/i.test(total) && /1 article régularisé sur 3/i.test(total), total);
  const depA = net(await a.locator("[data-depense]").first().innerText());
  const depB = net(await b.locator("[data-depense], [data-reste]").first().innerText());
  verifier("1. chaque carte de dépense nomme son article", /Article : Article A/i.test(depA) && /Article : Article B/i.test(await b.innerText()), `${depA.slice(0, 80)}`);
  verifier("1. le détail des dépenses de B (Achat B) est dans le bloc de B, avec le reste à rendre", /Achat B/i.test(depB) && /Reste à rendre par le collaborateur/i.test(tb));
  verifier("1. parcours de A : Régularisé avec solde final, B : Réglé", (await p.locator('[data-parcours-badge="REGULARISE"]').count()) === 1 && /Solde final : 0 FCFA/i.test(net(await p.locator('[data-parcours-etape="REGULARISE"]').innerText())) && (await p.locator('[data-parcours-badge="RETOUR_EN_ATTENTE"]').count()) === 1);
  await p.close();
}
{
  const p = await connecter("finance@simassurances.test");
  await p.goto(`${B}/treso/finance/demandes/${D1}`);
  verifier("1. le Responsable Finance voit aussi les blocs par article (chiffres, sans détail éditable)", (await blocArticle(p, A1).count()) === 1 && (await blocArticle(p, B1).count()) === 1);
  verifier("1. C (en attente) : la demande n'est pas clôturable tant qu'un article n'est pas décidé", (await p.getByRole("button", { name: "Clôturer totalement" }).count()) === 0);
  // C rejeté : tous les articles sont décidés, la clôture devient possible (DG déjà approuvé dans la fixture).
  await q(`UPDATE "LigneDemande" SET "statutValidation" = 'REJETEE', "motifRejet" = 'rejet e2e', "decideParId" = $2, "decideAt" = now() WHERE id = $1`, [C1, idFinance]);
  await p.goto(`${B}/treso/finance/demandes/${D1}`);
  verifier("1. tous les articles décidés : « Clôturer totalement » apparaît (clôture au niveau de la demande)", (await p.getByRole("button", { name: "Clôturer totalement" }).count()) === 1);
  verifier("1. l'article rejeté n'est pas compté : « 1 article régularisé sur 2 » toujours", /1 article régularisé sur 2/i.test(net(await p.locator("[data-regularisation-total]").innerText())));
  await p.close();
}

// Un retour déclaré par le collaborateur, avec un reste non détaillé (ligne générique)
const D2 = await demande("2", [{ libelle: "Article Z" }], { statut: "VALIDEE_NON_REGLEE", dgOk: true });
const Z2 = `${D2}-l1`;
await reglementCaisse(`${D2}-rZ`, D2, Z2, 10000);
await retour(`${D2}-retZ`, `${D2}-rZ`, { montant: 6000 });
await depense(`${D2}-dZ1`, `${D2}-retZ`, 4000, "Dépenses non détaillées", "SANS_PIECE");
{
  const p = await connecter("assistant-finance@simassurances.test");
  await p.goto(`${B}/treso/finance/demandes/${D2}`);
  const t = net(await blocArticle(p, Z2).innerText());
  verifier("1. article Z : « Reste non détaillé 4 000 » séparé des dépenses, solde 10 000 − 4 000 = 6 000", /Reste non détaillé 4 000/i.test(t) && /Dépenses justifiées 0/i.test(t) && /Solde à régulariser 6 000 FCFA/i.test(t), t.slice(0, 260));
  verifier("1. le reste non détaillé offre « Détailler » dans le contexte de l'article Z", (await blocArticle(p, Z2).getByRole("button", { name: /Détailler/ }).count()) >= 1);
  await p.close();
}

// Vue du demandeur : le même article nommé, sans action
{
  const p = await connecter("collaborateur@simassurances.test");
  await p.goto(`${B}/treso/demandes/${D1}`);
  const t = net(await p.locator("body").innerText());
  verifier("1. le demandeur voit « Article « Article A » (bénéficiaire … montant validé 10 000 FCFA) » sur ses retours", /Article « Article A » \(bénéficiaire : .*montant validé : 10 000 FCFA\)/i.test(t) && /Article « Article B »/i.test(t));
  await p.close();
}

// ======================================================================================================================
// 2. Listes : « Retours en attente » et « À régulariser » nomment l'article
// ======================================================================================================================
{
  const p = await connecter("assistant-finance@simassurances.test");
  await p.goto(`${B}/treso/finance/retours`);
  const ligne = p.locator("tr, li, div").filter({ hasText: "DEM-LOTE-2" }).filter({ hasText: "Article Z" }).first();
  const t = net(await ligne.innerText().catch(() => ""));
  verifier("2. « Retours en attente » : le retour de Z nomme l'article, son bénéficiaire et son montant validé", /Article : Article Z/i.test(t) && /validé 10 000 FCFA/i.test(t), t.slice(0, 160));
  await p.close();
}
{
  const p = await connecter("finance@simassurances.test");
  await p.goto(`${B}/treso/finance/a-regulariser`);
  const t = net(await p.locator("body").innerText());
  verifier("2. « À régulariser » : chaque article validé avec SON solde", /Article : Article A — régularisé/i.test(t) && /Article : Article B — solde 7 000 FCFA/i.test(t), t.slice(t.indexOf("DEM-LOTE-1"), t.indexOf("DEM-LOTE-1") + 220));
  await p.close();
}

// ======================================================================================================================
// 3. Retour exceptionnel post-clôture rattaché à UN article
// ======================================================================================================================
const D3 = await demande("3", [{ libelle: "Article X" }, { libelle: "Article Y" }], { cloturee: true, dgOk: true });
const X3 = `${D3}-l1`, Y3 = `${D3}-l2`;
await reglementCaisse(`${D3}-rX`, D3, X3, 10000);
await retour(`${D3}-retX`, `${D3}-rX`, { montant: 0, recu: true });
await depense(`${D3}-dX1`, `${D3}-retX`, 4000, "Achat X", "FACTURE");
await depense(`${D3}-dX2`, `${D3}-retX`, 6000, "Taxi X", "SANS_PIECE", "Pas de reçu");
await reglementCaisse(`${D3}-rY`, D3, Y3, 10000);
await retour(`${D3}-retY`, `${D3}-rY`, { montant: 0, recu: true });
await depense(`${D3}-dY1`, `${D3}-retY`, 10000, "Taxi Y", "SANS_PIECE", "Pas de reçu Y");
{
  const p = await connecter("assistant-finance@simassurances.test");
  await p.goto(`${B}/treso/finance/demandes/${D3}`);
  await p.getByRole("button", { name: "Enregistrer un retour exceptionnel" }).click();
  verifier("3. le formulaire demande l'ARTICLE concerné (liste des articles réglés avec leur plafond)", (await p.getByLabel("Article concerné").count()) === 1 && /maximum 10 000 FCFA/i.test(net(await p.getByLabel("Article concerné").innerText())));
  // Sans article : refus côté écran
  await p.getByLabel("Montant rendu (FCFA)").fill("3000");
  await p.getByLabel("Motif").fill("Le collaborateur a rendu de l'argent après la clôture");
  await p.getByRole("button", { name: "Enregistrer", exact: true }).click();
  verifier("3. sans article choisi : refusé, rien n'est créé", (await p.getByText("Choisissez l'article concerné.").count()) === 1 && (await q(`SELECT 1 FROM "RetourExceptionnel" WHERE "demandeId" = $1`, [D3])).length === 0);
  // Au-delà du plafond de l'article
  await p.getByLabel("Article concerné").selectOption(X3);
  await p.getByLabel("Montant rendu (FCFA)").fill("20000");
  await p.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await attendre(async () => (await p.getByText(/dépasse le maximum autorisé pour l'article « Article X »/).count()) > 0, 8000);
  verifier("3. au-delà du plafond de l'article : refusé avec le nom de l'article", (await p.getByText(/dépasse le maximum autorisé pour l'article « Article X »/).count()) > 0 && (await q(`SELECT 1 FROM "RetourExceptionnel" WHERE "demandeId" = $1`, [D3])).length === 0);
  // Montant valide
  await p.getByLabel("Montant rendu (FCFA)").fill("3000");
  await p.getByRole("button", { name: "Enregistrer", exact: true }).click();
  const cree = await attendre(async () => (await q(`SELECT 1 FROM "RetourExceptionnel" WHERE "demandeId" = $1`, [D3])).length === 1);
  const re = (await q(`SELECT id, "ligneDemandeId", statut FROM "RetourExceptionnel" WHERE "demandeId" = $1`, [D3]))[0];
  verifier("3. saisie rattachée à l'article X, en attente de validation", cree && re.ligneDemandeId === X3 && re.statut === "EN_ATTENTE_VALIDATION");
  await p.close();

  // Garde 8 par article, côté serveur : le bénéficiaire de l'article Y (rh@) ne valide pas… X est au collaborateur
  const f = await connecter("finance@simassurances.test");
  await f.goto(`${B}/treso/finance/demandes/${D3}`);
  verifier("3. la liste des retours exceptionnels nomme l'article", /Article : Article X/i.test(net(await f.locator("body").innerText())));
    await f.getByRole("button", { name: "Valider", exact: true }).first().click();
  const valide = await attendre(async () => (await q(`SELECT statut FROM "RetourExceptionnel" WHERE id = $1`, [re.id]))[0].statut === "VALIDE");
  verifier("3. validé par le Responsable Finance", valide);
  const lignes = await q(`SELECT id, montant::float AS montant FROM "DepenseLigne" WHERE "retourCaisseId" LIKE '${PREFIXE}3-ret%' ORDER BY id`);
  const m = Object.fromEntries(lignes.map((l) => [l.id, l.montant]));
  verifier("3. les dépenses sans pièce formelle de l'article X sont réduites de 3 000 (6 000 → 3 000), les justifiées intactes", m[`${D3}-dX2`] === 3000 && m[`${D3}-dX1`] === 4000, JSON.stringify(m));
  verifier("3. les dépenses de l'article Y ne sont PAS touchées", m[`${D3}-dY1`] === 10000);
  await f.goto(`${B}/treso/finance/demandes/${D3}`);
  const tx = net(await blocArticle(f, X3).innerText()), ty = net(await blocArticle(f, Y3).innerText());
  verifier("3. X : retours reçus 3 000, solde 0 ; Y inchangé (retours reçus 0, solde 0)", /Retours reçus 3 000/i.test(tx) && /Solde à régulariser 0 FCFA/i.test(tx) && /Retours reçus 0/i.test(ty) && /Solde à régulariser 0 FCFA/i.test(ty), tx.slice(0, 200));
  verifier("3. plus d'état « indéterminé » : aucune note sur les articles", !(await f.locator("body").innerText()).includes("ne peut pas être attribuée à cet article"));
  const histo = (await q(`SELECT detail FROM "HistoriqueEntry" WHERE "entityId" = $1 AND action = 'retour_exceptionnel_post_cloture'`, [D3]))[0]?.detail ?? "";
  verifier("3. l'historique nomme l'article", histo.includes("Article X"), histo.slice(0, 120));
  verifier("3. écriture de caisse : une ENTREE de 3 000", (await q(`SELECT 1 FROM "JournalCaisse" WHERE "demandeId" = $1 AND source = 'retour_exceptionnel_post_cloture' AND montant = 3000`, [D3])).length === 1);
  await f.close();
}

// ======================================================================================================================
// 4. Ancien retour exceptionnel SANS article (demande à 2 articles réglés) : jamais attribué, signalé
// ======================================================================================================================
const D4 = await demande("4", [{ libelle: "Article P" }, { libelle: "Article Q" }], { cloturee: true, dgOk: true });
const P4 = `${D4}-l1`, Q4 = `${D4}-l2`;
await reglementCaisse(`${D4}-rP`, D4, P4, 10000);
await reglementCaisse(`${D4}-rQ`, D4, Q4, 10000);
await q(`INSERT INTO "RetourExceptionnel"(id, "demandeId", montant, motif, statut, "saisiParId", "valideParId", "valideAt") VALUES ($1, $2, 2000, 'ancien retour sans article', 'VALIDE', $3, $4, now())`, [`${D4}-ancien`, D4, idAssistant, idFinance]);
{
  const f = await connecter("finance@simassurances.test");
  await f.goto(`${B}/treso/finance/demandes/${D4}`);
  const nr = net(await f.locator("[data-regularisation-non-rattachee]").innerText().catch(() => ""));
  verifier("4. l'ancien retour exceptionnel apparaît dans « Non rattaché à un article », jamais dans un article", /Non rattaché à un article/i.test(nr) && /Retours reçus 2 000/i.test(nr), nr.slice(0, 160));
  verifier("4. chaque article garde son propre solde (10 000), rien n'est deviné", /Retours reçus 0/i.test(net(await blocArticle(f, P4).innerText())) && /Retours reçus 0/i.test(net(await blocArticle(f, Q4).innerText())));
  verifier("4. la section des retours exceptionnels signale l'ancien retour comme non rattaché", /Non rattaché à un article \(ancien retour\)/i.test(net(await f.locator("body").innerText())));
  verifier("4. le parcours des articles réglés en Caisse reste « indéterminé » (pas de Régularisé affiché)", (await f.locator('[data-parcours-badge="REGULARISE"]').count()) === 0);
  await f.close();
  // Saisie bloquée tant que des règlements ne sont pas rattachés
}
const D5 = await demande("5", [{ libelle: "Article R" }, { libelle: "Article S" }], { cloturee: true, dgOk: true });
await reglementCaisse(`${D5}-rAnc`, D5, null, 8000);
{
  const p = await connecter("assistant-finance@simassurances.test");
  await p.goto(`${B}/treso/finance/demandes/${D5}`);
  verifier("5. règlements non rattachés : avertissement et saisie du retour exceptionnel désactivée", /ne sont rattachés à aucun article/i.test(net(await p.locator("body").innerText())) && (await p.getByRole("button", { name: "Enregistrer un retour exceptionnel" }).isDisabled().catch(() => true)));
  await p.close();
}

// ======================================================================================================================
// 5. Invariant : la somme des articles + part non rattachée = le solde de la demande (écran Mes demandes / À régulariser)
// ======================================================================================================================
{
  const rows = await q(`
    SELECT COALESCE((SELECT SUM(montant) FROM "Reglement" WHERE "demandeId" = $1 AND "estConfirme" AND NOT "estAnnule"),0)::float AS regle,
           COALESCE((SELECT SUM(d.montant) FROM "DepenseLigne" d JOIN "RetourCaisse" r ON r.id = d."retourCaisseId" JOIN "Reglement" g ON g.id = r."reglementId" WHERE g."demandeId" = $1),0)::float AS dep,
           COALESCE((SELECT SUM(r."montantARetourner") FROM "RetourCaisse" r JOIN "Reglement" g ON g.id = r."reglementId" WHERE g."demandeId" = $1 AND r."estReceptionne"),0)::float AS ret`, [D1]);
  const ecartSql = rows[0].regle - rows[0].dep - rows[0].ret;
  const p = await connecter("finance@simassurances.test");
  await p.goto(`${B}/treso/finance/demandes/${D1}`);
  const total = net(await p.locator("[data-regularisation-total]").innerText());
  verifier("6. invariant : le total affiché égale le calcul SQL indépendant de l'écart", new RegExp(`solde à régulariser ${String(ecartSql).replace(/(\d)(?=(\d{3})+$)/g, "$1 ")} fcfa`, "i").test(total), `SQL=${ecartSql}`);
  await p.close();
}

verifier("aucune erreur JavaScript non interceptée", erreursJs.length === 0, erreursJs.join(" | "));
await nettoyer();
await browser.close();
await db.end();
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles OK`);
process.exit(ko ? 1 : 0);
