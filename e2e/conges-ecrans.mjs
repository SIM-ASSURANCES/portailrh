// Congés — Lot 3c (2026-10-15) : écrans du module Congés, sur base JETABLE (voir e2e/README.md).
// Parcours : demande → responsable → RH (solde débité, plages créées) → annulation par la RH (solde recrédité),
// demande de modification puis resoumission, rejet avec motif, repli DG pour la demande d'un compte RH,
// congé d'office, droits d'accès (404, redirections), paramétrage des types, 390 px sans défilement horizontal.
import { chromium } from "playwright";
import pg from "pg";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pg@localhost:5432/conges_d";
if (!/conges_|e2e/.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");

const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const userId = async (email) => (await q(`SELECT id FROM "User" WHERE email = $1`, [email]))[0].id;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const lundi = (semaines) => {
  const d = new Date();
  d.setDate(d.getDate() + semaines * 7 - ((d.getDay() + 6) % 7));
  return d;
};
const plus = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);

// Base remise à zéro côté congés (jetable).
await q(`DELETE FROM "PlageAbsenceAutorisee" WHERE "demandeCongeId" IS NOT NULL`);
await q(`DELETE FROM "PieceJointeConge"`);
await q(`DELETE FROM "DemandeConge"`);
await q(`DELETE FROM "AjustementSolde"`);
await q(`DELETE FROM "SoldeConge"`);
await q(`DELETE FROM "Notification" WHERE category = 'RH' AND "lien" LIKE '/conges/%'`);

const collab = await userId("collaborateur@simassurances.test");

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const erreursJs = [];
let compteurIp = 10 + (Date.now() % 200);
async function connecter(email, viewport) {
  // Une adresse différente par connexion : la limite de tentatives de /login est par adresse.
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `10.9.9.${(compteurIp++ % 240) + 10}` }, ...(viewport ? { viewport } : {}) });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(`${email}: ${e.message}`));
  await p.goto(`${B}/login`);
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', "password123");
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click('button[type="submit"]')]);
  return { ctx, p };
}
const URL_DETAIL = /\/conges\/(?!nouvelle$|a-decider$|soldes$|parametrage$)[^/]+$/;
const texte = async (p) => p.locator("body").innerText();

async function deposer(p, { type, debut, fin, motif }) {
  await p.goto(`${B}/conges/nouvelle`);
  await p.getByLabel("Type de congé").selectOption({ label: type });
  await p.getByLabel("Date de début").fill(debut);
  await p.getByLabel("Date de fin").fill(fin);
  await p.getByLabel("Motif").fill(motif);
  return p;
}

const debut1 = iso(lundi(2));
const fin1 = iso(plus(lundi(2), 2)); // lundi → mercredi : 3 jours ouvrés
const debut2 = iso(lundi(4));
const fin2 = iso(plus(lundi(4), 1)); // 2 jours
const debut3 = iso(lundi(6));
const fin3 = iso(plus(lundi(6), 0)); // 1 jour

// ── Le collaborateur dépose une demande ────────────────────────────────────────────────────────────────────────────────
let idConge1;
{
  const { ctx, p } = await connecter("collaborateur@simassurances.test");
  await p.goto(`${B}/conges`);
  const t0 = await texte(p);
  verifier("Mes congés : page affichée avec un lien « Nouvelle demande »", t0.includes("Mes congés") && t0.includes("Nouvelle demande"));
  verifier("Mes congés : aucune demande au départ", t0.includes("encore déposé aucune demande"));

  await deposer(p, { type: "Congé annuel", debut: debut1, fin: fin1, motif: "Congé annuel de test e2e" });
  await p.getByText(/3 jours décomptés/).waitFor({ timeout: 15000 });
  verifier("Aperçu : 3 jours décomptés et solde de l'exercice (30 jours)", (await texte(p)).includes("30 jour(s) avant cette demande"));
  await Promise.all([p.waitForURL(URL_DETAIL, { timeout: 20000 }), p.getByRole("button", { name: "Envoyer la demande" }).click()]);
  idConge1 = new URL(p.url()).pathname.split("/").pop();
  const t1 = await texte(p);
  verifier("Demande déposée : statut « En attente du responsable »", t1.includes("En attente du responsable") && t1.includes("CNG-"));
  const ligne = (await q(`SELECT statut, "nbJours", "etapeResponsableRequise" FROM "DemandeConge" WHERE id = $1`, [idConge1]))[0];
  verifier("Base : EN_ATTENTE_RESPONSABLE, 3 jours, étape responsable requise", ligne.statut === "EN_ATTENTE_RESPONSABLE" && ligne.nbJours === 3 && ligne.etapeResponsableRequise === true);
  verifier("Le demandeur ne voit pas de boutons de décision (Approuver absent)", (await p.getByRole("button", { name: "Approuver" }).count()) === 0);
  await ctx.close();
}

// ── Le responsable de service, puis la RH ──────────────────────────────────────────────────────────────────────────────
{
  const { ctx, p } = await connecter("responsable-commercial@simassurances.test");
  await p.goto(`${B}/conges/a-decider`);
  verifier("Responsable : la demande est dans « À décider »", (await texte(p)).includes("Congé annuel") && (await p.locator(`a[href="/conges/${idConge1}"]`).count()) === 1);
  await p.goto(`${B}/conges/${idConge1}`);
  await p.getByRole("button", { name: "Approuver" }).click();
  await p.getByText("En attente de la RH", { exact: true }).waitFor({ timeout: 15000 });
  verifier("Après l'approbation du responsable : « En attente de la RH »", true);
  // Il ne peut plus décider : les boutons sont grisés.
  const grise = await p.getByRole("button", { name: "Approuver" }).isDisabled();
  verifier("Le responsable ne peut plus approuver (bouton grisé)", grise);
  await ctx.close();
}
{
  const { ctx, p } = await connecter("rh@simassurances.test");
  await p.goto(`${B}/conges/a-decider`);
  verifier("RH : la demande est dans « À décider »", (await p.locator(`a[href="/conges/${idConge1}"]`).count()) === 1);
  await p.goto(`${B}/conges/${idConge1}`);
  await p.getByRole("button", { name: "Approuver" }).click();
  await p.getByText("Validée", { exact: true }).first().waitFor({ timeout: 15000 });
  const s = (await q(`SELECT s."soldeRestant", d."joursDebites" FROM "DemandeConge" d JOIN "SoldeConge" s ON s.id = d."soldeCongeId" WHERE d.id = $1`, [idConge1]))[0];
  verifier("Validée par la RH : solde débité (30 → 27)", s && s.soldeRestant === 27 && s.joursDebites === 3);
  const plages = (await q(`SELECT count(*)::int AS n FROM "PlageAbsenceAutorisee" WHERE "demandeCongeId" = $1`, [idConge1]))[0].n;
  verifier("Une plage d'absence autorisée par jour décompté (3)", plages === 3);
  await ctx.close();
}
{
  const { ctx, p } = await connecter("collaborateur@simassurances.test");
  await p.goto(`${B}/conges`);
  const t = await texte(p);
  verifier("Mes congés : solde 27 / 30 jours affiché", /27\s*\/ 30 jours/.test(t.replace(/\n/g, " ")));
  await ctx.close();
}

// ── Demande de modification puis resoumission ─────────────────────────────────────────────────────────────────────────
let idConge2;
{
  const a = await connecter("collaborateur@simassurances.test");
  await deposer(a.p, { type: "Congé annuel", debut: debut2, fin: fin2, motif: "Deuxième demande e2e" });
  await Promise.all([a.p.waitForURL(URL_DETAIL, { timeout: 20000 }), a.p.getByRole("button", { name: "Envoyer la demande" }).click()]);
  idConge2 = new URL(a.p.url()).pathname.split("/").pop();
  await a.ctx.close();

  const r = await connecter("responsable-commercial@simassurances.test");
  await r.p.goto(`${B}/conges/${idConge2}`);
  await r.p.getByRole("button", { name: "Demander une modification" }).click();
  await r.p.getByLabel("Modification demandée").fill("Précisez les dates avec votre interim");
  await r.p.getByRole("button", { name: "Demander la modification" }).click();
  await r.p.getByText("Modification demandée", { exact: true }).first().waitFor({ timeout: 15000 });
  verifier("Le responsable peut demander une modification (statut MODIFICATION_DEMANDEE)", (await q(`SELECT statut FROM "DemandeConge" WHERE id = $1`, [idConge2]))[0].statut === "MODIFICATION_DEMANDEE");
  await r.ctx.close();

  const c = await connecter("collaborateur@simassurances.test");
  await c.p.goto(`${B}/conges/${idConge2}`);
  verifier("Le demandeur voit le motif de la modification demandée", (await texte(c.p)).includes("Précisez les dates avec votre interim"));
  await c.p.getByRole("link", { name: "Modifier et renvoyer" }).click();
  await c.p.waitForURL(/\/modifier$/);
  await c.p.getByLabel("Motif").fill("Deuxième demande e2e, interim : Marie");
  await Promise.all([c.p.waitForURL(URL_DETAIL, { timeout: 20000 }), c.p.getByRole("button", { name: "Renvoyer la demande" }).click()]);
  const l = (await q(`SELECT statut, motif FROM "DemandeConge" WHERE id = $1`, [idConge2]))[0];
  verifier("Resoumission : retour à EN_ATTENTE_RESPONSABLE avec le motif corrigé", l.statut === "EN_ATTENTE_RESPONSABLE" && l.motif.includes("Marie"));
  await c.ctx.close();
}

// ── Rejet avec motif ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const r = await connecter("responsable-commercial@simassurances.test");
  await r.p.goto(`${B}/conges/${idConge2}`);
  await r.p.getByRole("button", { name: "Rejeter" }).click();
  const confirmer = r.p.getByRole("button", { name: "Confirmer le rejet" });
  verifier("Rejet : le bouton de confirmation est grisé sans motif", await confirmer.isDisabled());
  await r.p.getByLabel("Motif du rejet").fill("Période de clôture comptable");
  await confirmer.click();
  await r.p.getByText("Rejetée", { exact: true }).first().waitFor({ timeout: 15000 });
  await r.ctx.close();
  const c = await connecter("collaborateur@simassurances.test");
  await c.p.goto(`${B}/conges/${idConge2}`);
  verifier("Le demandeur voit le motif du rejet", (await texte(c.p)).includes("Période de clôture comptable"));
  await c.ctx.close();
}

// ── Annulation par la RH : solde recrédité, plages supprimées ───────────────────────────────────────────────────────────
{
  const { ctx, p } = await connecter("rh@simassurances.test");
  await p.goto(`${B}/conges/${idConge1}`);
  await p.getByRole("button", { name: "Annuler la demande" }).click();
  await p.getByLabel("Motif de l'annulation").fill("Annulation de test e2e");
  await p.getByRole("button", { name: "Confirmer l'annulation" }).click();
  await p.getByText("Annulée", { exact: true }).first().waitFor({ timeout: 15000 });
  const s = (await q(`SELECT s."soldeRestant" FROM "SoldeConge" s WHERE s."userId" = $1`, [collab]))[0];
  verifier("Annulation par la RH : solde recrédité (27 → 30)", s.soldeRestant === 30);
  verifier("Annulation : plages d'absence supprimées", (await q(`SELECT count(*)::int AS n FROM "PlageAbsenceAutorisee" WHERE "demandeCongeId" = $1`, [idConge1]))[0].n === 0);
  await ctx.close();
}

// ── Repli : la demande d'un compte RH est décidée par le DG, jamais par lui-même ──────────────────────────────────────
let idRH;
{
  const a = await connecter("rh@simassurances.test");
  await deposer(a.p, { type: "Congé annuel", debut: debut3, fin: fin3, motif: "Demande du compte RH" });
  await Promise.all([a.p.waitForURL(URL_DETAIL, { timeout: 20000 }), a.p.getByRole("button", { name: "Envoyer la demande" }).click()]);
  idRH = new URL(a.p.url()).pathname.split("/").pop();
  const t = await texte(a.p);
  verifier("Compte RH : sa demande attend la RH (étape responsable non requise : il est son propre responsable)", t.includes("En attente de la RH"));
  verifier("Compte RH : il ne peut pas décider de sa propre demande (Approuver absent)", (await a.p.getByRole("button", { name: "Approuver" }).count()) === 0);
  await a.ctx.close();
  const d = await connecter("dg@simassurances.test");
  await d.p.goto(`${B}/conges/a-decider`);
  verifier("DG : la demande du compte RH est dans sa file", (await d.p.locator(`a[href="/conges/${idRH}"]`).count()) === 1);
  await d.p.goto(`${B}/conges/${idRH}`);
  await d.p.getByRole("button", { name: "Approuver" }).click();
  await d.p.getByText("Validée", { exact: true }).first().waitFor({ timeout: 15000 });
  verifier("DG : décision à la place de la RH (VALIDEE)", (await q(`SELECT statut FROM "DemandeConge" WHERE id = $1`, [idRH]))[0].statut === "VALIDEE");
  await d.ctx.close();
}

// ── Congé d'office, soldes, types ────────────────────────────────────────────────────────────────────────────────────────
{
  const { ctx, p } = await connecter("rh@simassurances.test");
  await p.goto(`${B}/conges/soldes`);
  verifier("Soldes : page RH affichée", (await texte(p)).includes("Soldes de congé"));
  await p.getByText("Accorder un congé d'office").click();
  const debutO = iso(lundi(8));
  await p.locator("details").getByLabel("Collaborateur").selectOption({ value: collab });
  await p.locator("details").getByLabel("Type de congé").selectOption({ label: "Congé annuel" });
  await p.locator("details").getByLabel("Date de début").fill(debutO);
  await p.locator("details").getByLabel("Date de fin").fill(debutO);
  await p.locator("details").getByLabel("Motif").fill("Congé collectif de test");
  await Promise.all([p.waitForURL(URL_DETAIL, { timeout: 20000 }), p.getByRole("button", { name: "Accorder le congé" }).click()]);
  const statut = (await q(`SELECT statut FROM "DemandeConge" WHERE "userId" = $1 AND "dateDebut" = $2`, [collab, debutO]))[0]?.statut;
  verifier("Congé d'office : accordé directement (VALIDEE)", statut === "VALIDEE");

  await p.goto(`${B}/conges/parametrage`);
  await p.getByRole("button", { name: "Nouveau type" }).click();
  await p.getByLabel("Libellé").fill("Type de test e2e");
  await p.getByLabel("Code").fill("TEST_E2E");
  await p.getByRole("button", { name: "Créer le type" }).click();
  await p.getByText("Type de test e2e").first().waitFor({ timeout: 15000 });
  verifier("Paramétrage : un type est créé", (await q(`SELECT count(*)::int AS n FROM "TypeConge" WHERE code = 'TEST_E2E'`))[0].n === 1);
  await ctx.close();
}

// ── Droits d'accès ──────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const m = await connecter("responsable-marketing@simassurances.test");
  const r = await m.p.goto(`${B}/conges/${idConge1}`);
  verifier("Un autre collaborateur (autre service) reçoit 404 sur la demande", r.status() === 404);
  const piece = await q(`SELECT id FROM "PieceJointeConge" LIMIT 1`);
  verifier("(aucune pièce en base pour ce parcours : contrôle B1 couvert par le script de la couche base)", piece.length === 0);
  await m.p.goto(`${B}/conges/soldes`);
  verifier("Un collaborateur est redirigé hors de /conges/soldes", !new URL(m.p.url()).pathname.startsWith("/conges/soldes"));
  await m.p.goto(`${B}/conges/parametrage`);
  verifier("Un collaborateur est redirigé hors de /conges/parametrage", !new URL(m.p.url()).pathname.startsWith("/conges/parametrage"));
  await m.ctx.close();
}

// ── 390 px, sans défilement horizontal ──────────────────────────────────────────────────────────────────────────────────
{
  const mobile = { width: 390, height: 844 };
  for (const [email, chemins] of [
    ["collaborateur@simassurances.test", ["/conges", "/conges/nouvelle", `/conges/${idConge1}`]],
    ["responsable-commercial@simassurances.test", ["/conges/a-decider"]],
    ["rh@simassurances.test", ["/conges/soldes", "/conges/parametrage", "/conges/a-decider"]],
  ]) {
    const { ctx, p } = await connecter(email, mobile);
    for (const chemin of chemins) {
      await p.goto(`${B}${chemin}`);
      await p.waitForLoadState("networkidle");
      const largeur = await p.evaluate(() => document.documentElement.scrollWidth);
      verifier(`390 px : ${chemin} (${email.split("@")[0]}) sans défilement horizontal`, largeur <= 390, `scrollWidth=${largeur}`);
    }
    if (process.env.E2E_CAPTURES && email.startsWith("rh")) await p.screenshot({ path: `${process.env.E2E_CAPTURES}/conges-soldes-mobile.png`, fullPage: true });
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
