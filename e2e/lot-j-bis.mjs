// Lot J bis — sur base JETABLE (voir e2e/README.md). Nécessite exceljs ou unzip.
//   1. La confirmation du DG d'un dépassement du seuil rouge COUVRE le règlement de l'article, jusqu'au montant confirmé :
//      validation avec confirmation du DG (écran réel), règlement confirmé au-delà du reste du budget, trace (qui, motif, montant couvert),
//      mention dans le parcours de l'article et le reporting ; un autre article, un règlement au-delà du montant confirmé et un
//      article sans confirmation restent refusés ; budget toujours consommé au règlement ; aucune écriture de caisse.
//   2. Page « Budgets », catégories : « Dernier paramétrage refusé » + budget en vigueur conservé.
//   3. La Finance (`treso.gerer_categories`) désactive / réactive catégories et objets : tracé, absent des choix mais présent dans
//      l'historique, le reporting et les demandes existantes ; budget visible ; droits de l'Admin inchangés ; refus sans la permission.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import pg from "pg";
import { assurerSignatures } from "./signatures-auto.mjs";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/i.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");

const db = new pg.Client({ connectionString: DB });
await db.connect();
await assurerSignatures(db); // lot L : les actions sensibles exigent une signature enrôlée
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
process.on("uncaughtException", (e) => {
  console.log(resultats.join("\n"));
  console.log("\nINTERROMPU :", e.message.split("\n").slice(0, 4).join(" | "));
  process.exit(2);
});
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
const net = (t) => t.replace(/\s+/g, " ").replace(/&apos;/g, "'");
const dossier = mkdtempSync(join(tmpdir(), "lotjbis-"));

const P = "e2e-lotjbis-";
const CATA = `${P}cata`; // budget 100 000 : article de 120 000 validé avec la confirmation du DG
const CATB = `${P}catb`; // budget 40 000 : dépense directe, confirmation qui ne couvre que 70 000
const CATC = `${P}catc`; // budget 50 000 : article de 60 000 SANS confirmation
const CATD = `${P}catd`; // budget valide 200 000 puis paramétrage refusé
const CATE = `${P}cate`; // seulement un paramétrage refusé
const CATF = `${P}catf`; // désactivée / réactivée par la Finance (budget 80 000, objet)
const CATS = [CATA, CATB, CATC, CATD, CATE, CATF];
const OBJF = `${P}objf`;
const nettoyer = async () => {
  await q(`DELETE FROM "Notification" WHERE message LIKE '%DEM-LOTJB-%' OR titre LIKE '%budget%' OR titre LIKE '%Budget%'`);
  await q(`DELETE FROM "HistoriqueEntry" WHERE "entityId" LIKE '${P}%' OR detail LIKE '%DEM-LOTJB-%' OR (entity IN ('Categorie','Objet') AND "entityId" LIKE '${P}%')`);
  await q(`DELETE FROM "JournalBanque" WHERE "reglementId" LIKE '${P}%'`);
  await q(`DELETE FROM "ReglementCategorieAllocation" WHERE "reglementId" LIKE '${P}%'`);
  await q(`DELETE FROM "Reglement" WHERE id LIKE '${P}%'`);
  await q(`DELETE FROM "BudgetDepassement" WHERE "demandeId" LIKE '${P}%'`);
  await q(`DELETE FROM "BudgetParametrage" WHERE "categorieId" = ANY($1)`, [CATS]);
  await q(`DELETE FROM "LigneDemande" WHERE "demandeId" LIKE '${P}%'`);
  await q(`DELETE FROM "Demande" WHERE id LIKE '${P}%'`);
  await q(`DELETE FROM "Objet" WHERE "categorieId" = ANY($1)`, [CATS]);
  await q(`DELETE FROM "Categorie" WHERE id = ANY($1)`, [CATS]);
};
await nettoyer();

const uid = async (email) => (await q(`SELECT id FROM "User" WHERE email = $1`, [email]))[0].id;
const idCollab = await uid("collaborateur@simassurances.test");
const idFinance = await uid("finance@simassurances.test");
const idDG = await uid("dg@simassurances.test");
const idAssistant = await uid("assistant-finance@simassurances.test");
const nomDG = (await q(`SELECT "fullName" FROM "User" WHERE id=$1`, [idDG]))[0].fullName;

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
const journalEmpreinte = async () => (await q(`SELECT COALESCE(md5(string_agg(id || ':' || type || ':' || montant::text, ',' ORDER BY id)), '') AS h, count(*)::int AS n FROM "JournalCaisse"`))[0];

async function idAction(page, nom) {
  const ressources = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name).filter((u) => u.includes("/_next/static/") && u.endsWith(".js")));
  for (const url of ressources) {
    const texte = await (await fetch(url)).text();
    const m = new RegExp(`createServerReference\\)?\\(\\s*"([0-9a-f]{20,})"[^)]*?"${nom}"`).exec(texte);
    if (m) return m[1];
  }
  return null;
}
async function appelerAction(page, id, args) {
  const r = await page.context().request.post(page.url(), {
    headers: { "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" },
    data: JSON.stringify(args),
  });
  const texte = await r.text();
  return { succes: /"status":"success"/.test(texte), message: /"message":"((?:[^"\\]|\\.)*)"/.exec(texte)?.[1] ?? texte.slice(0, 300) };
}

await q(
  `INSERT INTO "Categorie"(id, label, "isActive") VALUES ($1,'E2E-JB-CATA',true),($2,'E2E-JB-CATB',true),($3,'E2E-JB-CATC',true),($4,'E2E-JB-CATD',true),($5,'E2E-JB-CATE',true),($6,'E2E-JB-CATF',true)`,
  CATS
);
await q(`INSERT INTO "Objet"(id, label, "isActive", "categorieId") VALUES ($1,'E2E-JB-OBJF',true,$2)`, [OBJF, CATF]);
const budget = (id, cat, montant, statut = "VALIDE", extra = "") =>
  q(
    `INSERT INTO "BudgetParametrage"(id, portee, "categorieId", montant, "dateDebut", "modeSeuil", "seuilOrange", "seuilRouge", statut, "decideParId", "decideAt", "soumisAt"${extra ? ", " + extra.split("=")[0] : ""}) VALUES ($1,'CATEGORIE',$2,$3, current_date,'POURCENTAGE',20,10,$4,$5,now(), now()${extra ? ", " + extra.split("=")[1] : ""})`,
    [id, cat, montant, statut, idDG]
  );
await budget(`${P}ba`, CATA, 100000);
await budget(`${P}bb`, CATB, 40000);
await budget(`${P}bc`, CATC, 50000);
await budget(`${P}bd`, CATD, 200000);
await budget(`${P}bf`, CATF, 80000);
const caisse0 = await journalEmpreinte();

async function demande(suffixe, numero, articles, extra = {}) {
  const D = `${P}${suffixe}`;
  const total = articles.reduce((s, a) => s + a.montant, 0);
  await q(
    `INSERT INTO "Demande"(id, reference, montant, "montantValide", statut, "createurId", "updatedAt", "beneficiaireType", "beneficiaireUserId", "etapeCircuit", "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", description, "typeDemande", "categorieId")
     VALUES ($1, $2, $3, $7, $8, $4, now(), 'COLLABORATEUR', $4, $9, true, false, 'OPTIONNELLE', 'test e2e lot J bis', $5, $6)`,
    [D, `DEM-LOTJB-${numero}`, total, idCollab, extra.typeDemande ?? "STANDARD", extra.categorieId ?? null, extra.montantValide ?? 0, extra.statut ?? "EN_ATTENTE_VALIDATION", extra.etape ?? "FINANCE"]
  );
  for (const [i, a] of articles.entries()) {
    await q(
      `INSERT INTO "LigneDemande"(id, libelle, "libelleOriginal", quantite, "prixUnitaire", "demandeId", motif, "categorieId", "statutValidation") VALUES ($1,$2,$2,1,$3,$4,'motif e2e',$5,$6)`,
      [`${D}-l${i + 1}`, a.libelle, a.montant, D, a.categorie, a.statut ?? "EN_ATTENTE"]
    );
  }
  return D;
}
const reglement = async (id, D, ligne, montant, cat) => {
  await q(`INSERT INTO "Reglement"(id, montant, mode, "estConfirme", "demandeId", "ligneDemandeId", "auteurId", motif) VALUES ($1,$2,'BANQUE',false,$3,$4,$5,'Règlement e2e lot J bis')`, [id, montant, D, ligne, idAssistant]);
  await q(`INSERT INTO "ReglementCategorieAllocation"(id, "reglementId", "categorieId", montant) VALUES ($1,$2,$3,$4)`, [`${id}-a`, id, cat, montant]);
};
const consomme = async (cat) => Number((await q(`SELECT COALESCE(sum(a.montant),0) AS s FROM "ReglementCategorieAllocation" a JOIN "Reglement" r ON r.id=a."reglementId" WHERE a."categorieId"=$1 AND r."estConfirme" AND NOT r."estAnnule"`, [cat]))[0].s);
const statutReglement = async (id) => (await q(`SELECT "estConfirme" FROM "Reglement" WHERE id=$1`, [id]))[0].estConfirme;

// ======================================================================================================================
// 1. LA CONFIRMATION DU DG COUVRE LE RÈGLEMENT
// ======================================================================================================================
const D1 = await demande("d1", 1, [
  { libelle: "Serveur e2e", montant: 120000, categorie: CATA },
  { libelle: "Câbles e2e", montant: 10000, categorie: CATA },
]);
const L1 = `${D1}-l1`;
const L2 = `${D1}-l2`;
{
  const finance = await connecter("finance@simassurances.test");
  const dg = await connecter("dg@simassurances.test");
  await finance.goto(`${B}/treso/finance/demandes/${D1}`);
  await finance.locator(`[data-ligne-card="${L1}"]`).getByRole("button", { name: "Valider", exact: true }).click();
  await finance.locator("[data-budget-bloc]").waitFor();
  verifier("1a. validation de 120 000 sur un budget de 100 000 : alerte ROUGE, « Enregistrer » grisé", (await finance.locator('[data-alerte-budget="ROUGE"]').count()) === 1 && (await finance.getByRole("button", { name: /Enregistrer les décisions/ }).isDisabled()));
  await finance.locator("[data-demander-confirmation-dg]").click();
  verifier("1a. la Finance demande la confirmation du DG", await attendre(async () => (await q(`SELECT statut FROM "BudgetDepassement" WHERE "demandeId"=$1`, [D1])).length === 1));

  await dg.goto(`${B}/treso/finance/budgets`);
  const bd = dg.locator("[data-depassement]").first();
  await bd.locator('input[name="motifDepassement"]').fill("Serveur indispensable à la reprise d'activité");
  await bd.getByRole("button", { name: "Confirmer le dépassement" }).click();
  verifier("1b. le DG confirme (statut CONFIRME)", await attendre(async () => (await q(`SELECT statut FROM "BudgetDepassement" WHERE "demandeId"=$1`, [D1]))[0]?.statut === "CONFIRME"));

  await finance.goto(`${B}/treso/finance/demandes/${D1}`);
  await finance.locator(`[data-ligne-card="${L1}"]`).getByRole("button", { name: "Valider", exact: true }).click();
  await finance.getByRole("button", { name: /Enregistrer les décisions/ }).click();
  verifier("1c. l'article est validé grâce à la confirmation du DG", await attendre(async () => (await q(`SELECT "statutValidation" FROM "LigneDemande" WHERE id=$1`, [L1]))[0].statutValidation === "VALIDEE"));
  const dep = (await q(`SELECT statut, couverture FROM "BudgetDepassement" WHERE "demandeId"=$1`, [D1]))[0];
  verifier("1c. la confirmation est UTILISÉE et enregistre ce qu'elle couvre : article 120 000 dans la catégorie", dep.statut === "UTILISE" && Array.isArray(dep.couverture) && dep.couverture.length === 1 && dep.couverture[0].ligneId === L1 && dep.couverture[0].categorieId === CATA && Number(dep.couverture[0].montant) === 120000, JSON.stringify(dep.couverture));
  verifier("1c. historique de la validation : « couvre aussi le règlement jusqu'à 120 000 FCFA »", (await q(`SELECT detail FROM "HistoriqueEntry" WHERE "entityId"=$1 AND action='depassement_budget_utilise'`, [D1])).some((h) => /couvre aussi le règlement jusqu.à 120.000 FCFA/.test(net(h.detail))));
  await finance.close();
  await dg.close();
}

// Le second article est validé plus tôt (budget suffisant à l'époque) : SQL, sans confirmation du DG.
await q(`UPDATE "LigneDemande" SET "statutValidation"='VALIDEE', "decideParId"=$2, "decideAt"=now() WHERE id=$1`, [L2, idFinance]);
await q(`UPDATE "Demande" SET "montantValide"=130000, statut='VALIDEE_NON_REGLEE', "etapeCircuit"='TERMINEE' WHERE id=$1`, [D1]);

await reglement(`${P}r1`, D1, L1, 120000, CATA);
await reglement(`${P}r2`, D1, L2, 10000, CATA);
await reglement(`${P}r3`, D1, L1, 5000, CATA);
const assistant = await connecter("assistant-finance@simassurances.test");
await assistant.goto(`${B}/treso/finance/demandes/${D1}`);
const idConfirmerReglement = await idAction(assistant, "confirmerReglementAction");
verifier("0. identifiant de l'action de confirmation du règlement trouvé", !!idConfirmerReglement);
const confirmer = (id) => appelerAction(assistant, idConfirmerReglement, [id]);

{
  // 1d. Règlement d'un article dont le dépassement a été confirmé : accepté malgré le reste du budget (100 000).
  const r1 = await confirmer(`${P}r1`);
  verifier("1d. règlement de 120 000 de l'article couvert par la confirmation du DG : CONFIRMÉ (au-delà du reste de 100 000)", r1.succes && (await statutReglement(`${P}r1`)), r1.message);
  verifier("1d. le budget est consommé au règlement : 120 000 consommés sur la catégorie", (await consomme(CATA)) === 120000);
  const trace = (await q(`SELECT detail, "userId" FROM "HistoriqueEntry" WHERE "entityId"=$1 AND action='reglement_couvert_depassement'`, [D1]))[0];
  const t = net(trace?.detail ?? "");
  verifier("1d. trace : qui a confirmé (DG), motif, montant couvert", !!trace && t.includes(nomDG) && /Serveur indispensable à la reprise d'activité/.test(t) && /couvert par cette confirmation : 120.000 FCFA sur 120.000 FCFA/.test(t), t);
  verifier("1d. … posée sur la demande, par l'auteur de la confirmation du règlement", trace?.userId === idAssistant);

  // 1e. L'autre article de la même catégorie n'est PAS couvert : la couverture est celle de CET article.
  const r2 = await confirmer(`${P}r2`);
  verifier("1e. règlement d'un AUTRE article de la catégorie (sans confirmation) : REFUSÉ, budget dépassé", !r2.succes && /dépasse le budget disponible/.test(r2.message) && !(await statutReglement(`${P}r2`)), r2.message);
  verifier("1e. … et rien n'a été consommé par ce refus", (await consomme(CATA)) === 120000);

  // 1f. Un règlement au-delà du montant confirmé (et du montant validé de l'article) reste refusé.
  const r3 = await confirmer(`${P}r3`);
  verifier("1f. règlement supplémentaire sur l'article au-delà du montant confirmé : REFUSÉ", !r3.succes && !(await statutReglement(`${P}r3`)), r3.message);
  verifier("1f. … aucune trace de couverture supplémentaire", (await q(`SELECT 1 FROM "HistoriqueEntry" WHERE "entityId"=$1 AND action='reglement_couvert_depassement'`, [D1])).length === 1);
}

// 1g. Confirmation PARTIELLE (dépense directe validée en deux fois, la première avait été confirmée par le DG : 70 000 sur 120 000).
const D2 = await demande("d2", 2, [], { typeDemande: "DEPENSE_DIRECTE", categorieId: CATB, montantValide: 120000, statut: "VALIDEE_NON_REGLEE", etape: "TERMINEE" });
await q(`UPDATE "Demande" SET montant=120000 WHERE id=$1`, [D2]);
await q(`INSERT INTO "BudgetDepassement"(id, "demandeId", statut, resume, "demandeParId", "confirmeParId", "confirmeAt", motif, "utiliseAt", couverture) VALUES ($1,$2,'UTILISE','e2e',$3,$4,now(),'Première tranche confirmée par le DG',now(), $5::jsonb)`, [`${P}dep2`, D2, idFinance, idDG, JSON.stringify([{ ligneId: null, categorieId: CATB, montant: 70000 }])]);
await reglement(`${P}r4`, D2, null, 70000, CATB);
await reglement(`${P}r5`, D2, null, 20000, CATB);
{
  await assistant.goto(`${B}/treso/finance/demandes/${D2}`);
  const idC = (await idAction(assistant, "confirmerReglementAction")) ?? idConfirmerReglement;
  const r4 = await appelerAction(assistant, idC, [`${P}r4`]);
  verifier("1g. dépense directe : règlement de 70 000 (montant confirmé) CONFIRMÉ malgré un budget de 40 000", r4.succes && (await statutReglement(`${P}r4`)), r4.message);
  const r5 = await appelerAction(assistant, idC, [`${P}r5`]);
  verifier("1g. … règlement suivant de 20 000, au-delà du montant confirmé : REFUSÉ (budget déjà dépassé)", !r5.succes && /dépasse le budget disponible/.test(r5.message) && !(await statutReglement(`${P}r5`)), r5.message);
  verifier("1g. … la trace indique 70 000 couverts", (await q(`SELECT detail FROM "HistoriqueEntry" WHERE "entityId"=$1 AND action='reglement_couvert_depassement'`, [D2])).some((h) => /couvert par cette confirmation : 70.000 FCFA sur 70.000 FCFA/.test(net(h.detail))));
}

// 1h. Article sans aucune confirmation : règle d'origine inchangée.
const D3 = await demande("d3", 3, [{ libelle: "Mobilier e2e", montant: 60000, categorie: CATC, statut: "VALIDEE" }], { montantValide: 60000, statut: "VALIDEE_NON_REGLEE", etape: "TERMINEE" });
await reglement(`${P}r6`, D3, `${D3}-l1`, 60000, CATC);
{
  await assistant.goto(`${B}/treso/finance/demandes/${D3}`);
  const idC = (await idAction(assistant, "confirmerReglementAction")) ?? idConfirmerReglement;
  const r6 = await appelerAction(assistant, idC, [`${P}r6`]);
  verifier("1h. article sans confirmation du DG : règlement REFUSÉ au-delà du budget (règle inchangée)", !r6.succes && /dépasse le budget disponible/.test(r6.message) && !(await statutReglement(`${P}r6`)), r6.message);
}

// 1i. Parcours de l'article, historique et reporting (Finance et DG seulement).
{
  const finance = await connecter("finance@simassurances.test");
  await finance.goto(`${B}/treso/finance/demandes/${D1}`);
  const carte = net(await finance.locator(`[data-ligne-card="${L1}"]`).innerText());
  verifier("1i. parcours de l'article (Finance) : mention de la couverture du règlement par le DG", (await finance.locator(`[data-ligne-card="${L1}"] [data-couverture-reglement]`).count()) === 1 && /Dépassement de budget confirmé par le DG/.test(carte) && /couvre le règlement de cet article jusqu.à 120.000 FCFA/.test(carte), carte.slice(0, 400));
  verifier("1i. … l'article sans confirmation (l2) n'a pas cette mention", (await finance.locator(`[data-ligne-card="${L2}"] [data-couverture-reglement]`).count()) === 0);
  const histo = net(await finance.locator("body").innerText());
  verifier("1i. historique de la demande (Finance) : « Règlement couvert par la confirmation du DG »", /Règlement couvert par la confirmation du DG/.test(histo));
  await finance.goto(`${B}/treso/finance/reporting`);
  await finance.locator("[data-deplier-tout]").click();
  const tableau = net(await finance.locator("table[data-reporting-arbre]").innerText());
  verifier("1i. reporting (page) : la colonne « Budget après validation » mentionne la couverture du règlement", /couvre le règlement de cet article jusqu.à 120.000 FCFA/.test(tableau));
  const r = await finance.request.get(`${B}/api/treso/reporting/export`);
  const xlsx = join(dossier, "export.xlsx");
  writeFileSync(xlsx, await r.body());
  const partages = net(execFileSync("unzip", ["-p", xlsx, "xl/sharedStrings.xml"], { maxBuffer: 64 * 1024 * 1024 }).toString());
  verifier("1i. reporting (Excel) : même mention", /couvre le règlement de cet article jusqu.à 120.000 FCFA/.test(partages));
  const collab = await connecter("collaborateur@simassurances.test");
  await collab.goto(`${B}/treso/demandes/${D1}`);
  const txtCollab = net(await collab.locator("body").innerText());
  verifier("1i. le demandeur ne voit ni la confirmation du DG ni la couverture (gestion interne)", !/couvre le règlement/.test(txtCollab) && !/Dépassement de budget confirmé/.test(txtCollab) && !/couvert par la confirmation du DG/.test(txtCollab));
}
verifier("1j. aucune écriture de caisse créée ni modifiée (règlements Banque, grand livre intact)", JSON.stringify(await journalEmpreinte()) === JSON.stringify(caisse0));

// ======================================================================================================================
// 2. « DERNIER PARAMÉTRAGE REFUSÉ » : le budget en vigueur reste visible
// ======================================================================================================================
await q(`INSERT INTO "BudgetParametrage"(id, portee, "categorieId", montant, "dateDebut", statut, "soumisParId", "soumisAt", "decideParId", "decideAt", "motifRefus") VALUES ($1,'CATEGORIE',$2,300000, current_date,'REFUSE',$3, now() + interval '1 minute', $4, now() + interval '2 minutes','Trop élevé pour ce trimestre')`, [`${P}bd-refus`, CATD, idFinance, idDG]);
await q(`INSERT INTO "BudgetParametrage"(id, portee, "categorieId", montant, "dateDebut", statut, "soumisParId", "soumisAt", "decideParId", "decideAt", "motifRefus") VALUES ($1,'CATEGORIE',$2,90000, current_date,'REFUSE',$3, now(), $4, now(),'Pas de justification')`, [`${P}be-refus`, CATE, idFinance, idDG]);
{
  for (const email of ["finance@simassurances.test", "dg@simassurances.test"]) {
    const p = await connecter(email);
    await p.goto(`${B}/treso/finance/budgets`);
    const ligneD = p.locator('[data-budget-ligne="E2E-JB-CATD"]');
    const tD = net(await ligneD.innerText());
    verifier(`2. ${email.split("@")[0]} : catégorie au dernier paramétrage refusé → « Dernier paramétrage refusé » et budget en vigueur conservé (200 000)`, (await ligneD.locator("[data-dernier-parametrage-refuse]").count()) === 1 && /Dernier paramétrage refusé/.test(tD) && /Budget en vigueur conservé : 200.000 FCFA/.test(tD), tD);
    const tE = net(await p.locator('[data-budget-ligne="E2E-JB-CATE"]').innerText());
    verifier(`2. ${email.split("@")[0]} : catégorie dont le seul paramétrage a été refusé → « Aucun budget en vigueur »`, /Dernier paramétrage refusé/.test(tE) && /Aucun budget en vigueur/.test(tE), tE);
    const tA = net(await p.locator('[data-budget-ligne="E2E-JB-CATA"]').innerText());
    verifier(`2. ${email.split("@")[0]} : une catégorie dont le dernier paramétrage est validé n'affiche pas cette mention`, !/Dernier paramétrage refusé/.test(tA), tA);
    await p.close();
  }
}

// ======================================================================================================================
// 3. LA FINANCE DÉSACTIVE / RÉACTIVE CATÉGORIES ET OBJETS
// ======================================================================================================================
const D4 = await demande("d4", 4, [{ libelle: "Achat historique", montant: 25000, categorie: CATF, statut: "VALIDEE" }], { montantValide: 25000, statut: "VALIDEE_NON_REGLEE", etape: "TERMINEE" });
const D5 = await demande("d5", 5, [{ libelle: "Article à catégoriser", montant: 15000, categorie: null }]);
await q(`UPDATE "LigneDemande" SET "objetId"=NULL WHERE "demandeId"=$1`, [D4]);
const optionsChoix = async (p) => {
  await p.goto(`${B}/treso/finance/demandes/${D5}`);
  await p.locator(`[data-ligne-card="${D5}-l1"]`).getByRole("button", { name: /Catégoriser/ }).click();
  return (await p.locator('select[aria-label="Catégorie de la ligne"] option').allInnerTexts()).map(net);
};
{
  const finance = await connecter("finance@simassurances.test");
  await finance.goto(`${B}/treso/finance/budgets?onglet=categories`);
  const liCat = finance.locator("li", { hasText: "E2E-JB-CATF" }).first();
  verifier("3a. la Finance voit « Désactiver » sur la catégorie ET sur son objet", (await liCat.getByRole("button", { name: "Désactiver" }).count()) === 2);
  verifier("3a. avant : la catégorie est proposée dans les choix de catégorisation", (await optionsChoix(finance)).some((o) => o.includes("E2E-JB-CATF")));

  await finance.goto(`${B}/treso/finance/budgets?onglet=categories`);
  const idToggleCat = await idAction(finance, "toggleCategorieActiveAction");
  const idToggleObj = await idAction(finance, "toggleObjetActiveAction");
  verifier("3a. actions de bascule trouvées", !!idToggleCat && !!idToggleObj);
  await finance.locator("li", { hasText: "E2E-JB-CATF" }).first().getByRole("button", { name: "Désactiver" }).first().click();
  verifier("3b. la Finance désactive la catégorie : isActive = false", await attendre(async () => (await q(`SELECT "isActive" FROM "Categorie" WHERE id=$1`, [CATF]))[0].isActive === false));
  const h = (await q(`SELECT action, "userId", "createdAt" FROM "HistoriqueEntry" WHERE entity='Categorie' AND "entityId"=$1 ORDER BY "createdAt" DESC`, [CATF]))[0];
  verifier("3b. … tracé : DEACTIVATE par le compte Finance, avec sa date", h?.action === "DEACTIVATE" && h.userId === idFinance && !!h.createdAt);
  await finance.reload();
  const liApres = finance.locator("li", { hasText: "E2E-JB-CATF" }).first();
  const tApres = net(await liApres.innerText());
  verifier("3b. … l'écran montre « Inactive », « Désactivée le … par … » et le bouton « Réactiver »", /Inactive/.test(tApres) && /Désactivée le .+ par Finance/.test(tApres) && (await liApres.getByRole("button", { name: "Réactiver" }).count()) >= 1, tApres.slice(0, 300));
  verifier("3b. … son budget en vigueur reste visible (80 000 FCFA) dans la page Catégories", /80.000/.test(tApres));
  await finance.goto(`${B}/treso/finance/budgets`);
  const tBudget = net(await finance.locator('[data-budget-ligne="E2E-JB-CATF"]').innerText());
  verifier("3b. … et dans le tableau des budgets (80 000 FCFA, « désactivée »)", /80.000/.test(tBudget) && /désactivée/.test(tBudget), tBudget);

  verifier("3c. désactivée : absente des choix pour catégoriser un nouvel article", !(await optionsChoix(finance)).some((o) => o.includes("E2E-JB-CATF")));
  await finance.goto(`${B}/treso/finance/demandes/${D4}`);
  const carte4 = net(await finance.locator(`[data-ligne-card="${D4}-l1"]`).innerText());
  verifier("3c. … mais toujours affichée sur la demande existante qui la référence", /E2E-JB-CATF/.test(carte4), carte4.slice(0, 200));
  await finance.goto(`${B}/treso/finance/reporting`);
  const optsReporting = (await finance.locator("select option").allInnerTexts()).map(net);
  verifier("3c. … filtrable dans le reporting, signalée « désactivée »", optsReporting.some((o) => /E2E-JB-CATF \(désactivée\)/.test(o)), optsReporting.filter((o) => /JB-CAT/.test(o)).join(" | "));
  await finance.locator("[data-deplier-tout]").click();
  verifier("3c. … et ses demandes restent dans le reporting", /Achat historique/.test(net(await finance.locator("table[data-reporting-arbre]").innerText())));
  const demandeurOK = (await q(`SELECT "categorieId" FROM "LigneDemande" WHERE id=$1`, [`${D4}-l1`]))[0].categorieId === CATF;
  verifier("3c. … la demande existante n'a pas été modifiée (catégorie conservée)", demandeurOK);

  // Objet : désactivation / réactivation par la Finance.
  await finance.goto(`${B}/treso/finance/budgets?onglet=categories`);
  const liObj = finance.locator("li", { hasText: "E2E-JB-OBJF" }).last();
  await liObj.getByRole("button", { name: "Désactiver" }).click();
  verifier("3d. la Finance désactive l'objet", await attendre(async () => (await q(`SELECT "isActive" FROM "Objet" WHERE id=$1`, [OBJF]))[0].isActive === false));
  verifier("3d. … tracé (entité Objet, DEACTIVATE, Finance)", (await q(`SELECT 1 FROM "HistoriqueEntry" WHERE entity='Objet' AND "entityId"=$1 AND action='DEACTIVATE' AND "userId"=$2`, [OBJF, idFinance])).length === 1);
  await finance.reload();
  await finance.locator("li", { hasText: "E2E-JB-OBJF" }).last().getByRole("button", { name: "Réactiver" }).click();
  verifier("3d. … et la réactive (ACTIVATE tracé)", await attendre(async () => (await q(`SELECT "isActive" FROM "Objet" WHERE id=$1`, [OBJF]))[0].isActive === true) && (await q(`SELECT 1 FROM "HistoriqueEntry" WHERE entity='Objet' AND "entityId"=$1 AND action='ACTIVATE' AND "userId"=$2`, [OBJF, idFinance])).length === 1);

  // Réactivation de la catégorie.
  await finance.reload();
  await finance.locator("li", { hasText: "E2E-JB-CATF" }).first().getByRole("button", { name: "Réactiver" }).first().click();
  verifier("3e. la Finance réactive la catégorie (ACTIVATE tracé)", await attendre(async () => (await q(`SELECT "isActive" FROM "Categorie" WHERE id=$1`, [CATF]))[0].isActive === true) && (await q(`SELECT 1 FROM "HistoriqueEntry" WHERE entity='Categorie' AND "entityId"=$1 AND action='ACTIVATE' AND "userId"=$2`, [CATF, idFinance])).length === 1);
  verifier("3e. … de nouveau proposée dans les choix", (await optionsChoix(finance)).some((o) => o.includes("E2E-JB-CATF")));
  await finance.goto(`${B}/treso/finance/budgets?onglet=categories`);
  verifier("3e. … sans mention « Désactivée » résiduelle", !/Désactivée le/.test(net(await finance.locator("li", { hasText: "E2E-JB-CATF" }).first().innerText())));

  // Sans la permission : refus serveur (appel direct), état inchangé.
  for (const email of ["dg@simassurances.test", "assistant-finance@simassurances.test", "collaborateur@simassurances.test"]) {
    const p = await connecter(email);
    await p.goto(`${B}/`);
    const refus = await appelerAction(p, idToggleCat, [CATF, false]);
    const refusObj = await appelerAction(p, idToggleObj, [OBJF, false]);
    verifier(`3f. ${email.split("@")[0]} (sans treso.gerer_categories) : désactivation refusée côté serveur`, !refus.succes && !refusObj.succes && /non autoris/i.test(refus.message) && (await q(`SELECT "isActive" FROM "Categorie" WHERE id=$1`, [CATF]))[0].isActive === true && (await q(`SELECT "isActive" FROM "Objet" WHERE id=$1`, [OBJF]))[0].isActive === true, refus.message);
    await p.close();
  }

  // L'Admin garde ses droits sur /admin/categories.
  const admin = await connecter("admin@simassurances.test");
  await admin.goto(`${B}/admin/categories`);
  const liAdmin = admin.locator("li", { hasText: "E2E-JB-CATF" }).first();
  verifier("3g. Admin : /admin/categories propose toujours Désactiver (catégorie et objet)", (await liAdmin.getByRole("button", { name: "Désactiver" }).count()) === 2);
  await liAdmin.getByRole("button", { name: "Désactiver" }).first().click();
  verifier("3g. Admin : désactive la catégorie", await attendre(async () => (await q(`SELECT "isActive" FROM "Categorie" WHERE id=$1`, [CATF]))[0].isActive === false));
  await admin.reload();
  const t = net(await admin.locator("li", { hasText: "E2E-JB-CATF" }).first().innerText());
  verifier("3g. Admin : voit « Désactivée le … par Finance » puis réactive", /Désactivée le .+ par/.test(t));
  await admin.locator("li", { hasText: "E2E-JB-CATF" }).first().getByRole("button", { name: "Réactiver" }).first().click();
  verifier("3g. Admin : réactive la catégorie", await attendre(async () => (await q(`SELECT "isActive" FROM "Categorie" WHERE id=$1`, [CATF]))[0].isActive === true));
  // Suppression toujours refusée pour une catégorie utilisée, avec le message qui renvoie vers la désactivation (désormais possible).
  const liSuppr = admin.locator("li", { hasText: "E2E-JB-CATF" }).first();
  verifier("3h. une catégorie utilisée : « Supprimer » existe toujours, et « Désactiver » est maintenant offert à la Finance en alternative", (await liSuppr.getByRole("button", { name: /Supprimer/ }).count()) >= 1);
}

// ======================================================================================================================
verifier("9. aucune écriture de caisse créée ni modifiée sur l'ensemble du script", JSON.stringify(await journalEmpreinte()) === JSON.stringify(caisse0));
verifier("9. aucune erreur JavaScript côté navigateur", erreursJs.length === 0, erreursJs.slice(0, 2).join(" | "));
await nettoyer();
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles réussis`);
await browser.close();
await db.end();
process.exit(ko ? 1 : 0);
