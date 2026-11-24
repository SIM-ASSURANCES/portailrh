// Gestion Compta, lot GC-2c — ÉCRANS DES RÉFÉRENTIELS (/compta/referentiels) : partenaires, clients, produits, comptes, taux de taxe, conventions.
// Sur base JETABLE et neuve (voir e2e/README.md : `next build` puis `bash e2e/base-jetable.sh`) : ce script ÉCRIT en base et ne se rejoue pas
// sur la même base (les noms créés existeraient déjà).
//  1. droits d'écriture par rôle (formulaires visibles ou « Consultation seule ») ;
//  2. création et erreurs par champ de chaque référentiel, depuis l'écran réel ;
//  3. taux datés (jamais modifiés : remplacé / en vigueur / à venir) et conventions (chevauchement refusé, clôture, honoraires proposés) ;
//  4. désactivation, code d'un produit immuable, audit `CptAudit` ;
//  5. refus SERVEUR par rejeu de la Server Action avec la session d'un rôle non autorisé ; deux envois simultanés (verrou) ;
//  6. mobile sans défilement horizontal, aucune erreur JavaScript.
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
async function ouvrir(email, onglet) {
  const ctx = await contexte(email);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(`${email} : ${e.message}`));
  await p.goto(`${B}/compta/referentiels?onglet=${onglet}`);
  await p.waitForSelector("h1");
  await p.waitForLoadState("networkidle");
  return p;
}

const RFCRH = "compta-rfcrh@simassurances.test";
const PRODUCTION = "compta-production@simassurances.test";
const COMMERCIAL = "compta-commercial@simassurances.test";
const DIRECTION = "compta-direction@simassurances.test";
const ONGLETS = ["partenaires", "clients", "produits", "comptes", "taux", "conventions"];

const texte = async (p) => (await p.locator("body").innerText()).replace(/\s+/g, " ");
const formulaire = (p, titre) => p.locator(`form[data-formulaire-cpt="${titre}"]`);

/** Remplit un formulaire (texte, liste ou case selon l'élément) puis l'envoie ; renvoie la requête de Server Action émise. */
async function remplirEtEnvoyer(p, titre, valeurs) {
  const f = formulaire(p, titre);
  await f.waitFor();
  for (const [nom, valeur] of Object.entries(valeurs)) {
    const champ = f.locator(`[name="${nom}"]`);
    const type = await champ.evaluate((el) => (el.tagName === "SELECT" ? "select" : el.getAttribute("type")));
    if (type === "select") await champ.selectOption(valeur);
    else if (type === "checkbox") await (valeur ? champ.check() : champ.uncheck());
    else await champ.fill(valeur);
  }
  const [requete] = await Promise.all([
    p.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]),
    f.locator('button[type="submit"]').click(),
  ]);
  await p.waitForLoadState("networkidle");
  await p.waitForTimeout(400);
  return requete;
}

async function aEcran(p, extrait) {
  return (await texte(p)).includes(extrait);
}

/** Rejoue une Server Action capturée avec la session d'un autre compte (mêmes en-têtes, corps éventuellement modifié). */
async function rejouer(email, requete, modifier) {
  const ctx = await contexte(email);
  const corps = JSON.parse(requete.postData());
  const donnees = modifier ? modifier(corps) : corps;
  const rep = await ctx.request.post(requete.url(), {
    headers: { "next-action": requete.headers()["next-action"], "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", origin: B },
    data: JSON.stringify(donnees),
  });
  return rep.text();
}

const compter = async (table, where = "TRUE") => Number((await db.query(`SELECT count(*)::int AS n FROM "${table}" WHERE ${where}`)).rows[0].n);

// ---------- 1. Droits d'écriture par rôle ----------
{
  const p = await ouvrir(RFCRH, "partenaires");
  const onglets = await p.$$eval("[data-onglet-compta]", (els) => els.map((e) => e.getAttribute("data-onglet-compta")));
  verifier("1. RFCRH : les sept onglets sont présents (six référentiels + correspondances Odoo, GC-2e)", JSON.stringify(onglets) === JSON.stringify([...ONGLETS, "odoo"]), JSON.stringify(onglets));
  for (const o of ONGLETS) {
    await p.goto(`${B}/compta/referentiels?onglet=${o}`);
    await p.waitForLoadState("networkidle");
    verifier(`1. RFCRH : un formulaire de création sur l'onglet ${o}`, (await p.locator("form[data-formulaire-cpt]").count()) === 1);
  }
  await p.close();

  const dir = await ouvrir(DIRECTION, "partenaires");
  verifier("1. Direction : accès en lecture (titre « Référentiels »)", (await dir.locator("h1").first().innerText()).trim() === "Référentiels");
  for (const o of ONGLETS) {
    await dir.goto(`${B}/compta/referentiels?onglet=${o}`);
    await dir.waitForLoadState("networkidle");
    verifier(`1. Direction : aucun formulaire sur ${o}, « Consultation seule » affichée`, (await dir.locator("form[data-formulaire-cpt]").count()) === 0 && (await aEcran(dir, "Consultation seule")));
  }
  await dir.close();

  for (const [nom, email] of [["Production", PRODUCTION], ["Commercial", COMMERCIAL]]) {
    const c = await ouvrir(email, "clients");
    verifier(`1. ${nom} : peut saisir un client (formulaire présent)`, (await c.locator("form[data-formulaire-cpt]").count()) === 1);
    for (const o of ["partenaires", "produits", "comptes", "taux", "conventions"]) {
      await c.goto(`${B}/compta/referentiels?onglet=${o}`);
      await c.waitForLoadState("networkidle");
      verifier(`1. ${nom} : aucun formulaire sur ${o}`, (await c.locator("form[data-formulaire-cpt]").count()) === 0);
    }
    await c.close();
  }
}

// ---------- 2. Partenaires ----------
const pp = await ouvrir(RFCRH, "partenaires");
const captPartenaire = await remplirEtEnvoyer(pp, "Ajouter un partenaire", { nom: "Courtier Alpha", estApporteur: true, estGestionnaire: true, tiersOdoo: "T-ALPHA" });
verifier("2. partenaire créé et affiché", (await aEcran(pp, "Courtier Alpha")) && (await compter("CptPartenaire", `nom = 'Courtier Alpha'`)) === 1);
await remplirEtEnvoyer(pp, "Ajouter un partenaire", { nom: "courtier   ALPHA", estApporteur: true });
verifier("2. doublon de nom (casse et espaces ignorés) refusé", (await aEcran(pp, "existe déjà")) && (await compter("CptPartenaire")) === 1);
// Après une erreur le formulaire garde ses valeurs : les cases sont décochées explicitement à chaque envoi.
const AUCUN_ROLE = { estApporteur: false, estBeneficiaire: false, estGestionnaire: false, estClient: false };
await remplirEtEnvoyer(pp, "Ajouter un partenaire", { nom: "Sans rôle", ...AUCUN_ROLE });
verifier("2. aucun rôle coché : erreur par champ, rien écrit", (await aEcran(pp, "cochez au moins un rôle")) && (await compter("CptPartenaire")) === 1);
await remplirEtEnvoyer(pp, "Ajouter un partenaire", { nom: "X", ...AUCUN_ROLE, estClient: true });
verifier("2. nom trop court refusé", (await aEcran(pp, "2 caractères au moins")) && (await compter("CptPartenaire")) === 1);
await remplirEtEnvoyer(pp, "Ajouter un partenaire", { nom: "Bénéficiaire Beta", ...AUCUN_ROLE, estBeneficiaire: true, tiersOdoo: "" });
verifier("2. second partenaire créé", (await compter("CptPartenaire")) === 2);

// Modification
await pp.locator('[data-referentiel="partenaires"] button[data-action="modifier"]:visible').first().click();
await remplirEtEnvoyer(pp, "Modifier le partenaire", { coordonnees: "Plateau, Abidjan" });
verifier("2. modification enregistrée", (await compter("CptPartenaire", `coordonnees = 'Plateau, Abidjan'`)) === 1);
verifier("2. audit : création ×2 et modification ×1", (await compter("CptAudit", `entite = 'CptPartenaire' AND action = 'creation'`)) === 2 && (await compter("CptAudit", `entite = 'CptPartenaire' AND action = 'modification'`)) === 1);

// Désactivation / réactivation
await pp.getByRole("button", { name: "Désactiver" }).first().click();
await pp.waitForLoadState("networkidle");
await pp.waitForTimeout(400);
verifier("4. désactivation d'un partenaire (badge et base)", (await aEcran(pp, "Désactivé")) && (await compter("CptPartenaire", `actif = false`)) === 1);
await pp.getByRole("button", { name: "Réactiver" }).first().click();
await pp.waitForLoadState("networkidle");
await pp.waitForTimeout(400);
verifier("4. réactivation", (await compter("CptPartenaire", `actif = false`)) === 0);
verifier("4. audit : activation et désactivation tracées", (await compter("CptAudit", `entite = 'CptPartenaire' AND action IN ('activation','desactivation')`)) === 2);
await pp.close();

// ---------- 2. Produits ----------
const pr = await ouvrir(RFCRH, "produits");
const reqProduit = await remplirEtEnvoyer(pr, "Ajouter un produit", { code: "secur-pro", libelle: "Sécurité Pro", branche: "ACCIDENTS", tarifReference: "25 000" });
const produit = (await db.query(`SELECT code, "tarifReference"::text AS tarif FROM "CptProduit"`)).rows;
verifier("2. produit créé : code en majuscules, tarif canonique", produit.length === 1 && produit[0].code === "SECUR-PRO" && produit[0].tarif === "25000.00", JSON.stringify(produit));
await remplirEtEnvoyer(pr, "Ajouter un produit", { code: "SECUR-PRO", libelle: "Autre", branche: "SANTE" });
verifier("2. code en double refusé", (await aEcran(pr, "existe déjà")) && (await compter("CptProduit")) === 1);
await remplirEtEnvoyer(pr, "Ajouter un produit", { code: "a", libelle: "Court", branche: "SANTE" });
verifier("2. code invalide refusé", (await aEcran(pr, "2 à 30 caractères")) && (await compter("CptProduit")) === 1);
await remplirEtEnvoyer(pr, "Ajouter un produit", { code: "SANTE-1", libelle: "Santé 1", branche: "SANTE", tarifReference: "abc" });
verifier("2. tarif illisible refusé", (await aEcran(pr, "Tarif de référence")) && (await compter("CptProduit")) === 1);
await remplirEtEnvoyer(pr, "Ajouter un produit", { code: "SANTE-1", libelle: "Santé 1", branche: "SANTE", tarifReference: "" });
verifier("2. second produit créé", (await compter("CptProduit")) === 2);

// Code immuable : on rejoue la modification avec un autre code
await pr.locator('[data-referentiel="produits"] button[data-action="modifier"]:visible').first().click();
verifier("4. produit : le champ « Code » est verrouillé en modification", await formulaire(pr, "Modifier le produit").locator('[name="code"]').isDisabled());
const reqModifProduit = await remplirEtEnvoyer(pr, "Modifier le produit", { libelle: "Libellé modifié" });
verifier("2. modification d'un produit", (await compter("CptProduit", `libelle = 'Libellé modifié'`)) === 1);
const codeModifie = (await db.query(`SELECT code FROM "CptProduit" WHERE libelle = 'Libellé modifié'`)).rows[0].code;
const repCode = await rejouer(RFCRH, reqModifProduit, (c) => [c[0], { ...c[1], code: "PIRATE" }]);
verifier("4. code immuable : un code différent envoyé est ignoré", (await compter("CptProduit", `code = 'PIRATE'`)) === 0 && (await compter("CptProduit", `code = '${codeModifie}'`)) === 1, repCode.slice(0, 120));
await pr.close();

// ---------- 2. Comptes ----------
const pc = await ouvrir(RFCRH, "comptes");
await remplirEtEnvoyer(pc, "Ajouter un compte d'encaissement", { libelle: "Wave principal", type: "WAVE_BUSINESS", journalOdoo: "WAV" });
verifier("2. compte créé", (await compter("CptCompte", `libelle = 'Wave principal'`)) === 1);
await pc.close();

// ---------- 2. Clients ----------
const alpha = (await db.query(`SELECT id FROM "CptPartenaire" WHERE nom = 'Courtier Alpha'`)).rows[0].id;
const beta = (await db.query(`SELECT id FROM "CptPartenaire" WHERE nom = 'Bénéficiaire Beta'`)).rows[0].id;
const pcl = await ouvrir(RFCRH, "clients");
await remplirEtEnvoyer(pcl, "Ajouter un client", { nom: "Aya Koné", telephone: "12" });
verifier("2. téléphone illisible refusé", (await aEcran(pcl, "8 à 15 chiffres")) && (await compter("CptClient")) === 0);
await remplirEtEnvoyer(pcl, "Ajouter un client", { nom: "Aya Koné", telephone: "+225 07 00 00 00 01", partenaireOrigineId: alpha });
const client = (await db.query(`SELECT nom, telephone FROM "CptClient"`)).rows;
verifier("2. client créé, téléphone normalisé", client.length === 1 && client[0].telephone === "+2250700000001", JSON.stringify(client));
await pcl.close();
// Un compte qui peut seulement identifier un encaissement saisit un client
const pco = await ouvrir(COMMERCIAL, "clients");
await remplirEtEnvoyer(pco, "Ajouter un client", { nom: "Client Commercial" });
verifier("1. Commercial : création d'un client réussie", (await compter("CptClient", `nom = 'Client Commercial'`)) === 1);
await pco.close();

// ---------- 3. Taux de taxe ----------
const pt = await ouvrir(RFCRH, "taux");
const reqTaux = await remplirEtEnvoyer(pt, "Ajouter un taux de taxe", { branche: "ACCIDENTS", taux: "7,25", dateEffet: "2025-01-01" });
const t1 = (await db.query(`SELECT taux::text AS taux FROM "CptTauxTca"`)).rows;
verifier("3. taux enregistré en fraction exacte (7,25 % → 0.072500)", t1.length === 1 && t1[0].taux === "0.072500", JSON.stringify(t1));
await remplirEtEnvoyer(pt, "Ajouter un taux de taxe", { branche: "ACCIDENTS", taux: "8", dateEffet: "2025-01-01" });
verifier("3. même portée, même date : refusé (un taux ne se modifie pas)", (await aEcran(pt, "ne se modifie pas")) && (await compter("CptTauxTca")) === 1);
await remplirEtEnvoyer(pt, "Ajouter un taux de taxe", { branche: "ACCIDENTS", taux: "8", dateEffet: "2025-06-01" });
await remplirEtEnvoyer(pt, "Ajouter un taux de taxe", { branche: "ACCIDENTS", taux: "9", dateEffet: "2099-01-01" });
verifier("3. trois taux dans l'historique de la portée", (await compter("CptTauxTca")) === 3);
// Le tableau seulement : la phrase d'aide au-dessus cite aussi le mot « Remplacé ».
const etats = (await pt.locator('[data-referentiel="taux"]').innerText()).match(/Remplacé|En vigueur|À venir/g) ?? [];
verifier("3. états : un remplacé, un en vigueur, un à venir", etats.filter((e) => e === "Remplacé").length === 1 && etats.filter((e) => e === "En vigueur").length === 1 && etats.filter((e) => e === "À venir").length === 1, JSON.stringify(etats));
await remplirEtEnvoyer(pt, "Ajouter un taux de taxe", { branche: "ACCIDENTS", taux: "100,5", dateEffet: "2025-09-01" });
verifier("3. taux au-dessus de 100 % refusé", (await aEcran(pt, "100")) && (await compter("CptTauxTca")) === 3);
await remplirEtEnvoyer(pt, "Ajouter un taux de taxe", { branche: "SANTE", produitCode: "SECUR-PRO", taux: "5", dateEffet: "2025-01-01" });
verifier("3. produit d'une autre branche refusé", (await aEcran(pt, "relève de la branche")) && (await compter("CptTauxTca")) === 3);
await remplirEtEnvoyer(pt, "Ajouter un taux de taxe", { branche: "ACCIDENTS", produitCode: "SECUR-PRO", natureContrat: "GROUPE", taux: "3", dateEffet: "2025-01-01" });
verifier("3. taux propre à un produit et une nature accepté", (await compter("CptTauxTca", `"produitCode" = 'SECUR-PRO' AND "natureContrat" = 'GROUPE'`)) === 1);
const triggerTaux = await db.query(`UPDATE "CptTauxTca" SET taux = 0.5 WHERE true`).then(() => false, () => true);
verifier("3. la base interdit toute modification d'un taux", triggerTaux);
await pt.close();

// ---------- 3. Conventions ----------
const pv = await ouvrir(RFCRH, "conventions");
const base = { partenaireId: alpha, nature: "COMMISSION", taux: "10", base: "PRIME_NETTE", faitGenerateur: "EMISSION", modeReglement: "EN_UNE_FOIS" };
const reqConv = await remplirEtEnvoyer(pv, "Ajouter une convention de rémunération", { ...base, dateEffet: "2025-01-01" });
const conv1 = (await db.query(`SELECT taux::text AS taux, "dateFin" FROM "CptConvention"`)).rows;
verifier("3. convention créée (taux 10 % → 0.100000, ouverte)", conv1.length === 1 && conv1[0].taux === "0.100000" && conv1[0].dateFin === null, JSON.stringify(conv1));
await remplirEtEnvoyer(pv, "Ajouter une convention de rémunération", { ...base, taux: "12", dateEffet: "2025-06-01" });
verifier("3. chevauchement de même portée refusé", (await aEcran(pv, "fixez d'abord sa date de fin")) && (await compter("CptConvention")) === 1);
await remplirEtEnvoyer(pv, "Ajouter une convention de rémunération", { ...base, taux: "12", produitCode: "SECUR-PRO", dateEffet: "2025-06-01" });
verifier("3. un produit précis ne chevauche pas « tous produits »", (await compter("CptConvention")) === 2);

// Clôture : date avant l'effet refusée, puis acceptée
const ligneAlpha = pv.locator('[data-referentiel="conventions"] tr', { hasText: "Tous produits" }).first();
await ligneAlpha.locator('button[data-action="cloturer"]').click();
await ligneAlpha.locator('input[type="date"]').fill("2024-12-31");
await ligneAlpha.getByRole("button", { name: "Confirmer" }).click();
await pv.waitForLoadState("networkidle");
await pv.waitForTimeout(400);
verifier("3. date de fin avant la date d'effet refusée", (await aEcran(pv, "ne peut pas précéder")) && (await compter("CptConvention", `"dateFin" IS NOT NULL`)) === 0);
await ligneAlpha.locator('input[type="date"]').fill("2025-05-31");
await ligneAlpha.getByRole("button", { name: "Confirmer" }).click();
await pv.waitForLoadState("networkidle");
await pv.waitForTimeout(400);
verifier("3. convention clôturée au 31/05/2025", (await compter("CptConvention", `"dateFin" = '2025-05-31'`)) === 1);
verifier("3. audit : clôture tracée avec avant/après", (await compter("CptAudit", `entite = 'CptConvention' AND action = 'cloture' AND avant IS NOT NULL AND apres IS NOT NULL`)) === 1);
await remplirEtEnvoyer(pv, "Ajouter une convention de rémunération", { ...base, taux: "12", dateEffet: "2025-06-01" });
verifier("3. nouvelle convention acceptée après la clôture", (await compter("CptConvention")) === 3);

// Honoraires : le fait générateur est proposé selon l'apporteur
const f = formulaire(pv, "Ajouter une convention de rémunération");
await f.locator('[name="nature"]').selectOption("HONORAIRES");
await f.locator('[name="apporteurId"]').selectOption(alpha);
verifier("3. honoraires + apporteur gestionnaire : fait générateur proposé « À l'encaissement »", (await f.locator('[name="faitGenerateur"]').inputValue()) === "ENCAISSEMENT");
await f.locator('[name="apporteurId"]').selectOption(beta);
verifier("3. honoraires + autre apporteur : fait générateur proposé « À l'émission »", (await f.locator('[name="faitGenerateur"]').inputValue()) === "EMISSION");
await pv.close();

// ---------- 5. Refus serveur par rejeu ----------
const refus = (corps) => /Action non autorisée\./.test(corps);
const avantPartenaires = await compter("CptPartenaire");
for (const [nom, email] of [["Direction", DIRECTION], ["Production", PRODUCTION], ["Commercial", COMMERCIAL]]) {
  const corps = await rejouer(email, captPartenaire, (c) => [{ ...c[0], nom: `Pirate ${nom}` }]);
  verifier(`5. ${nom} : création d'un partenaire refusée par le serveur`, refus(corps) && (await compter("CptPartenaire", `nom = 'Pirate ${nom}'`)) === 0);
}
verifier("5. aucun partenaire créé par les rejeux", (await compter("CptPartenaire")) === avantPartenaires);
const corpsTaux = await rejouer(PRODUCTION, reqTaux, (c) => [{ ...c[0], dateEffet: "2031-01-01" }]);
verifier("5. Production : création d'un taux refusée par le serveur", refus(corpsTaux) && (await compter("CptTauxTca", `"dateEffet" = '2031-01-01'`)) === 0);
const corpsConv = await rejouer(PRODUCTION, reqConv, (c) => [{ ...c[0], dateEffet: "2031-01-01" }]);
verifier("5. Production : création d'une convention refusée par le serveur", refus(corpsConv) && (await compter("CptConvention", `"dateEffet" = '2031-01-01'`)) === 0);
const corpsConvDir = await rejouer(DIRECTION, reqConv, (c) => [{ ...c[0], dateEffet: "2031-01-01" }]);
verifier("5. Direction : création d'une convention refusée par le serveur", refus(corpsConvDir));
const corpsProduit = await rejouer(COMMERCIAL, reqProduit, (c) => [{ ...c[0], code: "PIRATE2" }]);
verifier("5. Commercial : création d'un produit refusée par le serveur", refus(corpsProduit) && (await compter("CptProduit", `code = 'PIRATE2'`)) === 0);

// Deux envois simultanés : le verrou sérialise, un seul passe
const [a, b] = await Promise.all([
  rejouer(RFCRH, reqTaux, (c) => [{ ...c[0], taux: "6", dateEffet: "2030-03-03" }]),
  rejouer(RFCRH, reqTaux, (c) => [{ ...c[0], taux: "7", dateEffet: "2030-03-03" }]),
]);
verifier("5. deux taux simultanés de même portée et date : un seul enregistré", (await compter("CptTauxTca", `"dateEffet" = '2030-03-03'`)) === 1, `${a.length}/${b.length}`);
const [c1, c2] = await Promise.all([
  rejouer(RFCRH, reqConv, (c) => [{ ...c[0], partenaireId: beta, nature: "ACCESSOIRES", dateEffet: "2026-01-01", dateFin: "" }]),
  rejouer(RFCRH, reqConv, (c) => [{ ...c[0], partenaireId: beta, nature: "ACCESSOIRES", dateEffet: "2026-03-01", dateFin: "" }]),
]);
verifier("5. deux conventions simultanées qui se chevauchent : une seule enregistrée", (await compter("CptConvention", `"partenaireId" = '${beta}'`)) === 1, `${c1.length}/${c2.length}`);

// ---------- 6. Mobile, erreurs JavaScript ----------
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
const pm = await mobile.newPage();
await pm.goto(`${B}/login`);
await pm.fill('input[name="email"]', RFCRH);
await pm.fill('input[name="password"]', "password123");
await Promise.all([pm.waitForURL((u) => !u.pathname.startsWith("/login")), pm.click('button[type="submit"]')]);
for (const o of ["partenaires", "taux", "conventions"]) {
  await pm.goto(`${B}/compta/referentiels?onglet=${o}`);
  await pm.waitForSelector("h1");
  await pm.waitForLoadState("networkidle");
  const larg = await pm.evaluate(() => ({ doc: document.documentElement.scrollWidth, vue: window.innerWidth }));
  verifier(`6. mobile 390 px : ${o} sans défilement horizontal`, larg.doc <= larg.vue, JSON.stringify(larg));
}
await mobile.close();
verifier("6. aucune erreur JavaScript dans les pages visitées", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));

for (const ctx of sessions.values()) await ctx.close();
await browser.close();
await db.end();

console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\nGC-2c : ${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko === 0 ? 0 : 1);
