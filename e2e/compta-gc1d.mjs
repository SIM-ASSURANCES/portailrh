// Gestion Compta, lot GC-1d — NAVIGATION : branche « Gestion Compta » du menu, carte d'accueil du portail, garde de /compta.
// Le module n'a PLUS de page d'accueil : ses rubriques sont dans la barre latérale et /compta redirige vers /compta/referentiels.
// Sur base JETABLE (voir e2e/README.md : `next build` puis `bash e2e/base-jetable.sh`). Lecture seule : ce script n'écrit rien en base.
//  1. accès par rôle (5 rôles Compta + DG autorisés ; Collaborateur, Finance, RH, Assistant Finance, Admin, Encaissements refusés) ;
//  2. menu : la branche « Gestion Compta » n'apparaît que pour qui a `cpt.consulter` ; aucun autre rôle ne voit un lien /compta ;
//  3. carte d'accueil du portail : lien /compta pour les autorisés, « Aucun accès » pour l'Admin, aucune carte pour les autres ;
//  4. rubriques de la barre latérale : chaque profil voit exactement ses rubriques (le DG superviseur ne voit aucune saisie), pas d'« Accueil » ;
//  5. refus : redirection vers l'accueil avec le message ; sans session : vers la connexion ; mobile sans défilement horizontal.
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
async function ouvrir(email) {
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
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(`${email} : ${e.message}`));
  return p;
}

// « Référentiels » (GC-2c) est la première rubrique de tout compte qui consulte le module, et la seule déjà disponible.
const RUBRIQUES = {
  production: ["Référentiels", "Production", "Contrôle hebdomadaire", "Clients", "Créances et relances"],
  commercial: ["Référentiels", "Encaissements", "Rattachements", "Contrôle hebdomadaire", "Clients", "Créances et relances"],
  rfcrh: [
    "Référentiels",
    "Encaissements",
    "Rattachements",
    "Contrôle hebdomadaire", "Clients",
    "Créances et relances",
    "Taxe sur les contrats d'assurance",
    "Partenaires",
    "Comptabilité (Odoo)",
    "Clôture du mois",
    "Paramètres",
  ],
  comptable: ["Référentiels", "Production", "Encaissements", "Contrôle hebdomadaire", "Clients", "Comptabilité (Odoo)"],
  direction: ["Référentiels", "Contrôle hebdomadaire", "Clients", "Litiges"],
};
const AUTORISES = [
  ["Compta – Production", "compta-production@simassurances.test", RUBRIQUES.production],
  ["Compta – Commercial", "compta-commercial@simassurances.test", RUBRIQUES.commercial],
  ["Compta – RFCRH", "compta-rfcrh@simassurances.test", RUBRIQUES.rfcrh],
  ["Compta – Comptable", "compta-comptable@simassurances.test", RUBRIQUES.comptable],
  ["Compta – Direction", "compta-direction@simassurances.test", RUBRIQUES.direction],
  ["DG (superviseur)", "dg@simassurances.test", ["Référentiels", "Contrôle hebdomadaire", "Clients", "Litiges"]],
];
const encaissements = (await db.query(`SELECT email FROM "User" WHERE email LIKE 'enc-%' ORDER BY email LIMIT 1`)).rows[0]?.email;
const REFUSES = [
  ["Collaborateur", "collaborateur@simassurances.test"],
  ["Finance", "finance@simassurances.test"],
  ["RH", "rh@simassurances.test"],
  ["Assistant Finance", "assistant-finance@simassurances.test"],
  ["Admin", "admin@simassurances.test"],
  ...(encaissements ? [["Encaissements", encaissements]] : []),
];
verifier("0. un compte Encaissements existe pour tester l'indépendance des modules", !!encaissements);

// Le menu est un accordéon : les liens d'une branche ne sont dans le DOM qu'une fois la branche dépliée.
async function ouvrirBrancheCompta(p) {
  const bouton = p.locator("aside button[aria-expanded]", { hasText: "Gestion Compta" });
  if ((await bouton.count()) > 0 && (await bouton.first().getAttribute("aria-expanded")) === "false") {
    await bouton.first().click();
    await bouton.first().locator("xpath=..").locator("li").first().waitFor();
  }
}
const liensMenu = (p) => p.$$eval("aside a[href]", (as) => as.map((a) => a.getAttribute("href")));
// Rubriques de la branche « Gestion Compta » : libellé, et si l'entrée est un lien ou « Bientôt » (div aria-disabled).
async function rubriquesMenu(p) {
  const branche = p.locator("aside button[aria-expanded]", { hasText: "Gestion Compta" }).first().locator("xpath=..");
  return branche.locator("li").evaluateAll((lis) =>
    lis.map((li) => ({
      libelle: (li.querySelector("span.truncate")?.textContent ?? li.textContent ?? "").trim(),
      lien: li.querySelector("a")?.getAttribute("href") ?? null,
      bientot: li.querySelector('[aria-disabled="true"]') !== null,
    }))
  );
}
const texte = async (p) => (await p.locator("body").innerText()).replace(/\s+/g, " ");

// ---------- 1 à 4. Rôles autorisés ----------
for (const [nom, email, attendues] of AUTORISES) {
  const p = await ouvrir(email);
  await p.goto(`${B}/`);
  await p.waitForSelector("aside a[href]");
  await ouvrirBrancheCompta(p);
  const menu = await liensMenu(p);
  verifier(`2. ${nom} : le menu contient « Gestion Compta » → /compta/referentiels`, menu.includes("/compta/referentiels"));
  verifier(`2. ${nom} : plus d'entrée « Accueil » (/compta) dans le menu`, !menu.includes("/compta"));
  const branche = await p.locator("aside").innerText();
  verifier(`2. ${nom} : la branche s'appelle « Gestion Compta »`, /Gestion Compta/.test(branche));
  const carte = await p.locator('main a[href="/compta"]').count();
  verifier(`3. ${nom} : carte d'accueil du portail avec lien /compta`, carte >= 1, `liens trouvés : ${carte}`);

  // 4. Les rubriques sont dans la barre latérale : exactement celles du profil, dans l'ordre, sans « Accueil ».
  const rubriques = await rubriquesMenu(p);
  const libelles = rubriques.map((r) => r.libelle);
  verifier(`4. ${nom} : rubriques de la barre latérale exactes`, JSON.stringify(libelles) === JSON.stringify(attendues), `obtenu ${JSON.stringify(libelles)}`);
  verifier(`4. ${nom} : aucune rubrique « Accueil »`, !libelles.includes("Accueil"));
  // « Référentiels » (GC-2) et « Production » (GC-3f) sont les seuls liens disponibles ; toutes les autres rubriques restent
  // « Bientôt » (module en construction).
  const ref = rubriques.find((r) => r.libelle === "Référentiels");
  verifier(`4. ${nom} : « Référentiels » est un lien vers /compta/referentiels`, ref?.lien === "/compta/referentiels" && !ref.bientot);
  const prod = rubriques.find((r) => r.libelle === "Production");
  if (prod) verifier(`4. ${nom} : « Production » est un lien vers /compta/production`, prod.lien === "/compta/production" && !prod.bientot);
  const param = rubriques.find((r) => r.libelle === "Paramètres");
  if (param) verifier(`4. ${nom} : « Paramètres » est un lien vers /compta/parametres`, param.lien === "/compta/parametres" && !param.bientot);
  const enc = rubriques.find((r) => r.libelle === "Encaissements");
  if (enc) verifier(`4. ${nom} : « Encaissements » est un lien vers /compta/encaissements`, enc.lien === "/compta/encaissements" && !enc.bientot);
  const DISPONIBLES = ["Référentiels", "Production", "Encaissements", "Rattachements", "Contrôle hebdomadaire", "Clients", "Paramètres"];
  verifier(`4. ${nom} : les autres rubriques sont « Bientôt »`, rubriques.filter((r) => !DISPONIBLES.includes(r.libelle)).every((r) => r.bientot && r.lien === null));

  // /compta reste une adresse valide : elle mène à la première rubrique construite, et n'affiche plus de page d'accueil.
  await p.goto(`${B}/compta`);
  await p.waitForSelector("h1");
  verifier(`1. ${nom} : /compta redirige vers /compta/referentiels`, new URL(p.url()).pathname === "/compta/referentiels" && (await p.locator("h1").first().innerText()).trim() === "Référentiels");
  verifier(`4. ${nom} : plus aucune rubrique dans le contenu de la page`, (await p.locator("[data-rubrique-compta]").count()) === 0);
  await p.close();
}

// ---------- 1, 2, 3, 5. Rôles refusés ----------
for (const [nom, email] of REFUSES) {
  const p = await ouvrir(email);
  await p.goto(`${B}/`);
  await p.waitForSelector("aside a[href]");
  const menu = await liensMenu(p);
  verifier(`2. ${nom} : aucun lien /compta dans le menu`, !menu.some((h) => h === "/compta" || h?.startsWith("/compta/")));
  const aside = await p.locator("aside").innerText();
  verifier(`2. ${nom} : aucune branche « Gestion Compta »`, !/Gestion Compta/.test(aside));
  const accueil = await p.locator("main").innerText();
  if (nom === "Admin") {
    // L'Admin voit toutes les cartes de modules actifs ; sans `cpt.consulter` la carte n'a pas de lien : « Aucun accès ».
    const carte = p.locator("main").getByText("Gestion Compta", { exact: false }).first();
    verifier("3. Admin : la carte « Gestion Compta » existe mais sans lien", (await carte.count()) === 1 && (await p.locator('main a[href="/compta"]').count()) === 0);
    verifier("3. Admin : la carte dit « Aucun accès » (jamais « Bientôt disponible »)", /Aucun accès/.test(accueil) && !/Gestion Compta[^.]*Bientôt disponible/.test(accueil));
  } else {
    verifier(`3. ${nom} : aucune carte « Gestion Compta » sur l'accueil du portail`, !/Gestion Compta/.test(accueil));
  }
  await p.goto(`${B}/compta`);
  await p.waitForLoadState("networkidle");
  const u = new URL(p.url());
  verifier(`1. ${nom} : /compta redirige vers l'accueil avec l'erreur`, u.pathname === "/" && u.searchParams.get("error") === "acces_refuse_compta", u.pathname + u.search);
  verifier(`5. ${nom} : le message « pas accès au module Gestion Compta » s'affiche`, await p.getByText("Vous n'avez pas accès au module Gestion Compta.").first().isVisible().catch(() => false));
  await p.close();
}

// ---------- 5. Sans session, mobile ----------
const anonyme = await fetch(`${B}/compta`, { redirect: "manual" });
verifier("5. sans session : /compta renvoie vers la connexion", [301, 302, 307, 308].includes(anonyme.status) && /\/login/.test(anonyme.headers.get("location") ?? ""), `${anonyme.status} ${anonyme.headers.get("location")}`);

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
const pm = await mobile.newPage();
await pm.goto(`${B}/login`);
await pm.fill('input[name="email"]', "compta-rfcrh@simassurances.test");
await pm.fill('input[name="password"]', "password123");
await Promise.all([pm.waitForURL((u) => !u.pathname.startsWith("/login")), pm.click('button[type="submit"]')]);
await pm.goto(`${B}/compta`);
await pm.waitForSelector("h1");
const larg = await pm.evaluate(() => ({ doc: document.documentElement.scrollWidth, vue: window.innerWidth }));
verifier("5. mobile 390 px : /compta sans défilement horizontal", larg.doc <= larg.vue, JSON.stringify(larg));
await mobile.close();

verifier("6. aucune erreur JavaScript dans les pages visitées", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));

for (const ctx of sessions.values()) await ctx.close();
await browser.close();
await db.end();

console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\nGC-1d : ${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko === 0 ? 0 : 1);
