// Congés et permissions d'absence — responsable de service SANS aucune permission (relecture du 2026-10-16) : base JETABLE.
// admin@ est responsable d'Informatique et son rôle (Admin) ne porte aucune permission congés/absences. Il doit :
// atteindre « À décider » (jamais « Mes congés »), voir la demande d'un membre d'Informatique, l'approuver, et rester
// refusé sur /conges/nouvelle (page ET Server Action rejouée).
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

const admin = (await q(`SELECT id FROM "User" WHERE email = 'admin@simassurances.test'`))[0].id;
const rh = (await q(`SELECT id FROM "User" WHERE email = 'rh@simassurances.test'`))[0].id;
const droitsAdmin = await q(
  `SELECT p.key FROM "RolePermission" rp JOIN "Permission" p ON p.id = rp."permissionId" JOIN "User" u ON u."roleId" = rp."roleId" WHERE u.id = $1 AND (p.key LIKE 'conges.%' OR p.key LIKE 'absences.%')`,
  [admin]
);
verifier("Préparation : le rôle d'admin@ ne porte aucune permission congés/absences", droitsAdmin.length === 0, droitsAdmin.map((d) => d.key).join(","));
const informatique = (await q(`SELECT id, "responsableId" FROM "Service" WHERE name = 'Informatique'`))[0];
verifier("Préparation : admin@ est responsable d'Informatique", informatique.responsableId === admin);

// Un membre d'Informatique : le collaborateur de test y est déplacé le temps du parcours.
const collab = (await q(`SELECT id, "serviceId" FROM "User" WHERE email = 'collaborateur@simassurances.test'`))[0];
await q(`UPDATE "User" SET "serviceId" = $2 WHERE id = $1`, [collab.id, informatique.id]);

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const erreursJs = [];
let compteurIp = 90 + (Date.now() % 100);
async function connecter(email) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `10.9.9.${(compteurIp++ % 240) + 10}` } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(`${email}: ${e.message}`));
  await p.goto(`${B}/login`);
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', "password123");
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click('button[type="submit"]')]);
  return { ctx, p };
}
const texte = (p) => p.locator("body").innerText();
const chemin = (p) => new URL(p.url()).pathname;
const rejouer = (p, nomAction, args, page) =>
  p.evaluate(
    async ({ id, args, url }) => {
      const r = await fetch(url, { method: "POST", headers: { "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" }, body: JSON.stringify(args) });
      return r.text();
    },
    { id: ids[nomAction], args, url: `${B}${page}` }
  );

try {
  // ── Le membre d'Informatique dépose un congé et une permission ──────────────────────────────────────────────────────
  let idConge;
  let idPermission;
  {
    const { ctx, p } = await connecter("collaborateur@simassurances.test");
    await p.goto(`${B}/conges/nouvelle`);
    await p.waitForLoadState("networkidle");
    const debut = iso(lundi(3));
    await p.getByLabel("Type de congé").selectOption({ label: "Congé annuel" });
    await p.getByLabel("Date de début").fill(debut);
    await p.getByLabel("Date de fin").fill(debut);
    await p.getByLabel("Motif").fill("Congé d'un membre d'Informatique");
    await p.getByText(/jour.* décompté/).waitFor({ timeout: 15000 });
    await Promise.all([p.waitForURL(/\/conges\/(?!nouvelle)[^/]+$/, { timeout: 20000 }), p.getByRole("button", { name: "Envoyer la demande" }).click()]);
    idConge = chemin(p).split("/").pop();

    await p.goto(`${B}/permissions-absence/nouvelle`);
    await p.waitForLoadState("networkidle");
    await p.getByLabel("Type de permission").selectOption({ label: "Démarche administrative" });
    await p.getByLabel(/^Date\b/).fill(iso(new Date(lundi(3).getTime() + 2 * 86400000)));
    await p.getByLabel("Heure de départ").fill("14:00");
    await p.getByLabel("Retour prévu").fill("15:00");
    await p.getByLabel(/^Motif\b/).fill("Démarche d'un membre d'Informatique");
    await Promise.all([p.waitForURL(/\/permissions-absence\/(?!nouvelle)[^/]+$/, { timeout: 20000 }), p.getByRole("button", { name: "Envoyer la demande" }).click()]);
    idPermission = chemin(p).split("/").pop();
    const attente = await q(`SELECT (SELECT statut FROM "DemandeConge" WHERE id = $1) AS c, (SELECT statut FROM "DemandePermission" WHERE id = $2) AS p`, [idConge, idPermission]);
    verifier("Les deux demandes attendent le responsable (admin@)", attente[0].c === "EN_ATTENTE_RESPONSABLE" && attente[0].p === "EN_ATTENTE_RESPONSABLE");
    await ctx.close();
  }

  // ── admin@ : responsable sans permission ────────────────────────────────────────────────────────────────────────────
  const { ctx, p } = await connecter("admin@simassurances.test");

  await p.goto(`${B}/conges`);
  verifier("/conges : redirigé vers « À décider » (pas de « Mes congés »)", chemin(p) === "/conges/a-decider", chemin(p));
  const menu = (await p.locator("nav").first().innerText()).replace(/\s+/g, " ");
  verifier("Menu : branche « Congés » avec « À décider 1 », sans « Mes congés » ni « Nouvelle demande »", /À décider\s*1\b/.test(menu) && !menu.includes("Mes congés") && !menu.includes("Nouvelle demande"), menu.slice(0, 260));
  const tListe = await texte(p);
  verifier("« À décider » : la demande du membre d'Informatique est listée", (await p.locator(`a[href="/conges/${idConge}"]`).count()) === 1 && tListe.includes("Congé annuel"));
  verifier("Sous-navigation : aucun lien « Mes congés »", (await p.locator('nav[aria-label="Congés"] a', { hasText: "Mes congés" }).count()) === 0);

  await p.goto(`${B}/conges/${idConge}`);
  verifier("Détail de la demande de congé : accessible (pas de 404)", (await texte(p)).includes("CNG-"));
  await p.waitForLoadState("networkidle");
  await p.getByRole("button", { name: "Approuver" }).click();
  await p.getByText("En attente de la RH", { exact: true }).first().waitFor({ timeout: 15000 });
  verifier("Congé approuvé par le responsable sans permission (EN_ATTENTE_RH)", (await q(`SELECT statut FROM "DemandeConge" WHERE id = $1`, [idConge]))[0].statut === "EN_ATTENTE_RH");

  await p.goto(`${B}/permissions-absence`);
  verifier("/permissions-absence : redirigé vers « À décider »", chemin(p) === "/permissions-absence/a-decider", chemin(p));
  verifier("Permissions : la demande est listée", (await p.locator(`a[href="/permissions-absence/${idPermission}"]`).count()) === 1);
  await p.goto(`${B}/permissions-absence/${idPermission}`);
  await p.waitForLoadState("networkidle");
  await p.getByRole("button", { name: "Approuver", exact: true }).click();
  await p.getByText("En attente de la RH", { exact: true }).first().waitFor({ timeout: 15000 });
  verifier("Permission approuvée par le responsable sans permission (EN_ATTENTE_RH)", (await q(`SELECT statut FROM "DemandePermission" WHERE id = $1`, [idPermission]))[0].statut === "EN_ATTENTE_RH");

  // Refus : jamais de demande pour lui-même, ni de soldes.
  await p.goto(`${B}/conges/nouvelle`);
  verifier("/conges/nouvelle reste refusé (page)", chemin(p) !== "/conges/nouvelle", chemin(p));
  await p.goto(`${B}/permissions-absence/nouvelle`);
  verifier("/permissions-absence/nouvelle reste refusé (page)", chemin(p) !== "/permissions-absence/nouvelle", chemin(p));
  await p.goto(`${B}/conges/soldes`);
  verifier("/conges/soldes reste refusé", chemin(p) !== "/conges/soldes", chemin(p));

  await p.goto(`${B}/conges/a-decider`);
  const type = (await q(`SELECT id FROM "TypeConge" WHERE code = 'ANNUEL'`))[0].id;
  const compte = async () => (await q(`SELECT (SELECT count(*)::int FROM "DemandeConge") + (SELECT count(*)::int FROM "DemandePermission") AS n`))[0].n;
  const avant = await compte();
  const repC = await rejouer(p, "soumettreCongeAction", [{ typeCongeId: type, dateDebut: iso(lundi(6)), dateFin: iso(lundi(6)), motif: "Tentative sans permission" }], "/conges/a-decider");
  verifier("soumettreCongeAction rejouée : « Action non autorisée. »", repC.includes("Action non autorisée."), repC.slice(-120));
  const typeP = (await q(`SELECT id FROM "TypePermission" WHERE label = 'Autre'`))[0].id;
  const repP = await rejouer(p, "soumettrePermissionAction", [{ typePermissionId: typeP, date: iso(lundi(6)), heureDepart: "09:00", heureRetourPrevue: "10:00", motif: "Tentative sans permission" }], "/conges/a-decider");
  verifier("soumettrePermissionAction rejouée : « Action non autorisée. »", repP.includes("Action non autorisée."), repP.slice(-120));
  verifier("Aucune demande créée par ces tentatives", avant === (await compte()), `${avant} → ${await compte()}`);

  // Accueil : cartes vers « À décider » (et jamais vers « Mes congés »).
  await p.goto(`${B}/`);
  verifier("Accueil : cartes des deux modules vers « À décider »", (await p.locator('a[href="/conges/a-decider"]').count()) >= 1 && (await p.locator('a[href="/permissions-absence/a-decider"]').count()) >= 1);
  verifier("Accueil : aucun lien vers /conges ni /permissions-absence (Mes …)", (await p.locator('a[href="/conges"], a[href="/permissions-absence"]').count()) === 0);
  await ctx.close();

  // Contre-épreuve : plus responsable d'aucun service, le même compte est refusé.
  await q(`UPDATE "Service" SET "responsableId" = $2 WHERE id = $1`, [informatique.id, rh]);
  const sans = await connecter("admin@simassurances.test");
  await sans.p.goto(`${B}/conges/a-decider`);
  verifier("Contre-épreuve : plus responsable d'aucun service, refusé sur /conges/a-decider", chemin(sans.p) !== "/conges/a-decider", chemin(sans.p));
  await sans.p.goto(`${B}/permissions-absence/a-decider`);
  verifier("Contre-épreuve : refusé aussi sur /permissions-absence/a-decider", chemin(sans.p) !== "/permissions-absence/a-decider", chemin(sans.p));
  await sans.ctx.close();
} finally {
  await q(`UPDATE "Service" SET "responsableId" = $2 WHERE id = $1`, [informatique.id, admin]);
  await q(`UPDATE "User" SET "serviceId" = $2 WHERE id = $1`, [collab.id, collab.serviceId]);
}

verifier("Aucune erreur JavaScript", erreursJs.length === 0, erreursJs.join(" | "));
await browser.close();
await db.end();
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko ? 1 : 0);
