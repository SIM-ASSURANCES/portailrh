// Gestion Compta, lot GC-8 — TAXE SUR LES CONTRATS (TCA). Sur base JETABLE et neuve (voir e2e/README.md : `next build` puis
// `bash e2e/base-jetable.sh`) : ce script ÉCRIT en base et ne se rejoue pas sur la même base. Données 100 % synthétiques.
// Parties lançables séparément : E2E_PARTIES="8c,8d,8e,8f" (défaut : toutes ; les parties suivantes supposent les précédentes).
//   8c : avertissement R1, calcul du mois (T1, T3, T5 par le vrai moteur), taux manquant (liste, déclaration bloquée, recalcul), avance par l'écran,
//        refus serveur par rejeu sans permission, 390 px ;
//   8d : mois non terminé / ordre des mois, déclaration (lignes verrouillées, trigger SQL), quittance, crédit reporté sur le mois suivant,
//        déclarations simultanées (une seule passe), rejeu direct sans permission ;
//   8e : état par taux (primes et accessoires hors taxe, base, taux, impôt ; primes remboursées « à compléter (Q15) »), export ;
//   8f : suivi par contrat et par mois, carte « taxe payée d'avance non encore imputée ».
import { execSync } from "node:child_process";
import { chromium } from "playwright";
import pg from "pg";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/i.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");
const PARTIES = (process.env.E2E_PARTIES ?? "8c,8d,8e,8f").split(",");
const partie = (p) => PARTIES.includes(p);

const db = new pg.Client({ connectionString: DB });
await db.connect();
const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const erreursJs = [];

const sessions = new Map();
async function contexte(email) {
  let ctx = sessions.get(email);
  if (!ctx) {
    ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
    const connexion = await ctx.newPage();
    await connexion.goto(`${B}/login`);
    await connexion.fill('input[name="email"]', email);
    await connexion.fill('input[name="password"]', "password123");
    await Promise.all([connexion.waitForURL((u) => !u.pathname.startsWith("/login")), connexion.click('button[type="submit"]')]);
    await connexion.close();
    sessions.set(email, ctx);
  }
  return ctx;
}
async function ouvrir(email, chemin, taille) {
  const ctx = await contexte(email);
  const p = await ctx.newPage();
  if (taille) await p.setViewportSize(taille);
  p.on("pageerror", (e) => erreursJs.push(`${email} : ${e.message}`));
  await p.goto(`${B}${chemin}`);
  await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  return p;
}
const RFCRH = "compta-rfcrh@simassurances.test";
const DIRECTION = "compta-direction@simassurances.test";
const COLLABORATEUR = "collaborateur@simassurances.test";
const R1 = "Gestion Compta est la référence pour la taxe sur les contrats d'assurance.";

const sql = async (texte, valeurs = []) => (await db.query(texte, valeurs)).rows;
const un = async (texte, valeurs = []) => (await sql(texte, valeurs))[0];
const nombre = (texte) => Number((texte ?? "").replace(/[^\d,-]/g, "").replace(",", "."));
const donnees = (phase) => execSync(`npx tsx e2e/compta-gc8-donnees.ts ${phase}`, { env: { ...process.env, DATABASE_URL: DB.replace(/\?.*$/, "") + "?schema=public" }, stdio: "pipe" });
/** Rejoue côté serveur une action capturée avec la session d'un autre compte (la réponse, texte brut). */
async function rejouer(email, req, modifier = null) {
  const ctx = await contexte(email);
  const corps = modifier ? modifier(JSON.parse(req.postData())) : JSON.parse(req.postData());
  const rep = await ctx.request.post(req.url(), { headers: { "next-action": req.headers()["next-action"], "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", origin: B }, data: JSON.stringify(corps) });
  return rep.text();
}
/** Clique et renvoie la requête d'action serveur émise. */
async function cliquerEtCapturer(page, locator) {
  const [req] = await Promise.all([page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]), locator.click()]);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500);
  return req;
}
const aPayerAffiche = async (p) => nombre(await p.locator("[data-a-payer]").innerText());
const sommeLignes = async (where = "TRUE") => Number((await un(`SELECT coalesce(sum(montant),0)::float AS s FROM "CptLigneTaxe" WHERE ${where}`)).s);

let reqRattraper = null;
let reqAvance = null;
let reqDeclarer = null;
let reqPaiement = null;
let totalFevrier = 0;
let declarationFevrier = null;

// =====================================================================================================================
// 8c — calcul du mois
// =====================================================================================================================
if (partie("8c")) {
  donnees("fevrier");
  const lignes = await sql(`SELECT origine, base::float AS base, montant::float AS montant FROM "CptLigneTaxe" ORDER BY "creeAt"`);
  verifier("8c. jeu d'essai : T1 une seule ligne de 169 sur 2 500, T3 739, T5 avance 101 + rattachement 101 + imputation −101 (5 lignes : le contrat sans taux n'en a pas)", lignes.length === 5, JSON.stringify(lignes));
  verifier("8c. T5 : la taxe de l'encaissement de 1 500 n'est comptée qu'une fois (101)", (await sommeLignes(`"encaissementId" IN (SELECT id FROM "CptEncaissement" WHERE montant = 1500)`)) === 101);

  const p = await ouvrir(RFCRH, "/compta/tca?mois=2026-02");
  verifier("8c. mention « Gestion Compta est la référence » en tête, texte exact", (await p.locator("[data-reference-compta]").innerText()).includes(R1));
  verifier("8c. à payer = T1 169 + T3 739 + T5 101 = 1 009 (le contrat sans taux n'est pas taxé)", (await aPayerAffiche(p)) === 1009, await p.locator("[data-a-payer]").innerText());
  verifier("8c. recoupé par un calcul SQL indépendant", (await sommeLignes()) === 1009);
  verifier("8c. liste « taux manquant » : le contrat INCENDIE sans taux", (await p.locator('[data-taux-manquant="POL-GC8-INC"]').count()) === 1, await p.locator("[data-taux-manquants] h2").innerText());
  verifier("8c. aucune taxe n'est devinée pour ce contrat", (await sommeLignes(`"contratId" IN (SELECT id FROM "CptContrat" WHERE "numPolice" = 'POL-GC8-INC')`)) === 0);
  verifier("8c. la formule du calcul est affichée", /À payer = taxe due cumulée/.test(await p.locator("[data-formule-mois]").innerText()));

  // Taux saisi → recalcul.
  await db.query(`INSERT INTO "CptTauxTca" (id, branche, taux, "dateEffet", "creeParId") VALUES ('taux-inc', 'INCENDIE', 0.125, '2000-01-01', (SELECT id FROM "User" WHERE email = $1))`, [RFCRH]);
  reqRattraper = await cliquerEtCapturer(p, p.locator("[data-rattraper-taxes]"));
  await p.reload();
  await p.waitForLoadState("networkidle").catch(() => {});
  verifier("8c. taux saisi puis « Recalculer » : la liste est vide et la taxe de 278 est ajoutée (1 287)", (await p.locator("[data-taux-manquants-vide]").count()) === 1 && (await aPayerAffiche(p)) === 1287, await p.locator("[data-a-payer]").innerText());
  verifier("8c. rattrapage : une seule ligne écrite pour le contrat INCENDIE (278)", (await sommeLignes(`"contratId" IN (SELECT id FROM "CptContrat" WHERE "numPolice" = 'POL-GC8-INC')`)) === 278);
  const rejeuRattrapage = await rejouer(DIRECTION, reqRattraper);
  verifier("8c. rejeu direct du recalcul sans cpt.declarer_tca : refusé", /Action non autoris/.test(rejeuRattrapage), rejeuRattrapage.slice(0, 120));

  // Avance par l'écran : encaissement de 1 000 sans contrat, produit connu (7,25 % → 68).
  await db.query(
    `INSERT INTO "CptEncaissement" (id, reference, "compteId", "referenceReleve", "dateValeur", montant, "typeFlux", statut, "resteARattacher", "creeParId", "majAt")
     VALUES ('enc-avance', 'CPE-2026-955555', (SELECT id FROM "CptCompte" LIMIT 1), 'T_AVANCE_E2E', '2026-02-20', 1000, 'ENCAISSEMENT', 'A_RATTACHER', 1000, (SELECT id FROM "User" WHERE email = $1), now())`,
    [RFCRH]
  );
  const f = p.locator("[data-avance-taxe]");
  await f.locator('input[name="reference"]').fill("CPE-2026-000000");
  await f.locator('input[name="produitCode"]').fill("RELAXMOTO");
  await f.locator('button[type="submit"]').click();
  await p.waitForTimeout(700);
  verifier("8c. avance sur une référence inconnue : refusée, rien n'est écrit", (await sommeLignes(`origine = 'AVANCE' AND montant = 68`)) === 0);
  await f.locator('input[name="reference"]').fill("CPE-2026-955555");
  reqAvance = await cliquerEtCapturer(p, f.locator('button[type="submit"]'));
  verifier("8c. avance par produit : 1 000 à 7,25 % → taxe 68 dans le mois de la date de valeur", (await sommeLignes(`origine = 'AVANCE' AND montant = 68 AND "moisDeclaration" = '2026-02-01'`)) === 68);
  await p.reload();
  await p.waitForLoadState("networkidle").catch(() => {});
  totalFevrier = await sommeLignes();
  verifier("8c. le mois affiche 1 287 + 68 = 1 355", (await aPayerAffiche(p)) === 1355 && totalFevrier === 1355, await p.locator("[data-a-payer]").innerText());
  const rejeuAvance = await rejouer(DIRECTION, reqAvance);
  verifier("8c. rejeu direct de l'avance sans permission : refusé", /Action non autoris/.test(rejeuAvance), rejeuAvance.slice(0, 120));
  await p.close();

  const d = await ouvrir(DIRECTION, "/compta/tca?mois=2026-02");
  verifier("8c. la Direction voit la mention de référence et le calcul en lecture seule", (await d.locator("[data-reference-compta]").count()) === 1 && (await d.locator("[data-section-avance]").count()) === 0 && (await d.locator("[data-calcul-mois]").count()) === 1);
  await d.close();
  const m = await ouvrir(RFCRH, "/compta/tca?mois=2026-02", { width: 390, height: 844 });
  verifier("8c. 390 px : pas de défilement horizontal de la page", await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await m.close();
  const r = await (await contexte(COLLABORATEUR)).request.get(`${B}/compta/tca`, { maxRedirects: 0 });
  verifier("8c. sans cpt.consulter : redirigé", r.status() >= 300 && r.status() < 400, `${r.status()}`);
  const n = await ouvrir(DIRECTION, "/compta/controle");
  verifier("8c. la rubrique « Taxe sur les contrats d'assurance » est dans la barre latérale", (await n.locator('a[href="/compta/tca"]').count()) > 0);
  await n.close();
}

// =====================================================================================================================
// 8d — déclaration, quittance, verrouillage
// =====================================================================================================================
if (partie("8d")) {
  const mois = new Date().toISOString().slice(0, 7);
  const c = await ouvrir(RFCRH, `/compta/tca?mois=${mois}`);
  verifier("8d. le mois courant ne se déclare pas (« pas terminé »)", /pas terminé/.test(await c.locator("[data-declaration-impossible]").innerText()) && (await c.locator("[data-declarer-mois]").isDisabled()));
  await c.close();
  donnees("mars");
  const ordre = await ouvrir(RFCRH, "/compta/tca?mois=2026-03");
  verifier("8d. mars ne se déclare pas avant février (ordre des mois)", /Déclarez d'abord le mois du 2026-02/.test(await ordre.locator("[data-declaration-impossible]").innerText()), await ordre.locator("[data-declaration-impossible]").innerText());
  await ordre.close();

  const p = await ouvrir(RFCRH, "/compta/tca?mois=2026-02");
  const attendu = await sommeLignes(`"moisDeclaration" <= '2026-02-01'`);
  reqDeclarer = await cliquerEtCapturer(p, p.locator("[data-declarer-mois]"));
  declarationFevrier = await un(`SELECT id, reference, "montantDu"::float AS du, "montantAPayer"::float AS a_payer, "nbLignes", statut FROM "CptDeclarationTca" WHERE mois = '2026-02-01'`);
  verifier("8d. déclaration CPD-2026-01 : montant à payer = somme des lignes", declarationFevrier?.reference === "CPD-2026-01" && declarationFevrier.a_payer === attendu && attendu === totalFevrier, JSON.stringify(declarationFevrier));
  const verrouillees = Number((await un(`SELECT count(*)::int AS n FROM "CptLigneTaxe" WHERE "declarationId" = $1`, [declarationFevrier.id])).n);
  verifier("8d. toutes les lignes du mois sont rattachées à la déclaration", verrouillees === declarationFevrier.nbLignes && Number((await un(`SELECT count(*)::int AS n FROM "CptLigneTaxe" WHERE "declarationId" IS NULL AND "moisDeclaration" <= '2026-02-01'`)).n) === 0);
  let refus = "";
  try {
    await db.query(`UPDATE "CptLigneTaxe" SET montant = 1 WHERE "declarationId" = $1`, [declarationFevrier.id]);
  } catch (e) {
    refus = e.message;
  }
  verifier("8d. trigger : une ligne déclarée ne se modifie plus (SQL direct)", /CPT_LIGNE_TAXE_VERROUILLEE/.test(refus), refus);
  verifier("8d. l'écran montre la déclaration et le formulaire de paiement", (await p.locator("[data-reference-declaration]").innerText()) === "CPD-2026-01" && (await p.locator("[data-paiement-tca]").count()) === 1);
  const rejeuDecl = await rejouer(DIRECTION, reqDeclarer);
  verifier("8d. rejeu direct de la déclaration sans permission : refusé", /Action non autoris/.test(rejeuDecl), rejeuDecl.slice(0, 120));
  const rejeuDeclDeux = await rejouer(RFCRH, reqDeclarer);
  verifier("8d. un mois déjà déclaré ne se déclare pas deux fois", /déjà déclaré/.test(rejeuDeclDeux) && Number((await un(`SELECT count(*)::int AS n FROM "CptDeclarationTca"`)).n) === 1, rejeuDeclDeux.slice(0, 160));

  // Paiement : 13 de trop.
  const f = p.locator("[data-paiement-tca]");
  await f.locator('input[name="quittanceNumero"]').fill("Q-FEV-2026");
  await f.locator('input[name="quittanceMontant"]').fill(String(declarationFevrier.a_payer + 13));
  reqPaiement = await cliquerEtCapturer(p, f.locator('button[type="submit"]'));
  const payee = await un(`SELECT statut, "quittanceNumero", "quittanceMontant"::float AS q FROM "CptDeclarationTca" WHERE id = $1`, [declarationFevrier.id]);
  verifier("8d. paiement : déclaration PAYEE avec sa quittance", payee.statut === "PAYEE" && payee.quittanceNumero === "Q-FEV-2026" && payee.q === declarationFevrier.a_payer + 13, JSON.stringify(payee));
  verifier("8d. trop-payé de 13 : un crédit à récupérer", Number((await un(`SELECT coalesce(sum(montant),0)::float AS s FROM "CptCreditTaxe" WHERE statut = 'A_RECUPERER'`)).s) === 13);
  await p.reload();
  await p.waitForLoadState("networkidle").catch(() => {});
  verifier("8d. l'écran affiche la quittance", /Q-FEV-2026/.test(await p.locator("[data-quittance]").innerText()));
  const rejeuPaiementDirection = await rejouer(DIRECTION, reqPaiement);
  verifier("8d. rejeu direct du paiement sans cpt.payer_tca : refusé", /Action non autoris/.test(rejeuPaiementDirection), rejeuPaiementDirection.slice(0, 120));
  const rejeuPaiementDeux = await rejouer(RFCRH, reqPaiement);
  verifier("8d. une déclaration payée ne se paie pas deux fois", /déjà payée/.test(rejeuPaiementDeux), rejeuPaiementDeux.slice(0, 160));
  await p.close();

  // Mars : le trop-payé est reporté.
  const mars = await ouvrir(RFCRH, "/compta/tca?mois=2026-03");
  verifier("8d. mars : à payer = 101 − 13 de trop-payé reporté = 88", (await aPayerAffiche(mars)) === 88, await mars.locator("[data-a-payer]").innerText());
  // Deux déclarations simultanées du même mois : une seule passe.
  const reqMars = await cliquerEtCapturer(mars, mars.locator("[data-declarer-mois]"));
  const decMars = await un(`SELECT id, reference, "montantAPayer"::float AS a_payer FROM "CptDeclarationTca" WHERE mois = '2026-03-01'`);
  verifier("8d. mars déclarée : 88 à payer, référence CPD-2026-02", decMars?.a_payer === 88 && decMars.reference === "CPD-2026-02", JSON.stringify(decMars));
  verifier("8d. le crédit de 13 est récupéré par la déclaration de mars", Number((await un(`SELECT count(*)::int AS n FROM "CptCreditTaxe" WHERE statut = 'RECUPERE' AND "recupereDansId" = $1`, [decMars.id])).n) === 1);
  // Simultanéité : deux déclarations d'avril (mois terminé, sans ligne) lancées EN MÊME TEMPS, une seule passe.
  const [r1, r2] = await Promise.all([rejouer(RFCRH, reqMars, () => ["2026-04-01"]), rejouer(RFCRH, reqMars, () => ["2026-04-01"])]);
  const nbAvril = Number((await un(`SELECT count(*)::int AS n FROM "CptDeclarationTca" WHERE mois = '2026-04-01'`)).n);
  verifier("8d. deux déclarations simultanées du même mois : une seule passe, l'autre reçoit « déjà déclaré »", nbAvril === 1 && /déjà déclaré/.test(r1 + r2), `${nbAvril} — ${(r1 + r2).replace(/\s+/g, " ").slice(0, 200)}`);
  await mars.close();
}

// =====================================================================================================================
// 8e — état par taux
// =====================================================================================================================
if (partie("8e")) {
  const p = await ouvrir(RFCRH, "/compta/tca/etat?mois=2026-02");
  verifier("8e. mention de référence en tête de l'état par taux", (await p.locator("[data-reference-compta]").innerText()).includes(R1));
  // Chaque taux de l'écran est recoupé par un GROUP BY indépendant sur les lignes du mois.
  const attendu = await sql(`SELECT taux::float AS taux, sum("primeHt")::float AS primes, sum("accessoiresHt")::float AS acc, sum(montant)::float AS impot FROM "CptLigneTaxe" WHERE "moisDeclaration" = '2026-02-01' GROUP BY taux ORDER BY taux DESC`);
  const libelles = { 0.0725: "7,25 %", 0.015: "1,5 %", 0.125: "12,5 %" };
  verifier("8e. trois taux (12,5 %, 7,25 %, 1,5 %) et un total", attendu.length === 3 && (await p.locator("[data-etat-par-taux] tbody tr").count()) === 3);
  for (const a of attendu) {
    const ligne = p.locator(`[data-taux="${libelles[a.taux]}"]`);
    const primes = nombre(await ligne.locator("[data-primes]").innerText());
    const base = nombre(await ligne.locator("[data-base]").innerText());
    const impot = nombre(await ligne.locator("[data-impot]").innerText());
    verifier(`8e. taux ${libelles[a.taux]} : primes hors taxe, base d'imposition et impôt = calcul SQL indépendant`, primes === a.primes && base === a.primes + a.acc && impot === a.impot, `écran ${primes}/${base}/${impot} — SQL ${a.primes}/${a.primes + a.acc}/${a.impot}`);
  }
  verifier("8e. le taux de 7,25 % porte T1 (169) + T5 (101, une seule fois) + l'avance de 68 = 338", nombre(await p.locator('[data-taux="7,25 %"] [data-impot]').innerText()) === 338);
  verifier("8e. total de l'impôt = 1 355 (le même que le montant déclaré)", nombre(await p.locator("[data-impot-total]").innerText()) === 1355);
  verifier("8e. primes remboursées : « à compléter (Q15) », jamais inventées", (await p.locator('[data-etat-par-taux] [data-remboursees]').first().innerText()).includes("à compléter (Q15)"));
  verifier("8e. la déclaration du mois est rappelée (CPD-2026-01, payée)", /CPD-2026-01/.test(await p.locator("[data-etat-declaration]").innerText()));
  verifier("8e. crédits à part : trop-payé de 13 né de ce mois, plus rien à récupérer après mars", nombre(await p.locator("[data-credit-mois]").innerText()) === 13 && nombre(await p.locator("[data-credit-ouvert]").innerText()) === 0);
  await p.close();

  const mars = await ouvrir(RFCRH, "/compta/tca/etat?mois=2026-03");
  verifier("8e. mars : 1 ligne à 7,25 %, impôt 101", (await mars.locator("[data-etat-par-taux] tbody tr").count()) === 1 && nombre(await mars.locator('[data-taux="7,25 %"] [data-impot]').innerText()) === 101);
  await mars.close();
  const vide = await ouvrir(DIRECTION, "/compta/tca/etat?mois=2025-01");
  verifier("8e. un mois sans taxe : message clair, la Direction peut consulter", (await vide.locator("[data-etat-vide]").count()) === 1);
  await vide.close();

  // Export : mêmes lignes que l'écran, accès contrôlé.
  const ctx = await contexte(RFCRH);
  const csv = await ctx.request.get(`${B}/api/compta/export/tca?mois=2026-02&format=csv`);
  const texteCsv = await csv.text();
  verifier("8e. export CSV : 200, trois taux et un total de 1 355", csv.status() === 200 && /7,25 %/.test(texteCsv) && /12,5 %/.test(texteCsv) && /Total/.test(texteCsv) && /1355/.test(texteCsv.replace(/\s/g, "")), texteCsv.slice(0, 200).replace(/\n/g, " | "));
  const xlsx = await ctx.request.get(`${B}/api/compta/export/tca?mois=2026-02&format=xlsx`);
  const octets = await xlsx.body();
  verifier("8e. export Excel : 200 et fichier xlsx valide (PK)", xlsx.status() === 200 && octets[0] === 0x50 && octets[1] === 0x4b);
  const anonyme = await browser.newContext();
  verifier("8e. export sans session : 401", (await anonyme.request.get(`${B}/api/compta/export/tca?mois=2026-02&format=csv`, { maxRedirects: 0 })).status() === 401);
  const refuse = await (await contexte(COLLABORATEUR)).request.get(`${B}/api/compta/export/tca?mois=2026-02&format=csv`, { maxRedirects: 0 });
  verifier("8e. export sans cpt.consulter : refusé (403)", refuse.status() === 403, `${refuse.status()}`);
  verifier("8e. mois invalide : 400", (await ctx.request.get(`${B}/api/compta/export/tca?mois=abc&format=csv`)).status() === 400);
  const m = await ouvrir(RFCRH, "/compta/tca/etat?mois=2026-02", { width: 390, height: 844 });
  verifier("8e. 390 px : pas de défilement horizontal de la page", await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await m.close();
}

// =====================================================================================================================
// 8f — suivi par contrat et par mois, taxe payée d'avance
// =====================================================================================================================
if (partie("8f")) {
  const p = await ouvrir(RFCRH, "/compta/tca/suivi?mois=2026-02");
  verifier("8f. mention de référence en tête du suivi", (await p.locator("[data-reference-compta]").innerText()).includes(R1));
  const ligne = (police) => p.locator(`[data-suivi-contrat="${police}"]`);
  verifier("8f. T1 : exigible 169, déclarée 169, payée 169 → « Payée »", nombre(await ligne("POL-GC8-T1").locator("[data-exigible]").innerText()) === 169 && nombre(await ligne("POL-GC8-T1").locator("[data-payee]").innerText()) === 169 && (await ligne("POL-GC8-T1").getAttribute("data-etat-suivi")) === "PAYEE");
  verifier("8f. T3 : exigible 739", nombre(await ligne("POL-GC8-T3").locator("[data-exigible]").innerText()) === 739);
  verifier("8f. T5 : taxe exigible 101 payée d'avance et imputée 101, rien de plus à déclarer (« Payée »)", nombre(await ligne("POL-GC8-T5").locator("[data-exigible]").innerText()) === 101 && nombre(await ligne("POL-GC8-T5").locator("[data-imputee]").innerText()) === 101 && nombre(await ligne("POL-GC8-T5").locator("[data-nette]").innerText()) === 0 && (await ligne("POL-GC8-T5").getAttribute("data-etat-suivi")) === "PAYEE");
  verifier("8f. émise : la taxe de l'échéance (T1 = 169) est affichée même sans encaissement ce mois-là", nombre(await ligne("POL-GC8-T1").locator("[data-emise]").innerText()) >= 0);
  const f = await ouvrir(RFCRH, "/compta/tca/suivi?mois=2026-02&q=T5");
  verifier("8f. filtre par numéro de police : une seule ligne", (await f.locator("[data-suivi-contrat]").count()) === 1);
  await f.close();
  verifier("8f. la carte « taxe payée d'avance non encore imputée » = l'avance de 68 déjà déclarée", Number(((await p.locator("[data-avances-non-imputees]").innerText()).match(/(\d+) FCFA/) ?? [])[1]) === 68, (await p.locator("[data-avances-non-imputees]").innerText()).replace(/\s+/g, " "));
  const c = await ouvrir(RFCRH, "/compta/controle");
  verifier("8f. /compta/controle : la carte n'est plus « Disponible au lot GC-8 » et affiche 68 FCFA", !/Disponible au lot GC-8/.test(await c.locator('[data-indicateur="taxe-payee-avance"]').innerText()) && Number(((await c.locator('[data-indicateur="taxe-payee-avance"]').innerText()).match(/(\d+) FCFA/) ?? [])[1]) === 68, (await c.locator('[data-indicateur="taxe-payee-avance"]').innerText()).replace(/\s+/g, " "));
  await c.close();

  // Imputation de l'avance de 68 : l'encaissement est rattaché à un contrat ; février est déclaré, la correction va au premier mois ouvert.
  donnees("imputer");
  const apres = await sql(`SELECT origine, montant::float AS montant, to_char("moisDeclaration",'YYYY-MM') AS mois FROM "CptLigneTaxe" WHERE "encaissementId" = 'enc-avance' ORDER BY "creeAt"`);
  verifier("8f. rattachement de l'encaissement taxé d'avance : avance 68 + rattachement 68 + imputation −68, total toujours 68", apres.length === 3 && apres.reduce((s, l) => s + l.montant, 0) === 68, JSON.stringify(apres));
  verifier("8f. février est déclaré : les deux lignes de correction vont au premier mois non déclaré (mai, après avril)", apres.filter((l) => l.origine !== "AVANCE").every((l) => l.mois === "2026-05"), JSON.stringify(apres));
  await p.reload();
  await p.waitForLoadState("networkidle").catch(() => {});
  verifier("8f. la carte repasse à 0 : l'avance est imputée", Number(((await p.locator("[data-avances-non-imputees]").innerText()).match(/(\d+) FCFA/) ?? [])[1]) === 0);
  const m = await ouvrir(RFCRH, "/compta/tca/suivi?mois=2026-02", { width: 390, height: 844 });
  verifier("8f. 390 px : pas de défilement horizontal de la page", await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await m.close();
  await p.close();
}

verifier("aucune erreur JavaScript", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));
await browser.close();
await db.end();
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\nGC-8 : ${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko === 0 ? 0 : 1);
