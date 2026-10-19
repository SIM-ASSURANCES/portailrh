// Lot I (changements demandés par le DG) — sur base JETABLE (voir e2e/README.md). Nécessite `pdftotext` et exceljs.
//   1. Libellé « Montant retourné » du retour de caisse (écran Finance, écran du collaborateur, reçu PDF).
//   2. Motif / nature du règlement obligatoire (5 caractères), caisse comme banque : serveur ET écran ; affiché dans le parcours
//      de l'article, le reçu, l'historique et le reporting ; anciens règlements « Non renseigné », jamais bloqués ni modifiés.
//   3. Catégorisation obligatoire À PARTIR D'UNE DATE (paramètre de la Finance, historisé, nul = jamais) : avant / après / nul.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { chromium } from "playwright";
import pg from "pg";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/i.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");

const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const erreursJs = [];
const attendre = async (fn, ms = 15000) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};
const net = (t) => t.replace(/ | /g, " ").replace(/\s+/g, " ");
const dossier = mkdtempSync(join(tmpdir(), "loti-"));
const pdfTexte = async (reponse, nom) => {
  const f = join(dossier, nom);
  writeFileSync(f, await reponse.body());
  return net(execFileSync("pdftotext", ["-layout", f, "-"]).toString());
};

const P = "e2e-loti-";
const CLE = "categorisation.obligatoire_a_partir_du";
const nettoyer = async () => {
  await q(`UPDATE "ParametreTresorerie" SET "valeurDate" = NULL, "majParId" = NULL WHERE cle = $1`, [CLE]);
  await q(`DELETE FROM "HistoriqueEntry" WHERE entity = 'ParametreTresorerie' OR "entityId" LIKE '${P}%' OR detail LIKE '%DEM-LOTI-%'`);
  await q(`DELETE FROM "Notification" WHERE message LIKE '%DEM-LOTI-%'`);
  await q(`DELETE FROM "JournalCaisse" WHERE id LIKE '${P}%' OR "demandeId" LIKE '${P}%' OR "refId" IN (SELECT id FROM "Reglement" WHERE "demandeId" LIKE '${P}%')`);
  await q(`DELETE FROM "DepenseLigne" WHERE "retourCaisseId" IN (SELECT id FROM "RetourCaisse" WHERE "reglementId" IN (SELECT id FROM "Reglement" WHERE "demandeId" LIKE '${P}%'))`);
  await q(`DELETE FROM "RetourCaisse" WHERE "reglementId" IN (SELECT id FROM "Reglement" WHERE "demandeId" LIKE '${P}%')`);
  await q(`DELETE FROM "JournalBanque" WHERE "reglementId" IN (SELECT id FROM "Reglement" WHERE "demandeId" LIKE '${P}%')`);
  await q(`DELETE FROM "ReglementCategorieAllocation" WHERE "reglementId" IN (SELECT id FROM "Reglement" WHERE "demandeId" LIKE '${P}%')`);
  await q(`DELETE FROM "Reglement" WHERE "demandeId" LIKE '${P}%'`);
  await q(`DELETE FROM "LigneDemande" WHERE "demandeId" LIKE '${P}%'`);
  await q(`DELETE FROM "Demande" WHERE id LIKE '${P}%'`);
};
await nettoyer();

const uid = async (email) => (await q(`SELECT id FROM "User" WHERE email = $1`, [email]))[0].id;
const idCollab = await uid("collaborateur@simassurances.test");
const idFinance = await uid("finance@simassurances.test");
const idAssistant = await uid("assistant-finance@simassurances.test");

const sessions = new Map();
async function connecter(email) {
  let ctx = sessions.get(email);
  if (!ctx) {
    ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
    const connexion = await ctx.newPage();
    connexion.on("pageerror", (e) => erreursJs.push(e.message));
    await connexion.goto(`${B}/login`);
    await connexion.fill('input[name="email"]', email);
    await connexion.fill('input[name="password"]', "password123");
    await Promise.all([connexion.waitForURL((u) => !u.pathname.startsWith("/login")), connexion.click('button[type="submit"]')]);
    await connexion.close();
    sessions.set(email, ctx);
  }
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(e.message));
  return p;
}
const jourIso = (decalage) => new Date(Date.now() + decalage * 86400000).toISOString().slice(0, 10);
const journalEmpreinte = async () => (await q(`SELECT COALESCE(md5(string_agg(id || ':' || type || ':' || montant::text, ',' ORDER BY id)), '') AS h, count(*)::int AS n FROM "JournalCaisse"`))[0];

await q(`INSERT INTO "Categorie"(id, label, "isActive") VALUES ('e2e-loti-cat', 'E2E-LOTI-CAT', true) ON CONFLICT (id) DO NOTHING`);
await q(`INSERT INTO "JournalCaisse"(id, type, montant, source, "refId", "userId") VALUES ('e2e-loti-appro', 'ENTREE', 3000000, 'alimentation_caisse', 'e2e-loti-appro', $1)`, [idAssistant]);

/** Demande à UN article en attente de décision de la Finance (étape Finance), sans catégorie. */
async function demandeEnAttente(suffixe, numero) {
  const D = `${P}${suffixe}`;
  await q(
    `INSERT INTO "Demande"(id, reference, montant, "montantValide", statut, "createurId", "updatedAt", "beneficiaireType", "beneficiaireUserId", "etapeCircuit", "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", description)
     VALUES ($1, $2, 40000, 0, 'EN_ATTENTE_VALIDATION', $3, now(), 'COLLABORATEUR', $3, 'FINANCE', true, false, 'OPTIONNELLE', 'test e2e lot I')`,
    [D, `DEM-LOTI-${numero}`, idCollab]
  );
  await q(
    `INSERT INTO "LigneDemande"(id, libelle, "libelleOriginal", quantite, "prixUnitaire", "demandeId", motif) VALUES ($1, $2, $2, 1, 40000, $3, 'motif e2e')`,
    [`${D}-l1`, `ARTICLE ${suffixe}`, D]
  );
  return { D, L: `${D}-l1` };
}
/** Valide l'unique article par l'écran. */
async function validerParEcran(page, D) {
  await page.goto(`${B}/treso/finance/demandes/${D}`);
  const valider = page.getByRole("button", { name: "Valider", exact: true });
  await valider.click();
  const enregistrer = page.getByRole("button", { name: "Enregistrer les décisions" });
  await enregistrer.click();
}
/** Identifiant d'une Server Action, lu dans les scripts client de la page (ils portent le nom de la fonction). */
async function idAction(page, nom) {
  const ressources = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name).filter((u) => u.includes("/_next/static/") && u.endsWith(".js")));
  for (const url of ressources) {
    const texte = await (await fetch(url)).text();
    const m = new RegExp(`createServerReference\\)?\\(\\s*"([0-9a-f]{20,})"[^)]*?"${nom}"`).exec(texte);
    if (m) return m[1];
  }
  return null;
}
/** Appel DIRECT d'une Server Action (sans passer par l'écran : le grisage des boutons ne protège de rien). */
async function appelerAction(page, id, args) {
  const r = await page.context().request.post(page.url(), {
    headers: { "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" },
    data: JSON.stringify(args),
  });
  const texte = await r.text();
  return { succes: /"status":"success"/.test(texte), message: /"message":"((?:[^"\\]|\\.)*)"/.exec(texte)?.[1] ?? texte.slice(0, 200) };
}
const ligneDe = async (L) => (await q(`SELECT "statutValidation", "categorieId" FROM "LigneDemande" WHERE id = $1`, [L]))[0];

// ======================================================================================================================
// 3. CATÉGORISATION OBLIGATOIRE À PARTIR D'UNE DATE
// ======================================================================================================================
const caisseEmpreinte0 = await journalEmpreinte();
{
  const param = (await q(`SELECT "valeurDate" FROM "ParametreTresorerie" WHERE cle = $1`, [CLE]))[0];
  verifier("3. migration : le paramètre existe et vaut NUL (rien n'est bloqué au déploiement)", !!param && param.valeurDate === null);

  const finance = await connecter("finance@simassurances.test");
  // 3a. Date nulle : valider sans catégorie passe.
  const d1 = await demandeEnAttente("D1", 1);
  await finance.goto(`${B}/treso/finance/demandes/${d1.D}`);
  const raisonsNul = net(await finance.locator("body").innerText());
  verifier("3a. date nulle : « Valider » n'est pas grisé pour un article sans catégorie", await finance.getByRole("button", { name: "Valider", exact: true }).isEnabled());
  verifier("3a. date nulle : aucune phrase « Catégorisez… avant de la valider / de la soumettre au DG »", !/Catégorisez cet article avant de le soumettre au DG/.test(raisonsNul) && (await finance.locator("[data-sans-categorie]").count()) === 0);
  await validerParEcran(finance, d1.D);
  verifier("3a. date nulle : l'article est validé SANS catégorie (écran → serveur)", await attendre(async () => (await ligneDe(d1.L)).statutValidation === "VALIDEE"));
  verifier("3a. … la catégorie reste vide, le montant validé est celui de l'article", (await ligneDe(d1.L)).categorieId === null && Number((await q(`SELECT "montantValide"::float AS m FROM "Demande" WHERE id = $1`, [d1.D]))[0].m) === 40000);

  // 3b. Écran de paramétrage : la Finance le voit, l'Assistant et le DG non.
  await finance.goto(`${B}/treso/finance/categories`);
  verifier("3b. Finance : l'écran affiche la règle (aucune date fixée) et un champ date vide", /n'est pas obligatoire/.test(net(await finance.locator("[data-regle-categorisation]").innerText())) && (await finance.locator('input[name="dateCategorisation"]').inputValue()) === "");
  for (const email of ["assistant-finance@simassurances.test", "dg@simassurances.test"]) {
    const autre = await connecter(email);
    await autre.goto(`${B}/treso/finance/categories`);
    verifier(`3b. ${email.split("@")[0]} : écran de paramétrage inaccessible`, !new URL(autre.url()).pathname.endsWith("/treso/finance/categories"), autre.url());
    await autre.close();
  }

  // 3c. Date FUTURE (demain) : avant cette date, on peut encore valider sans catégorie.
  const d2 = await demandeEnAttente("D2", 2);
  await finance.goto(`${B}/treso/finance/categories`);
  await finance.locator('input[name="dateCategorisation"]').fill(jourIso(1));
  await finance.locator("[data-parametre-categorisation]").getByRole("button", { name: "Enregistrer", exact: true }).click();
  verifier("3c. Finance fixe la date de demain : enregistrée en base", await attendre(async () => (await q(`SELECT "valeurDate"::text AS d FROM "ParametreTresorerie" WHERE cle = $1`, [CLE]))[0].d === jourIso(1)));
  const hist = await q(`SELECT detail, "userId" FROM "HistoriqueEntry" WHERE entity = 'ParametreTresorerie' ORDER BY "createdAt"`);
  verifier("3c. le changement est historisé (auteur Finance, ancienne → nouvelle valeur)", hist.length === 1 && hist[0].userId === idFinance && /aucune \(jamais obligatoire\) → /.test(hist[0].detail), JSON.stringify(hist));
  await finance.goto(`${B}/treso/finance/categories`);
  verifier("3c. l'écran annonce « deviendra obligatoire à partir du… » et liste l'historique", /deviendra obligatoire/.test(net(await finance.locator("[data-regle-categorisation]").innerText())) && (await finance.locator("[data-historique-parametre] li").count()) === 1);
  await validerParEcran(finance, d2.D);
  verifier("3c. avant la date : l'article est validé sans catégorie", await attendre(async () => (await ligneDe(d2.L)).statutValidation === "VALIDEE"));

  // 3d. Date = AUJOURD'HUI : le blocage d'origine s'applique (écran ET serveur).
  const d3 = await demandeEnAttente("D3", 3);
  await finance.goto(`${B}/treso/finance/categories`);
  await finance.locator('input[name="dateCategorisation"]').fill(jourIso(0));
  await finance.locator("[data-parametre-categorisation]").getByRole("button", { name: "Enregistrer", exact: true }).click();
  verifier("3d. date fixée à aujourd'hui (incluse)", await attendre(async () => (await q(`SELECT "valeurDate"::text AS d FROM "ParametreTresorerie" WHERE cle = $1`, [CLE]))[0].d === jourIso(0)));
  await finance.goto(`${B}/treso/finance/demandes/${d3.D}`);
  const texte3 = net(await finance.locator("body").innerText());
  verifier("3d. à partir de la date : « Valider » grisé et phrase « Catégorisez cette ligne… »", (await finance.getByRole("button", { name: "Valider", exact: true }).isDisabled()) && (await finance.locator("[data-sans-categorie]").count()) === 1);
  verifier("3d. à partir de la date : la soumission au DG redit « Catégorisez cet article avant de le soumettre au DG. »", /Catégorisez cet article avant de le soumettre au DG/.test(texte3));
  const idValider = await idAction(finance, "validerLignesAction");
  verifier("3d. identifiant de validerLignesAction retrouvé", !!idValider);
  const refus = idValider ? await appelerAction(finance, idValider, [d3.D, [{ ligneId: d3.L, statut: "VALIDEE" }]]) : { succes: true, message: "" };
  verifier("3d. serveur : validation sans catégorie REFUSÉE par appel direct (le grisage de l'écran ne protège de rien)", !refus.succes && /n'a pas de catégorie/.test(refus.message) && (await ligneDe(d3.L)).statutValidation === "EN_ATTENTE", refus.message);

  // 3e. Retour à « jamais obligatoire » : de nouveau possible. Aucune donnée existante n'a été touchée.
  await finance.goto(`${B}/treso/finance/categories`);
  await finance.getByRole("button", { name: "Ne jamais exiger" }).click();
  verifier("3e. « Ne jamais exiger » : paramètre remis à NUL", await attendre(async () => (await q(`SELECT "valeurDate" FROM "ParametreTresorerie" WHERE cle = $1`, [CLE]))[0].valeurDate === null));
  verifier("3e. historique : 3 changements tracés", (await q(`SELECT count(*)::int AS n FROM "HistoriqueEntry" WHERE entity = 'ParametreTresorerie'`))[0].n === 3);
  await validerParEcran(finance, d3.D);
  verifier("3e. date nulle de nouveau : l'article D3 est validé sans catégorie", await attendre(async () => (await ligneDe(d3.L)).statutValidation === "VALIDEE"));
  verifier("3. les articles D1 et D2 (validés sans catégorie) n'ont pas été modifiés par les changements de règle", (await ligneDe(d1.L)).categorieId === null && (await ligneDe(d2.L)).categorieId === null);
  const caisseEmpreinte1 = await journalEmpreinte();
  verifier("3. aucune écriture de caisse créée ni modifiée par ces opérations", caisseEmpreinte1.h === caisseEmpreinte0.h && caisseEmpreinte1.n === caisseEmpreinte0.n);
  await finance.close();
}

// ======================================================================================================================
// 2. MOTIF / NATURE DU RÈGLEMENT
// ======================================================================================================================
const D4 = `${P}D4`;
const L4a = `${D4}-la`;
const L4b = `${D4}-lb`;
await q(
  `INSERT INTO "Demande"(id, reference, montant, "montantValide", statut, "createurId", "updatedAt", "beneficiaireType", "beneficiaireUserId", "etapeCircuit", "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", description)
   VALUES ($1, 'DEM-LOTI-4', 100000, 100000, 'VALIDEE_NON_REGLEE', $2, now(), 'COLLABORATEUR', $2, 'TERMINEE', true, false, 'OPTIONNELLE', 'test e2e lot I')`,
  [D4, idCollab]
);
for (const [L, nom, montant] of [[L4a, "FOURNITURES", 60000], [L4b, "MISSION", 40000]]) {
  await q(
    `INSERT INTO "LigneDemande"(id, libelle, "libelleOriginal", quantite, "prixUnitaire", "demandeId", "categorieId", motif, "statutValidation", "decideParId", "decideAt", "decideurFinanceId")
     VALUES ($1, $2, $2, 1, $3, $4, 'e2e-loti-cat', 'motif', 'VALIDEE', $5, now(), $5)`,
    [L, nom, montant, D4, idFinance]
  );
}
const reglementsDe = (D) => q(`SELECT id, montant::float AS montant, mode, motif, "estConfirme", "ligneDemandeId" FROM "Reglement" WHERE "demandeId" = $1 ORDER BY "createdAt"`, [D]);
const blocDe = (p, L) => p.locator(`[data-article-reglement="${L}"]`);
let reglCaisseId = null;
let reglBanqueId = null;
{
  const a = await connecter("assistant-finance@simassurances.test");
  await a.goto(`${B}/treso/finance/demandes/${D4}`);
  // 2a. Écran : motif obligatoire, bouton grisé tant qu'il est trop court.
  let bloc = blocDe(a, L4a);
  await bloc.getByRole("button", { name: "Ajouter un règlement" }).click();
  await bloc.locator('input[name="montant"]').fill("60000");
  await bloc.locator('select[name="mode"]').selectOption("CAISSE");
  const creer = bloc.getByRole("button", { name: "Créer le règlement" });
  verifier("2a. écran : sans motif, « Créer le règlement » est grisé", await creer.isDisabled());
  await bloc.locator('textarea[name="motif"]').fill("abcd");
  verifier("2a. écran : motif de 4 caractères, toujours grisé", await creer.isDisabled());
  // 2b. Serveur : contournement du grisage → refus, aucun règlement créé.
  await creer.evaluate((el) => { el.removeAttribute("disabled"); el.click(); });
  verifier("2b. serveur : motif de 4 caractères REFUSÉ (message à l'écran)", await attendre(async () => /5 caractères minimum/.test(await bloc.innerText())));
  verifier("2b. … aucun règlement créé", (await reglementsDe(D4)).length === 0);
  await bloc.locator('textarea[name="motif"]').fill("     ");
  await creer.evaluate((el) => { el.removeAttribute("disabled"); el.click(); });
  await a.waitForTimeout(1000);
  verifier("2b. serveur : motif fait d'espaces REFUSÉ", (await reglementsDe(D4)).length === 0);
  // 2c. Motif valide (caisse).
  await bloc.locator('textarea[name="motif"]').fill("Achat de fournitures de bureau");
  verifier("2c. écran : motif valide, bouton actif", await creer.isEnabled());
  await creer.click();
  verifier("2c. règlement Caisse créé avec son motif", await attendre(async () => (await reglementsDe(D4)).length === 1));
  const r1 = (await reglementsDe(D4))[0];
  reglCaisseId = r1.id;
  verifier("2c. motif enregistré tel que saisi", r1.motif === "Achat de fournitures de bureau" && r1.mode === "CAISSE", JSON.stringify(r1));
  await a.goto(`${B}/treso/finance/demandes/${D4}`);
  verifier("2c. écran : « Motif / nature : Achat de fournitures de bureau » sous le règlement", /Motif \/ nature\s*:\s*Achat de fournitures de bureau/i.test(net(await blocDe(a, L4a).locator("[data-motif-reglement]").innerText())));
  await blocDe(a, L4a).getByRole("button", { name: "Confirmer", exact: true }).first().click();
  verifier("2c. règlement Caisse confirmé (écriture de caisse SORTIE)", await attendre(async () => (await q(`SELECT 1 FROM "JournalCaisse" WHERE "refId" = $1 AND type = 'SORTIE'`, [reglCaisseId])).length === 1));
  verifier("2c. historique de la demande : « motif : Achat de fournitures de bureau »", (await q(`SELECT 1 FROM "HistoriqueEntry" WHERE "entityId" = $1 AND action = 'reglement' AND detail LIKE '%motif : Achat de fournitures de bureau%'`, [D4])).length === 1);

  // 2d. Banque : même obligation ; modification d'un brouillon.
  await a.goto(`${B}/treso/finance/demandes/${D4}`);
  bloc = blocDe(a, L4b);
  await bloc.getByRole("button", { name: "Ajouter un règlement" }).click();
  await bloc.locator('input[name="montant"]').fill("40000");
  await bloc.locator('select[name="mode"]').selectOption("BANQUE");
  await bloc.locator('textarea[name="motif"]').fill("abc");
  await bloc.getByRole("button", { name: "Créer le règlement" }).evaluate((el) => { el.removeAttribute("disabled"); el.click(); });
  await a.waitForTimeout(1200);
  verifier("2d. Banque : motif de 3 caractères refusé par le serveur", (await reglementsDe(D4)).filter((r) => r.mode === "BANQUE").length === 0);
  // React réinitialise les champs non contrôlés (ici le mode) après une action refusée : on le resélectionne.
  await bloc.locator('select[name="mode"]').selectOption("BANQUE");
  await bloc.locator('textarea[name="motif"]').fill("Frais de mission Abidjan");
  await bloc.getByRole("button", { name: "Créer le règlement" }).click();
  verifier("2d. Banque : règlement créé avec son motif", await attendre(async () => (await reglementsDe(D4)).filter((r) => r.mode === "BANQUE").length === 1));
  reglBanqueId = (await reglementsDe(D4)).find((r) => r.mode === "BANQUE").id;
  await a.goto(`${B}/treso/finance/demandes/${D4}`);
  bloc = blocDe(a, L4b);
  await bloc.getByRole("button", { name: "Modifier", exact: true }).click();
  await bloc.locator('textarea[name="motifReglement"]').fill("");
  await bloc.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await a.waitForTimeout(800);
  verifier("2d. modification : motif vidé refusé, motif d'origine conservé", (await reglementsDe(D4)).find((r) => r.id === reglBanqueId).motif === "Frais de mission Abidjan");
  await bloc.locator('textarea[name="motifReglement"]').fill("Frais de mission Bouaké");
  await bloc.getByRole("button", { name: "Enregistrer", exact: true }).click();
  verifier("2d. modification : nouveau motif valide enregistré", await attendre(async () => (await reglementsDe(D4)).find((r) => r.id === reglBanqueId).motif === "Frais de mission Bouaké"));
  const sortiesAvant = (await q(`SELECT count(*)::int AS n FROM "JournalCaisse"`))[0].n;
  await a.goto(`${B}/treso/finance/demandes/${D4}`);
  await blocDe(a, L4b).getByRole("button", { name: "Confirmer", exact: true }).first().click();
  verifier("2d. règlement Banque confirmé", await attendre(async () => (await reglementsDe(D4)).find((r) => r.id === reglBanqueId).estConfirme));
  verifier("2d. un règlement Banque n'écrit rien dans la caisse", (await q(`SELECT count(*)::int AS n FROM "JournalCaisse"`))[0].n === sortiesAvant);
  await a.close();
}

// 2e. ANCIENS règlements (sans motif) : jamais bloqués, jamais modifiés, « Non renseigné » partout.
const D5 = `${P}D5`;
const L5 = `${D5}-l1`;
await q(
  `INSERT INTO "Demande"(id, reference, montant, "montantValide", statut, "createurId", "updatedAt", "beneficiaireType", "beneficiaireUserId", "etapeCircuit", "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", description)
   VALUES ($1, 'DEM-LOTI-5', 100000, 100000, 'PARTIELLEMENT_REGLEE', $2, now(), 'COLLABORATEUR', $2, 'TERMINEE', true, false, 'OPTIONNELLE', 'test e2e lot I')`,
  [D5, idCollab]
);
await q(
  `INSERT INTO "LigneDemande"(id, libelle, "libelleOriginal", quantite, "prixUnitaire", "demandeId", "categorieId", motif, "statutValidation", "decideParId", "decideAt", "decideurFinanceId")
   VALUES ($1, 'ANCIEN ARTICLE', 'ANCIEN ARTICLE', 1, 100000, $2, 'e2e-loti-cat', 'motif', 'VALIDEE', $3, now(), $3)`,
  [L5, D5, idFinance]
);
const rAncienConfirme = `${P}r5a`;
const rAncienBrouillon = `${P}r5b`;
await q(`INSERT INTO "Reglement"(id, montant, mode, "estConfirme", "demandeId", "ligneDemandeId", "auteurId", "confirmeAt") VALUES ($1, 60000, 'BANQUE', true, $2, $3, $4, now())`, [rAncienConfirme, D5, L5, idAssistant]);
await q(`INSERT INTO "Reglement"(id, montant, mode, "estConfirme", "demandeId", "ligneDemandeId", "auteurId") VALUES ($1, 40000, 'BANQUE', false, $2, $3, $4)`, [rAncienBrouillon, D5, L5, idAssistant]);
{
  const a = await connecter("assistant-finance@simassurances.test");
  await a.goto(`${B}/treso/finance/demandes/${D5}`);
  const motifs = await a.locator("[data-motif-reglement]").allInnerTexts();
  verifier("2e. anciens règlements : « Non renseigné » affiché pour chacun", motifs.length === 2 && motifs.every((t) => /Non renseigné/i.test(t)), motifs.join(" | "));
  await a.getByRole("button", { name: "Confirmer", exact: true }).first().click();
  verifier("2e. un ancien brouillon SANS motif se confirme (jamais bloqué)", await attendre(async () => (await q(`SELECT "estConfirme" FROM "Reglement" WHERE id = $1`, [rAncienBrouillon]))[0].estConfirme));
  const anciens = await q(`SELECT id, motif FROM "Reglement" WHERE id IN ($1, $2)`, [rAncienConfirme, rAncienBrouillon]);
  verifier("2e. leur motif reste NUL en base (jamais modifié)", anciens.length === 2 && anciens.every((r) => r.motif === null));
  await a.close();
}

// 2f. Reçu PDF, parcours de l'article, reporting (page et Excel).
{
  const f = await connecter("finance@simassurances.test");
  const recuNouveau = await f.request.get(`${B}/api/treso/reglements/${reglCaisseId}/recu`);
  const tNouveau = await pdfTexte(recuNouveau, "recu-nouveau.pdf");
  verifier("2f. reçu PDF d'un règlement récent : « Motif / nature du règlement » et le motif", recuNouveau.status() === 200 && /Motif \/ nature du règlement\s+Achat de fournitures de bureau/.test(tNouveau) && /Motif : Achat de fournitures de bureau/.test(tNouveau), tNouveau.slice(600, 1200));
  const recuAncien = await f.request.get(`${B}/api/treso/reglements/${rAncienConfirme}/recu`);
  const tAncien = await pdfTexte(recuAncien, "recu-ancien.pdf");
  verifier("2f. reçu PDF d'un ancien règlement : « Non renseigné »", recuAncien.status() === 200 && /Motif \/ nature du règlement\s+Non renseigné/.test(tAncien));

  await f.goto(`${B}/treso/finance/demandes/${D4}`);
  const corps = net(await f.locator("body").innerText());
  verifier("2f. parcours de l'article : l'étape Réglé cite le motif", /motif\s*:\s*Achat de fournitures de bureau/i.test(corps) && /motif\s*:\s*Frais de mission Bouaké/i.test(corps));
  verifier("2f. historique de la demande : le motif du règlement confirmé", /Règlement confirmé[^]{0,200}motif\s*:\s*Frais de mission Bouaké/i.test(corps));

  await f.goto(`${B}/treso/finance/reporting`);
  verifier("2f. page de reporting : colonne « Motif / nature du règlement »", /Motif \/ nature du règlement/i.test(net(await f.locator("body").innerText())));
  const rep = await f.request.get(`${B}/api/treso/reporting/export`);
  const fichier = join(dossier, "export.xlsx");
  writeFileSync(fichier, await rep.body());
  const classeur = new ExcelJS.Workbook();
  await classeur.xlsx.readFile(fichier);
  const ws = classeur.getWorksheet("Reporting");
  const entetes = ws.getRow(1).values.slice(1);
  const colMotif = entetes.indexOf("Motif / nature du règlement") + 1;
  const colType = entetes.indexOf("Type de ligne") + 1;
  const colRef = entetes.indexOf("Référence demande") + 1;
  verifier("2f. export Excel : colonne « Motif / nature du règlement » présente", colMotif > 0, entetes.join(" | "));
  const valeurs = [];
  const horsReglement = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const v = row.getCell(colMotif).value;
    const type = String(row.getCell(colType).value ?? "");
    const ref = String(row.getCell(colRef).value ?? "");
    if (!ref.startsWith("DEM-LOTI-")) return;
    if (v != null && String(v) !== "") {
      if (/^Règlement/.test(type)) valeurs.push(String(v));
      else horsReglement.push(`${type}:${v}`);
    }
  });
  verifier("2f. export : motifs des règlements récents et « Non renseigné » pour les anciens", valeurs.includes("Achat de fournitures de bureau") && valeurs.includes("Frais de mission Bouaké") && valeurs.filter((x) => x === "Non renseigné").length === 2, valeurs.join(" | "));
  verifier("2f. export : la colonne reste vide hors des lignes Règlement", horsReglement.length === 0, horsReglement.join(" | "));
  await f.close();
}

// ======================================================================================================================
// 1. « MONTANT RENDU » du retour de caisse
// ======================================================================================================================
const D6 = `${P}D6`;
const L6 = `${D6}-l1`;
await q(
  `INSERT INTO "Demande"(id, reference, montant, "montantValide", statut, "createurId", "updatedAt", "beneficiaireType", "beneficiaireUserId", "etapeCircuit", "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", description)
   VALUES ($1, 'DEM-LOTI-6', 50000, 50000, 'REGLEE', $2, now(), 'COLLABORATEUR', $2, 'TERMINEE', true, false, 'OPTIONNELLE', 'test e2e lot I')`,
  [D6, idCollab]
);
await q(
  `INSERT INTO "LigneDemande"(id, libelle, "libelleOriginal", quantite, "prixUnitaire", "demandeId", "categorieId", motif, "statutValidation", "decideParId", "decideAt", "decideurFinanceId")
   VALUES ($1, 'ARTICLE RETOUR', 'ARTICLE RETOUR', 1, 50000, $2, 'e2e-loti-cat', 'motif', 'VALIDEE', $3, now(), $3)`,
  [L6, D6, idFinance]
);
await q(`INSERT INTO "Reglement"(id, montant, mode, "estConfirme", "demandeId", "ligneDemandeId", "auteurId", "confirmeAt", motif) VALUES ($1, 50000, 'CAISSE', true, $2, $3, $4, now(), 'Avance sur frais')`, [`${P}r6`, D6, L6, idAssistant]);
await q(`INSERT INTO "JournalCaisse"(id, type, montant, source, "refId", "userId", "demandeId") VALUES ('e2e-loti-sortie6', 'SORTIE', 50000, 'reglement_caisse', $1, $2, $3)`, [`${P}r6`, idAssistant, D6]);
await q(`INSERT INTO "RetourCaisse"(id, "montantARetourner", "estReceptionne", "reglementId", "declarantId", "receptionneParId", "receptionneAt") VALUES ($1, 20000, true, $2, $3, $4, now())`, [`${P}ret6`, `${P}r6`, idCollab, idAssistant]);
await q(`INSERT INTO "JournalCaisse"(id, type, montant, source, "refId", "userId", "demandeId") VALUES ('e2e-loti-entree6', 'ENTREE', 20000, 'retour_caisse', $1, $2, $3)`, [`${P}ret6`, idAssistant, D6]);
await q(`INSERT INTO "DepenseLigne"(id, montant, objet, date, justification, "retourCaisseId") VALUES ($1, 30000, 'Dépense justifiée', now(), 'FACTURE', $2)`, [`${P}dep6`, `${P}ret6`]);
{
  const caisseAvant = await journalEmpreinte();
  const a = await connecter("assistant-finance@simassurances.test");
  await a.goto(`${B}/treso/finance/retours/${P}ret6`);
  const tFin = net(await a.locator("body").innerText());
  verifier("1. écran Finance du retour : « Montant retourné » 20 000 FCFA", /Montant retourné\s*20 000 FCFA/i.test(tFin), tFin.slice(0, 200));
  verifier("1. écran Finance : plus de « Retourné à la compta »", !/Retourné à la compta/i.test(tFin));
  const recu = await a.request.get(`${B}/api/treso/retours/${P}ret6/recu`);
  const tPdf = await pdfTexte(recu, "recu-retour.pdf");
  verifier("1. reçu PDF du retour : « Montant retourné » (plus de « Montant rendu » ni de « Retourné à la compta »)", recu.status() === 200 && /Montant retourné/i.test(tPdf) && !/Montant rendu/i.test(tPdf) && !/Retourné à la compta/i.test(tPdf));
  await a.close();
  const c = await connecter("collaborateur@simassurances.test");
  await c.goto(`${B}/treso/demandes/${D6}`);
  const tCollab = net(await c.locator("body").innerText());
  verifier("1. écran du collaborateur : « Montant retourné » 20 000 FCFA, plus de « Retourné à la compta » ni de « Montant rendu »", /Montant retourné\s*20 000 FCFA/i.test(tCollab) && !/Montant rendu/i.test(tCollab) && !/Retourné à la compta/i.test(tCollab));
  await c.close();
  const caisseApres = await journalEmpreinte();
  verifier("1. aucun calcul ni écriture de caisse modifiés (grand livre identique)", caisseApres.h === caisseAvant.h);
}

await nettoyer();
await q(`DELETE FROM "JournalCaisse" WHERE id = 'e2e-loti-appro'`);
verifier("aucune erreur JavaScript en console", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles OK`);
await browser.close();
await db.end();
process.exit(ko === 0 ? 0 : 1);
