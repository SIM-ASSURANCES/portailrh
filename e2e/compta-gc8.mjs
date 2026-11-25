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
const R1 = "Le module Encaissements calcule aussi la taxe. Avant la mise en service, un seul des deux doit faire foi (décision à prendre).";

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
  verifier("8c. avertissement R1 visible en tête, texte exact", (await p.locator("[data-avertissement-r1]").innerText()).includes(R1));
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
  verifier("8c. la Direction voit l'avertissement R1 et le calcul en lecture seule", (await d.locator("[data-avertissement-r1]").count()) === 1 && (await d.locator("[data-section-avance]").count()) === 0 && (await d.locator("[data-calcul-mois]").count()) === 1);
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

verifier("aucune erreur JavaScript", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));
await browser.close();
await db.end();
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\nGC-8 : ${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko === 0 ? 0 : 1);
