// Congés — C3 (consignes du 2026-10-16) : observations de la RH (à sa décision) et du DG (à tout moment).
// Base JETABLE seulement (voir e2e/README.md). Parcours : le collaborateur dépose un congé ; le responsable
// approuve avec une observation ; la RH valide avec ses observations ; le DG (sans `consulter_tous`) voit tout, ajoute une
// observation sans changer le statut ; le demandeur la voit avec le nom de l'auteur, sans pouvoir en ajouter ; les actions
// rejouées par un compte non DG ou avec 501 caractères sont refusées ; l'observation du DG prévient le demandeur et la RH.
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
await q(`DELETE FROM "Notification" WHERE titre = 'Observation du DG'`);

const nom = async (email) => (await q(`SELECT "fullName" FROM "User" WHERE email = $1`, [email]))[0].fullName;
const uid = async (email) => (await q(`SELECT id FROM "User" WHERE email = $1`, [email]))[0].id;
const collab = await uid("collaborateur@simassurances.test");
const rh = await uid("rh@simassurances.test");
const dg = await uid("dg@simassurances.test");
const nomDG = await nom("dg@simassurances.test");
const nomRH = await nom("rh@simassurances.test");

// Le DG ne porte AUCUNE permission « consulter_tous » pendant le parcours : son accès vient de sa permission d'étape.
const retirees = await q(
  `DELETE FROM "RolePermission" rp USING "Permission" p, "User" u
   WHERE rp."permissionId" = p.id AND rp."roleId" = u."roleId" AND u.id = $1 AND p.key = 'conges.consulter_tous'
   RETURNING rp."roleId", rp."permissionId"`,
  [dg]
);

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const erreursJs = [];
let compteurIp = 120 + (Date.now() % 100);
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
  // ── Le collaborateur dépose un congé ───────────────────────────────────────────────────────────────────────────────
  let idConge;
  {
    const { ctx, p } = await connecter("collaborateur@simassurances.test");
    await p.goto(`${B}/conges/nouvelle`);
    await p.waitForLoadState("networkidle");
    const debut = iso(lundi(3));
    await p.getByLabel("Type de congé").selectOption({ label: "Congé annuel" });
    await p.getByLabel("Date de début").fill(debut);
    await p.getByLabel("Date de fin").fill(debut);
    await p.getByLabel("Motif").fill("Congé pour les observations");
    await p.getByText(/jour.* décompté/).waitFor({ timeout: 15000 });
    await Promise.all([p.waitForURL(/\/conges\/(?!nouvelle)[^/]+$/, { timeout: 20000 }), p.getByRole("button", { name: "Envoyer la demande" }).click()]);
    idConge = chemin(p).split("/").pop();

    await ctx.close();
  }

  // ── Le responsable approuve avec une observation ────────────────────────────────────────────────────────────────────
  {
    const { ctx, p } = await connecter("responsable-commercial@simassurances.test");
    await p.goto(`${B}/conges/${idConge}`);
    await p.waitForLoadState("networkidle");
    verifier("Responsable : le champ « Observations (facultatif) » accompagne la décision", (await p.getByLabel(/Observations \(facultatif\)/).count()) === 1);
    await p.getByLabel(/Observations \(facultatif\)/).fill("Dossier complet, remplacement assuré.");
    await p.getByRole("button", { name: "Approuver" }).click();
    await p.getByText("En attente de la RH", { exact: true }).first().waitFor({ timeout: 15000 });
    verifier("Congé approuvé par le responsable avec une observation", (await q(`SELECT count(*)::int AS n FROM "ObservationAbsence" WHERE "demandeCongeId" = $1 AND etape = 'RESPONSABLE'`, [idConge]))[0].n === 1);

    await ctx.close();
  }

  // ── La RH valide avec ses observations ──────────────────────────────────────────────────────────────────────────────
  {
    const { ctx, p } = await connecter("rh@simassurances.test");
    await p.goto(`${B}/conges/${idConge}`);
    await p.waitForLoadState("networkidle");
    verifier("RH : le congé montre déjà l'observation du responsable", (await texte(p)).includes("Dossier complet, remplacement assuré."));
    verifier("RH (non DG) : aucun formulaire d'observation du DG", (await p.getByLabel("Ajouter une observation (DG)").count()) === 0);
    await p.getByLabel(/Observations \(facultatif\)/).fill("Solde suffisant, validé par la RH.");
    await p.getByRole("button", { name: "Approuver" }).click();
    await p.getByText("Validée", { exact: true }).first().waitFor({ timeout: 15000 });
    verifier("Congé validé par la RH avec ses observations", (await q(`SELECT count(*)::int AS n FROM "ObservationAbsence" WHERE "demandeCongeId" = $1 AND etape = 'RH'`, [idConge]))[0].n === 1);

    // Un compte RH (non DG) rejoue l'observation du DG : refusée.
    const rep = await rejouer(p, "ajouterObservationCongeAction", [idConge, "Je ne suis pas le DG"], `/conges/${idConge}`);
    verifier("Action du DG rejouée par la RH : refusée", rep.includes("Seul le DG peut ajouter une observation"), rep.slice(-150));
    await ctx.close();
  }

  // ── Le DG (sans consulter_tous) voit tout et observe, statut inchangé ───────────────────────────────────────────────
  {
    const { ctx, p } = await connecter("dg@simassurances.test");
    await p.goto(`${B}/conges`);
    const menu = (await p.locator("nav").first().innerText()).replace(/\s+/g, " ");
    verifier("DG : « Toutes les demandes » dans le menu, sans permission consulter_tous", menu.includes("Toutes les demandes"), menu.slice(0, 200));
    await p.goto(`${B}/conges/toutes`);
    verifier("DG : /conges/toutes liste le congé du collaborateur", chemin(p) === "/conges/toutes" && (await p.locator(`a[href="/conges/${idConge}"]`).count()) === 1);

    const avant = (await q(`SELECT statut, "valideParId", "approuveParId" FROM "DemandeConge" WHERE id = $1`, [idConge]))[0];
    await p.goto(`${B}/conges/${idConge}`);
    await p.waitForLoadState("networkidle");
    const t = await texte(p);
    verifier("DG : voit les observations du responsable et de la RH", t.includes("Dossier complet, remplacement assuré.") && t.includes("Solde suffisant, validé par la RH."));
    await p.getByLabel("Ajouter une observation (DG)").fill("À suivre de près au retour.");
    await p.getByRole("button", { name: "Ajouter l'observation" }).click();
    await p.locator('[data-observation="DG"]', { hasText: "À suivre de près au retour." }).waitFor({ timeout: 15000 });
    const apres = (await q(`SELECT statut, "valideParId", "approuveParId" FROM "DemandeConge" WHERE id = $1`, [idConge]))[0];
    verifier("DG : l'observation ne change ni le statut ni les décideurs", apres.statut === avant.statut && apres.statut === "VALIDEE" && apres.valideParId === avant.valideParId && apres.approuveParId === avant.approuveParId);
    verifier("Une entrée d'historique par observation (3)", (await q(`SELECT count(*)::int AS n FROM "HistoriqueEntry" WHERE entity = 'DemandeConge' AND "entityId" = $1 AND action = 'observation'`, [idConge]))[0].n === 3);

    // Texte de 501 caractères rejoué : refusé, rien d'écrit.
    const avantN = (await q(`SELECT count(*)::int AS n FROM "ObservationAbsence"`))[0].n;
    const long = await rejouer(p, "ajouterObservationCongeAction", [idConge, "x".repeat(501)], `/conges/${idConge}`);
    verifier("Observation de 501 caractères rejouée : refusée", long.includes("500 caractères"), long.slice(-150));
    verifier("Rien d'écrit après ce refus", (await q(`SELECT count(*)::int AS n FROM "ObservationAbsence"`))[0].n === avantN);
    await ctx.close();
  }

  // ── Le demandeur voit les observations avec leur auteur, sans pouvoir en ajouter ────────────────────────────────────
  {
    const { ctx, p } = await connecter("collaborateur@simassurances.test");
    await p.goto(`${B}/conges/${idConge}`);
    const t = await texte(p);
    verifier("Demandeur : voit les trois observations", t.includes("Dossier complet, remplacement assuré.") && t.includes("Solde suffisant, validé par la RH.") && t.includes("À suivre de près au retour."));
    verifier("Demandeur : le nom de l'auteur accompagne chaque observation (RH et DG)", t.includes(nomRH) && t.includes(nomDG));
    verifier("Demandeur : aucun formulaire pour ajouter une observation", (await p.getByLabel("Ajouter une observation (DG)").count()) === 0);
    const rep = await rejouer(p, "ajouterObservationCongeAction", [idConge, "Je réponds"], `/conges/${idConge}`);
    verifier("Demandeur : l'action rejouée est refusée", rep.includes("Seul le DG peut ajouter une observation"), rep.slice(-150));
    await ctx.close();
  }

  // ── Notifications d'information : demandeur et RH, jamais le DG ─────────────────────────────────────────────────────
  const notifs = await q(`SELECT "userId", priority FROM "Notification" WHERE titre = 'Observation du DG'`);
  const destinataires = new Set(notifs.map((n) => n.userId));
  verifier("Notification d'information au demandeur et à la RH", destinataires.has(collab) && destinataires.has(rh), JSON.stringify([...destinataires]));
  verifier("Le DG n'est pas notifié de sa propre observation", !destinataires.has(dg));
  verifier("Priorité INFO (aucun rappel)", notifs.every((n) => n.priority === "INFO"));

  // ── Ajout seul, jusque dans la base ─────────────────────────────────────────────────────────────────────────────────
  let refusUpdate = "";
  try {
    await q(`UPDATE "ObservationAbsence" SET texte = 'modifiée' WHERE "demandeCongeId" = $1`, [idConge]);
  } catch (e) {
    refusUpdate = String(e);
  }
  verifier("Modification en base refusée (OBSERVATION_IMMUABLE)", /OBSERVATION_IMMUABLE/.test(refusUpdate), refusUpdate.slice(0, 100));

  // ── 390 px ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const { ctx, p } = await connecter("dg@simassurances.test", { width: 390, height: 844 });
    for (const c of ["/conges/toutes", `/conges/${idConge}`]) {
      await p.goto(`${B}${c}`);
      await p.waitForLoadState("networkidle");
      const largeur = await p.evaluate(() => document.documentElement.scrollWidth);
      verifier(`390 px : ${c.replace(/[0-9a-z]{20,}/, "[id]")} (dg) sans défilement horizontal`, largeur <= 390, `scrollWidth=${largeur}`);
    }
    await ctx.close();
  }
} finally {
  // Le DG retrouve ses permissions « consulter_tous ».
  for (const r of retirees) {
    await q(`INSERT INTO "RolePermission" ("roleId", "permissionId") VALUES ($1, $2) ON CONFLICT DO NOTHING`, [r.roleId, r.permissionId]);
  }
}

verifier("Aucune erreur JavaScript", erreursJs.length === 0, erreursJs.join(" | "));
await browser.close();
await db.end();
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko ? 1 : 0);
