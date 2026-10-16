// Congés et permissions d'absence — Lot 5 (2026-10-16) : intégration au socle, sur base JETABLE (voir e2e/README.md).
// Menu et compteurs « à décider », cartes de l'accueil (« Aucun accès » pour l'Admin), date d'embauche au profil,
// « Mon équipe », suppression d'un compte lié (message au lieu d'une clé étrangère), purge du Pointage refusée dès qu'une
// demande existe, 390 px sans défilement horizontal sur toutes les pages des deux modules.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import pg from "pg";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:45497/e2e";
if (!/conges_|e2e/.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");

const manifeste = JSON.parse(readFileSync(new URL("../frontend/.next/server/server-reference-manifest.json", import.meta.url), "utf8"));
const ids = Object.fromEntries(Object.entries(manifeste.node).map(([id, v]) => [v.exportedName, id]));

const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const lundi = (semaines) => {
  const d = new Date();
  d.setDate(d.getDate() + semaines * 7 - ((d.getDay() + 6) % 7));
  return d;
};
const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);

await q(`DELETE FROM "PlageAbsenceAutorisee" WHERE "demandeCongeId" IS NOT NULL OR "demandePermissionId" IS NOT NULL`);
await q(`DELETE FROM "PieceJointeConge"`);
await q(`DELETE FROM "DemandeConge"`);
await q(`DELETE FROM "DemandePermission"`);
await q(`DELETE FROM "AjustementSolde"`);
await q(`DELETE FROM "SoldeConge"`);

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const erreursJs = [];
let compteurIp = 30 + (Date.now() % 150);
async function connecter(email, viewport) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `10.9.9.${(compteurIp++ % 240) + 10}` }, ...(viewport ? { viewport } : {}) });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(`${email}: ${e.message}`));
  await p.goto(`${B}/login`);
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', "password123");
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click('button[type="submit"]')]);
  return { ctx, p };
}
const texte = async (p) => p.locator("body").innerText();
const nav = (p) => p.locator("aside nav, nav").first();
const rejouer = (p, nomAction, args, page = "/admin/users") =>
  p.evaluate(
    async ({ id, args, url }) => {
      const r = await fetch(url, { method: "POST", headers: { "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" }, body: JSON.stringify(args) });
      return r.text();
    },
    { id: ids[nomAction], args, url: `${B}${page}` }
  );

// ── Avant toute demande : la purge du Pointage reste possible ──────────────────────────────────────────────────────────
{
  const { ctx, p } = await connecter("admin@simassurances.test");
  await p.goto(`${B}/admin/reinitialisation-pointage`);
  verifier("Purge du Pointage : sans demande, le formulaire est proposé", (await p.locator('[data-etat="purge-refusee-absences"]').count()) === 0);
  const statut = await p.evaluate(async () => (await fetch("/api/admin/reinitialisation-pointage/sauvegarde")).status);
  verifier("Purge du Pointage : sans demande, la sauvegarde est accordée (200)", statut === 200, String(statut));
  await ctx.close();
}

// ── Le collaborateur dépose un congé et une permission ─────────────────────────────────────────────────────────────────
let idConge;
let idPermission;
const collab = (await q(`SELECT id FROM "User" WHERE email = 'collaborateur@simassurances.test'`))[0].id;
{
  const { ctx, p } = await connecter("collaborateur@simassurances.test");

  await p.goto(`${B}/`);
  verifier("Accueil : carte « Congés » vers /conges", (await p.locator('a[href="/conges"]').count()) >= 1);
  verifier("Accueil : carte « Permissions d'absence » vers /permissions-absence", (await p.locator('a[href="/permissions-absence"]').count()) >= 1);

  await p.goto(`${B}/conges/nouvelle`);
  await p.waitForLoadState("networkidle");
  const debut = iso(lundi(3));
  await p.getByLabel("Type de congé").selectOption({ label: "Congé annuel" });
  await p.getByLabel("Date de début").fill(debut);
  await p.getByLabel("Date de fin").fill(debut);
  await p.getByLabel("Motif").fill("Congé du test d'intégration");
  await p.getByText(/jour.* décompté/).waitFor({ timeout: 15000 });
  await Promise.all([p.waitForURL(/\/conges\/(?!nouvelle)[^/]+$/, { timeout: 20000 }), p.getByRole("button", { name: "Envoyer la demande" }).click()]);
  idConge = new URL(p.url()).pathname.split("/").pop();

  await p.goto(`${B}/permissions-absence/nouvelle`);
  await p.waitForLoadState("networkidle");
  await p.getByLabel("Type de permission").selectOption({ label: "Démarche administrative" });
  await p.getByLabel(/^Date\b/).fill(iso(new Date(lundi(3).getTime() + 2 * 86400000))); // mercredi : jamais le jour du congé
  await p.getByLabel("Heure de départ").fill("14:00");
  await p.getByLabel("Retour prévu").fill("15:00");
  await p.getByLabel(/^Motif\b/).fill("Démarche du test d'intégration");
  try {
    await Promise.all([p.waitForURL(/\/permissions-absence\/(?!nouvelle)[^/]+$/, { timeout: 20000 }), p.getByRole("button", { name: "Envoyer la demande" }).click()]);
  } catch (e) {
    console.log("DEBUG permission:", (await texte(p)).replace(/\s+/g, " ").slice(0, 1200));
    throw e;
  }
  idPermission = new URL(p.url()).pathname.split("/").pop();

  await p.goto(`${B}/conges`);
  const menu = await nav(p).innerText();
  verifier("Menu du collaborateur : branche « Congés » avec « Mes congés » et « Nouvelle demande »", menu.includes("Congés") && menu.includes("Mes congés") && menu.includes("Nouvelle demande"));
  verifier("Menu du collaborateur : ni « À décider » ni « Soldes »", !menu.includes("À décider") && !menu.includes("Soldes"));
  await p.goto(`${B}/permissions-absence`);
  const menuP = await nav(p).innerText();
  verifier("Menu du collaborateur : branche « Permissions d'absence » avec « Mes permissions »", menuP.includes("Permissions d'absence") && menuP.includes("Mes permissions"));

  await p.goto(`${B}/profil`);
  const profil = await texte(p);
  verifier("Profil : la date d'embauche (15/01/2024) est affichée", /date d'embauche/i.test(profil) && profil.includes("15/01/2024"));
  verifier("Profil : la date d'embauche n'est pas modifiable (aucun champ date)", (await p.locator('input[type="date"]').count()) === 0);
  await ctx.close();
}

// ── Le responsable de service : compteurs et « Mon équipe » ────────────────────────────────────────────────────────────
{
  const { ctx, p } = await connecter("responsable-commercial@simassurances.test");
  await p.goto(`${B}/conges`);
  verifier("Responsable : « À décider » avec 1 congé dans le menu", /À décider\s*1\b/.test(await nav(p).innerText()), (await nav(p).innerText()).replace(/\s+/g, " ").slice(0, 300));
  await p.goto(`${B}/permissions-absence`);
  verifier("Responsable : « À décider » avec 1 permission dans le menu", /À décider\s*1\b/.test(await nav(p).innerText()));
  await p.goto(`${B}/pointage/mon-equipe`);
  const section = p.locator('[data-section="absences-a-decider"]');
  const t = await section.innerText();
  verifier("Mon équipe : « Congés à décider » (1) et « Permissions à décider » (1)", /Congés à décider\s*1/.test(t.replace(/\n+/g, " ")) && /Permissions à décider\s*1/.test(t.replace(/\n+/g, " ")), t.replace(/\s+/g, " "));
  verifier(
    "Mon équipe : liens vers les deux files",
    (await section.locator('a[href="/conges/a-decider"]').count()) === 1 && (await section.locator('a[href="/permissions-absence/a-decider"]').count()) === 1
  );
  await ctx.close();
}

// ── La RH ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const { ctx, p } = await connecter("rh@simassurances.test");
  await p.goto(`${B}/conges`);
  const menu = await nav(p).innerText();
  verifier("Menu de la RH : « À décider » et « Soldes »", menu.includes("À décider") && menu.includes("Soldes"));
  await p.goto(`${B}/pointage/mon-equipe`);
  verifier("Mon équipe (responsable du service RH) : les deux cartes « à décider » sont présentes", (await p.locator('[data-section="absences-a-decider"]').count()) === 1);
  await ctx.close();
}

// ── L'Admin : aucun droit congés, donc « Aucun accès » ─────────────────────────────────────────────────────────────────
{
  const { ctx, p } = await connecter("admin@simassurances.test");
  await p.goto(`${B}/`);
  const carte = async (titre) => (await p.locator(`h3:text-is("${titre}")`).first().locator("xpath=..").innerText()).replace(/\s+/g, " ");
  verifier("Accueil de l'Admin : carte « Congés » = « Aucun accès »", (await carte("Congés")).includes("Aucun accès"), await carte("Congés"));
  verifier("Accueil de l'Admin : carte « Permissions d'absence » = « Aucun accès »", (await carte("Permissions d'absence")).includes("Aucun accès"));
  verifier("Accueil de l'Admin : aucun lien vers /conges ni /permissions-absence", (await p.locator('a[href="/conges"], a[href="/permissions-absence"]').count()) === 0);
  verifier("Menu de l'Admin : pas de branche « Congés »", (await p.locator('button[aria-expanded]', { hasText: /^Congés$/ }).count()) === 0);

  // Suppression d'un compte lié à un congé : message précis (et non une erreur de clé étrangère).
  const reponse = await rejouer(p, "supprimerUtilisateurAction", [collab]);
  verifier("Suppression d'un compte avec congé et permission : refusée avec un message précis", /demandé 1 congé\(s\)/.test(reponse) && /demandé 1 permission\(s\) d'absence/.test(reponse), reponse.slice(0, 300));
  verifier("Le compte existe toujours", (await q(`SELECT count(*)::int AS n FROM "User" WHERE id = $1`, [collab]))[0].n === 1);

  // Purge du Pointage : refusée dès qu'une demande existe.
  await p.goto(`${B}/admin/reinitialisation-pointage`);
  verifier("Purge du Pointage : avec une demande, le message de refus remplace le formulaire", (await p.locator('[data-etat="purge-refusee-absences"]').count()) === 1);
  const statut = await p.evaluate(async () => (await fetch("/api/admin/reinitialisation-pointage/sauvegarde")).status);
  verifier("Purge du Pointage : la sauvegarde est refusée (409)", statut === 409, String(statut));
  await ctx.close();
}

// ── 390 px, sans défilement horizontal ─────────────────────────────────────────────────────────────────────────────────
{
  const mobile = { width: 390, height: 844 };
  const parRole = [
    ["collaborateur@simassurances.test", ["/", "/profil", "/conges", "/conges/nouvelle", `/conges/${idConge}`, "/permissions-absence", "/permissions-absence/nouvelle", `/permissions-absence/${idPermission}`]],
    ["responsable-commercial@simassurances.test", ["/conges/a-decider", "/permissions-absence/a-decider", "/pointage/mon-equipe"]],
    ["rh@simassurances.test", ["/conges/a-decider", "/conges/soldes", "/conges/parametrage", "/permissions-absence/a-decider", "/permissions-absence/parametrage"]],
  ];
  for (const [email, chemins] of parRole) {
    const { ctx, p } = await connecter(email, mobile);
    for (const chemin of chemins) {
      const r = await p.goto(`${B}${chemin}`);
      await p.waitForLoadState("networkidle");
      const largeur = await p.evaluate(() => document.documentElement.scrollWidth);
      verifier(`390 px : ${chemin.replace(/[0-9a-z]{20,}/, "[id]")} (${email.split("@")[0]}) sans défilement horizontal`, r.status() < 400 && largeur <= 390, `statut=${r.status()} scrollWidth=${largeur}`);
    }
    await ctx.close();
  }
}

verifier("Aucune erreur JavaScript", erreursJs.length === 0, erreursJs.join(" | "));
await browser.close();
await db.end();
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko ? 1 : 0);
