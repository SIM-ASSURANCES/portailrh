// Congés — intégration au socle, sur base JETABLE (voir e2e/README.md).
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

await q(`DELETE FROM "PlageAbsenceAutorisee" WHERE "demandeCongeId" IS NOT NULL`);
await q(`DELETE FROM "PieceJointeConge"`);
await q(`DELETE FROM "DemandeConge"`);
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

// ── Le collaborateur dépose un congé ──────────────────────────────────────────────────────────────────────────────────
let idConge;
const collab = (await q(`SELECT id FROM "User" WHERE email = 'collaborateur@simassurances.test'`))[0].id;
{
  const { ctx, p } = await connecter("collaborateur@simassurances.test");

  await p.goto(`${B}/`);
  verifier("Accueil : carte « Congés » vers /conges", (await p.locator('a[href="/conges"]').count()) >= 1);

  await p.goto(`${B}/conges/nouvelle`);
  await p.waitForLoadState("networkidle");
  const debut = iso(lundi(3));
  await p.getByLabel("Type de congé").selectOption({ label: "Congé annuel" });
  await p.getByLabel("Date de début").fill(debut);
  await p.getByLabel("Date de fin").fill(debut);
  await p.getByLabel("Motif").fill("Congé du test d'intégration");
  verifier("Formulaire : « Jours ouvrables (lundi à vendredi) » près du type", (await texte(p)).includes("Jours ouvrables (lundi à vendredi)"));
  await p.getByText(/jour.* décompté/).waitFor({ timeout: 15000 });
  await Promise.all([p.waitForURL(/\/conges\/(?!nouvelle)[^/]+$/, { timeout: 20000 }), p.getByRole("button", { name: "Envoyer la demande" }).click()]);
  idConge = new URL(p.url()).pathname.split("/").pop();
  verifier("Détail du congé : le décompte est nommé « jours ouvrables (lundi à vendredi) »", (await texte(p)).includes("jours ouvrables (lundi à vendredi)"));

  // B2 : pas de congé dans le passé — la phrase est la même à l'écran et côté serveur (action rejouée).
  const PHRASE_PASSE = "La date de début ne peut pas être dans le passé : un congé exige une autorisation préalable (art. 12 du règlement).";
  await p.goto(`${B}/conges/nouvelle`);
  await p.waitForLoadState("networkidle");
  await p.getByLabel("Type de congé").selectOption({ label: "Congé annuel" });
  const hierJour = iso(new Date(Date.now() - 86400000));
  await p.getByLabel("Date de début").fill(hierJour);
  verifier("Date passée : la phrase s'affiche sous le champ", (await texte(p)).includes(PHRASE_PASSE));
  verifier("Date passée : « Envoyer la demande » est grisé", await p.getByRole("button", { name: "Envoyer la demande" }).isDisabled());
  const typeAnnuel = (await q(`SELECT id FROM "TypeConge" WHERE code = 'ANNUEL'`))[0].id;
  const repPasse = await rejouer(p, "soumettreCongeAction", [{ typeCongeId: typeAnnuel, dateDebut: hierJour, dateFin: hierJour, motif: "Déjà pris hier" }], "/conges");
  verifier("Action rejouée avec une date passée : refusée avec la même phrase", repPasse.includes(PHRASE_PASSE), repPasse.slice(-200));

  await p.goto(`${B}/conges`);
  const menu = await nav(p).innerText();
  verifier("Menu du collaborateur : branche « Congés » avec « Mes congés » et « Nouvelle demande »", menu.includes("Congés") && menu.includes("Mes congés") && menu.includes("Nouvelle demande"));
  verifier("Menu du collaborateur : ni « À décider » ni « Soldes »", !menu.includes("À décider") && !menu.includes("Soldes"));
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
  await p.goto(`${B}/pointage/mon-equipe`);
  const section = p.locator('[data-section="absences-a-decider"]');
  const t = await section.innerText();
  verifier("Mon équipe : « Congés à décider » (1)", /Congés à décider\s*1/.test(t.replace(/\n+/g, " ")), t.replace(/\s+/g, " "));
  verifier("Mon équipe : lien vers la file des congés", (await section.locator('a[href="/conges/a-decider"]').count()) === 1);
  await ctx.close();
}

// ── La RH ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const { ctx, p } = await connecter("rh@simassurances.test");
  await p.goto(`${B}/conges`);
  const menu = await nav(p).innerText();
  verifier("Menu de la RH : « À décider » et « Soldes »", menu.includes("À décider") && menu.includes("Soldes"));
  // C1 : nombre de jours paramétrable ; l'historique garde l'ancienne ET la nouvelle valeur.
  await p.goto(`${B}/conges/parametrage`);
  await p.waitForLoadState("networkidle");
  const carteAnnuel = p.locator("div", { hasText: "ANNUEL" }).filter({ has: p.getByRole("button", { name: "Modifier" }) }).last();
  await carteAnnuel.getByRole("button", { name: "Modifier" }).click();
  const champJours = p.getByLabel("Jours accordés par défaut");
  verifier("Paramétrage : le texte « soldes créés ensuite » est affiché près du nombre de jours", (await texte(p)).includes("s'applique aux soldes créés ensuite"));
  await champJours.fill("28");
  await p.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await p.getByText("Type modifié.").first().waitFor({ timeout: 15000 });
  const h1 = await q(`SELECT detail FROM "HistoriqueEntry" WHERE entity = 'TypeConge' AND action = 'modification_type' ORDER BY "createdAt" DESC LIMIT 1`);
  verifier("Historique : « jours accordés : 30 → 28 »", (h1[0]?.detail ?? "").includes("jours accordés : 30 → 28"), h1[0]?.detail);
  await p.reload();
  await p.waitForLoadState("networkidle");
  const carteAnnuel2 = p.locator("div", { hasText: "ANNUEL" }).filter({ has: p.getByRole("button", { name: "Modifier" }) }).last();
  await carteAnnuel2.getByRole("button", { name: "Modifier" }).click();
  await p.getByLabel("Jours accordés par défaut").fill("30");
  await p.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await p.waitForFunction(() => document.body.innerText.includes("30 jour(s)"), null, { timeout: 15000 });
  const h2 = await q(`SELECT detail FROM "HistoriqueEntry" WHERE entity = 'TypeConge' AND action = 'modification_type' ORDER BY "createdAt" DESC LIMIT 1`);
  verifier("Historique : la remise à 30 garde « 28 → 30 »", (h2[0]?.detail ?? "").includes("jours accordés : 28 → 30"), h2[0]?.detail);

  await p.goto(`${B}/pointage/mon-equipe`);
  verifier("Mon équipe (responsable du service RH) : la carte congés « à décider » est présente", (await p.locator('[data-section="absences-a-decider"]').count()) === 1);
  await ctx.close();
}

// ── L'Admin : aucun droit congés, donc « Aucun accès » ─────────────────────────────────────────────────────────────────
{
  const { ctx, p } = await connecter("admin@simassurances.test");
  await p.goto(`${B}/`);
  const carte = async (titre) => (await p.locator(`h3:text-is("${titre}")`).first().locator("xpath=..").innerText()).replace(/\s+/g, " ");
  // L'Admin du seed est responsable d'Informatique : sans permission, il accède à « À décider » seulement (jamais « Mes … »).
  verifier("Accueil de l'Admin (responsable d'Informatique) : carte vers « À décider »", (await p.locator('a[href="/conges/a-decider"]').count()) >= 1);
  verifier("Accueil de l'Admin : aucun lien vers /conges (Mes congés)", (await p.locator('a[href="/conges"]').count()) === 0);
  await p.goto(`${B}/conges/a-decider`);
  const menuAdmin = (await nav(p).innerText()).replace(/\s+/g, " ");
  verifier("Menu de l'Admin : « À décider » sans « Mes congés »", menuAdmin.includes("À décider") && !menuAdmin.includes("Mes congés"), menuAdmin.slice(0, 200));
  // Plus responsable d'aucun service : « Aucun accès » sur l'accueil, jamais « Bientôt disponible ».
  const informatique = (await q(`SELECT id, "responsableId" FROM "Service" WHERE name = 'Informatique'`))[0];
  const rhId = (await q(`SELECT id FROM "User" WHERE email = 'rh@simassurances.test'`))[0].id;
  await q(`UPDATE "Service" SET "responsableId" = $2 WHERE id = $1`, [informatique.id, rhId]);
  try {
    await p.goto(`${B}/`);
    const carte = async (titre) => (await p.locator(`h3:text-is("${titre}")`).first().locator("xpath=..").innerText()).replace(/\s+/g, " ");
    verifier("Accueil d'un Admin sans permission ni service dirigé : carte « Congés » = « Aucun accès »", (await carte("Congés")).includes("Aucun accès"), await carte("Congés"));
    verifier("Menu de cet Admin : pas de branche « Congés »", (await p.locator('button[aria-expanded]', { hasText: /^Congés$/ }).count()) === 0);
  } finally {
    await q(`UPDATE "Service" SET "responsableId" = $2 WHERE id = $1`, [informatique.id, informatique.responsableId]);
  }

  // Suppression d'un compte lié à un congé : message précis (et non une erreur de clé étrangère).
  const reponse = await rejouer(p, "supprimerUtilisateurAction", [collab]);
  verifier("Suppression d'un compte avec congé : refusée avec un message précis", /demandé 1 congé\(s\)/.test(reponse), reponse.slice(0, 300));
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
    ["collaborateur@simassurances.test", ["/", "/profil", "/conges", "/conges/nouvelle", `/conges/${idConge}`]],
    ["responsable-commercial@simassurances.test", ["/conges/a-decider", "/pointage/mon-equipe"]],
    ["rh@simassurances.test", ["/conges/a-decider", "/conges/soldes", "/conges/parametrage"]],
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
