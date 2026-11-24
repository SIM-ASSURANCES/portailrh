// Gestion Compta, lot GC-2e — CORRESPONDANCES ODOO (/compta/referentiels?onglet=odoo).
// Sur base JETABLE et neuve (voir e2e/README.md : `next build` puis `bash e2e/base-jetable.sh`) : ce script ÉCRIT en base et ne se rejoue
// pas sur la même base. Les fiches d'essai sont insérées en SQL (avec leurs mots de recherche), puis l'écran réel est exercé :
//  1. l'onglet existe, les fiches à compléter passent d'abord, compteurs « n à compléter sur N » (fiches actives seulement) ;
//  2. le filtre « À compléter seulement » ; une fiche désactivée n'est jamais comptée ;
//  3. enregistrement d'un tiers, d'un compte Odoo, d'un journal + compte : base, audit `correspondance_odoo`, index de recherche, compteurs ;
//  4. un champ trop long est refusé avec son message, rien n'est écrit ;
//  5. la recherche rapide filtre partenaires, clients et produits par leur valeur Odoo ;
//  6. droits : Direction (lecture seule) ne voit aucun bouton, et le rejeu de la Server Action avec sa session est refusé ;
//  7. mobile 390 px sans défilement horizontal, aucune erreur JavaScript.
import { chromium } from "playwright";
import pg from "pg";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/i.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");

const db = new pg.Client({ connectionString: DB });
await db.connect();
const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const erreursJs = [];

const RFCRH = "compta-rfcrh@simassurances.test";
const DIRECTION = "compta-direction@simassurances.test";

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
async function ouvrir(email, parametres = "") {
  const ctx = await contexte(email);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(`${email} : ${e.message}`));
  await p.goto(`${B}/compta/referentiels?onglet=odoo${parametres}`);
  await p.waitForSelector("h1");
  await p.waitForSelector('[data-referentiel="odoo"]');
  await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  return p;
}

const ligne = (p, id) => p.locator(`[data-odoo-ligne="${id}"]`);
const resume = async (p, entite) => (await p.locator(`[data-odoo-resume="${entite}"]`).innerText()).replace(/\s+/g, " ").trim();
const idsAffiches = async (p, entite) => p.$$eval(`[data-odoo-section="${entite}"] [data-odoo-ligne]`, (els) => els.map((e) => e.getAttribute("data-odoo-ligne")));
const statut = async (p, id) => ligne(p, id).getAttribute("data-odoo-statut");
const un = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const mots = async (entite, id) => (await db.query(`SELECT mot FROM "CptMot" WHERE entite = $1 AND "entiteId" = $2`, [entite, id])).rows.map((r) => r.mot);

/** Enregistre la ligne et rend la requête de Server Action capturée (pour le rejeu). */
async function enregistrer(p, id, valeurs) {
  const l = ligne(p, id);
  for (const [nom, valeur] of Object.entries(valeurs)) await l.locator(`[name="${nom}"]`).fill(valeur);
  const [requete] = await Promise.all([p.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]), l.locator('button[type="submit"]').click()]);
  await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(500);
  return requete;
}

// ---------- Fiches d'essai (SQL) ----------
await db.query(`DELETE FROM "CptMot" WHERE "entiteId" LIKE 'gc2e-%'`);
await db.query(`INSERT INTO "CptPartenaire" (id, nom, "estApporteur", "tiersOdoo", actif, "majAt") VALUES
  ('gc2e-p-a', 'Alpha GC2E', true, NULL, true, now()),
  ('gc2e-p-b', 'Beta GC2E', false, 'T-BETA', true, now()),
  ('gc2e-p-c', 'Gamma Inactif GC2E', false, NULL, false, now())`);
await db.query(`INSERT INTO "CptClient" (id, nom, telephone, "tiersOdoo", "majAt") VALUES
  ('gc2e-c-a', 'Client Sans Tiers GC2E', '+2250700000001', NULL, now()),
  ('gc2e-c-b', 'Client Avec Tiers GC2E', NULL, 'T-CLI', now())`);
await db.query(`INSERT INTO "CptProduit" (id, code, libelle, branche, "compteOdoo", actif, "majAt") VALUES
  ('gc2e-x-a', 'GC2E-P1', 'Produit un GC2E', 'ACCIDENTS', NULL, true, now()),
  ('gc2e-x-b', 'GC2E-P2', 'Produit deux GC2E', 'SANTE', '411300', true, now())`);
await db.query(`INSERT INTO "CptCompte" (id, libelle, type, "journalOdoo", "compteOdoo", actif, "majAt") VALUES
  ('gc2e-k-a', 'Compte Complet GC2E', 'BANQUE', 'J1', '5211', true, now()),
  ('gc2e-k-b', 'Compte Partiel GC2E', 'WAVE_BUSINESS', 'J2', NULL, true, now())`);
// Mots de recherche des fiches d'essai (la migration de l'index ne remplit que les fiches déjà présentes à son passage).
await db.query(`INSERT INTO "CptMot" (entite, "entiteId", mot) VALUES
  ('PARTENAIRE','gc2e-p-a','alpha'), ('PARTENAIRE','gc2e-p-a','gc2e'),
  ('PARTENAIRE','gc2e-p-b','beta'), ('PARTENAIRE','gc2e-p-b','gc2e'), ('PARTENAIRE','gc2e-p-b','tbeta'), ('PARTENAIRE','gc2e-p-b','t'),
  ('CLIENT','gc2e-c-a','client'), ('CLIENT','gc2e-c-a','gc2e'),
  ('CLIENT','gc2e-c-b','client'), ('CLIENT','gc2e-c-b','gc2e'), ('CLIENT','gc2e-c-b','tcli'),
  ('PRODUIT','gc2e-x-a','gc2ep1'), ('PRODUIT','gc2e-x-a','gc2e'),
  ('PRODUIT','gc2e-x-b','gc2ep2'), ('PRODUIT','gc2e-x-b','gc2e'), ('PRODUIT','gc2e-x-b','411300')
  ON CONFLICT DO NOTHING`);

// Compteurs attendus, calculés sur TOUTE la base (le seed ne crée pas de fiches Compta, mais on ne le suppose pas).
const n = async (sql) => Number((await un(sql)).n);
const attendu = async () => ({
  partenaires: [await n(`SELECT count(*)::int n FROM "CptPartenaire" WHERE actif`), await n(`SELECT count(*)::int n FROM "CptPartenaire" WHERE actif AND "tiersOdoo" IS NULL`)],
  clients: [await n(`SELECT count(*)::int n FROM "CptClient"`), await n(`SELECT count(*)::int n FROM "CptClient" WHERE "tiersOdoo" IS NULL`)],
  produits: [await n(`SELECT count(*)::int n FROM "CptProduit" WHERE actif`), await n(`SELECT count(*)::int n FROM "CptProduit" WHERE actif AND "compteOdoo" IS NULL`)],
  comptes: [await n(`SELECT count(*)::int n FROM "CptCompte" WHERE actif`), await n(`SELECT count(*)::int n FROM "CptCompte" WHERE actif AND ("journalOdoo" IS NULL OR "compteOdoo" IS NULL)`)],
});
const texteResume = ([total, manque]) => `${manque} à compléter sur ${total}`;

// ---------- 1. L'onglet, l'ordre, les compteurs ----------
let p = await ouvrir(RFCRH);
const onglets = await p.$$eval("[data-onglet-compta]", (els) => els.map((e) => e.getAttribute("data-onglet-compta")));
verifier("1. l'onglet « Correspondances Odoo » est le septième onglet", onglets[6] === "odoo" && onglets.length === 7, JSON.stringify(onglets));
const att = await attendu();
verifier("1. compteur Partenaires = actifs sans tiers / actifs", (await resume(p, "PARTENAIRE")) === texteResume(att.partenaires), await resume(p, "PARTENAIRE"));
verifier("1. compteur Clients", (await resume(p, "CLIENT")) === texteResume(att.clients), await resume(p, "CLIENT"));
verifier("1. compteur Produits", (await resume(p, "PRODUIT")) === texteResume(att.produits), await resume(p, "PRODUIT"));
verifier("1. compteur Comptes (journal OU compte manquant)", (await resume(p, "COMPTE")) === texteResume(att.comptes), await resume(p, "COMPTE"));
const idsPart = await idsAffiches(p, "PARTENAIRE");
verifier("1. partenaires : les fiches à compléter passent avant celle qui est complète", idsPart.indexOf("gc2e-p-b") > idsPart.indexOf("gc2e-p-a"), JSON.stringify(idsPart));
verifier("1. statuts : sans tiers = à compléter, avec tiers = complet", (await statut(p, "gc2e-p-a")) === "a-completer" && (await statut(p, "gc2e-p-b")) === "complet");
verifier("1. compte partiel = à compléter (compte Odoo manquant), compte complet = complet", (await statut(p, "gc2e-k-b")) === "a-completer" && (await statut(p, "gc2e-k-a")) === "complet");
verifier("1. le champ manquant est nommé", (await ligne(p, "gc2e-k-b").innerText()).includes("À compléter : Compte Odoo"));
verifier("1. fiche désactivée affichée avec son badge, mais pas comptée", (await ligne(p, "gc2e-p-c").innerText()).includes("Désactivé"));
const phrase = (await p.locator("[data-odoo-a-completer]").innerText()).replace(/\s+/g, " ");
const totalAttendu = att.partenaires[1] + att.clients[1] + att.produits[1] + att.comptes[1];
verifier("1. phrase d'ensemble : nombre de fiches actives à compléter", phrase.includes(`${totalAttendu} fiche`), phrase);
await p.close();

// ---------- 2. Filtre « à compléter seulement » ----------
p = await ouvrir(RFCRH, "&manquantes=1");
const filtrees = await idsAffiches(p, "PARTENAIRE");
verifier("2. filtre : la fiche complète n'est plus listée", !filtrees.includes("gc2e-p-b") && filtrees.includes("gc2e-p-a"), JSON.stringify(filtrees));
verifier("2. filtre : la fiche désactivée n'est pas proposée à compléter", !filtrees.includes("gc2e-p-c"));
verifier("2. filtre : produits et comptes complets absents", !(await idsAffiches(p, "PRODUIT")).includes("gc2e-x-b") && !(await idsAffiches(p, "COMPTE")).includes("gc2e-k-a"));
verifier("2. les compteurs ignorent le filtre", (await resume(p, "PARTENAIRE")) === texteResume(att.partenaires));
verifier("2. le lien « Toutes » retire le filtre", !/manquantes/.test((await p.locator('[data-odoo-filtre="tout"]').getAttribute("href")) ?? ""));
await p.close();

// ---------- 3. Enregistrement ----------
p = await ouvrir(RFCRH);
verifier("3. bouton « Enregistrer » grisé tant que rien n'a changé", await ligne(p, "gc2e-p-a").locator('button[type="submit"]').isDisabled());
const reqTiers = await enregistrer(p, "gc2e-p-a", { tiersOdoo: "  T-ALPHA   2 " });
const alpha = await un(`SELECT "tiersOdoo" FROM "CptPartenaire" WHERE id = 'gc2e-p-a'`);
verifier("3. partenaire : tiers enregistré, espaces réduits", alpha.tiersOdoo === "T-ALPHA 2", alpha.tiersOdoo);
verifier("3. partenaire : la fiche devient complète et le compteur baisse", (await statut(p, "gc2e-p-a")) === "complet" && (await resume(p, "PARTENAIRE")) === texteResume([att.partenaires[0], att.partenaires[1] - 1]), await resume(p, "PARTENAIRE"));
const motsAlpha = await mots("PARTENAIRE", "gc2e-p-a");
verifier("3. partenaire : les mots du tiers sont indexés (« talpha », « alpha »)", ["talpha", "t", "alpha", "2"].every((m) => motsAlpha.includes(m)), JSON.stringify(motsAlpha));
const audit = await un(`SELECT action, avant, apres FROM "CptAudit" WHERE entite = 'CptPartenaire' AND "entiteId" = 'gc2e-p-a' ORDER BY at DESC LIMIT 1`);
verifier("3. audit « correspondance_odoo » avec l'avant et l'après", audit?.action === "correspondance_odoo" && JSON.stringify(audit?.avant ?? {}).includes("tiersOdoo") && JSON.stringify(audit?.apres ?? {}).includes("T-ALPHA"), JSON.stringify(audit)?.slice(0, 200));

await enregistrer(p, "gc2e-x-a", { compteOdoo: "411100" });
const prod = await un(`SELECT "compteOdoo", code, libelle FROM "CptProduit" WHERE id = 'gc2e-x-a'`);
verifier("3. produit : compte Odoo enregistré, code et libellé intacts", prod.compteOdoo === "411100" && prod.code === "GC2E-P1" && prod.libelle === "Produit un GC2E", JSON.stringify(prod));
verifier("3. produit : « 411100 » est cherchable dans l'index", (await mots("PRODUIT", "gc2e-x-a")).includes("411100"));

await enregistrer(p, "gc2e-k-b", { compteOdoo: "5212" });
const cpt = await un(`SELECT "journalOdoo", "compteOdoo" FROM "CptCompte" WHERE id = 'gc2e-k-b'`);
verifier("3. compte d'encaissement : journal conservé, compte ajouté", cpt.journalOdoo === "J2" && cpt.compteOdoo === "5212", JSON.stringify(cpt));
await enregistrer(p, "gc2e-k-a", { journalOdoo: "", compteOdoo: "" });
const vide = await un(`SELECT "journalOdoo", "compteOdoo" FROM "CptCompte" WHERE id = 'gc2e-k-a'`);
verifier("3. champs vidés : remis à « non renseigné » (NULL), pas une chaîne vide", vide.journalOdoo === null && vide.compteOdoo === null, JSON.stringify(vide));
verifier("3. la fiche vidée repasse « à compléter »", (await statut(p, "gc2e-k-a")) === "a-completer");

await enregistrer(p, "gc2e-c-a", { tiersOdoo: "T-CLIENT-A" });
const cli = await un(`SELECT "tiersOdoo", nom, telephone FROM "CptClient" WHERE id = 'gc2e-c-a'`);
verifier("3. client : tiers enregistré, nom et téléphone intacts", cli.tiersOdoo === "T-CLIENT-A" && cli.nom === "Client Sans Tiers GC2E" && cli.telephone === "+2250700000001", JSON.stringify(cli));
const motsCli = await mots("CLIENT", "gc2e-c-a");
verifier("3. client : mots du tiers et du téléphone (sans « + ») indexés", motsCli.includes("tclienta") && motsCli.includes("2250700000001"), JSON.stringify(motsCli));
const nbAudits = await n(`SELECT count(*)::int n FROM "CptAudit" WHERE action = 'correspondance_odoo' AND "entiteId" LIKE 'gc2e-%'`);
verifier("3. une trace d'audit par enregistrement (5)", nbAudits === 5, String(nbAudits));
await p.close();

// ---------- 4. Champ trop long ----------
p = await ouvrir(RFCRH);
const avantLong = await un(`SELECT "tiersOdoo" FROM "CptPartenaire" WHERE id = 'gc2e-p-b'`);
await enregistrer(p, "gc2e-p-b", { tiersOdoo: "x".repeat(70) });
const apresLong = await un(`SELECT "tiersOdoo" FROM "CptPartenaire" WHERE id = 'gc2e-p-b'`);
verifier("4. tiers de plus de 60 caractères : rien n'est écrit", apresLong.tiersOdoo === avantLong.tiersOdoo, apresLong.tiersOdoo);
verifier("4. le message d'erreur est affiché sous le champ", (await ligne(p, "gc2e-p-b").innerText()).includes("60 caractères"));
await p.close();

// ---------- 5. Recherche rapide ----------
p = await ouvrir(RFCRH, "&q=tbeta");
verifier("5. « tbeta » (valeur Odoo) trouve le partenaire", (await idsAffiches(p, "PARTENAIRE")).includes("gc2e-p-b") && !(await idsAffiches(p, "PARTENAIRE")).includes("gc2e-p-a"));
verifier("5. « tbeta » ne trouve aucun client ni produit", (await idsAffiches(p, "CLIENT")).length === 0 && (await idsAffiches(p, "PRODUIT")).length === 0);
const hrefM = await p.locator('[data-odoo-filtre="manquantes"]').getAttribute("href");
verifier("5. le filtre conserve la recherche", /q=tbeta/.test(hrefM ?? "") && /manquantes=1/.test(hrefM ?? ""), hrefM ?? "");
await p.close();
p = await ouvrir(RFCRH, "&q=gc2e");
verifier("5. « gc2e » trouve des fiches des trois types indexés", (await idsAffiches(p, "CLIENT")).includes("gc2e-c-a") && (await idsAffiches(p, "PRODUIT")).includes("gc2e-x-a") && (await idsAffiches(p, "PARTENAIRE")).includes("gc2e-p-a"));
verifier("5. les comptes ne sont pas filtrés par la recherche (pas d'index)", (await idsAffiches(p, "COMPTE")).includes("gc2e-k-a"));
await p.close();

// ---------- 6. Droits ----------
const dir = await ouvrir(DIRECTION);
verifier("6. Direction : les fiches sont lisibles", (await ligne(dir, "gc2e-p-a").count()) === 1);
verifier("6. Direction : aucun bouton « Enregistrer »", (await dir.locator('[data-referentiel="odoo"] button[type="submit"]').count()) === 0);
verifier("6. Direction : champs en lecture seule", await ligne(dir, "gc2e-p-b").locator('input[name="tiersOdoo"]').isDisabled());
verifier("6. Direction : mention de consultation seule", (await dir.locator('[data-referentiel="odoo"]').innerText()).includes("Consultation seule"));
await dir.close();

const enTetes = { "next-action": reqTiers.headers()["next-action"], "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", origin: B };
const corps = JSON.parse(reqTiers.postData());
const rejouer = async (email, donnees) => (await (await contexte(email)).request.post(reqTiers.url(), { headers: enTetes, data: JSON.stringify(donnees) })).text();
verifier("6. le corps capturé est bien celui de l'écran (entité, id)", Array.isArray(corps) && corps[0] === "PARTENAIRE" && corps[1] === "gc2e-p-a", JSON.stringify(corps).slice(0, 120));
const texteRep = await rejouer(DIRECTION, ["PARTENAIRE", "gc2e-p-b", { tiersOdoo: "PIRATE" }]);
const pirate = await un(`SELECT "tiersOdoo" FROM "CptPartenaire" WHERE id = 'gc2e-p-b'`);
verifier("6. rejeu de la Server Action avec la session Direction : refusé, rien écrit", /non autoris/i.test(texteRep) && pirate.tiersOdoo === avantLong.tiersOdoo, `${texteRep.slice(0, 120)} / ${pirate.tiersOdoo}`);
verifier("6. type de fiche inconnu : refusé", /inconnu/i.test(await rejouer(RFCRH, ["TAUX", "gc2e-p-b", { tiersOdoo: "X" }])));
await rejouer(RFCRH, ["PRODUIT", "gc2e-x-b", { compteOdoo: "411301", code: "PIRATE", libelle: "Piraté", actif: false }]);
const produitSup = await un(`SELECT code, libelle, actif, "compteOdoo" FROM "CptProduit" WHERE id = 'gc2e-x-b'`);
verifier("6. champs étrangers envoyés avec la saisie : ignorés (seul le compte Odoo change)", produitSup.code === "GC2E-P2" && produitSup.libelle === "Produit deux GC2E" && produitSup.actif === true && produitSup.compteOdoo === "411301", JSON.stringify(produitSup));

// ---------- 7. Mobile, erreurs JavaScript ----------
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
const pm = await mobile.newPage();
await pm.goto(`${B}/login`);
await pm.fill('input[name="email"]', RFCRH);
await pm.fill('input[name="password"]', "password123");
await Promise.all([pm.waitForURL((u) => !u.pathname.startsWith("/login")), pm.click('button[type="submit"]')]);
await pm.goto(`${B}/compta/referentiels?onglet=odoo`);
await pm.waitForSelector('[data-referentiel="odoo"]');
await pm.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
const larg = await pm.evaluate(() => ({ doc: document.documentElement.scrollWidth, vue: window.innerWidth }));
verifier("7. mobile 390 px : onglet Odoo sans défilement horizontal", larg.doc <= larg.vue, JSON.stringify(larg));
await mobile.close();
verifier("7. aucune erreur JavaScript dans les pages visitées", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));

for (const ctx of sessions.values()) await ctx.close();
await browser.close();
await db.end();

console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\nGC-2e : ${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko === 0 ? 0 : 1);
