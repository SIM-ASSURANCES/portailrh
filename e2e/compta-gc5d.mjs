// Gestion Compta, lot GC-5d — ÉCRAN « RATTACHEMENTS » (/compta/rattachements) : le moteur propose, le commercial confirme avec le reçu,
// le RFCRH valide ou rejette. Sur base JETABLE et neuve (voir e2e/README.md : `next build` puis `bash e2e/base-jetable.sh`) : ce script
// ÉCRIT en base et ne se rejoue pas sur la même base. Données 100 % synthétiques. Il vérifie :
//  1. « Lancer le rapprochement » crée les propositions (preuve, déduction, probable) et laisse un encaissement sans proposition ;
//  2. le commercial confirme avec le reçu (bouton grisé sans reçu) et ne peut pas valider ; le RFCRH valide et ne peut pas confirmer ;
//  3. la validation solde l'encaissement et l'échéance ; un rejet exige un motif et remet l'encaissement « sans proposition » ;
//  4. « Pas une prime » avec motif (RFCRH) et identification manuelle (commercial, reçu joint) puis validation ;
//  5. lecture seule (Direction) : aucune case ni bouton ; mobile 390 px sans défilement horizontal, aucune erreur JavaScript.
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
async function ouvrir(email, chemin = "/compta/rattachements") {
  const ctx = await contexte(email);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(`${email} : ${e.message}`));
  await p.goto(`${B}${chemin}`);
  await p.waitForSelector("h1");
  await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  return p;
}

const COMMERCIAL = "compta-commercial@simassurances.test";
const RFCRH = "compta-rfcrh@simassurances.test";
const DIRECTION = "compta-direction@simassurances.test";
const TECHNIQUE = "compta-production@simassurances.test";

const texte = async (p) => (await p.locator("body").innerText()).replace(/\s+/g, " ");
const compter = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);
async function attendre(condition, delaiMs = 15000) {
  const fin = Date.now() + delaiMs;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// ---------- Jeu d'essai ----------
const techniqueId = (await db.query(`SELECT id FROM "User" WHERE email = $1`, [TECHNIQUE])).rows[0].id;
await db.query(`INSERT INTO "CptCompte" (id, libelle, type, "majAt") VALUES ('co-wave', 'Wave Business', 'WAVE_BUSINESS', now())`);
await db.query(`INSERT INTO "CptProduit" (id, code, libelle, branche, "majAt") VALUES ('pr-1', 'P1', 'Produit 1', 'ACCIDENTS', now())`);
await db.query(`INSERT INTO "CptClient" (id, nom, "majAt") VALUES ('cl-ama', 'Kouassi Ama', now()), ('cl-issa', 'Traoré Issa', now())`);
async function contrat(id, police, client, p) {
  await db.query(
    `INSERT INTO "CptContrat" (id, "numPolice", "produitId", "natureContrat", "clientId", "dateEffet", "dateEcheance", "primeNetteHt", "primeTtc", "creeParId", "majAt", "referencePaiementDeclaree", "datePaiementDeclaree", fractionnement)
     VALUES ($1,$2,'pr-1','INDIVIDUEL',$3,'2026-01-01','2026-12-31',$4,$4,$5,now(),$6,$7,$8)`,
    [id, police, client, p.echeances.reduce((s, x) => s + x, 0), techniqueId, p.ref ?? null, p.datePaiement ?? null, p.echeances.length > 1 ? "MENSUEL" : "COMPTANT"]
  );
  for (const [i, montant] of p.echeances.entries()) {
    await db.query(
      `INSERT INTO "CptEcheance" (id, "contratId", rang, "periodeDebut", "periodeFin", "datePrevue", "primeTtc", "primeHt", "montantDu", "majAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$7,now())`,
      [`${id}-e${i + 1}`, id, i + 1, `2026-0${i + 1}-01`, `2026-0${i + 1}-28`, `2026-0${i + 1}-05`, montant]
    );
  }
}
async function encaissement(id, reference, ref, montant, date, payeur) {
  await db.query(
    `INSERT INTO "CptEncaissement" (id, reference, "compteId", "referenceReleve", "dateValeur", montant, "typeFlux", "resteARattacher", payeur, "creeParId", "majAt")
     VALUES ($1,$2,'co-wave',$3,$4,$5,'ENCAISSEMENT',$5,$6,$7,now())`,
    [id, reference, ref, date, montant, payeur, techniqueId]
  );
}
await contrat("k1", "POL-K1", "cl-ama", { ref: "T_REFEXACT0001", echeances: [2500, 2500] });
await contrat("k3", "POL-K3", "cl-issa", { datePaiement: "2026-03-08", echeances: [2500] });
await encaissement("e1", "CPE-2026-000001", "T_REFEXACT0001", 2500, "2026-03-10", "Awa Kone"); // référence exacte
await encaissement("e3", "CPE-2026-000003", "T_AUTRE0000003", 2500, "2026-03-10", "Yao Brou"); // montant et date → POL-K3
await encaissement("e4", "CPE-2026-000004", "T_INCONNU0004", 4500, "2026-03-10", "Zzz"); // rien ne correspond
await encaissement("e5", "CPE-2026-000005", "T_PROBABLE005", 1234, "2026-03-12", "AMA KOUASSI"); // même nom que POL-K1

// ---------- 1. Lancer le rapprochement (commercial) ----------
let p = await ouvrir(COMMERCIAL);
verifier("la rubrique « Rattachements » est un lien actif de la barre latérale", (await p.locator('a[href="/compta/rattachements"]').count()) > 0);
verifier("avant le rapprochement : 4 encaissements sans proposition", (await texte(p)).includes("Encaissements sans proposition 4"));
await p.locator("[data-rapprochement-lancer]").click();
verifier("le rapprochement crée 3 propositions (E4 reste sans proposition)", await attendre(async () => (await compter(`SELECT count(*) n FROM "CptRattachement"`)) === 3));
await p.reload();
await p.waitForSelector("h1");
const classes = (await db.query(`SELECT e.reference, r.methode, r."niveauPreuve", r.statut FROM "CptRattachement" r JOIN "CptEncaissement" e ON e.id = r."encaissementId" ORDER BY e.reference`)).rows;
verifier(
  "E1 référence exacte (preuve), E3 montant et date (déduction), E5 probable (à confirmer)",
  classes.length === 3 &&
    classes[0].methode === "REFERENCE_EXACTE" && classes[0].niveauPreuve === "PREUVE" &&
    classes[1].methode === "MONTANT_DATE" && classes[1].niveauPreuve === "DEDUCTION" &&
    classes[2].methode === "PROBABLE" && classes[2].niveauPreuve === "A_CONFIRMER",
  JSON.stringify(classes)
);
verifier("« À confirmer » liste E3 et E5 ; « À valider » liste E1 (preuve)", (await p.locator('[data-rattachements-table="confirmer"] tbody tr').count()) === 2 && (await p.locator('[data-rattachements-table="valider"] tbody tr').count()) === 1);
verifier("le commercial ne voit ni case ni bouton de validation", (await p.locator('[data-rattachements-table="valider"] input[type="checkbox"]').count()) === 0 && (await p.locator("[data-rattachements-bouton-valider]").count()) === 0);

// ---------- 2. Étape 1 : confirmation avec le reçu ----------
const ligneE3 = p.locator('[data-rattachements-table="confirmer"] tr[data-rattachement-police="POL-K3"]');
await ligneE3.locator('input[type="checkbox"]').check();
const boutonConfirmer = p.locator("[data-rattachements-bouton-confirmer]");
verifier("« Confirmer » est grisé tant que le reçu n'est pas saisi", await boutonConfirmer.isDisabled());
await p.locator('[data-rattachements-confirmer] input[name="recu"]').fill("REÇU-0042");
verifier("« Confirmer » devient actif avec le reçu", await boutonConfirmer.isEnabled());
await boutonConfirmer.click();
verifier("E3 est confirmée par le commercial avec son reçu", await attendre(async () => (await compter(`SELECT count(*) n FROM "CptRattachement" WHERE statut = 'CONFIRME' AND "recuReference" = 'REÇU-0042'`)) === 1));
await p.reload();
await p.waitForSelector("h1");
verifier("E3 passe dans « À valider » avec le nom du confirmateur et le reçu", (await p.locator('[data-rattachements-table="valider"] tbody tr').count()) === 2 && (await texte(p)).includes("Reçu : REÇU-0042"));
await p.close();

// ---------- 3. Étape 2 : validation par le RFCRH ----------
p = await ouvrir(RFCRH);
verifier("le RFCRH ne voit pas de case dans « À confirmer »", (await p.locator('[data-rattachements-table="confirmer"] input[type="checkbox"]').count()) === 0 && (await p.locator("[data-rattachements-bouton-confirmer]").count()) === 0);
verifier("« Valider » et « Rejeter » sont grisés sans sélection", (await p.locator("[data-rattachements-bouton-valider]").isDisabled()) && (await p.locator("[data-rattachements-bouton-rejeter]").isDisabled()));
await p.locator('[data-rattachements-table="valider"] thead input[type="checkbox"]').check();
await p.locator("[data-rattachements-bouton-valider]").click();
verifier("E1 et E3 sont validées", await attendre(async () => (await compter(`SELECT count(*) n FROM "CptRattachement" WHERE statut = 'VALIDE'`)) === 2));
const soldes = await compter(`SELECT count(*) n FROM "CptEncaissement" WHERE id IN ('e1','e3') AND statut = 'SOLDE' AND "resteARattacher" = 0`);
const echeancesSoldees = await compter(`SELECT count(*) n FROM "CptEcheance" WHERE id IN ('k1-e1','k3-e1') AND etat = 'SOLDEE'`);
verifier("la validation solde les deux encaissements et les deux échéances", soldes === 2 && echeancesSoldees === 2, `${soldes} / ${echeancesSoldees}`);
verifier("aucune échéance n'a été payée avant la validation (E5 reste « à confirmer »)", (await compter(`SELECT count(*) n FROM "CptEcheance" WHERE etat = 'SOLDEE'`)) === 2);
await p.close();

// ---------- 4. Rejet avec motif, puis « pas une prime » et identification manuelle ----------
p = await ouvrir(COMMERCIAL);
const ligneE5 = p.locator('[data-rattachements-table="confirmer"] tr[data-rattachement-police="POL-K1"]');
await ligneE5.locator('input[type="checkbox"]').check();
await p.locator('[data-rattachements-confirmer] input[name="recu"]').fill("REÇU-0043");
await p.locator("[data-rattachements-bouton-confirmer]").click();
verifier("E5 (probable) est confirmée à son tour", await attendre(async () => (await compter(`SELECT count(*) n FROM "CptRattachement" WHERE statut = 'CONFIRME' AND "recuReference" = 'REÇU-0043'`)) === 1));
await p.close();

p = await ouvrir(RFCRH);
await p.locator('[data-rattachements-table="valider"] tbody input[type="checkbox"]').first().check();
verifier("« Rejeter » reste grisé sans motif", await p.locator("[data-rattachements-bouton-rejeter]").isDisabled());
await p.locator('[data-rattachements-valider] input[name="motif"]').fill("Cette échéance est déjà soldée");
await p.locator("[data-rattachements-bouton-rejeter]").click();
verifier("E5 est rejetée avec son motif", await attendre(async () => (await compter(`SELECT count(*) n FROM "CptRattachement" WHERE statut = 'REJETE' AND "motifRejet" = 'Cette échéance est déjà soldée'`)) === 1));
await p.reload();
await p.waitForSelector("h1");
const sansProp = await texte(p);
verifier("E5 et E4 sont de nouveau « sans proposition » (E5 après son rejet)", sansProp.includes("CPE-2026-000004") && sansProp.includes("CPE-2026-000005"));

// « Pas une prime » sur E4 (4 500 dont 2 000 de frais de carte santé, cas T1)
const ligneE4 = p.locator('[data-encaissement-ref="CPE-2026-000004"]');
verifier("le RFCRH voit « Pas une prime » mais pas « Identifier » (il ne confirme pas)", (await ligneE4.locator("[data-pas-une-prime-ouvrir]").count()) === 1 && (await ligneE4.locator("[data-identifier-ouvrir]").count()) === 0);
await ligneE4.locator("[data-pas-une-prime-ouvrir]").click();
const formPup = ligneE4.locator("[data-pas-une-prime-formulaire]");
await formPup.locator('input[name="montant"]').fill("2000");
verifier("« Classer » est grisé tant que le motif est trop court", await formPup.locator("[data-pas-une-prime-envoyer]").isDisabled());
await formPup.locator('input[name="motif"]').fill("Frais de carte santé");
await formPup.locator("[data-pas-une-prime-envoyer]").click();
verifier(
  "2 000 sont classés « pas une prime » avec leur motif, 2 500 restent à rattacher",
  await attendre(async () => (await compter(`SELECT count(*) n FROM "CptEncaissement" WHERE id = 'e4' AND "montantPasUnePrime" = 2000 AND "resteARattacher" = 2500 AND "motifPasUnePrime" = 'Frais de carte santé'`)) === 1)
);
await p.close();

// Identification manuelle par le commercial (E5 → échéance 2 de POL-K1)
p = await ouvrir(COMMERCIAL);
const ligneE5b = p.locator('[data-encaissement-ref="CPE-2026-000005"]');
verifier("le commercial voit « Identifier » mais pas « Pas une prime »", (await ligneE5b.locator("[data-identifier-ouvrir]").count()) === 1 && (await ligneE5b.locator("[data-pas-une-prime-ouvrir]").count()) === 0);
await ligneE5b.locator("[data-identifier-ouvrir]").click();
const formId = ligneE5b.locator("[data-identifier-formulaire]");
await formId.locator('input[name="police"]').fill("pol-k1");
await formId.locator('input[name="rang"]').fill("2");
await formId.locator('input[name="recu"]').fill("REÇU-0077");
await formId.locator('input[name="justification"]').fill("Le payeur a présenté son reçu Wave");
await formId.locator("[data-identifier-envoyer]").click();
verifier(
  "E5 est identifiée sur l'échéance 2 de POL-K1, confirmée dans le même geste (manuelle, à confirmer)",
  await attendre(async () => (await compter(`SELECT count(*) n FROM "CptRattachement" WHERE methode = 'MANUELLE' AND statut = 'CONFIRME' AND "echeanceId" = 'k1-e2' AND montant = 1234`)) === 1)
);
await p.close();

p = await ouvrir(RFCRH);
await p.locator('[data-rattachements-table="valider"] tbody input[type="checkbox"]').first().check();
await p.locator("[data-rattachements-bouton-valider]").click();
verifier(
  "le RFCRH valide : échéance 2 à 1 234 réglés (encore ouverte), E5 soldée",
  await attendre(async () => (await compter(`SELECT count(*) n FROM "CptEcheance" WHERE id = 'k1-e2' AND "montantRegle" = 1234 AND etat = 'OUVERTE'`)) === 1) &&
    (await compter(`SELECT count(*) n FROM "CptEncaissement" WHERE id = 'e5' AND statut = 'SOLDE'`)) === 1
);
await p.close();

// ---------- 5. Lecture seule et mobile ----------
p = await ouvrir(DIRECTION);
verifier(
  "la Direction lit la page sans aucune case ni bouton d'action",
  (await p.locator('input[type="checkbox"]').count()) === 0 &&
    (await p.locator("[data-rapprochement-lancer], [data-rattachements-bouton-confirmer], [data-rattachements-bouton-valider], [data-identifier-ouvrir], [data-pas-une-prime-ouvrir]").count()) === 0
);
await p.close();

const ctxMobile = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" }, viewport: { width: 390, height: 844 } });
const cx = await ctxMobile.newPage();
await cx.goto(`${B}/login`);
await cx.fill('input[name="email"]', COMMERCIAL);
await cx.fill('input[name="password"]', "password123");
await Promise.all([cx.waitForURL((u) => !u.pathname.startsWith("/login")), cx.click('button[type="submit"]')]);
cx.on("pageerror", (e) => erreursJs.push(`mobile : ${e.message}`));
await cx.goto(`${B}/compta/rattachements`);
await cx.waitForSelector("h1");
verifier("mobile 390 px : pas de défilement horizontal de la page", await cx.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await cx.close();

verifier("aucune erreur JavaScript", erreursJs.length === 0, erreursJs.join(" | "));

console.log(resultats.join("\n"));
await browser.close();
await db.end();
if (resultats.some((r) => r.startsWith("KO"))) process.exit(1);
console.log(`\nGC-5d : ${resultats.length} contrôles réussis.`);
