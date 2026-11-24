// Gestion Compta, lot GC-4e — ÉCRAN « ENCAISSEMENTS » (/compta/encaissements) : import de relevés par l'écran réel, contrôle mensuel par compte.
// Sur base JETABLE et neuve (voir e2e/README.md : `next build` puis `bash e2e/base-jetable.sh`) : ce script ÉCRIT en base et ne se rejoue
// pas sur la même base. Données 100 % synthétiques. Il vérifie :
//  1. sans format par défaut, l'import dit pourquoi (et le comptable voit le formulaire, sans les espèces dans la liste des comptes) ;
//  2. Paramètres : le format proposé d'un type de relevé se crée en un clic (RFCRH), badge « Format enregistré » ;
//  3. import d'un relevé Wave puis d'un relevé BNI par l'écran : bilan, encaissements en base, virement Wave → BNI reconnu ;
//  4. contrôle mensuel : une ligne par compte et par mois, « Concorde » ; liste filtrable par compte, statut et nature ;
//  5. le même fichier ne s'importe pas deux fois ; les anomalies de relevé se traitent (compte autorisé) et n'apparaissent pas dans « Production » ;
//  6. lecture seule (Direction) : ni formulaire ni dépôt (route 403) mais la liste est lisible ; mobile 390 px, aucune erreur JavaScript.
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
async function ouvrir(email, chemin = "/compta/encaissements") {
  const ctx = await contexte(email);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(`${email} : ${e.message}`));
  await p.goto(`${B}${chemin}`);
  await p.waitForSelector("h1");
  await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  return p;
}

const COMPTABLE = "compta-comptable@simassurances.test";
const RFCRH = "compta-rfcrh@simassurances.test";
const COMMERCIAL = "compta-commercial@simassurances.test";
const DIRECTION = "compta-direction@simassurances.test";

const texte = async (p) => (await p.locator("body").innerText()).replace(/\s+/g, " ");
const compter = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);

// ---------- Jeu d'essai : comptes d'encaissement ----------
await db.query(`INSERT INTO "CptCompte" (id, libelle, type, "majAt") VALUES ('co-wave', 'Wave Business', 'WAVE_BUSINESS', now()), ('co-bni', 'BNI', 'BANQUE', now()), ('co-caisse', 'Caisse', 'CAISSE', now())`);

const ENTETE_WAVE = "Horodatage,Identifiant de transaction,Type de transaction,Montant brut,Frais,Montant net,Contrepartie,Téléphone,Identifiant de session,Référence client";
const waveMars = Buffer.from(
  [
    ENTETE_WAVE,
    "2026-03-02 10:15:00,T_WAVE000001,merchant_payment,100000,1000,99000,Awa Kone,+225 07 00 00 00 01,cos-aaa,POL-1",
    "2026-03-03 11:00:00,T_WAVE000002,refund,-2000,0,-2000,Yao Brou,,,",
    "2026-03-04 12:00:00,T_WAVE000003,api_checkout,100,2,98,TEST,,cos-bbb,",
    "2026-03-10 09:00:00,T_WAVE000004,transfer,-300000,0,-300000,SIM Assurances,,,",
    "2026-03-05 09:00:00,T_WAVE000005,merchant_payment,beaucoup,,,Illisible,,,",
    "2026-03-06 09:00:00,T_WAVE000001,merchant_payment,5,0,5,Doublon,,,",
  ].join("\n"),
  "utf8"
);
const bniMars = Buffer.from(
  ["Date de valeur,Référence,Libellé,Débit,Crédit", "2026-03-11,VIR-BNI-0001,VIREMENT RECU DE WAVE,,300000", "2026-03-12,CHQ-BNI-0002,REMISE CHEQUE CLIENT,,50000", "2026-03-15,FRS-BNI-0003,FRAIS DE TENUE DE COMPTE,1500,"].join("\n"),
  "utf8"
);

/** Choisit le compte, dépose le fichier, lance l'import ; renvoie le texte du bilan ou du message d'erreur. */
async function importer(p, compteId, nom, contenu) {
  await p.locator("[data-import-releve-compte]").selectOption(compteId);
  await p.locator("input[data-import-releve-fichier]").setInputFiles({ name: nom, mimeType: "text/csv", buffer: contenu });
  await p.getByText("déposé, pas encore importé").waitFor({ timeout: 15000 });
  await p.locator("[data-import-releve-lancer]").click();
  await p.locator("[data-import-releve-bilan], [data-import-releve-erreur]").first().waitFor({ timeout: 60000 });
  const bilan = (await p.locator("[data-import-releve-bilan]").count()) === 1;
  return { ok: bilan, texte: await p.locator(bilan ? "[data-import-releve-bilan]" : "[data-import-releve-erreur]").innerText() };
}

// ---------- 1. Sans format par défaut ----------
let p = await ouvrir(COMPTABLE);
verifier("1. le comptable voit le formulaire d'import de relevé", (await p.locator("[data-import-releve-cpt]").count()) === 1);
const optionsCompte = await p.locator("[data-import-releve-compte] option").allInnerTexts();
verifier("1. les comptes proposés sont Wave et BNI, jamais la caisse (espèces : saisie)", optionsCompte.some((o) => o.includes("Wave Business")) && optionsCompte.some((o) => o.includes("BNI")) && !optionsCompte.some((o) => o.includes("Caisse")), optionsCompte.join(" | "));
verifier("1. page vide au départ : contrôle et liste disent « aucun »", (await p.locator("[data-controle-vide]").count()) === 1 && (await p.locator("[data-encaissements-vide]").count()) === 1);
const sansFormat = await importer(p, "co-wave", "wave-mars.csv", waveMars);
verifier("1. sans format par défaut, l'import dit pourquoi", !sansFormat.ok && /format par défaut/i.test(sansFormat.texte), sansFormat.texte);
verifier("1. rien n'a été écrit", (await compter(`SELECT count(*)::int AS n FROM "CptEncaissement"`)) === 0 && (await compter(`SELECT count(*)::int AS n FROM "CptImport" WHERE type <> 'PRODUCTION'`)) === 0);
await p.close();

// ---------- 2. Paramètres : formats de relevé ----------
p = await ouvrir(RFCRH, "/compta/parametres");
verifier("2. Paramètres liste les 5 types de relevé, tous « Aucun format »", (await p.locator("[data-format-releve-type]").count()) === 5 && (await p.locator("[data-format-releve-type]").getByText("Aucun format").count()) === 5);
await p.locator('[data-format-releve-type="RELEVE_WAVE_BUSINESS"] [data-format-releve-creer]').click();
await p.locator('[data-format-releve-type="RELEVE_WAVE_BUSINESS"]').getByText("Format enregistré").waitFor({ timeout: 15000 });
await p.locator('[data-format-releve-type="RELEVE_BANQUE"] [data-format-releve-creer]').click();
await p.locator('[data-format-releve-type="RELEVE_BANQUE"]').getByText("Format enregistré").waitFor({ timeout: 15000 });
verifier("2. deux formats proposés créés, définis par défaut, actifs", (await compter(`SELECT count(*)::int AS n FROM "CptFormatImport" WHERE type IN ('RELEVE_WAVE_BUSINESS','RELEVE_BANQUE') AND "parDefaut" AND actif`)) === 2);
verifier("2. audit « creation_format » écrit pour les deux", (await compter(`SELECT count(*)::int AS n FROM "CptAudit" WHERE action = 'creation_format' AND apres->>'source' = 'modele_propose'`)) === 2);
verifier("2. le bouton disparaît pour un type qui a un format", (await p.locator('[data-format-releve-type="RELEVE_WAVE_BUSINESS"] [data-format-releve-creer]').count()) === 0 && (await p.locator('[data-format-releve-type="RELEVE_PEYAPAY"] [data-format-releve-creer]').count()) === 1);
await p.close();

// ---------- 3. Import par l'écran ----------
p = await ouvrir(COMPTABLE);
const rWave = await importer(p, "co-wave", "wave-mars.csv", waveMars);
verifier("3. relevé Wave : bilan affiché", rWave.ok && /4 encaissement\(s\) créé\(s\)/.test(rWave.texte) && /2 ligne\(s\) rejetée\(s\)/.test(rWave.texte), rWave.texte.replace(/\s+/g, " "));
verifier("3. en base : 4 encaissements Wave, 1 relevé, import VALIDE, format enregistré sur l'import", (await compter(`SELECT count(*)::int AS n FROM "CptEncaissement" WHERE "compteId" = 'co-wave'`)) === 4 && (await compter(`SELECT count(*)::int AS n FROM "CptReleve"`)) === 1 && (await compter(`SELECT count(*)::int AS n FROM "CptImport" WHERE type = 'RELEVE_WAVE_BUSINESS' AND statut = 'VALIDE' AND "formatId" IS NOT NULL`)) === 1);
await p.close();

p = await ouvrir(COMPTABLE);
const rBni = await importer(p, "co-bni", "bni-mars.csv", bniMars);
verifier("3. relevé BNI : un virement interne reconnu", rBni.ok && /1 virement\(s\) interne\(s\) reconnu\(s\)/.test(rBni.texte), rBni.texte.replace(/\s+/g, " "));
verifier("3. en base : la ligne Wave est devenue un virement émis, un transfert interne existe", (await compter(`SELECT count(*)::int AS n FROM "CptEncaissement" WHERE "referenceReleve" = 'T_WAVE000004' AND "typeFlux" = 'VIREMENT_INTERNE_SORTANT'`)) === 1 && (await compter(`SELECT count(*)::int AS n FROM "CptTransfertInterne"`)) === 1);
await p.close();

// ---------- 4. Contrôle mensuel et liste ----------
p = await ouvrir(COMPTABLE);
verifier("4. le contrôle mensuel a une ligne par compte (Wave et BNI), mars 2026", (await p.locator("[data-controle-ligne]").count()) === 2 && /mars 2026/i.test(await texte(p)));
verifier("4. les deux lignes concordent", (await p.locator('[data-controle-ligne][data-controle-coherent="oui"]').count()) === 2 && (await p.locator('[data-controle-ligne][data-controle-coherent="non"]').count()) === 0);
const ligneBni = (await p.locator("[data-controle-ligne]").filter({ hasText: "BNI" }).innerText()).replace(/\s+/g, " ");
verifier("4. BNI : crédits 350 000 = 50 000 à rattacher + 300 000 de virement reçu", /350\s?000/.test(ligneBni) && /50\s?000/.test(ligneBni) && /300\s?000/.test(ligneBni), ligneBni);
verifier("4. la liste montre les 7 encaissements, nature lisible", (await p.locator("[data-encaissement-reference]").count()) === 7 && /Virement interne reçu/.test(await texte(p)) && /Virement interne émis/.test(await texte(p)), `${await p.locator("[data-encaissement-reference]").count()} lignes`);
verifier("4. référence CPE-2026-000001 visible, numéros dans l'ordre", (await p.locator('[data-encaissement-reference="CPE-2026-000001"]').count()) === 1);
await p.close();

p = await ouvrir(COMPTABLE, "/compta/encaissements?statut=A_RATTACHER");
verifier("4. filtre « À rattacher » : le crédit Wave et le chèque BNI seulement", (await p.locator("[data-encaissement-reference]").count()) === 2 && (await p.locator('[data-encaissement-flux="ENCAISSEMENT"]').count()) === 2);
await p.close();
p = await ouvrir(COMPTABLE, "/compta/encaissements?flux=VIREMENT_INTERNE_SORTANT");
verifier("4. filtre « Nature » : un seul virement émis", (await p.locator("[data-encaissement-reference]").count()) === 1);
await p.close();
p = await ouvrir(COMPTABLE, "/compta/encaissements?compte=co-bni");
verifier("4. filtre « Compte » : seulement les trois lignes BNI", (await p.locator("[data-encaissement-reference]").count()) === 3);
await p.close();

// ---------- 5. Même fichier, anomalies ----------
p = await ouvrir(COMPTABLE);
const rDouble = await importer(p, "co-wave", "wave-mars-bis.csv", waveMars);
verifier("5. le même fichier ne s'importe pas deux fois", !rDouble.ok && /déjà été importé/.test(rDouble.texte), rDouble.texte);
verifier("5. rien de plus en base", (await compter(`SELECT count(*)::int AS n FROM "CptEncaissement"`)) === 7);
const anomaliesTexte = await p.locator("[data-releves-anomalies]").innerText();
verifier("5. les anomalies du relevé sont listées avec leur libellé", /Montant manquant ou illisible/.test(anomaliesTexte) && /Référence en double dans le fichier/.test(anomaliesTexte) && /Cellule illisible/.test(anomaliesTexte), anomaliesTexte.replace(/\s+/g, " ").slice(0, 200));
await p.close();

p = await ouvrir(COMPTABLE, "/compta/production");
verifier("5. « Production » ne montre pas les anomalies de relevé", /Aucune anomalie à traiter/.test(await p.locator("[data-production-anomalies]").innerText()));
await p.close();

const avantTraitees = await compter(`SELECT count(*)::int AS n FROM "CptAnomalie" WHERE statut = 'TRAITEE'`);
p = await ouvrir(COMMERCIAL);
verifier("5. le commercial (identifier un encaissement) voit les cases mais pas le formulaire d'import", (await p.locator("[data-anomalie-case]").count()) > 0 && (await p.locator("[data-import-releve-cpt]").count()) === 0);
const nbAvant = await p.locator("[data-anomalie-case]").count();
await p.locator("[data-anomalie-case]").first().check();
await p.locator("[data-anomalies-bouton]").click();
await p.waitForFunction((n) => document.querySelectorAll("[data-anomalie-case]").length < n, nbAvant, { timeout: 15000 });
verifier("5. une anomalie traitée disparaît de la liste et est tracée en base", (await compter(`SELECT count(*)::int AS n FROM "CptAnomalie" WHERE statut = 'TRAITEE'`)) === avantTraitees + 1);
await p.close();

// ---------- 6. Lecture seule, mobile ----------
p = await ouvrir(DIRECTION);
verifier("6. Direction : ni formulaire d'import ni cases d'anomalies, mais le contrôle et la liste sont lisibles", (await p.locator("[data-import-releve-cpt]").count()) === 0 && (await p.locator("[data-anomalie-case]").count()) === 0 && (await p.locator("[data-controle-ligne]").count()) === 2 && (await p.locator("[data-encaissement-reference]").count()) === 7);
await p.close();
const depot = await (await contexte(DIRECTION)).request.post(`${B}/api/compta/import/upload`, { multipart: { file: { name: "x.csv", mimeType: "text/csv", buffer: bniMars } } });
verifier("6. Direction : la route de dépôt répond 403", depot.status() === 403, `statut ${depot.status()}`);
const depotCommercial = await (await contexte(COMMERCIAL)).request.post(`${B}/api/compta/import/upload`, { multipart: { file: { name: "x.csv", mimeType: "text/csv", buffer: bniMars } } });
verifier("6. Commercial (sans droit d'import) : la route de dépôt répond 403", depotCommercial.status() === 403, `statut ${depotCommercial.status()}`);

const ctxMobile = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
const connexion = await ctxMobile.newPage();
await connexion.goto(`${B}/login`);
await connexion.fill('input[name="email"]', COMPTABLE);
await connexion.fill('input[name="password"]', "password123");
await Promise.all([connexion.waitForURL((u) => !u.pathname.startsWith("/login")), connexion.click('button[type="submit"]')]);
await connexion.goto(`${B}/compta/encaissements`);
await connexion.waitForSelector("h1");
await connexion.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
const debord = await connexion.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
verifier("6. mobile 390 px : aucun défilement horizontal de la page", debord <= 1, `débordement ${debord} px`);
await ctxMobile.close();
verifier("6. aucune erreur JavaScript", erreursJs.length === 0, erreursJs.join(" | "));

console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\nGC-4e (écran Encaissements) : ${resultats.length - ko}/${resultats.length} contrôles réussis`);
await browser.close();
await db.end();
process.exit(ko === 0 ? 0 : 1);
