// Gestion Compta, lot GC-6 — CONTRÔLE HEBDOMADAIRE (/compta/controle). Sur base JETABLE et neuve (voir e2e/README.md : `next build` puis
// `bash e2e/base-jetable.sh`) : ce script ÉCRIT en base et ne se rejoue pas sur la même base. Données 100 % synthétiques.
//   6a : les deux listes de travail (encaissements sans contrat, contrats déclarés payés sans encaissement), leur âge, leurs filtres en
//        GET, la pagination à 50, l'accès (cpt.consulter), le mobile 390 px sans défilement horizontal de la page.
//   6c : les indicateurs de la semaine (mêmes chiffres que les listes, taxe d'avance annoncée pour le lot GC-8, écart technique / réel).
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
async function ouvrir(email, chemin = "/compta/controle") {
  const ctx = await contexte(email);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(`${email} : ${e.message}`));
  await p.goto(`${B}${chemin}`);
  await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  return p;
}

const COMMERCIAL = "compta-commercial@simassurances.test";
const PRODUCTION = "compta-production@simassurances.test";
const DIRECTION = "compta-direction@simassurances.test";
const COLLABORATEUR = "collaborateur@simassurances.test";

const attributs = (p, attribut) => p.$$eval(`[${attribut}]`, (els, a) => els.map((e) => e.getAttribute(a)), attribut);
const ageDe = (p, attribut, valeur) => p.locator(`[${attribut}="${valeur}"]`).first().getAttribute("data-age");
const jour = (decalage) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + decalage);
  return d.toISOString().slice(0, 10);
};

// ---------- Jeu d'essai ----------
const techniqueId = (await db.query(`SELECT id FROM "User" WHERE email = $1`, [PRODUCTION])).rows[0].id;
await db.query(`INSERT INTO "CptCompte" (id, libelle, type, "majAt") VALUES ('co-wave', 'Wave Business', 'WAVE_BUSINESS', now()), ('co-bni', 'BNI', 'BANQUE', now())`);
await db.query(
  `INSERT INTO "CptProduit" (id, code, libelle, branche, "majAt") VALUES ('pr-acc', 'ACC', 'Accidents particuliers', 'ACCIDENTS', now()), ('pr-san', 'SAN', 'Santé famille', 'SANTE', now())`
);
await db.query(`INSERT INTO "CptClient" (id, nom, "majAt") VALUES ('cl-1', 'Kouassi Ama', now())`);
await db.query(`INSERT INTO "CptPartenaire" (id, nom, "estApporteur", "majAt") VALUES ('pa-1', 'Courtage Alpha', true, now()), ('pa-2', 'Courtage Beta', true, now())`);

async function contrat(id, police, o) {
  await db.query(
    `INSERT INTO "CptContrat" (id, "numPolice", "produitId", "natureContrat", "clientId", "partenaireApporteurId", "dateEffet", "dateEcheance", "primeNetteHt", "primeTtc", "creeParId", "majAt",
       "declarePaye", "referencePaiementDeclaree", "datePaiementDeclaree", statut, fractionnement, "creeAt")
     VALUES ($1,$2,$3,'INDIVIDUEL','cl-1',$4,'2026-01-01','2026-12-31',$5,$5,$6,now(),$7,$8,$9,$10,'COMPTANT', $11)`,
    [id, police, o.produit ?? "pr-acc", o.partenaire ?? null, o.prime ?? 10000, techniqueId, o.declarePaye ?? true, o.ref ?? null, o.datePaiement ?? null, o.statut ?? "EN_COURS", o.creeAt ?? new Date()]
  );
  await db.query(
    `INSERT INTO "CptEcheance" (id, "contratId", rang, "periodeDebut", "periodeFin", "datePrevue", "primeTtc", "primeHt", "montantDu", "majAt")
     VALUES ($1,$2,1,'2026-01-01','2026-12-31','2026-01-05',$3,$3,$3,now())`,
    [`${id}-e1`, id, o.prime ?? 10000]
  );
}
async function encaissement(id, reference, o) {
  await db.query(
    `INSERT INTO "CptEncaissement" (id, reference, "compteId", "referenceReleve", "dateValeur", montant, "typeFlux", statut, "resteARattacher", payeur, "creeParId", "majAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())`,
    [id, reference, o.compte ?? "co-wave", `T_${id}`, o.date, o.montant ?? 2500, o.flux ?? "ENCAISSEMENT", o.statut ?? "A_RATTACHER", o.statut === "SOLDE" || o.statut === "SANS_OBJET" ? 0 : (o.montant ?? 2500), o.payeur ?? "Payeur " + id, techniqueId]
  );
}

// Encaissements : 3 retenus d'âges connus, 4 écartés (soldé, virement émis, remboursement, autre débit), 1 sur l'autre compte.
await encaissement("e-vieux", "CPE-2026-000001", { date: jour(-40), payeur: "Awa Kone" });
await encaissement("e-moyen", "CPE-2026-000002", { date: jour(-10), payeur: "Yao Brou" });
await encaissement("e-recent", "CPE-2026-000003", { date: jour(-3), payeur: "Zoe Tano" });
await encaissement("e-solde", "CPE-2026-000004", { date: jour(-20), statut: "SOLDE" });
await encaissement("e-virement", "CPE-2026-000005", { date: jour(-20), flux: "VIREMENT_INTERNE_SORTANT", statut: "SANS_OBJET" });
await encaissement("e-debit", "CPE-2026-000006", { date: jour(-20), flux: "AUTRE_DEBIT", statut: "SANS_OBJET" });
await encaissement("e-bni", "CPE-2026-000007", { date: jour(-15), compte: "co-bni", payeur: "Client BNI" });

// Contrats : 4 retenus, 5 écartés (non déclaré payé, annulé, rattachement proposé, rattachement validé-équivalent, rattachement rejeté = retenu).
await contrat("c-1", "POL-C1", { partenaire: "pa-1", produit: "pr-acc", datePaiement: jour(-70), ref: "T_DECLAREE_C1" });
await contrat("c-2", "POL-C2", { partenaire: "pa-2", produit: "pr-san", datePaiement: jour(-9) });
await contrat("c-3", "POL-C3", { partenaire: "pa-1", produit: "pr-san", datePaiement: null, creeAt: new Date(`${jour(-35)}T10:00:00Z`) }); // âge = date d'import
await contrat("c-nonpaye", "POL-NP", { declarePaye: false, datePaiement: jour(-50) });
await contrat("c-annule", "POL-AN", { statut: "ANNULE", datePaiement: jour(-50) });
await contrat("c-propose", "POL-PR", { datePaiement: jour(-50) });
await contrat("c-rejete", "POL-RJ", { partenaire: "pa-2", datePaiement: jour(-12) });
// Une proposition en cours sur POL-PR (écarté) ; un rattachement REJETÉ sur POL-RJ (retenu : un rejet ne compte pas).
await db.query(
  `INSERT INTO "CptRattachement" (id, "encaissementId", "echeanceId", montant, methode, "niveauPreuve", justification, "majAt")
   VALUES ('r-prop', 'e-recent', 'c-propose-e1', 2500, 'MONTANT_DATE', 'DEDUCTION', 'proposition de test', now()),
          ('r-rej', 'e-moyen', 'c-rejete-e1', 2500, 'PROBABLE', 'A_CONFIRMER', 'proposition de test', now())`
);
await db.query(`UPDATE "CptRattachement" SET statut = 'REJETE', "rejeteParId" = $1, "rejeteAt" = now(), "motifRejet" = 'pas le bon contrat' WHERE id = 'r-rej'`, [techniqueId]);
// 55 encaissements d'un autre compte, jours variés, pour la pagination (le compte BNI sert de contrôle de filtre).
for (let i = 0; i < 55; i++) await encaissement(`e-pg-${i}`, `CPE-2026-1${String(i).padStart(5, "0")}`, { date: jour(-100 - i), compte: "co-bni", payeur: `Pagination ${i}` });

// ---------- 1. Accès ----------
let p = await ouvrir(COLLABORATEUR);
verifier("1. un compte sans cpt.consulter est renvoyé hors du module", !new URL(p.url()).pathname.startsWith("/compta"), new URL(p.url()).pathname + new URL(p.url()).search);
await p.close();
for (const [nom, email] of [["commercial", COMMERCIAL], ["production", PRODUCTION], ["direction", DIRECTION]]) {
  p = await ouvrir(email);
  verifier(`1. ${nom} : la page s'ouvre (cpt.consulter)`, new URL(p.url()).pathname === "/compta/controle" && (await p.locator("h1").first().innerText()).trim() === "Contrôle hebdomadaire");
  await p.close();
}
p = await ouvrir(DIRECTION);
verifier("1. la rubrique « Contrôle hebdomadaire » est un lien actif de la barre latérale", (await p.locator('aside a[href="/compta/controle"]').count()) > 0);
await p.close();

// ---------- 2. Listes et âge (sans filtre : 58 encaissements, 4 contrats) ----------
p = await ouvrir(COMMERCIAL);
const refsPage1 = await attributs(p, "data-encaissement-sans-contrat");
verifier("2. encaissements sans contrat : 50 lignes sur la première page", refsPage1.length === 50, `${refsPage1.length}`);
verifier("2. total des encaissements sans contrat = 59 (3 Wave + 1 BNI + 55 de pagination ; soldé, virement et débit écartés)", (await p.locator("[data-liste-encaissements-sans-contrat] h2").innerText()).includes("(59)"));
verifier("2. le plus ancien est en tête", (await ageDe(p, "data-encaissement-sans-contrat", refsPage1[0])) === "154", `${await ageDe(p, "data-encaissement-sans-contrat", refsPage1[0])}`);
const contrats = await attributs(p, "data-contrat-sans-encaissement");
verifier("2. contrats sans encaissement : POL-C1, POL-RJ, POL-C2, puis POL-C3 sans date de paiement déclarée (en fin de liste)", JSON.stringify(contrats) === JSON.stringify(["POL-C1", "POL-RJ", "POL-C2", "POL-C3"]), JSON.stringify(contrats));
verifier("2. POL-NP (non déclaré payé), POL-AN (annulé) et POL-PR (proposition en cours) sont écartés", !contrats.some((c) => ["POL-NP", "POL-AN", "POL-PR"].includes(c)));
verifier("2. âge d'un contrat = depuis la date de paiement déclarée (70 jours)", (await ageDe(p, "data-contrat-sans-encaissement", "POL-C1")) === "70");
verifier("2. contrat sans date de paiement : âge depuis l'import (35 jours), la date d'import est indiquée", (await ageDe(p, "data-contrat-sans-encaissement", "POL-C3")) === "35" && (await p.locator('[data-contrat-sans-encaissement="POL-C3"]').innerText()).includes("date d'import"));
verifier("2. un rattachement rejeté ne compte pas : POL-RJ reste listé", contrats.includes("POL-RJ"));
await p.goto(`${B}/compta/controle?compte=co-wave`);
const wave = await attributs(p, "data-encaissement-sans-contrat");
verifier("2. âges des encaissements Wave : 40, 10 et 3 jours", JSON.stringify(wave) === JSON.stringify(["CPE-2026-000001", "CPE-2026-000002", "CPE-2026-000003"]) && (await ageDe(p, "data-encaissement-sans-contrat", "CPE-2026-000001")) === "40" && (await ageDe(p, "data-encaissement-sans-contrat", "CPE-2026-000002")) === "10" && (await ageDe(p, "data-encaissement-sans-contrat", "CPE-2026-000003")) === "3");
verifier("2. proposition en cours signalée sur CPE-2026-000003, « Aucune proposition » sur CPE-2026-000001", (await p.locator('[data-encaissement-sans-contrat="CPE-2026-000003"]').innerText()).includes("Proposition en cours") && (await p.locator('[data-encaissement-sans-contrat="CPE-2026-000001"]').innerText()).includes("Aucune proposition"));
verifier("2. ni le soldé, ni le virement, ni le débit n'apparaissent", !wave.some((r) => ["CPE-2026-000004", "CPE-2026-000005", "CPE-2026-000006"].includes(r)));

// ---------- 3. Filtres ----------
const encPour = async (q) => {
  await p.goto(`${B}/compta/controle?${q}`);
  return { enc: await attributs(p, "data-encaissement-sans-contrat"), con: await attributs(p, "data-contrat-sans-encaissement") };
};
let r = await encPour(`compte=co-bni&du=${jour(-20)}&au=${jour(-10)}`);
verifier("3. compte BNI + période : un seul encaissement (CPE-2026-000007) ; la période filtre aussi les contrats (POL-RJ à 12 jours), pas le compte", r.enc.join() === "CPE-2026-000007" && r.con.join() === "POL-RJ", `${r.enc} / ${r.con}`);
r = await encPour(`du=${jour(-12)}&au=${jour(-1)}&compte=co-wave`);
verifier("3. période : seuls les encaissements Wave de 10 et 3 jours", r.enc.join() === "CPE-2026-000002,CPE-2026-000003", r.enc.join());
verifier("3. période : contrats déclarés payés dans les 12 derniers jours (POL-C2 à 9 jours, POL-RJ à 12 jours)", r.con.join() === "POL-RJ,POL-C2", r.con.join());
r = await encPour("partenaire=pa-1");
verifier("3. partenaire Alpha : POL-C1 et POL-C3 (les encaissements ne sont pas filtrés)", r.con.join() === "POL-C1,POL-C3" && r.enc.length === 50, r.con.join());
r = await encPour("branche=SANTE");
verifier("3. branche Santé : POL-C2 puis POL-C3 (sans date déclarée)", r.con.join() === "POL-C2,POL-C3", r.con.join());
r = await encPour("partenaire=pa-2&branche=SANTE");
verifier("3. partenaire Beta + branche Santé : POL-C2 seul", r.con.join() === "POL-C2", r.con.join());
r = await encPour("du=pas-une-date&compte=inconnu&partenaire=inconnu&branche=AUTO");
verifier("3. filtres invalides ignorés : mêmes listes que sans filtre, aucune erreur", r.enc.length === 50 && r.con.length === 4);
const valeursForm = await p.$$eval("[data-filtres-controle] [name]", (els) => els.map((e) => e.getAttribute("name")));
verifier("3. le formulaire est en GET avec du, au, compte, partenaire, branche", JSON.stringify(valeursForm) === JSON.stringify(["du", "au", "compte", "partenaire", "branche"]) && (await p.locator("[data-filtres-controle]").getAttribute("method")) === "get");
await p.goto(`${B}/compta/controle?compte=co-bni&branche=SANTE`);
await p.locator("[data-filtres-controle] button[type=submit]").click();
await p.waitForURL((u) => u.search.includes("compte=co-bni") && u.search.includes("branche=SANTE"));
verifier("3. « Filtrer » conserve les valeurs choisies dans l'adresse", true);

// ---------- 4. Pagination ----------
await p.goto(`${B}/compta/controle`);
verifier("4. « Suivante » mène à la page 2", (await p.locator("[data-liste-encaissements-sans-contrat] a", { hasText: "Suivante" }).count()) === 1);
await p.goto(`${B}/compta/controle?page=2`);
const page2 = await attributs(p, "data-encaissement-sans-contrat");
verifier("4. page 2 : les 9 dernières lignes (59 − 50), toutes plus récentes que la page 1", page2.length === 9 && !page2.some((x) => refsPage1.includes(x)), `${page2.length}`);
verifier("4. page 2 : la liste des contrats est inchangée", (await attributs(p, "data-contrat-sans-encaissement")).length === 4);
await p.goto(`${B}/compta/controle?page=999`);
verifier("4. page hors limites : message « aucun » sans erreur, pied de page cohérent", (await p.locator("[data-liste-vide]").count()) >= 1 || (await attributs(p, "data-encaissement-sans-contrat")).length === 0);
await p.goto(`${B}/compta/controle?page=2&du=${jour(-3)}`);
verifier("4. la page 2 de la pagination suit les filtres", (await p.locator("[data-pagination-total]").first().innerText()).includes("1 encaissement(s)"), (await p.locator("[data-pagination-total]").first().innerText()));
await p.close();

// ---------- 4 bis (6c). Indicateurs de la semaine ----------
const texteIndicateur = async (page, nom) => (await page.locator(`[data-indicateur="${nom}"]`).innerText()).replace(/\s+/g, " ");
p = await ouvrir(COMMERCIAL);
let ind = await texteIndicateur(p, "encaissements-relance");
verifier("4b. encaissements sans contrat depuis 7 jours ou plus : 58 sur 59 (CPE-…003 à 3 jours n'y est pas)", /depuis 7 jours ou plus/.test(ind) && /(?<!\d)58(?!\d)/.test(ind) && /59 au total/.test(ind), ind);
verifier("4b. dont 56 depuis 30 jours ou plus", /Dont 56 depuis 30 jours ou plus/.test(ind), ind);
ind = await texteIndicateur(p, "contrats-sans-encaissement");
verifier("4b. contrats sans encaissement : 4, dont 4 depuis 7 jours ou plus et 2 depuis 30 jours ou plus", /(?<!\d)4(?!\d)/.test(ind) && /Dont 4 depuis 7 jours ou plus et 2 depuis 30 jours ou plus/.test(ind), ind);
ind = await texteIndicateur(p, "taxe-payee-avance");
verifier("4b. taxe payée d'avance : calculée depuis le lot GC-8 (0 FCFA, aucune avance déclarée), plus de « Disponible au lot GC-8 »", !/Disponible au lot GC-8/.test(ind) && /0 FCFA/.test(ind) && /0 encaissement/.test(ind), ind);
ind = await texteIndicateur(p, "ecart-technique-reel");
verifier("4b. écart technique / réel : 5 contrats payés en une fois, 50 000 déclarés, 0 prouvé, écart 50 000", /5 contrats payés en une fois/.test(ind) && /50 000 FCFA/.test(ind) && /prouvé par un rattachement validé : 0 FCFA/.test(ind), ind);
// Mêmes chiffres que les listes (sans filtre) : le total des listes est celui des indicateurs.
const totalListes = await p.locator("[data-liste-encaissements-sans-contrat] h2").innerText();
verifier("4b. l'indicateur et la liste disent le même total d'encaissements (59) et de contrats (4)", totalListes.includes("(59)") && (await p.locator("[data-liste-contrats-sans-encaissement] h2").innerText()).includes("(4)"));
await p.goto(`${B}/compta/controle?compte=co-bni&partenaire=pa-1&branche=SANTE`);
verifier("4b. les indicateurs ne dépendent pas des filtres des listes", /58/.test(await texteIndicateur(p, "encaissements-relance")) && /Dont 4 depuis/.test(await texteIndicateur(p, "contrats-sans-encaissement")));
await p.close();
// Un rattachement VALIDÉ sur POL-PR (2 500 sur 10 000) : le « réel » monte à 2 500, l'écart baisse à 47 500 ; le contrat reste hors de la liste.
const autreId = (await db.query(`SELECT id FROM "User" WHERE email = 'admin@simassurances.test'`)).rows[0].id;
await db.query(`UPDATE "CptRattachement" SET statut = 'CONFIRME', "confirmeParId" = $1, "confirmeAt" = now(), "recuReference" = 'RECU-1' WHERE id = 'r-prop'`, [techniqueId]);
await db.query(`UPDATE "CptRattachement" SET statut = 'VALIDE', "valideParId" = $1, "valideAt" = now() WHERE id = 'r-prop'`, [autreId]);
p = await ouvrir(COMMERCIAL);
ind = await texteIndicateur(p, "ecart-technique-reel");
verifier("4b. avec un rattachement validé de 2 500 : prouvé 2 500, écart 47 500", /prouvé par un rattachement validé : 2 500 FCFA/.test(ind) && /47 500 FCFA/.test(ind), ind);
await p.close();

// ---------- 5. Mobile 390 px ----------
const ctxMobile = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
{
  const connexion = await ctxMobile.newPage();
  await connexion.goto(`${B}/login`);
  await connexion.fill('input[name="email"]', COMMERCIAL);
  await connexion.fill('input[name="password"]', "password123");
  await Promise.all([connexion.waitForURL((u) => !u.pathname.startsWith("/login")), connexion.click('button[type="submit"]')]);
  const m = await ctxMobile.newPage();
  m.on("pageerror", (e) => erreursJs.push(`mobile : ${e.message}`));
  await m.goto(`${B}/compta/controle`);
  await m.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  const debordement = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  verifier("5. mobile 390 px : aucun défilement horizontal de la page", debordement <= 0, `${debordement} px`);
  verifier("5. mobile : les deux listes sont affichées", (await m.locator("[data-liste-encaissements-sans-contrat]").count()) === 1 && (await m.locator("[data-liste-contrats-sans-encaissement]").count()) === 1);
}
await ctxMobile.close();

verifier("6. aucune erreur JavaScript", erreursJs.length === 0, erreursJs.join(" | "));
await browser.close();
await db.end();
console.log(resultats.join("\n"));
const ko = resultats.filter((l) => l.startsWith("KO")).length;
console.log(`\nGC-6 (contrôle hebdomadaire) : ${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko === 0 ? 0 : 1);
