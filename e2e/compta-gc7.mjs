// Gestion Compta, lot GC-7 — CLIENTS ET CRÉANCES. Sur base JETABLE et neuve (voir e2e/README.md : `next build` puis
// `bash e2e/base-jetable.sh`) : ce script ÉCRIT en base et ne se rejoue pas sur la même base. Données 100 % synthétiques.
//   7a : fiche client (identité, contrats, échéances, paiements prouvés, paiements en attente, « pas une prime », retards), recherche par
//        début de mot, accès depuis /compta/controle et /compta/production, lecture seule, 390 px sans défilement horizontal.
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

const COMMERCIAL = "compta-commercial@simassurances.test";
const PRODUCTION = "compta-production@simassurances.test";
const RFCRH = "compta-rfcrh@simassurances.test";
const DIRECTION = "compta-direction@simassurances.test";
const COLLABORATEUR = "collaborateur@simassurances.test";

const jour = (decalage, base = new Date()) => {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + decalage);
  return d.toISOString().slice(0, 10);
};
const AUJOURDHUI = jour(0);
const joursEntre = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86_400_000);
const tranche = (n) => (n <= 30 ? "0 à 30 jours" : n <= 90 ? "31 à 90 jours" : n <= 180 ? "91 à 180 jours" : "Plus de 180 jours");
const nombre = (texte) => Number((texte ?? "").replace(/[^\d,-]/g, "").replace(",", "."));

// ---------- Jeu d'essai ----------
const userId = async (email) => (await db.query(`SELECT id FROM "User" WHERE email = $1`, [email])).rows[0].id;
const prodId = await userId(PRODUCTION);
const rfcrhId = await userId(RFCRH);
const commercialId = await userId(COMMERCIAL);
await db.query(`INSERT INTO "CptCompte" (id, libelle, type, "majAt") VALUES ('co-wave', 'Wave Business', 'WAVE_BUSINESS', now()), ('co-bni', 'BNI', 'BANQUE', now())`);
await db.query(
  `INSERT INTO "CptProduit" (id, code, libelle, branche, "majAt") VALUES ('pr-acc', 'ACC', 'Accidents particuliers', 'ACCIDENTS', now()), ('pr-san', 'SAN', 'Santé famille', 'SANTE', now())`
);
await db.query(
  `INSERT INTO "CptPartenaire" (id, nom, "estApporteur", "estClient", "majAt") VALUES ('pa-alpha', 'Courtage Alpha', true, false, now()), ('pa-beta', 'Courtage Beta', true, true, now())`
);
async function client(id, nom, o = {}) {
  await db.query(`INSERT INTO "CptClient" (id, nom, telephone, "partenaireOrigineId", "majAt") VALUES ($1,$2,$3,$4,now())`, [id, nom, o.telephone ?? null, o.partenaire ?? null]);
  // Index de recherche par début de mot (mêmes règles que l'application : minuscules, sans accents).
  const mots = new Set(nom.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  for (const m of mots) await db.query(`INSERT INTO "CptMot" (entite, "entiteId", mot) VALUES ('CLIENT', $1, $2)`, [id, m]);
}
/** Contrat et échéancier : `echeances` = [{ date, du, regle }] (rang = position + 1). */
async function contrat(id, police, clientId, o) {
  const prime = o.echeances.reduce((s, e) => s + e.du, 0);
  await db.query(
    `INSERT INTO "CptContrat" (id, "numPolice", "produitId", "natureContrat", "clientId", "partenaireApporteurId", "dateEffet", "dateEcheance", "primeNetteHt", "primeTtc", "creeParId", "majAt",
       "declarePaye", statut, fractionnement)
     VALUES ($1,$2,$3,'INDIVIDUEL',$4,$5,$6,$7,$8,$8,$9,now(),$10,'EN_COURS',$11)`,
    [id, police, o.produit ?? "pr-acc", clientId, o.partenaire ?? null, o.echeances[0].date, o.echeances[o.echeances.length - 1].date, prime, prodId, o.declarePaye ?? false, o.fractionnement ?? "MENSUEL"]
  );
  const motsPolice = new Set([police.toLowerCase().replace(/[^a-z0-9]/g, ""), ...police.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)]);
  for (const m of motsPolice) await db.query(`INSERT INTO "CptMot" (entite, "entiteId", mot) VALUES ('CONTRAT', $1, $2)`, [id, m]);
  for (const [i, e] of o.echeances.entries()) {
    await db.query(
      `INSERT INTO "CptEcheance" (id, "contratId", rang, "periodeDebut", "periodeFin", "datePrevue", "primeTtc", "primeHt", "montantDu", "montantRegle", etat, "majAt")
       VALUES ($1,$2,$3,$4,$4,$4,$5,$5,$5,$6,$7,now())`,
      [`${id}-e${i + 1}`, id, i + 1, e.date, e.du, e.regle ?? 0, (e.regle ?? 0) >= e.du ? "SOLDEE" : "OUVERTE"]
    );
  }
}
let nEnc = 0;
async function encaissement(id, o) {
  nEnc++;
  await db.query(
    `INSERT INTO "CptEncaissement" (id, reference, "compteId", "referenceReleve", "dateValeur", montant, "typeFlux", statut, "resteARattacher", "montantPasUnePrime", "motifPasUnePrime", payeur, "creeParId", "majAt")
     VALUES ($1,$2,$3,$4,$5,$6,'ENCAISSEMENT',$7,$8,$9,$10,$11,$12,now())`,
    [id, `CPE-2026-${String(900000 + nEnc)}`, o.compte ?? "co-wave", `T_${id}`, o.date, o.montant, o.statut ?? "SOLDE", o.reste ?? 0, o.pasUnePrime ?? 0, o.motifPasUnePrime ?? null, o.payeur ?? "Payeur", prodId]
  );
}
/** Rattachement d'un encaissement à une échéance. VALIDE = preuve (aucune étape 1) ; sinon PROPOSE. */
async function rattachement(id, encaissementId, echeanceId, montant, statut) {
  await db.query(
    `INSERT INTO "CptRattachement" (id, "encaissementId", "echeanceId", montant, methode, "niveauPreuve", statut, justification, "valideParId", "valideAt", "majAt")
     VALUES ($1,$2,$3,$4,'REFERENCE_EXACTE','PREUVE',$5,'essai',$6,$7,now())`,
    [id, encaissementId, echeanceId, montant, statut, statut === "VALIDE" ? rfcrhId : null, statut === "VALIDE" ? new Date() : null]
  );
}

// T7 — Koné Awa : trois échéances, la plus ancienne il y a 120 jours ; un second contrat dont la première échéance est prouvée.
await client("cl-t7", "Koné Awa", { telephone: "+2250707070707", partenaire: "pa-alpha" });
await contrat("ct-t7", "POL-T7", "cl-t7", {
  partenaire: "pa-alpha",
  echeances: [
    { date: jour(-120), du: 100000 },
    { date: jour(-60), du: 100000 },
    { date: jour(30), du: 100000 },
  ],
});
await contrat("ct-t7b", "POL-T7B", "cl-t7", {
  produit: "pr-san",
  declarePaye: true,
  echeances: [
    { date: jour(-45), du: 50000, regle: 50000 },
    { date: jour(-15), du: 50000 },
  ],
});
await encaissement("en-t7", { date: jour(-44), montant: 60000, pasUnePrime: 10000, motifPasUnePrime: "Frais de carte santé", payeur: "Awa Kone" });
await rattachement("ra-t7", "en-t7", "ct-t7b-e1", 50000, "VALIDE");
await db.query(`UPDATE "CptContrat" SET "datePaiementDeclaree" = $1, "referencePaiementDeclaree" = 'T_DECLAREE_T7B' WHERE id = 'ct-t7b'`, [jour(-44)]);
await encaissement("en-t7p", { date: jour(-10), montant: 50000, statut: "A_RATTACHER", reste: 50000, payeur: "Awa Kone" });
await rattachement("ra-t7p", "en-t7p", "ct-t7b-e2", 50000, "PROPOSE");

// T12 — Diabaté Moussa : 12 échéances de 506 486 (6 077 832), deux payées ; août en retard.
await client("cl-t12", "Diabaté Moussa", { partenaire: "pa-beta" });
const moisT12 = ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01", "2027-04-01", "2027-05-01"];
await contrat("ct-t12", "POL-T12", "cl-t12", {
  partenaire: "pa-beta",
  echeances: moisT12.map((date, i) => ({ date, du: 506486, regle: i < 2 ? 506486 : 0 })),
});
await encaissement("en-t12a", { date: "2026-06-03", montant: 506486, payeur: "Moussa Diabate" });
await encaissement("en-t12b", { date: "2026-07-02", montant: 506486, payeur: "Moussa Diabate" });
await rattachement("ra-t12a", "en-t12a", "ct-t12-e1", 506486, "VALIDE");
await rattachement("ra-t12b", "en-t12b", "ct-t12-e2", 506486, "VALIDE");

// Un client sans contrat, un client qui ne doit pas apparaître dans la recherche « Koné ».
await client("cl-vide", "Zézé Paul");

// ---------- 7a. Liste et recherche de clients ----------
{
  const p = await ouvrir(COMMERCIAL, "/compta/clients");
  verifier("7a. la rubrique « Clients » est dans la barre latérale", (await p.locator('a[href="/compta/clients"]').count()) > 0);
  verifier("7a. liste : les trois clients", (await p.locator("[data-client]").count()) === 3);
  await p.fill('[data-recherche-clients] input[name="q"]', "kon");
  await Promise.all([p.waitForURL(/q=kon/), p.click('[data-recherche-clients] button[type="submit"]')]);
  verifier("7a. recherche par début de mot « kon » (accents ignorés) : Koné Awa seulement", (await p.locator("[data-client]").count()) === 1 && (await p.locator('[data-client="Koné Awa"]').count()) === 1);
  await p.fill('[data-recherche-clients] input[name="q"]', "inconnu");
  await Promise.all([p.waitForURL(/q=inconnu/), p.click('[data-recherche-clients] button[type="submit"]')]);
  verifier("7a. recherche sans résultat : message", (await p.locator("[data-liste-vide]").count()) === 1);
  await p.close();
}

// ---------- 7a. Fiche T7 ----------
{
  const p = await ouvrir(DIRECTION, "/compta/clients/cl-t7");
  const totaux = await p.locator("[data-totaux-client]").innerText();
  verifier("7a. fiche : identité (nom, téléphone, partenaire d'origine)", /Koné Awa/.test(await p.locator("h1").innerText()) && /\+2250707070707/.test(await p.innerText("body")) && /Courtage Alpha/.test(await p.innerText("body")));
  verifier("7a. T7 : prime émise 400 000, encaissé prouvé 50 000, reste dû 350 000", /400\s?000/.test(totaux) && /50\s?000/.test(totaux) && /350\s?000/.test(totaux), totaux.replace(/\s+/g, " "));
  const jours = joursEntre(jour(-120), AUJOURDHUI);
  verifier("7a. T7 : ancienneté 120 jours, tranche 91 à 180 jours", new RegExp(`${jours} jours`).test(totaux) && /91 à 180 jours/.test(totaux), totaux.replace(/\s+/g, " "));
  verifier("7a. T7 : l'échéance la plus ancienne est « En retard de 120 jours »", /En retard de 120 jours/.test(await p.locator('[data-echeance="POL-T7-1"]').innerText()));
  verifier("7a. T7 : l'échéance à venir est « À venir »", /À venir/.test(await p.locator('[data-echeance="POL-T7-3"]').innerText()));
  verifier("7a. contrat payé : échéance « Payée »", /Payée/.test(await p.locator('[data-echeance="POL-T7B-1"]').innerText()));
  verifier("7a. paiement prouvé : canal, référence, date, montant", await (async () => {
    const t = await p.locator("[data-paiements-prouves]").innerText();
    return /Wave Business/.test(t) && /CPE-2026-900001/.test(t) && /T_en-t7/.test(t) && /50\s?000/.test(t) && /POL-T7B/.test(t);
  })());
  verifier("7a. un rattachement seulement PROPOSÉ n'est pas dans les paiements prouvés", (await p.locator("[data-paiements-prouves]").innerText()).indexOf("CPE-2026-900002") === -1);
  verifier("7a. … il figure à part, « en attente de validation »", /CPE-2026-900002/.test(await p.locator("[data-paiements-en-attente]").innerText()));
  verifier("7a. somme « pas une prime » avec son motif", /10\s?000/.test(await p.locator("[data-sommes-pas-une-prime]").innerText()) && /Frais de carte santé/.test(await p.locator("[data-sommes-pas-une-prime]").innerText()));
  verifier("7a. le contrat déclaré payé mais non prouvé est signalé (reste dû 50 000)", /50\s?000/.test(await p.locator("[data-declare-paye-non-prouve]").innerText()));
  verifier("7a. lecture seule : aucun bouton d'action sur la fiche", (await p.locator("main button, main form").count()) === 0);
  await p.close();
}

// ---------- 7a. Fiche T12 ----------
{
  const p = await ouvrir(RFCRH, "/compta/clients/cl-t12");
  const totaux = await p.locator("[data-totaux-client]").innerText();
  verifier("7a. T12 : prime émise 6 077 832, encaissé 1 012 972, reste dû 5 064 860", /6\s?077\s?832/.test(totaux) && /1\s?012\s?972/.test(totaux) && /5\s?064\s?860/.test(totaux), totaux.replace(/\s+/g, " "));
  verifier("7a. T12 : l'échéance d'août est en retard", /En retard/.test(await p.locator('[data-echeance="POL-T12-3"]').innerText()));
  verifier("7a. T12 : juin et juillet payées", /Payée/.test(await p.locator('[data-echeance="POL-T12-1"]').innerText()) && /Payée/.test(await p.locator('[data-echeance="POL-T12-2"]').innerText()));
  const jours = joursEntre("2026-08-01", AUJOURDHUI);
  verifier(`7a. T12 : ancienneté depuis le 1er août (${jours} jours), tranche attendue « ${tranche(jours)} »`, new RegExp(`${jours} jours`).test(totaux) && totaux.includes(tranche(jours)), totaux.replace(/\s+/g, " "));
  await p.close();
}

// ---------- 7a. Accès, introuvable, mobile ----------
{
  const ctx = await contexte(COLLABORATEUR);
  const r = await ctx.request.get(`${B}/compta/clients/cl-t7`, { maxRedirects: 0 });
  verifier("7a. sans cpt.consulter : redirigé, la fiche n'est pas servie", r.status() >= 300 && r.status() < 400, `${r.status()}`);
  const p = await ouvrir(COMMERCIAL, "/compta/clients/inexistant");
  verifier("7a. client inconnu : page introuvable", /introuvable|404|n'existe pas/i.test(await p.innerText("body")));
  await p.close();
  const m = await ouvrir(COMMERCIAL, "/compta/clients/cl-t7", { width: 390, height: 844 });
  verifier("7a. 390 px : pas de défilement horizontal de la page", await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await m.close();
}

// ---------- 7a. Liens depuis /compta/controle et /compta/production ----------
{
  await db.query(`UPDATE "CptContrat" SET "declarePaye" = true, "datePaiementDeclaree" = $1, "referencePaiementDeclaree" = 'T_DECL_T7' WHERE id = 'ct-t7'`, [jour(-12)]);
  const p = await ouvrir(COMMERCIAL, "/compta/controle");
  const lien = p.locator('[data-contrat-sans-encaissement="POL-T7"] [data-lien-fiche-client]');
  verifier("7a. /compta/controle : le client d'un contrat sans encaissement ouvre sa fiche", (await lien.count()) === 1 && (await lien.getAttribute("href")) === "/compta/clients/cl-t7");
  await p.close();
  const q = await ouvrir(PRODUCTION, "/compta/production?q=POL-T7");
  const hrefs = await q.$$eval("[data-lien-fiche-client]", (els) => els.map((e) => e.getAttribute("href")));
  verifier("7a. /compta/production : le client des contrats trouvés ouvre sa fiche", hrefs.length >= 1 && hrefs.every((h) => h === "/compta/clients/cl-t7"), JSON.stringify(hrefs));
  await q.close();
}
void commercialId;

verifier("aucune erreur JavaScript", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));
await browser.close();
await db.end();
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\nGC-7 : ${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko === 0 ? 0 : 1);
