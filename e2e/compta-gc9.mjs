// Gestion Compta, lot GC-9 — RÉMUNÉRATION DES PARTENAIRES (sans GC-9d). Sur base JETABLE et neuve (voir e2e/README.md : `next build` puis
// `bash e2e/base-jetable.sh`) : ce script ÉCRIT en base et ne se rejoue pas sur la même base. Données 100 % synthétiques.
// Parties : E2E_PARTIES="9e,9f,9g" (défaut : toutes ; les parties suivantes supposent les précédentes).
//   9e : avertissement R1 et message des bordereaux, quatre soldes, T6 ter, T6, T6 bis par les écrans ; règlement et affectation, avance,
//        décision « en une fois », refus serveur par rejeu sans permission, deux règlements simultanés, 390 px ;
//   9f : aucune compensation automatique, compensation d'une avance avec motif (montant et motif contrôlés), refus par rejeu sans
//        permission, deux compensations simultanées, honoraires « à régulariser » après résiliation ;
//   9g : relevé par partenaire et par nature (écran, mêmes chiffres que la fiche), exports CSV / Excel et PDF recoupés, accès refusés,
//        390 px. Le PDF est relu avec `pdftotext`.
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import pg from "pg";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/i.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");
const PARTIES = (process.env.E2E_PARTIES ?? "9e,9f,9g").split(",");
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
const calme = (p) => p.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
async function ouvrir(email, chemin, taille) {
  const ctx = await contexte(email);
  const p = await ctx.newPage();
  if (taille) await p.setViewportSize(taille);
  p.on("pageerror", (e) => erreursJs.push(`${email} : ${e.message}`));
  await p.goto(`${B}${chemin}`);
  await calme(p);
  return p;
}
async function recharger(p) {
  await p.reload();
  await calme(p);
}
const RFCRH = "compta-rfcrh@simassurances.test";
const DIRECTION = "compta-direction@simassurances.test";
const COMMERCIAL = "compta-commercial@simassurances.test";
const COLLABORATEUR = "collaborateur@simassurances.test";
const R1 = "Le module Encaissements calcule aussi les honoraires. Avant la mise en service, un seul des deux doit faire foi.";
const BORDEREAUX = "Bordereaux des partenaires : en attente des modèles de fichiers";

const sql = async (texte, valeurs = []) => (await db.query(texte, valeurs)).rows;
const un = async (texte, valeurs = []) => (await sql(texte, valeurs))[0];
const compter = async (table, where = "TRUE", valeurs = []) => Number((await un(`SELECT count(*)::int AS n FROM "${table}" WHERE ${where}`, valeurs)).n);
const nombre = (texte) => Number((texte ?? "").replace(/[^\d,-]/g, "").replace(",", "."));
const idPartenaire = async (nom) => (await un(`SELECT id FROM "CptPartenaire" WHERE nom = $1`, [nom])).id;
const donnees = (phase) => execSync(`npx tsx e2e/compta-gc9-donnees.ts ${phase}`, { env: { ...process.env, DATABASE_URL: DB.replace(/\?.*$/, "") + "?schema=public" }, stdio: "pipe" });
/** Rejoue côté serveur une action capturée avec la session d'un compte (la réponse, texte brut). */
async function rejouer(email, req, modifier = null) {
  const ctx = await contexte(email);
  const corps = modifier ? modifier(JSON.parse(req.postData())) : JSON.parse(req.postData());
  const rep = await ctx.request.post(req.url(), { headers: { "next-action": req.headers()["next-action"], "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", origin: B }, data: JSON.stringify(corps) });
  return rep.text();
}
async function cliquerEtCapturer(page, locator) {
  const [req] = await Promise.all([page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]), locator.click()]);
  await page.waitForResponse((r) => r.request() === req).catch(() => {});
  await calme(page);
  await page.waitForTimeout(700);
  return req;
}
const carte = async (p, nature, cle) => nombre(await p.locator(`[data-carte-solde="${nature}"] [data-montant="${cle}"]`).innerText());
/** Payé de chaque ligne en base (règlements + compensations), et lignes payées au-delà de leur dû. */
const lignesPayees = (partenaire) =>
  sql(
    `SELECT l.id, e.rang, c."numPolice", l.nature, l.du::float AS du,
       (coalesce((SELECT sum(montant) FROM "CptAffectationReglement" a WHERE a."ligneRemunerationId" = l.id),0)
        + coalesce((SELECT sum(montant) FROM "CptAffectationCompensation" a WHERE a."ligneRemunerationId" = l.id),0))::float AS paye
     FROM "CptLigneRemuneration" l JOIN "CptEcheance" e ON e.id = l."echeanceId" JOIN "CptContrat" c ON c.id = l."contratId"
     WHERE l."partenaireBeneficiaireId" = $1 ORDER BY c."numPolice", l.nature, e.rang`,
    [partenaire]
  );

async function remplirReglement(p, { nature, montant, reference = "VIR-E2E", avance = false, motif = "", mode = "VIREMENT", derogation = "" }) {
  const f = p.locator("[data-form-reglement]");
  await f.locator('select[name="nature"]').selectOption(nature);
  await f.locator('input[name="montant"]').fill(String(montant));
  await f.locator('select[name="mode"]').selectOption(mode);
  await f.locator('input[name="referenceReglement"]').fill(reference);
  await f.locator('select[name="modeDerogation"]').selectOption(derogation);
  if (avance) await f.locator('input[name="accepterAvance"]').check();
  if (motif) await f.locator('textarea[name="motif"]').fill(motif);
  return f.locator('button[type="submit"]');
}

donnees("base");

// =====================================================================================================================
// 9e — règlements et affectations
// =====================================================================================================================
let reqReglement = null;
if (partie("9e")) {
  const idTer = await idPartenaire("Courtier T6ter");
  const liste = await ouvrir(RFCRH, "/compta/partenaires");
  verifier("9e. liste : avertissement R1 visible, texte exact", (await liste.locator("[data-avertissement-r1]").innerText()).includes(R1));
  verifier("9e. liste : « Bordereaux des partenaires : en attente des modèles de fichiers »", (await liste.locator("[data-bordereaux-en-attente]").innerText()).trim() === BORDEREAUX);
  const rangee = (nom) => liste.locator(`[data-partenaire="${nom}"]`);
  verifier("9e. liste : T6 ter, commission nette à verser 3 000, reste dû 12 000", nombre(await rangee("Courtier T6ter").locator('[data-solde="COMMISSION"] [data-net]').innerText()) === 3000 && nombre(await rangee("Courtier T6ter").locator('[data-solde="COMMISSION"] [data-reste-du]').innerText()) === 12000);
  verifier("9e. liste : quatrième solde, la créance du courtier client (50 000), séparée de sa commission (28 050)", nombre(await rangee("Courtier T6").locator("[data-creance]").innerText()) === 50000 && nombre(await rangee("Courtier T6").locator('[data-solde="COMMISSION"] [data-net]').innerText()) === 28050);
  verifier("9e. la rubrique « Partenaires » est dans la barre latérale", (await liste.locator('aside a[href="/compta/partenaires"]').count()) > 0);
  await liste.close();

  // ---------- T6 ter ----------
  const p = await ouvrir(RFCRH, `/compta/partenaires/${idTer}`);
  verifier("9e. fiche : avertissement R1 et message des bordereaux", (await p.locator("[data-avertissement-r1]").innerText()).includes(R1) && (await p.locator("[data-bordereaux-en-attente]").count()) === 1);
  verifier("9e. T6 ter avant règlement : dû 12 000, payable 3 000, net 3 000, payé 0", (await carte(p, "COMMISSION", "du")) === 12000 && (await carte(p, "COMMISSION", "payable")) === 3000 && (await carte(p, "COMMISSION", "reste-payable")) === 3000 && (await carte(p, "COMMISSION", "paye")) === 0);
  verifier("9e. détail : 12 échéances de commission, 1 000 chacune", (await p.locator("[data-ligne]").count()) === 12 && nombre(await p.locator('[data-ligne="POL-T6TER-12"] [data-montant="du"]').innerText()) === 1000);

  // Au-delà du payable, sans avance : refusé, rien n'est écrit.
  await cliquerEtCapturer(p, await remplirReglement(p, { nature: "COMMISSION", montant: 3001 }));
  verifier("9e. 3 001 sans avance : refusé avec le payable (3 000), rien n'est écrit", /payable aujourd'hui \(3\s000 FCFA\)/.test(await p.locator("[data-message-reglement]").innerText()) && (await compter("CptReglementPartenaire")) === 0 && (await compter("CptLigneRemuneration")) === 0);

  reqReglement = await cliquerEtCapturer(p, await remplirReglement(p, { nature: "COMMISSION", montant: "3 000", reference: "VIR-T6TER-1" }));
  const r1 = await un(`SELECT reference, montant::float AS montant, "montantAvance"::float AS avance, nature FROM "CptReglementPartenaire"`);
  verifier("9e. règlement de 3 000 : CPR-2026-000001, nature commission, sans avance", r1?.reference === "CPR-2026-000001" && r1.montant === 3000 && r1.avance === 0 && r1.nature === "COMMISSION", JSON.stringify(r1));
  const lignes = await lignesPayees(idTer);
  verifier("9e. affecté aux trois échéances les plus anciennes (1 000 chacune) ; les 12 lignes du contrat sont figées", lignes.length === 12 && lignes.filter((l) => l.paye === 1000).map((l) => l.rang).join(",") === "1,2,3" && lignes.every((l) => l.du === 1000));
  verifier("9e. audit : le règlement est tracé avec ses affectations", (await compter("CptAudit", `entite = 'CptReglementPartenaire' AND action = 'reglement_partenaire'`)) === 1);
  await recharger(p);
  verifier("9e. T6 ter après règlement : reste payable 0, reste dû 9 000, payé 3 000, avance 0", (await carte(p, "COMMISSION", "reste-payable")) === 0 && (await carte(p, "COMMISSION", "reste-du")) === 9000 && (await carte(p, "COMMISSION", "paye")) === 3000 && (await carte(p, "COMMISSION", "avance")) === 0);
  verifier("9e. l'historique montre le règlement", (await p.locator('[data-reglement="CPR-2026-000001"]').count()) === 1);

  // Refus serveur sans la permission.
  for (const compte of [DIRECTION, COMMERCIAL]) {
    const rep = await rejouer(compte, reqReglement);
    verifier(`9e. rejeu direct du règlement sans cpt.regler_partenaire (${compte.split("@")[0]}) : refusé`, /Action non autoris/.test(rep) && (await compter("CptReglementPartenaire")) === 1, rep.slice(0, 120));
  }
  const d = await ouvrir(DIRECTION, `/compta/partenaires/${idTer}`);
  const boutonDirection = d.locator('[data-form-reglement] button[type="submit"]');
  verifier("9e. Direction : bouton visible mais grisé avec la raison", (await boutonDirection.isDisabled()) && /ne permet pas de régler/.test(await d.locator("[data-form-reglement]").innerText()));
  await d.close();

  // Deux règlements simultanés : la 4ᵉ mensualité rend 1 000 payables, un seul des deux passe.
  donnees("mois4");
  const simultane = (corps) => [{ ...corps[0], montant: "1000", referenceReglement: "VIR-SIMULTANE" }];
  const [a, b] = await Promise.all([rejouer(RFCRH, reqReglement, simultane), rejouer(RFCRH, reqReglement, simultane)]);
  const nbSimultanes = await compter("CptReglementPartenaire", `"referenceReglement" = 'VIR-SIMULTANE'`);
  const apresSimultanes = await lignesPayees(idTer);
  verifier("9e. deux règlements simultanés de 1 000 : un seul enregistré, l'autre refusé", nbSimultanes === 1 && /dépasse le payable|dépasse le reste dû/.test(a + b), `${nbSimultanes} — ${(a + b).replace(/\s+/g, " ").slice(0, 200)}`);
  verifier("9e. aucun montant affecté deux fois : payé total 4 000, aucune ligne au-delà de son dû", apresSimultanes.reduce((s, l) => s + l.paye, 0) === 4000 && apresSimultanes.every((l) => l.paye <= l.du));
  verifier("9e. numérotation sans trou : CPR-2026-000002 pour le règlement accepté", (await compter("CptReglementPartenaire", `reference = 'CPR-2026-000002'`)) === 1);

  // Décision « en une fois » sur le contrat.
  await recharger(p);
  const fd = p.locator("[data-form-decision]");
  await fd.locator('select[name="contratId"]').selectOption({ label: "POL-T6TER" });
  await fd.locator('select[name="nature"]').selectOption("COMMISSION");
  await fd.locator('select[name="mode"]').selectOption("EN_UNE_FOIS");
  await fd.locator('textarea[name="motif"]').fill("Accord écrit du directeur : solde en une fois");
  const reqDecision = await cliquerEtCapturer(p, fd.locator('button[type="submit"]'));
  await recharger(p);
  verifier("9e. décision « en une fois » : tout le reste dû devient payable (8 000), motif tracé", (await carte(p, "COMMISSION", "reste-payable")) === 8000 && (await compter("CptDecisionModeRemuneration", `mode = 'EN_UNE_FOIS' AND motif LIKE 'Accord écrit%'`)) === 1 && (await compter("CptAudit", `action = 'decision_mode_remuneration'`)) === 1);
  const repDecision = await rejouer(DIRECTION, reqDecision);
  verifier("9e. rejeu direct de la décision sans cpt.regler_partenaire : refusé", /Action non autoris/.test(repDecision) && (await compter("CptDecisionModeRemuneration")) === 1, repDecision.slice(0, 120));

  // Règlement avec le choix « au prorata » pour CE règlement : retour au plafond de la part encaissée (0).
  await cliquerEtCapturer(p, await remplirReglement(p, { nature: "COMMISSION", montant: 100, derogation: "AU_PRORATA", motif: "Retour au prorata pour ce versement" }));
  verifier("9e. choix « au prorata » sur un règlement : plafonné à la part encaissée (rien à payer), refusé", /payable aujourd'hui \(0 FCFA\)/.test(await p.locator("[data-message-reglement]").innerText()) && (await compter("CptReglementPartenaire")) === 2);
  await p.close();

  // ---------- T6 : deux soldes distincts ----------
  const idCourtier = await idPartenaire("Courtier T6");
  const idGestionnaire = await idPartenaire("Gestionnaire T6");
  const g = await ouvrir(RFCRH, `/compta/partenaires/${idGestionnaire}`);
  const honorairesAvant = await carte(g, "HONORAIRES", "reste-payable");
  const c = await ouvrir(RFCRH, `/compta/partenaires/${idCourtier}`);
  await cliquerEtCapturer(c, await remplirReglement(c, { nature: "COMMISSION", montant: 28050, reference: "VIR-T6" }));
  await recharger(c);
  await recharger(g);
  verifier("9e. T6 : commission du courtier réglée (28 050), ses honoraires restent à 0", (await carte(c, "COMMISSION", "reste-payable")) === 0 && (await carte(c, "COMMISSION", "paye")) === 28050 && (await carte(c, "HONORAIRES", "du")) === 0);
  verifier("9e. T6 : les honoraires du gestionnaire (10 000) ne bougent pas, il n'a aucune commission", honorairesAvant === 10000 && (await carte(g, "HONORAIRES", "reste-payable")) === 10000 && (await carte(g, "COMMISSION", "du")) === 0);
  verifier("9e. T6 : la créance du courtier (50 000) n'est pas compensée par son règlement", nombre(await c.locator('[data-carte-creance] [data-montant="creance"]').innerText()) === 50000);
  await c.close();
  await g.close();

  // ---------- T6 bis ----------
  const idNovelia = await idPartenaire("NOVELIA");
  const n = await ouvrir(RFCRH, `/compta/partenaires/${idNovelia}`);
  const h = (police, col) => n.locator(`[data-honoraire="${police}"] [data-${col}]`).innerText().then(nombre);
  verifier("9e. T6 bis : contrat SIM exigible 8 000 « sur primes non encaissées », avec le reste dû du client", (await h("POL-BIS-SIM", "exigible")) === 8000 && (await h("POL-BIS-SIM", "non-encaissees")) === 8000 && (await h("POL-BIS-SIM", "encaissees")) === 0 && (await h("POL-BIS-SIM", "reste-client")) === 100000);
  verifier("9e. T6 bis : rien d'exigible sur le contrat NOVELIA", (await h("POL-BIS-NOV", "exigible")) === 0 && (await h("POL-BIS-NOV", "non-encaissees")) === 0);
  donnees("t6bis");
  await recharger(n);
  verifier("9e. T6 bis : à l'encaissement, les deux passent « sur primes encaissées » (8 000 chacun)", (await h("POL-BIS-SIM", "encaissees")) === 8000 && (await h("POL-BIS-SIM", "non-encaissees")) === 0 && (await h("POL-BIS-NOV", "encaissees")) === 8000);
  await n.close();

  const m = await ouvrir(RFCRH, `/compta/partenaires/${idTer}`, { width: 390, height: 844 });
  verifier("9e. 390 px : fiche sans défilement horizontal de la page", await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await m.close();
  const ml = await ouvrir(RFCRH, "/compta/partenaires", { width: 390, height: 844 });
  verifier("9e. 390 px : liste sans défilement horizontal de la page", await ml.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await ml.close();
  const refuse = await (await contexte(COLLABORATEUR)).request.get(`${B}/compta/partenaires`, { maxRedirects: 0 });
  verifier("9e. sans cpt.consulter : redirigé", refuse.status() >= 300 && refuse.status() < 400, `${refuse.status()}`);
}

// =====================================================================================================================
// 9f — compensation
// =====================================================================================================================
if (partie("9f")) {
  const idCab = await idPartenaire("Cabinet Compensation");
  const p = await ouvrir(RFCRH, `/compta/partenaires/${idCab}`);
  const bouton = p.locator('[data-form-compensation] button[type="submit"]');
  verifier("9f. sans avance : bouton « Compenser » grisé avec la raison", (await bouton.isDisabled()) && /Rien à compenser/.test(await p.locator("[data-raison-compensation]").innerText()));
  verifier("9f. avant : commission payable 0 (prime non encaissée), honoraires à verser 7 000", (await carte(p, "COMMISSION", "reste-payable")) === 0 && (await carte(p, "HONORAIRES", "reste-payable")) === 7000);

  await cliquerEtCapturer(p, await remplirReglement(p, { nature: "COMMISSION", montant: 3000, avance: true, motif: "Avance sur commission demandée par le cabinet", reference: "VIR-CAB-AV" }));
  await recharger(p);
  const avance = await un(`SELECT "montantAvance"::float AS a, motif FROM "CptReglementPartenaire" WHERE "referenceReglement" = 'VIR-CAB-AV'`);
  verifier("9f. règlement avec avance explicite et motif : 3 000 d'avance enregistrée", avance?.a === 3000 && /Avance sur commission/.test(avance.motif), JSON.stringify(avance));
  verifier("9f. aucune compensation automatique : avance de commission 3 000, honoraires toujours 7 000 à verser", (await carte(p, "COMMISSION", "avance")) === 3000 && (await carte(p, "HONORAIRES", "reste-payable")) === 7000 && (await compter("CptCompensation")) === 0);

  const remplir = async (montant, motif, source = "COMMISSION", cible = "HONORAIRES") => {
    const f = p.locator("[data-form-compensation]");
    await f.locator('select[name="natureSource"]').selectOption(source);
    await f.locator('select[name="natureCible"]').selectOption(cible);
    await f.locator('input[name="montant"]').fill(String(montant));
    await f.locator('textarea[name="motif"]').fill(motif);
    return f.locator('button[type="submit"]');
  };
  await cliquerEtCapturer(p, await remplir(3001, "Compensation convenue avec le cabinet"));
  verifier("9f. au-delà de l'avance disponible : refusée, rien n'est écrit", /avance disponible en commission \(3\s000 FCFA\)/.test(await p.locator("[data-message-compensation]").innerText()) && (await compter("CptCompensation")) === 0);
  await cliquerEtCapturer(p, await remplir(1000, "trop bref"));
  verifier("9f. motif de moins de 10 caractères : refusée par le serveur", /motif est obligatoire/.test(await p.locator("[data-message-compensation]").innerText()) && (await compter("CptCompensation")) === 0);
  const reqComp = await cliquerEtCapturer(p, await remplir(1000, "Compensation convenue avec le cabinet"));
  await recharger(p);
  verifier("9f. compensation de 1 000 : avance de commission 2 000, honoraires à verser 6 000", (await carte(p, "COMMISSION", "avance")) === 2000 && (await carte(p, "HONORAIRES", "reste-payable")) === 6000);
  const mouvements = await sql(`SELECT l.nature, a.montant::float AS montant FROM "CptAffectationCompensation" a JOIN "CptLigneRemuneration" l ON l.id = a."ligneRemunerationId" ORDER BY a.montant`);
  verifier("9f. en base : −1 000 sur la commission, +1 000 sur les honoraires, audit avec motif", JSON.stringify(mouvements) === JSON.stringify([{ nature: "COMMISSION", montant: -1000 }, { nature: "HONORAIRES", montant: 1000 }]) && (await compter("CptAudit", `action = 'compensation' AND motif = 'Compensation convenue avec le cabinet'`)) === 1, JSON.stringify(mouvements));
  verifier("9f. l'historique des compensations l'affiche", (await p.locator("[data-compensation-faite]").count()) === 1);

  for (const compte of [DIRECTION, COMMERCIAL]) {
    const rep = await rejouer(compte, reqComp);
    verifier(`9f. rejeu direct de la compensation sans cpt.compenser (${compte.split("@")[0]}) : refusé`, /Action non autoris/.test(rep) && (await compter("CptCompensation")) === 1, rep.slice(0, 120));
  }
  const d = await ouvrir(DIRECTION, `/compta/partenaires/${idCab}`);
  verifier("9f. Direction : bouton grisé avec la raison", (await d.locator('[data-form-compensation] button[type="submit"]').isDisabled()) && /ne permet pas de compenser/.test(await d.locator("[data-raison-compensation]").innerText()));
  await d.close();

  const deux = (corps) => [{ ...corps[0], montant: "2000" }];
  const [a, b] = await Promise.all([rejouer(RFCRH, reqComp, deux), rejouer(RFCRH, reqComp, deux)]);
  const apres = await lignesPayees(idCab);
  verifier("9f. deux compensations simultanées de 2 000 (avance restante 2 000) : une seule passe", (await compter("CptCompensation", "montant = 2000")) === 1 && /avance disponible/.test(a + b), (a + b).replace(/\s+/g, " ").slice(0, 200));
  verifier("9f. aucune avance reprise deux fois : total payé inchangé (3 000), aucune ligne négative ni au-delà de son dû", apres.reduce((s, l) => s + l.paye, 0) === 3000 && apres.every((l) => l.paye >= 0 && l.paye <= l.du), JSON.stringify(apres.map((l) => l.paye)));

  donnees("resilier");
  await recharger(p);
  verifier("9f. résiliation d'un contrat jamais encaissé : ses honoraires (2 000) sont « à régulariser »", /À régulariser 2\s000/.test(await p.locator('[data-honoraire="POL-CAB-RESIL"] [data-a-regulariser]').innerText()) && (await p.locator("[data-honoraire]").first().getAttribute("data-honoraire")) === "POL-CAB-RESIL");
  await p.close();
  const m = await ouvrir(RFCRH, `/compta/partenaires/${idCab}`, { width: 390, height: 844 });
  verifier("9f. 390 px : pas de défilement horizontal de la page", await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await m.close();
}

// =====================================================================================================================
// 9g — relevés par partenaire et par nature
// =====================================================================================================================
if (partie("9g")) {
  const idCab = await idPartenaire("Cabinet Compensation");
  const idNovelia = await idPartenaire("NOVELIA");
  const total = async (p, cle) => nombre(await p.locator(`[data-total="${cle}"]`).innerText());
  const sommeMouvements = async (p) => (await p.locator("[data-montant-mouvement]").allInnerTexts()).reduce((s, t) => s + nombre(t), 0);

  const fiche = await ouvrir(RFCRH, `/compta/partenaires/${idCab}?nature=COMMISSION`);
  const ficheCommission = { du: await carte(fiche, "COMMISSION", "du"), paye: await carte(fiche, "COMMISSION", "paye"), avance: await carte(fiche, "COMMISSION", "avance") };
  await Promise.all([fiche.waitForURL(/\/releve/), fiche.locator("[data-lien-releve]").click()]);
  await calme(fiche);
  const r = fiche;
  verifier("9g. depuis la fiche : le relevé de commission, avec l'avertissement R1", /nature=COMMISSION/.test(r.url()) && (await r.locator("[data-avertissement-r1]").innerText()).includes(R1));
  verifier("9g. mêmes chiffres que la fiche (dû, payé, avance)", (await total(r, "du")) === ficheCommission.du && (await total(r, "paye")) === ficheCommission.paye && (await total(r, "avance")) === ficheCommission.avance, JSON.stringify(ficheCommission));
  verifier("9g. commission du cabinet : le règlement de 3 000, deux reprises de compensation (−1 000, −2 000) ; leur somme est le payé", (await r.locator('[data-mouvement="REGLEMENT"]').count()) === 1 && (await r.locator('[data-mouvement="COMPENSATION"]').count()) === 2 && (await sommeMouvements(r)) === (await total(r, "paye")) && (await total(r, "paye")) === 0);
  const payeSql = Number((await un(`SELECT (coalesce((SELECT sum(montant) FROM "CptReglementPartenaire" WHERE "partenaireId" = $1 AND nature = 'HONORAIRES'),0) + coalesce((SELECT sum(montant) FROM "CptCompensation" WHERE "partenaireId" = $1 AND "natureCible" = 'HONORAIRES'),0))::float AS s`, [idCab])).s);
  await r.goto(`${B}/compta/partenaires/${idCab}/releve?nature=HONORAIRES`);
  await calme(r);
  verifier("9g. honoraires du cabinet : 3 000 imputés par compensation, recoupés par un calcul SQL indépendant", (await total(r, "paye")) === payeSql && payeSql === 3000 && (await sommeMouvements(r)) === 3000);
  await r.close();

  const idTer = await idPartenaire("Courtier T6ter");
  const t = await ouvrir(DIRECTION, `/compta/partenaires/${idTer}/releve?nature=COMMISSION`);
  const attendu = await un(`SELECT coalesce(sum(montant),0)::float AS s, count(*)::int AS n FROM "CptReglementPartenaire" WHERE "partenaireId" = $1`, [idTer]);
  verifier("9g. la Direction consulte le relevé T6 ter : 12 échéances, payé = les règlements, dû 12 000", (await t.locator("[data-releve-ligne]").count()) === 12 && (await total(t, "du")) === 12000 && (await total(t, "paye")) === attendu.s && (await t.locator('[data-mouvement="REGLEMENT"]').count()) === attendu.n, JSON.stringify(attendu));
  await t.close();

  const n = await ouvrir(RFCRH, `/compta/partenaires/${idNovelia}/releve?nature=HONORAIRES`);
  verifier("9g. relevé d'honoraires : colonnes encaissées / non encaissées (16 000 encaissées après T6 bis)", (await total(n, "encaissees")) === 16000 && (await total(n, "non-encaissees")) === 0);
  const ecranDu = await total(n, "du");
  await n.close();

  // Exports : mêmes lignes que l'écran, accès contrôlé.
  const ctx = await contexte(RFCRH);
  const url = (id, nature, format) => `${B}/api/compta/export/remuneration?partenaire=${id}&nature=${nature}&format=${format}`;
  const csv = await ctx.request.get(url(idCab, "COMMISSION", "csv"));
  const lignesCsv = (await csv.text()).replace(/^\uFEFF/, "").trim().split("\r\n").map((l) => l.split(";"));
  const colonne = (titre) => lignesCsv[0].indexOf(titre);
  const sections = lignesCsv.slice(1).map((l) => l[0]);
  verifier("9g. export CSV : échéance, règlement, deux compensations et un total", csv.status() === 200 && sections.join(",") === "Échéance,Règlement,Compensation,Compensation,Total", sections.join(","));
  const totalCsv = lignesCsv.at(-1);
  verifier("9g. CSV : total payé 0 = somme des mouvements ; une reprise reste négative", Number(totalCsv[colonne("Payé (FCFA)")].replace(",", ".")) === 0 && Number(totalCsv[colonne("Mouvement (FCFA)")].replace(",", ".")) === 0 && lignesCsv.some((l) => l[colonne("Mouvement (FCFA)")] === "-2000,00"));
  const csvH = await (await ctx.request.get(url(idNovelia, "HONORAIRES", "csv"))).text();
  const lh = csvH.replace(/^\uFEFF/, "").trim().split("\r\n").map((l) => l.split(";"));
  verifier("9g. CSV honoraires : total dû = écran, colonne « Sur primes encaissées » = 16000", Number(lh.at(-1)[lh[0].indexOf("Dû (FCFA)")].replace(",", ".")) === ecranDu && Number(lh.at(-1)[lh[0].indexOf("Sur primes encaissées (FCFA)")].replace(",", ".")) === 16000);
  const xlsx = await ctx.request.get(url(idCab, "HONORAIRES", "xlsx"));
  const octets = await xlsx.body();
  verifier("9g. export Excel : 200 et fichier xlsx valide (PK)", xlsx.status() === 200 && octets[0] === 0x50 && octets[1] === 0x4b);

  const pdf = await ctx.request.get(`${B}/api/compta/partenaires/${idCab}/releve?nature=HONORAIRES`);
  const corps = await pdf.body();
  const dossier = mkdtempSync(join(tmpdir(), "gc9-pdf-"));
  writeFileSync(join(dossier, "releve.pdf"), corps);
  const texte = execFileSync("pdftotext", ["-enc", "UTF-8", "-layout", join(dossier, "releve.pdf"), "-"]).toString("utf8");
  rmSync(dossier, { recursive: true, force: true });
  verifier("9g. PDF : en-tête, partenaire, nature, compensation et payé 3 000", pdf.status() === 200 && corps.subarray(0, 4).toString() === "%PDF" && /RELEVÉ PARTENAIRE/.test(texte) && /Cabinet Compensation/.test(texte) && /Compensation/.test(texte) && /3 000 FCFA/.test(texte), texte.slice(0, 300).replace(/\s+/g, " "));

  const anonyme = await browser.newContext();
  verifier("9g. sans session : export 401, PDF 401", (await anonyme.request.get(url(idCab, "COMMISSION", "csv"), { maxRedirects: 0 })).status() === 401 && (await anonyme.request.get(`${B}/api/compta/partenaires/${idCab}/releve?nature=COMMISSION`, { maxRedirects: 0 })).status() === 401);
  const sansDroit = await contexte(COLLABORATEUR);
  const e403 = (await sansDroit.request.get(url(idCab, "COMMISSION", "csv"), { maxRedirects: 0 })).status();
  const p403 = (await sansDroit.request.get(`${B}/api/compta/partenaires/${idCab}/releve?nature=COMMISSION`, { maxRedirects: 0 })).status();
  verifier("9g. sans cpt.consulter : export et PDF refusés (403)", e403 === 403 && p403 === 403, `${e403} / ${p403}`);
  verifier("9g. nature absente : 400 ; partenaire inconnu : 404", (await ctx.request.get(url(idCab, "X", "csv"))).status() === 400 && (await ctx.request.get(url("inconnu", "COMMISSION", "csv"))).status() === 404 && (await ctx.request.get(`${B}/api/compta/partenaires/inconnu/releve?nature=COMMISSION`)).status() === 404);

  const m = await ouvrir(RFCRH, `/compta/partenaires/${idNovelia}/releve?nature=HONORAIRES`, { width: 390, height: 844 });
  verifier("9g. 390 px : relevé sans défilement horizontal de la page", await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await m.close();
}

verifier("aucune erreur JavaScript", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));
await browser.close();
await db.end();
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\nGC-9 : ${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko === 0 ? 0 : 1);
