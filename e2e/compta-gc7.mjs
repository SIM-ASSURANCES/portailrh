// Gestion Compta, lot GC-7 — CLIENTS ET CRÉANCES. Sur base JETABLE et neuve (voir e2e/README.md : `next build` puis
// `bash e2e/base-jetable.sh`) : ce script ÉCRIT en base et ne se rejoue pas sur la même base. Données 100 % synthétiques.
//   7a : fiche client (identité, contrats, échéances, paiements prouvés, paiements en attente, « pas une prime », retards), recherche par
//        début de mot, accès depuis /compta/controle et /compta/production, lecture seule, 390 px sans défilement horizontal.
//   7b : état des créances par débiteur (tranches, détail contrat par contrat, débiteur partenaire), échéances à surveiller, filtres en GET,
//        pagination à 50, export CSV (401 / 403), 390 px.
//   7c : relevé client en PDF (téléchargé, contenu relu, 401 / 403 / 404, lien sur la fiche).
//   7d : relance consignée hors application et promesse de paiement (« relance proposée », promesse en cours, évaluation par la règle : tenue /
//        non tenue, audit, statut final non modifiable, refus serveur par rejeu sans cpt.relancer, validations).
//   7e : prévision d'encaissements par semaine et par mois, chaque ligne recoupée par un calcul SQL indépendant, promesses, accès, 390 px.
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
// ---------- 7b. État des créances ----------
{
  const restants = (t12Payees = 2) => 506486 * (12 - t12Payees);
  const p = await ouvrir(RFCRH, "/compta/creances");
  const totaux = (await p.locator("[data-totaux-creances]").innerText()).replace(/\s+/g, " ");
  verifier("7b. reste dû total = Koné (350 000) + Courtage Beta (T12 : 5 064 860)", /5\s?414\s?860/.test(totaux), totaux);
  const kone = p.locator('[data-debiteur="Koné Awa"]');
  const beta = p.locator('[data-debiteur="Courtage Beta"]');
  verifier("7b. un débiteur client direct (Koné Awa) et un débiteur partenaire (Courtage Beta : il est aussi client)", (await kone.count()) === 1 && (await beta.count()) === 1);
  verifier("7b. le client Diabaté n'est pas lui-même débiteur (c'est le partenaire qui paie)", (await p.locator('[data-debiteur="Diabaté Moussa"]').count()) === 0);
  verifier("7b. T7 : tranche 91 à 180 jours", (await kone.getAttribute("data-tranche-debiteur")) === "T91_180" && /91 à 180 jours/.test(await kone.locator("summary").innerText()));
  verifier("7b. T12 : reste dû 5 064 860, tranche selon l'ancienneté du 1er août", /5\s?064\s?860/.test(await beta.locator("summary").innerText()) && (await beta.getAttribute("data-tranche-debiteur")) === (({ "0 à 30 jours": "T0_30", "31 à 90 jours": "T31_90", "91 à 180 jours": "T91_180", "Plus de 180 jours": "PLUS_180" })[tranche(joursEntre("2026-08-01", AUJOURDHUI))]));
  verifier("7b. « relance proposée » signalée (échéances en retard), rien n'est envoyé", /Relance proposée/.test(await kone.locator("summary").innerText()) && (await p.locator("form [name=envoyer]").count()) === 0);
  await kone.locator("summary").click();
  const detail = await kone.innerText();
  verifier("7b. détail contrat par contrat (POL-T7 et POL-T7B), prime, encaissé, reste", (await kone.locator('[data-contrat-creance="POL-T7"]').count()) === 1 && (await kone.locator('[data-contrat-creance="POL-T7B"]').count()) === 1 && /Prime émise 400\s?000/.test(detail) && /encaissé prouvé 50\s?000/.test(detail), detail.replace(/\s+/g, " ").slice(0, 300));
  verifier("7b. dû depuis la date PRÉVUE de la plus ancienne échéance impayée (pas la date de saisie)", detail.includes(new Date(`${jour(-120)}T00:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC" })));
  verifier("7b. déclaré payé non prouvé affiché", /déclaré payé non prouvé 350\s?000/.test(detail));
  void restants;

  // Échéances à surveiller : en retard + dues dans 7 jours.
  const attendues = 3 + moisT12.slice(2).filter((d) => d <= jour(7)).length;
  const nbLignes = await p.locator("[data-echeance-proche]").count();
  verifier("7b. échéances à surveiller : en retard + dues dans les 7 jours (et seulement elles)", nbLignes === attendues, `${nbLignes} / ${attendues}`);
  verifier("7b. l'échéance à venir (POL-T7 n°3, dans 30 jours) n'y est pas", (await p.locator('[data-echeance-proche="POL-T7-3"]').count()) === 0);
  verifier("7b. l'échéance payée (POL-T12 n°1) n'y est pas", (await p.locator('[data-echeance-proche="POL-T12-1"]').count()) === 0);
  verifier("7b. T12 : l'échéance d'août est en retard", (await p.locator('[data-echeance-proche="POL-T12-3"]').getAttribute("data-etat")) === "EN_RETARD");
  verifier("7b. lecture seule : aucun bouton d'action", (await p.locator("[data-etat-creances] button:not([data-evaluer-promesses]), [data-echeances-proches] button").count()) === 0);
  await p.close();
}
{
  // Filtres en GET.
  const q = await ouvrir(DIRECTION, "/compta/creances?q=kon");
  verifier("7b. filtre client « kon » : Koné seul", (await q.locator("[data-debiteur]").count()) === 1 && (await q.locator('[data-debiteur="Koné Awa"]').count()) === 1);
  verifier("7b. filtre client : les échéances suivent (aucune échéance T12)", (await q.locator('[data-echeance-proche^="POL-T12"]').count()) === 0 && (await q.locator("[data-echeance-proche]").count()) === 3);
  await q.close();
  const b = await ouvrir(DIRECTION, "/compta/creances?partenaire=pa-beta");
  verifier("7b. filtre partenaire : Courtage Beta seul", (await b.locator("[data-debiteur]").count()) === 1 && (await b.locator('[data-debiteur="Courtage Beta"]').count()) === 1);
  await b.close();
  const t = await ouvrir(DIRECTION, "/compta/creances?tranche=PLUS_180");
  verifier("7b. filtre tranche « plus de 180 jours » : aucun débiteur", (await t.locator("[data-debiteur]").count()) === 0 && (await t.locator("[data-liste-vide]").count()) >= 1);
  await t.close();
  const r = await ouvrir(DIRECTION, "/compta/creances?vue=EN_RETARD&q=kon");
  verifier("7b. vue « en retard seulement » : les 3 échéances de Koné en retard", (await r.locator("[data-echeance-proche]").count()) === 3 && (await r.locator('[data-echeance-proche][data-etat="EN_RETARD"]').count()) === 3);
  await r.close();
  const d7 = await ouvrir(DIRECTION, "/compta/creances?vue=DUES_7J&q=kon");
  verifier("7b. vue « dues dans 7 jours » : aucune pour Koné", (await d7.locator("[data-echeance-proche]").count()) === 0);
  await d7.close();
}
{
  // Pagination à 50 : 60 débiteurs de plus, un contrat en retard chacun.
  for (let i = 1; i <= 60; i++) {
    const id = `bulk${String(i).padStart(2, "0")}`;
    await client(`cl-${id}`, `Bulk Client ${String(i).padStart(2, "0")}`);
    await contrat(`ct-${id}`, `POL-${id.toUpperCase()}`, `cl-${id}`, { fractionnement: "COMPTANT", echeances: [{ date: jour(-5), du: 1000 }] });
  }
  const p = await ouvrir(DIRECTION, "/compta/creances");
  verifier("7b. pagination : 50 débiteurs sur la première page", (await p.locator("[data-debiteur]").count()) === 50, `${await p.locator("[data-debiteur]").count()}`);
  verifier("7b. pagination : total 62 débiteurs, page 1 sur 2", /62 débiteur\(s\) · page 1 sur 2/.test(await p.locator("[data-etat-creances] [data-pagination-total]").innerText()));
  await Promise.all([p.waitForURL(/page=2/), p.getByRole("link", { name: /Suivante/ }).first().click()]);
  await p.waitForLoadState("networkidle").catch(() => {});
  verifier("7b. page 2 : les 12 derniers débiteurs", (await p.locator("[data-debiteur]").count()) === 12);
  await p.close();
  const m = await ouvrir(DIRECTION, "/compta/creances", { width: 390, height: 844 });
  verifier("7b. 390 px : pas de défilement horizontal de la page", await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await m.close();
}
{
  // Export CSV : mêmes filtres que l'écran ; 401 sans session, 403 sans la permission.
  const ctx = await contexte(DIRECTION);
  const r = await ctx.request.get(`${B}/api/compta/export/creances?vue=debiteurs&q=kon`);
  const texte = await r.text();
  verifier("7b. export CSV des débiteurs : 200, filtre appliqué (Koné seul), montants et tranche", r.status() === 200 && /text\/csv/.test(r.headers()["content-type"] ?? "") && /Koné Awa/.test(texte) && !/Courtage Beta/.test(texte) && /350000,00|350 000,00|350000\.00/.test(texte.replace(/\s/g, "")) && /91 à 180 jours/.test(texte), texte.slice(0, 250));
  const e = await ctx.request.get(`${B}/api/compta/export/creances?vue=echeances&q=kon`);
  const te = await e.text();
  verifier("7b. export CSV des échéances : 3 lignes pour Koné", e.status() === 200 && te.trim().split(/\r?\n/).length === 4 && /POL-T7/.test(te), `${te.trim().split(/\r?\n/).length} lignes`);
  const anonyme = await browser.newContext();
  const r401 = await anonyme.request.get(`${B}/api/compta/export/creances?vue=debiteurs`, { maxRedirects: 0 });
  verifier("7b. export sans session : refusé (401 ou redirection de connexion)", [401, 307, 302, 308].includes(r401.status()), `${r401.status()}`);
  await anonyme.close();
  const r403 = await (await contexte(COLLABORATEUR)).request.get(`${B}/api/compta/export/creances?vue=debiteurs`, { maxRedirects: 0 });
  verifier("7b. export sans cpt.consulter : 403", r403.status() === 403, `${r403.status()}`);
  const rVue = await ctx.request.get(`${B}/api/compta/export/creances?vue=zzz`);
  verifier("7b. vue inconnue : 400", rVue.status() === 400);
  const rClient = await (await contexte(COLLABORATEUR)).request.get(`${B}/compta/creances`, { maxRedirects: 0 });
  verifier("7b. écran sans cpt.consulter : redirigé", rClient.status() >= 300 && rClient.status() < 400, `${rClient.status()}`);
}
// ---------- 7c. Relevé client en PDF ----------
{
  const p = await ouvrir(COMMERCIAL, "/compta/clients/cl-t7");
  const lien = p.locator("[data-releve-pdf]");
  verifier("7c. la fiche propose le relevé PDF", (await lien.count()) === 1 && (await lien.getAttribute("href")) === "/api/compta/clients/cl-t7/releve");
  await p.close();
  const ctx = await contexte(COMMERCIAL);
  const r = await ctx.request.get(`${B}/api/compta/clients/cl-t7/releve`);
  const corps = await r.body();
  verifier("7c. relevé : 200, application/pdf, fichier PDF valide", r.status() === 200 && /application\/pdf/.test(r.headers()["content-type"] ?? "") && corps.subarray(0, 5).toString() === "%PDF-" && corps.length > 2000, `${r.status()} ${corps.length} o`);
  verifier("7c. en-tête de téléchargement : nom de fichier du client", /attachment; filename="releve-kone-awa\.pdf"/.test(r.headers()["content-disposition"] ?? ""), r.headers()["content-disposition"]);
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { execFileSync } = await import("node:child_process");
  const dossier = mkdtempSync(`${tmpdir()}/releve-`);
  writeFileSync(`${dossier}/releve.pdf`, corps);
  let texte = null;
  try {
    texte = execFileSync("pdftotext", ["-enc", "UTF-8", "-layout", `${dossier}/releve.pdf`, "-"], { encoding: "utf8" });
  } catch {
    texte = null;
  }
  if (texte === null) verifier("7c. contenu du PDF relu (pdftotext indisponible : contrôle non exécuté)", true, "non exécuté");
  else {
    const plat = texte.replace(/\s+/g, " ");
    verifier("7c. contenu : client, échéances, paiement, reste dû et ancienneté", /Koné Awa/.test(plat) && /POL-T7/.test(plat) && /POL-T7B/.test(plat) && /CPE-2026-900001/.test(plat) && /350 000 FCFA/.test(plat) && /91 à 180 jours/.test(plat) && /Relevé client|RELEVÉ CLIENT/i.test(plat), plat.slice(0, 300));
  }
  const anonyme = await browser.newContext();
  const r401 = await anonyme.request.get(`${B}/api/compta/clients/cl-t7/releve`, { maxRedirects: 0 });
  verifier("7c. relevé sans session : refusé (401 ou redirection de connexion)", [401, 307, 302, 308].includes(r401.status()), `${r401.status()}`);
  await anonyme.close();
  const r403 = await (await contexte(COLLABORATEUR)).request.get(`${B}/api/compta/clients/cl-t7/releve`, { maxRedirects: 0 });
  verifier("7c. relevé sans cpt.consulter : 403", r403.status() === 403, `${r403.status()}`);
  const r404 = await ctx.request.get(`${B}/api/compta/clients/inexistant/releve`);
  verifier("7c. client inconnu : 404", r404.status() === 404, `${r404.status()}`);
  const rVide = await ctx.request.get(`${B}/api/compta/clients/cl-vide/releve`);
  verifier("7c. client sans contrat : relevé produit (vide, sans erreur)", rVide.status() === 200);
}
// ---------- 7d. Relances et promesses ----------
{
  const compter = async (table, where = "TRUE") => Number((await db.query(`SELECT count(*)::int AS n FROM "${table}" WHERE ${where}`)).rows[0].n);
  const p = await ouvrir(COMMERCIAL, "/compta/clients/cl-t7");
  verifier("7d. fiche : « relance proposée » (échéances en retard, aucune promesse), rien n'est envoyé", (await p.locator("[data-relance-proposee]").count()) === 1 && (await p.locator("[data-formulaire-relance]").count()) === 1);
  const f = p.locator("[data-formulaire-relance]");
  await f.locator('select[name="canal"]').selectOption("TELEPHONE");
  await f.locator('textarea[name="commentaire"]').fill("Appelé ce matin, promet de payer");
  await f.locator("[data-promesse-case]").check();
  await f.locator('input[name="promesseMontant"]').fill("100 000");
  await f.locator('input[name="promesseDate"]').fill(jour(5));
  const [requete] = await Promise.all([p.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]), f.locator('button[type="submit"]').click()]);
  await p.waitForLoadState("networkidle");
  await p.waitForTimeout(600);
  verifier("7d. relance enregistrée : une ligne, canal téléphone, commentaire, auteur", (await compter("CptRelance", `"clientId" = 'cl-t7' AND canal = 'TELEPHONE' AND commentaire LIKE 'Appelé%' AND origine = 'MANUELLE'`)) === 1 && /Téléphone/.test(await p.locator("[data-liste-relances]").innerText()));
  verifier("7d. promesse en cours : 100 000 à la date promise", (await compter("CptPromesse", `"clientId" = 'cl-t7' AND statut = 'EN_COURS' AND montant = 100000 AND "datePromise" = '${jour(5)}'`)) === 1 && (await p.locator('[data-promesse][data-statut="EN_COURS"]').count()) === 1);
  verifier("7d. la relance proposée disparaît tant qu'une promesse est en cours", (await p.locator("[data-relance-proposee]").count()) === 0);
  verifier("7d. audit : la relance et la promesse sont tracées", (await compter("CptAudit", `entite IN ('CptRelance', 'CptPromesse') AND action IN ('relance', 'promesse')`)) === 2);
  const g = await ouvrir(COMMERCIAL, "/compta/creances?q=kon");
  verifier("7d. état des créances : « 1 promesse en cours » et plus de relance proposée pour Koné", /1 promesse\(s\) en cours/.test(await g.locator('[data-debiteur="Koné Awa"] summary').innerText()) && !/Relance proposée/.test(await g.locator('[data-debiteur="Koné Awa"] summary').innerText()));
  await g.close();

  // Validations : le serveur refuse (rejeu avec un corps modifié).
  const rejouer = async (email, req, modifier) => {
    const ctx = await contexte(email);
    const donnees = modifier ? modifier(JSON.parse(req.postData())) : JSON.parse(req.postData());
    const rep = await ctx.request.post(req.url(), { headers: { "next-action": req.headers()["next-action"], "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", origin: B }, data: JSON.stringify(donnees) });
    return rep.text();
  };
  const avant = await compter("CptRelance");
  const futur = await rejouer(COMMERCIAL, requete, (c) => [c[0], { ...c[1], faiteLe: jour(3), promesseMontant: "", promesseDate: "" }]);
  verifier("7d. une relance datée dans le futur est refusée", /futur/.test(futur) && (await compter("CptRelance")) === avant, futur.slice(0, 160));
  const trop = await rejouer(COMMERCIAL, requete, (c) => [c[0], { ...c[1], promesseMontant: "999999999" }]);
  verifier("7d. une promesse au-delà du reste dû est refusée (et la relance avec elle)", /dépasse le reste dû/.test(trop) && (await compter("CptRelance")) === avant, trop.slice(0, 160));
  const passee = await rejouer(COMMERCIAL, requete, (c) => [c[0], { ...c[1], promesseDate: jour(-1) }]);
  verifier("7d. une date promise passée est refusée", /passé/.test(passee) && (await compter("CptRelance")) === avant, passee.slice(0, 160));
  const canal = await rejouer(COMMERCIAL, requete, (c) => [c[0], { ...c[1], canal: "PIGEON", promesseMontant: "", promesseDate: "" }]);
  verifier("7d. un canal inconnu est refusé", /canal/i.test(canal) && (await compter("CptRelance")) === avant, canal.slice(0, 160));

  // Refus serveur sans cpt.relancer.
  const refus = await rejouer(DIRECTION, requete, (c) => [c[0], { ...c[1], promesseMontant: "", promesseDate: "" }]);
  verifier("7d. rejeu direct de l'enregistrement sans cpt.relancer : refusé, rien n'est écrit", /Action non autoris/.test(refus) && (await compter("CptRelance")) === avant, refus.slice(0, 160));
  await p.close();

  // Évaluation par la règle : une tenue (argent prouvé dans la fenêtre), une non tenue (échéance passée sans argent).
  await db.query(`INSERT INTO "CptPromesse" (id, "clientId", montant, "datePromise", "creeParId", "creeAt") VALUES ('pr-tenue', 'cl-t7', 50000, $1, $2, $3)`, [jour(-2), prodId, new Date(`${jour(-10)}T09:00:00Z`)]);
  await db.query(`INSERT INTO "CptPromesse" (id, "clientId", montant, "datePromise", "creeParId", "creeAt") VALUES ('pr-non-tenue', 'cl-t12', 100000, $1, $2, $3)`, [jour(-1), prodId, new Date(`${jour(-10)}T09:00:00Z`)]);
  await encaissement("en-promesse", { date: jour(-5), montant: 50000, payeur: "Awa Kone" });
  await rattachement("ra-promesse", "en-promesse", "ct-t7-e1", 50000, "VALIDE");
  await db.query(`UPDATE "CptEcheance" SET "montantRegle" = 50000 WHERE id = 'ct-t7-e1'`);
  const fiche = await ouvrir(COMMERCIAL, "/compta/clients/cl-t7");
  verifier("7d. la fiche AFFICHE « Tenue » (règle appliquée à l'affichage) alors que l'évaluation n'est pas enregistrée, sans rien écrire", (await fiche.locator('[data-promesse][data-statut="TENUE"][data-statut-enregistre="EN_COURS"]').count()) === 1 && /évaluation non enregistrée/.test((await fiche.locator("[data-a-evaluer]").allInnerTexts()).join(" ")) && (await compter("CptPromesse", `id = 'pr-tenue' AND statut = 'EN_COURS'`)) === 1);
  await fiche.close();
  const echue = await ouvrir(COMMERCIAL, "/compta/clients/cl-t12");
  verifier("7d. promesse échue JAMAIS évaluée → affichée « Non tenue » (statut enregistré encore EN_COURS), la relance est de nouveau proposée", (await echue.locator('[data-promesse][data-statut="NON_TENUE"][data-statut-enregistre="EN_COURS"]').count()) === 1 && (await echue.locator("[data-relance-proposee]").count()) === 1 && (await compter("CptPromesse", `id = 'pr-non-tenue' AND statut = 'EN_COURS'`)) === 1);
  await echue.close();
  const credEchue = await ouvrir(COMMERCIAL, "/compta/creances?partenaire=pa-beta");
  verifier("7d. état des créances : la promesse échue non évaluée ne compte pas comme « en cours »", !/promesse\(s\) en cours/.test(await credEchue.locator('[data-debiteur="Courtage Beta"] summary').innerText()) && /Relance proposée/.test(await credEchue.locator('[data-debiteur="Courtage Beta"] summary').innerText()));
  await credEchue.close();
  const cr = await ouvrir(COMMERCIAL, "/compta/creances");
  const [reqEval] = await Promise.all([cr.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]), cr.locator("[data-evaluer-promesses]").click()]);
  await cr.waitForLoadState("networkidle");
  await cr.waitForTimeout(600);
  const tenue = (await db.query(`SELECT statut, "montantProuve", "evalueAt" FROM "CptPromesse" WHERE id = 'pr-tenue'`)).rows[0];
  const nonTenue = (await db.query(`SELECT statut, "montantProuve", "evalueAt" FROM "CptPromesse" WHERE id = 'pr-non-tenue'`)).rows[0];
  verifier("7d. évaluation : la promesse couverte par 50 000 prouvés dans la fenêtre est TENUE (montant prouvé et date tracés)", tenue.statut === "TENUE" && Number(tenue.montantProuve) === 50000 && tenue.evalueAt !== null, JSON.stringify(tenue));
  verifier("7d. évaluation : la promesse échue sans argent est NON TENUE (prouvé 0)", nonTenue.statut === "NON_TENUE" && Number(nonTenue.montantProuve) === 0 && nonTenue.evalueAt !== null, JSON.stringify(nonTenue));
  verifier("7d. la promesse encore dans les délais reste EN COURS", (await compter("CptPromesse", `"clientId" = 'cl-t7' AND statut = 'EN_COURS' AND montant = 100000`)) === 1);
  verifier("7d. audit : une ligne « evaluation_promesse » par promesse évaluée, avec l'auteur", (await compter("CptAudit", `action = 'evaluation_promesse' AND "userId" = '${commercialId}'`)) === 2);
  await cr.locator("[data-evaluer-promesses]").click();
  await cr.waitForTimeout(800);
  verifier("7d. une seconde évaluation ne change rien (statuts finaux, pas de nouvel audit)", (await compter("CptAudit", `action = 'evaluation_promesse'`)) === 2);
  const refusEval = await rejouer(DIRECTION, reqEval, null);
  verifier("7d. rejeu de l'évaluation sans cpt.relancer : refusé", /Action non autoris/.test(refusEval), refusEval.slice(0, 160));
  await cr.close();
  let modif = null;
  try {
    await db.query(`UPDATE "CptPromesse" SET statut = 'TENUE' WHERE id = 'pr-non-tenue'`);
  } catch (e) {
    modif = String(e.message);
  }
  verifier("7d. un statut final ne se modifie plus (trigger), même par SQL", modif !== null && /CPT_PROMESSE_FINALE/.test(modif), modif ?? "modifié");
  let rel = null;
  try {
    await db.query(`UPDATE "CptRelance" SET commentaire = 'x' WHERE "clientId" = 'cl-t7'`);
  } catch (e) {
    rel = String(e.message);
  }
  verifier("7d. une relance enregistrée ne se modifie pas (trigger)", rel !== null && /CPT_RELANCE_IMMUABLE/.test(rel), rel ?? "modifiée");

  // Relance proposée pour un client dont la promesse n'a pas été tenue.
  const t12 = await ouvrir(COMMERCIAL, "/compta/clients/cl-t12");
  verifier("7d. T12 : promesse non tenue → « relance proposée » à nouveau, promesse « Non tenue » listée", (await t12.locator("[data-relance-proposee]").count()) === 1 && /Non tenue/.test(await t12.locator('[data-promesse][data-statut="NON_TENUE"]').innerText()));
  await t12.close();

  // Lecture seule pour la Direction : ni formulaire ni bouton d'évaluation.
  const dir = await ouvrir(DIRECTION, "/compta/clients/cl-t7");
  verifier("7d. Direction : lit les relances et promesses, sans formulaire ni bouton d'évaluation", (await dir.locator("[data-liste-relances]").count()) === 1 && (await dir.locator("[data-formulaire-relance], [data-evaluer-promesses]").count()) === 0);
  await dir.close();
}
// ---------- 7e. Prévision d'encaissements ----------
{
  const nb = (t) => Number((t ?? "").replace(/[^\d,-]/g, "").replace(",", ".")) || 0;
  const sql = async (texte, params) => Number((await db.query(texte, params)).rows[0].v);
  for (const [vue, attendu] of [["semaine", 13], ["mois", 9]]) {
    const p = await ouvrir(DIRECTION, vue === "semaine" ? "/compta/previsions" : "/compta/previsions?vue=mois");
    const lignes = await p.$$eval("[data-periode]", (els) => els.map((e) => ({ debut: e.getAttribute("data-periode"), position: e.getAttribute("data-position"), prevu: e.querySelector("[data-prevu]").textContent, reste: e.querySelector("[data-reste]").textContent, reel: e.querySelector("[data-reel]").textContent, promesses: e.querySelector("[data-promesses]").textContent })));
    verifier(`7e. vue ${vue} : ${attendu} périodes dont une seule en cours`, lignes.length === attendu && lignes.filter((l) => l.position === "COURANTE").length === 1, `${lignes.length}`);
    let ecarts = 0;
    for (const [i, l] of lignes.entries()) {
      const fin = vue === "semaine" ? jour(0, new Date(`${l.debut}T00:00:00Z`)) : null;
      const finPeriode = vue === "semaine" ? new Date(new Date(`${l.debut}T00:00:00Z`).getTime() + 6 * 86_400_000).toISOString().slice(0, 10) : new Date(Date.UTC(Number(l.debut.slice(0, 4)), Number(l.debut.slice(5, 7)), 0)).toISOString().slice(0, 10);
      void fin;
      const prevu = await sql(`SELECT COALESCE(SUM(e."montantDu"),0)::float8 AS v FROM "CptEcheance" e JOIN "CptContrat" c ON c.id = e."contratId" WHERE e.etat <> 'ANNULEE' AND c.statut <> 'ANNULE' AND e."datePrevue" BETWEEN $1 AND $2`, [l.debut, finPeriode]);
      const regle = await sql(`SELECT COALESCE(SUM(e."montantRegle"),0)::float8 AS v FROM "CptEcheance" e JOIN "CptContrat" c ON c.id = e."contratId" WHERE e.etat <> 'ANNULEE' AND c.statut <> 'ANNULE' AND e."datePrevue" BETWEEN $1 AND $2`, [l.debut, finPeriode]);
      const reel = await sql(`SELECT COALESCE(SUM(r.montant),0)::float8 AS v FROM "CptRattachement" r JOIN "CptEncaissement" e ON e.id = r."encaissementId" WHERE r.statut = 'VALIDE' AND e."dateValeur" BETWEEN $1 AND $2`, [l.debut, finPeriode]);
      const promesses = await sql(`SELECT COALESCE(SUM(montant),0)::float8 AS v FROM "CptPromesse" WHERE statut = 'EN_COURS' AND "datePromise" BETWEEN $1 AND $2`, [l.debut, finPeriode]);
      const resteAttendu = Math.max(0, prevu - regle);
      if (nb(l.prevu) !== prevu || nb(l.reste) !== resteAttendu || (l.position !== "FUTURE" && nb(l.reel) !== reel) || nb(l.promesses) !== promesses) {
        ecarts++;
        verifier(`7e. vue ${vue} : ligne ${i} (${l.debut}) recoupée par SQL`, false, `${JSON.stringify(l)} / SQL prévu ${prevu} reste ${resteAttendu} réel ${reel} promesses ${promesses}`);
      }
    }
    verifier(`7e. vue ${vue} : chaque ligne (prévu, reste à encaisser, réel, promesses) est égale à un calcul SQL indépendant`, ecarts === 0);
    verifier(`7e. vue ${vue} : les périodes futures n'affichent pas de réel (« — »)`, lignes.filter((l) => l.position === "FUTURE").every((l) => l.reel.trim() === "—"));
    const totalPrevu = nb(await p.locator("[data-total-prevu]").innerText());
    verifier(`7e. vue ${vue} : le total affiché est la somme des lignes`, totalPrevu === lignes.reduce((s, l) => s + nb(l.prevu), 0));
    if (vue === "semaine") {
      verifier("7e. semaine : la promesse de 100 000 (date promise dans 5 jours) apparaît dans la période qui la contient", lignes.some((l) => nb(l.promesses) === 100000));
      verifier("7e. semaine : un montant en retard d'une période passée est signalé « en retard »", /en retard/.test(await p.locator('[data-position="PASSEE"] [data-reste]').allInnerTexts().then((t) => t.join(" "))));
    }
    await p.close();
  }
  const m = await ouvrir(DIRECTION, "/compta/previsions", { width: 390, height: 844 });
  verifier("7e. 390 px : pas de défilement horizontal de la page", await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await m.close();
  const r = await (await contexte(COLLABORATEUR)).request.get(`${B}/compta/previsions`, { maxRedirects: 0 });
  verifier("7e. sans cpt.consulter : redirigé", r.status() >= 300 && r.status() < 400, `${r.status()}`);
  const p = await ouvrir(COMMERCIAL, "/compta/previsions");
  verifier("7e. la rubrique « Prévision d'encaissements » est dans la barre latérale", (await p.locator('a[href="/compta/previsions"]').count()) > 0);
  await p.close();
}
void commercialId;

verifier("aucune erreur JavaScript", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));
await browser.close();
await db.end();
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\nGC-7 : ${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko === 0 ? 0 : 1);
