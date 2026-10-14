// Lot 2 (2026-10-13) — « Soumettre au DG » par article, sur base JETABLE (voir e2e/README.md).
// Demande à 3 articles (A et B catégorisés, C non) à l'étape Finance, vue par finance@, fin-sans-dg@ (rôle Finance
// sans treso.soumettre_dg, créé par le script) et assistant-finance@ ; demandes émises par le DG et par la Finance.
// Vérifie : un bouton par article toujours visible, les phrases affichées (lisibles), la soumission de l'article A par
// son bouton individuel, le bandeau « étape DG ». Aucune règle métier testée ici : le serveur reste l'autorité.
import { chromium } from "playwright";
import pg from "pg";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");

const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
const browser = await chromium.launch(
  process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}
);
const erreursJs = [];

const PHRASE_PERMISSION = "Votre rôle n'a pas la permission de soumettre au DG. Contactez un administrateur.";
const PHRASE_SANS_CATEGORIE = "Catégorisez cet article avant de le soumettre au DG.";
const PHRASE_INTRO = "Pour chaque article, la Finance choisit : Valider, Rejeter ou Soumettre au DG. Un article refusé par le DG peut lui être resoumis. Seul un article catégorisé peut être soumis.";
const PHRASE_ATTENTE_FINALE = "En attente de la validation finale.";
// Lot B : les autres articles ne sont plus bloqués pendant que le DG décide.
const PHRASE_BANDEAU = "Des articles de cette demande attendent la décision du DG. Les autres articles ne sont pas bloqués";

// --- Données de test (idempotentes : on repart de zéro à chaque lancement) --------------------------------------
await q(`DELETE FROM "HistoriqueEntry" WHERE "entityId" LIKE 'e2e-soum-%' OR "entityId" IN (SELECT id FROM "LigneDemande" WHERE "demandeId" LIKE 'e2e-soum-%')`);
await q(`DELETE FROM "Notification" WHERE lien LIKE '%e2e-soum-%'`);
await q(`DELETE FROM "LigneDemande" WHERE "demandeId" LIKE 'e2e-soum-%'`);
await q(`DELETE FROM "Demande" WHERE id LIKE 'e2e-soum-%'`);
await q(`DELETE FROM "Notification" WHERE "userId" = 'e2e-soum-u-sansdg'`);
await q(`DELETE FROM "HistoriqueEntry" WHERE "userId" = 'e2e-soum-u-sansdg'`);
await q(`DELETE FROM "User" WHERE id = 'e2e-soum-u-sansdg'`);
await q(`DELETE FROM "RolePermission" WHERE "roleId" = 'e2e-soum-r-sansdg'`);
await q(`DELETE FROM "Role" WHERE id = 'e2e-soum-r-sansdg'`);

const uid = async (email) => (await q(`SELECT id FROM "User" WHERE email = $1`, [email]))[0].id;
await q(`INSERT INTO "Role"(id, name, "estAdmin", "peutEtreBeneficiaireDelegation", "peutRecevoirFeedback") VALUES ('e2e-soum-r-sansdg', 'Finance sans soumission DG', false, false, true)`);
await q(
  `INSERT INTO "RolePermission"("roleId", "permissionId")
   SELECT 'e2e-soum-r-sansdg', rp."permissionId" FROM "RolePermission" rp
   JOIN "Role" r ON r.id = rp."roleId" JOIN "Permission" p ON p.id = rp."permissionId"
   WHERE r.name = 'Finance' AND p.key <> 'treso.soumettre_dg'`
);
await q(
  `INSERT INTO "User"(id, email, "fullName", "passwordHash", "roleId", "serviceId", "isActive", "createdAt", "updatedAt")
   SELECT 'e2e-soum-u-sansdg', 'fin-sans-dg@simassurances.test', 'Finance SansDG', "passwordHash", 'e2e-soum-r-sansdg', "serviceId", true, now(), now()
   FROM "User" WHERE email = 'finance@simassurances.test'`
);
const categorie = (await q(`SELECT id FROM "Categorie" LIMIT 1`))[0].id;

async function demande(id, createurEmail, mode, etape, lignes) {
  const createur = await uid(createurEmail);
  await q(
    `INSERT INTO "Demande"(id, reference, montant, statut, "createurId", "updatedAt", "beneficiaireType", "etapeCircuit",
       "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", description)
     VALUES ($1, $2, $3, 'EN_ATTENTE_VALIDATION', $4, now(), 'COLLABORATEUR', $5, $6, false, $7, 'test e2e')`,
    [id, `DEM-${id}`, lignes.length * 10000, createur, etape, mode === "OBLIGATOIRE" ? false : true, mode]
  );
  for (const [i, l] of lignes.entries()) {
    await q(
      `INSERT INTO "LigneDemande"(id, libelle, quantite, "prixUnitaire", "demandeId", "categorieId", motif)
       VALUES ($1, $2, 1, 10000, $3, $4, 'motif')`,
      [`${id}-l${i + 1}`, l.libelle, id, l.categorie ? categorie : null]
    );
  }
}
const ARTICLES = [{ libelle: "Article A", categorie: true }, { libelle: "Article B", categorie: true }, { libelle: "Article C", categorie: false }];
// Une demande par scénario : la soumission de A modifie son demande.
await demande("e2e-soum-d-finance", "collaborateur@simassurances.test", "OPTIONNELLE", "FINANCE", ARTICLES);
await demande("e2e-soum-d-sansdg", "collaborateur@simassurances.test", "OPTIONNELLE", "FINANCE", ARTICLES);
await demande("e2e-soum-d-assistant", "collaborateur@simassurances.test", "OPTIONNELLE", "FINANCE", ARTICLES);
await demande("e2e-soum-d-dg", "dg@simassurances.test", "NON_REQUISE", "FINANCE", ARTICLES.slice(0, 2));
await demande("e2e-soum-d-fin", "assistant-finance@simassurances.test", "OBLIGATOIRE", "DG", ARTICLES.slice(0, 2));

async function connecter(email) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(e.message));
  await p.goto(`${B}/login`);
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', "password123");
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click('button[type="submit"]')]);
  return { ctx, p };
}
const ouvrir = (p, id) => p.goto(`${B}/treso/finance/demandes/${id}`);
const bouton = (p, article) => p.locator(`[data-soumettre-article="e2e-soum-${p.__demande}-l${article}"]`);
const raison = (p, article) => p.locator(`[data-raison-article="e2e-soum-${p.__demande}-l${article}"]`);
const ligneId = (d, n) => `e2e-soum-${d}-l${n}`;
async function visible(loc) {
  // Texte lisible : police d'au moins 14 px, couleur foncée (pas le gris pâle de `text-muted-foreground`).
  const s = await loc.first().evaluate((el) => {
    const c = getComputedStyle(el);
    return { taille: parseFloat(c.fontSize), couleur: c.color, poids: parseInt(c.fontWeight, 10) };
  });
  const [r, g, b] = s.couleur.match(/\d+(\.\d+)?/g).map(Number);
  return s.taille >= 14 && s.poids >= 500 && r + g + b < 300;
}

// --- finance@ : le cas nominal ----------------------------------------------------------------------------------
{
  const { ctx, p } = await connecter("finance@simassurances.test");
  p.__demande = "d-finance";
  await ouvrir(p, "e2e-soum-d-finance");
  const nb = await p.locator("[data-soumettre-article]").count();
  verifier("finance@ : un bouton « Soumettre au DG » par article (3)", nb === 3, `${nb} boutons`);
  verifier("finance@ : A actif", !(await bouton(p, 1).isDisabled()));
  verifier("finance@ : B actif", !(await bouton(p, 2).isDisabled()));
  verifier("finance@ : C (non catégorisé) grisé", await bouton(p, 3).isDisabled());
  verifier("finance@ : phrase « Catégorisez cet article… » sous C", (await raison(p, 3).innerText()).trim() === PHRASE_SANS_CATEGORIE);
  verifier("finance@ : phrase de C lisible (≥ 14 px, foncée)", await visible(raison(p, 3)));
  verifier("finance@ : aucune phrase sous A", (await raison(p, 1).count()) === 0);
  // Lot B bis : plus de case à cocher, plus de bouton global, plus de « Cochez au moins un article ».
  verifier("finance@ : aucune case à cocher « Soumettre au DG »", (await p.locator('main input[type="checkbox"]').count()) === 0);
  verifier("finance@ : aucun bouton global « Soumettre au DG » (un seul par article : 3)", (await p.getByRole("button", { name: /^Soumettre au DG/ }).count()) === 3);
  verifier("finance@ : phrase d'introduction du bloc", (await p.locator("[data-intro-articles]").innerText()).trim() === PHRASE_INTRO);
  verifier("finance@ : plus de « Cochez au moins un article »", !(await p.locator("main").innerText()).includes("Cochez"));
  verifier("finance@ : pas de bandeau avant la soumission", (await p.locator("[data-bandeau-etape-dg]").count()) === 0);

  // Chaque carte d'article rappelle la demande (numéro, demandeur, service, date, devise).
  const entete = (await p.locator("[data-entete-demande]").first().innerText()).replace(/\s+/g, " ");
  verifier("finance@ : en-tête de la demande sur chaque article (3)", (await p.locator("[data-entete-demande]").count()) === 3);
  verifier("finance@ : en-tête = numéro, demandeur, service, date, devise", entete.includes("DEM-e2e-soum-d-finance") && entete.includes("Collaborateur Test") && /\d{2}\/\d{2}\/\d{4}/.test(entete) && entete.includes("FCFA"), entete);

  // Soumission de A par SON bouton (seul moyen de soumettre : seul A part).
  await bouton(p, 1).click();
  await p.locator('[data-sonner-toast][data-type="success"]').first().waitFor();
  const lignes = await q(`SELECT id, "soumiseAuDG" FROM "LigneDemande" WHERE "demandeId" = 'e2e-soum-d-finance' ORDER BY id`);
  verifier("finance@ : A soumis au DG par son bouton", lignes.find((l) => l.id === ligneId("d-finance", 1)).soumiseAuDG === true);
  verifier("finance@ : B et C non soumis", lignes.filter((l) => l.soumiseAuDG).length === 1);
  const etape = (await q(`SELECT "etapeCircuit" FROM "Demande" WHERE id = 'e2e-soum-d-finance'`))[0].etapeCircuit;
  // Lot B : l'étape se déduit des articles — B et C attendent encore la Finance, la demande reste à l'étape Finance.
  verifier("finance@ : la demande reste à l'étape Finance (B et C l'attendent encore)", etape === "FINANCE");
  await p.reload();
  const bandeau = p.locator("[data-bandeau-etape-dg]");
  verifier("finance@ : bandeau « étape DG » affiché", (await bandeau.count()) === 1 && (await bandeau.innerText()).startsWith(PHRASE_BANDEAU));
  verifier("finance@ : A grisé (attend déjà le DG)", await bouton(p, 1).isDisabled());
  verifier("finance@ : Valider/Rejeter restent actifs sur les articles non soumis (lot B)", !(await p.getByRole("button", { name: /^(Valider|Rejeter)$/ }).first().isDisabled()));
  await ctx.close();
}

// --- fin-sans-dg@ : cas A ---------------------------------------------------------------------------------------
{
  const { ctx, p } = await connecter("fin-sans-dg@simassurances.test");
  p.__demande = "d-sansdg";
  await ouvrir(p, "e2e-soum-d-sansdg");
  verifier("fin-sans-dg@ : 3 boutons visibles", (await p.locator("[data-soumettre-article]").count()) === 3);
  let tousGrises = true;
  for (const n of [1, 2, 3]) tousGrises &&= await bouton(p, n).isDisabled();
  verifier("fin-sans-dg@ : les 3 boutons grisés", tousGrises);
  verifier("fin-sans-dg@ : phrase de permission sous A", (await raison(p, 1).innerText()).trim() === PHRASE_PERMISSION);
  verifier("fin-sans-dg@ : phrase de permission lisible", await visible(raison(p, 1)));
  verifier("fin-sans-dg@ : plus de « Action non autorisée. » à l'écran", !(await p.locator("main").innerText()).includes("Action non autorisée."));
  await ctx.close();
}

// --- assistant-finance@ : cas D ---------------------------------------------------------------------------------
{
  const { ctx, p } = await connecter("assistant-finance@simassurances.test");
  p.__demande = "d-assistant";
  await ouvrir(p, "e2e-soum-d-assistant");
  verifier("assistant-finance@ : 3 boutons visibles et grisés", (await p.locator("[data-soumettre-article]").count()) === 3 && (await bouton(p, 1).isDisabled()));
  verifier("assistant-finance@ : « En attente de la validation finale. » sous A", (await raison(p, 1).innerText()).trim() === PHRASE_ATTENTE_FINALE);
  verifier("assistant-finance@ : phrase lisible", await visible(raison(p, 1)));
  verifier("assistant-finance@ : phrase aussi sous la décision", (await p.locator("[data-raison-decision]").first().innerText()).trim() === PHRASE_ATTENTE_FINALE);
  await ctx.close();
}

// --- finance@ : cas C (demande émise par le DG, puis par la Finance) --------------------------------------------
{
  const { ctx, p } = await connecter("finance@simassurances.test");
  await ouvrir(p, "e2e-soum-d-dg");
  verifier("demande du DG : aucun bouton « Soumettre au DG » (ni global, ni par article)", (await p.getByRole("button", { name: /^Soumettre au DG/ }).count()) === 0);
  const texte1 = (await p.locator("[data-raison-circuit]").first().innerText()).trim();
  verifier("demande du DG : phrase explicative", texte1.startsWith("Cette demande a été émise par le DG"), texte1);
  verifier("demande du DG : phrase lisible", await visible(p.locator("[data-raison-circuit]")));
  await ouvrir(p, "e2e-soum-d-fin");
  const texte2 = (await p.locator("[data-raison-circuit]").first().innerText()).trim();
  verifier("demande de la Finance : « le DG la décide d'office »", texte2.includes("le DG la décide d'office"), texte2);
  verifier("demande de la Finance : une seule phrase, aucun bouton « Soumettre au DG »", (await p.locator("[data-raison-circuit]").count()) === 1 && (await p.getByRole("button", { name: /^Soumettre au DG/ }).count()) === 0);
  await ctx.close();
}

// --- Lot B bis : rappel de la demande en tête des articles, sur les écrans DG, Service et collaborateur ----------
async function enteteSur(email, url, attendu) {
  const { ctx, p } = await connecter(email);
  await p.goto(`${B}${url}`);
  const n = await p.locator("[data-entete-demande]").count();
  const texte = n ? (await p.locator("[data-entete-demande]").first().innerText()).replace(/\s+/g, " ") : "";
  verifier(`${attendu} : en-tête de la demande sur les articles`, n >= 1 && texte.includes("DEM-e2e-soum-d-finance") && texte.includes("Collaborateur Test") && texte.includes("Commercial") && texte.includes("FCFA"), `${n} en-tête(s) — ${texte}`);
  await ctx.close();
}
await enteteSur("dg@simassurances.test", "/treso/dg/e2e-soum-d-finance", "DG");
await enteteSur("responsable-commercial@simassurances.test", "/treso/service/e2e-soum-d-finance", "responsable de service");
await enteteSur("collaborateur@simassurances.test", "/treso/demandes/e2e-soum-d-finance", "collaborateur");

await db.end();
await browser.close();
console.log(resultats.join("\n"));
if (erreursJs.length) console.log(`KO erreurs JavaScript : ${erreursJs.join(" | ")}`);
const ko = resultats.filter((r) => r.startsWith("KO")).length + (erreursJs.length ? 1 : 0);
console.log(`\n${resultats.length - resultats.filter((r) => r.startsWith("KO")).length}/${resultats.length} contrôles OK${erreursJs.length ? ", erreurs JS présentes" : ", aucune erreur JavaScript"}`);
process.exit(ko ? 1 : 0);
