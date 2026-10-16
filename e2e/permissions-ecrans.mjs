// Permissions d'absence — Lot 4 (2026-10-15) : écrans du module, sur base JETABLE (voir e2e/README.md).
// Parcours : demande (aperçu serveur) → responsable → RH → retour marqué (consommée, écart de 20 min), plafond mensuel
// atteint (soumission permise, dérogation motivée obligatoire à l'accord), rejet avec motif, annulation par le demandeur,
// aucune « modification demandée » pour une permission, accès (404 pour un tiers), 390 px sans défilement horizontal.
import { chromium } from "playwright";
import pg from "pg";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pg@localhost:5432/conges_d";
if (!/conges_|e2e/.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");

const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const aujourdhui = iso(new Date());

const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);

// Base remise à zéro côté permissions (jetable) ; plafonds connus pour le scénario.
await q(`DELETE FROM "PlageAbsenceAutorisee" WHERE "demandePermissionId" IS NOT NULL`);
await q(`DELETE FROM "DemandePermission"`);
await q(`DELETE FROM "HistoriqueEntry" WHERE entity = 'DemandePermission'`);
await q(`DELETE FROM "Notification" WHERE "lien" LIKE '/permissions-absence/%'`);
await q(`UPDATE "TypePermission" SET "dureeMaxHeures" = 3, "plafondMensuel" = 5 WHERE label = 'Rendez-vous médical'`);
await q(`UPDATE "TypePermission" SET "dureeMaxHeures" = 3, "plafondMensuel" = 1 WHERE label = 'Démarche administrative'`);
await q(`UPDATE "TypePermission" SET "dureeMaxHeures" = 4, "plafondMensuel" = 5 WHERE label = 'Autre'`);

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const erreursJs = [];
let compteurIp = 50 + (Date.now() % 150);
async function connecter(email, viewport) {
  // Une adresse différente par connexion : la limite de tentatives de /login est par adresse.
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `10.8.8.${(compteurIp++ % 240) + 10}` }, ...(viewport ? { viewport } : {}) });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(`${email}: ${e.message}`));
  await p.goto(`${B}/login`);
  await p.waitForLoadState("networkidle");
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', "password123");
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click('button[type="submit"]')]);
  return { ctx, p };
}
const URL_DETAIL = /\/permissions-absence\/(?!nouvelle$|a-decider$|parametrage$)[^/]+$/;
const texte = async (p) => p.locator("body").innerText();
const attendreTexte = async (p, t) => p.waitForFunction((x) => document.body.innerText.includes(x), t, { timeout: 15000 }).then(() => true, () => false);
const attendreStatut = async (id, attendu) => {
  for (let i = 0; i < 40; i++) {
    if ((await q(`SELECT statut FROM "DemandePermission" WHERE id = $1`, [id]))[0]?.statut === attendu) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};
const statutBase = async (id) => (await q(`SELECT statut FROM "DemandePermission" WHERE id = $1`, [id]))[0]?.statut;

async function deposer(p, { type, date, depart, retour, motif }) {
  await p.goto(`${B}/permissions-absence/nouvelle`);
  await p.waitForLoadState("networkidle");
  await p.getByLabel("Type de permission").selectOption({ label: type });
  await p.getByLabel(/^Date\b/).fill(date);
  await p.getByLabel("Heure de départ").fill(depart);
  await p.getByLabel("Retour prévu").fill(retour);
  await p.getByLabel(/^Motif\b/).fill(motif);
}
async function envoyer(p) {
  await Promise.all([p.waitForURL(URL_DETAIL, { timeout: 20000 }), p.getByRole("button", { name: "Envoyer la demande" }).click()]);
  return p.url().split("/").pop();
}
async function approuverEtape(email, id, attendu) {
  const { ctx, p } = await connecter(email);
  await p.goto(`${B}/permissions-absence/${id}`);
  await p.waitForLoadState("networkidle");
  await p.getByRole("button", { name: "Approuver", exact: true }).click();
  const ok = await attendreTexte(p, attendu);
  await ctx.close();
  return ok;
}

// ── Demande 1 : Rendez-vous médical, 09:00–11:00 ───────────────────────────────────────────────────────────────────────
let id1;
{
  const { ctx, p } = await connecter("collaborateur@simassurances.test");
  await p.goto(`${B}/permissions-absence`);
  await p.waitForLoadState("networkidle");
  const t0 = await texte(p);
  verifier("Mes permissions : page avec compteurs du mois et lien « Nouvelle demande »", t0.includes("Ce mois-ci") && t0.includes("Nouvelle demande"));

  await deposer(p, { type: "Rendez-vous médical", date: aujourdhui, depart: "09:00", retour: "11:00", motif: "Consultation chez le médecin" });
  const apercu = await attendreTexte(p, "Durée : 2h");
  verifier("Formulaire : l'aperçu du serveur affiche la durée (2h)", apercu);
  id1 = await envoyer(p);
  await p.waitForLoadState("networkidle");
  const t1 = await texte(p);
  verifier("Détail : statut « En attente du responsable »", t1.includes("En attente du responsable"));
  verifier("Détail : aucun bouton « Demander une modification » (pas de modification pour une permission)", !t1.includes("Demander une modification"));
  verifier("Détail : le demandeur n'a que « Annuler la demande » (ni Approuver ni Rejeter)", !t1.includes("Approuver") && t1.includes("Annuler la demande"));
  await ctx.close();
}

// ── Responsable puis RH ────────────────────────────────────────────────────────────────────────────────────────────────
{
  const { ctx, p } = await connecter("responsable-commercial@simassurances.test");
  await p.goto(`${B}/permissions-absence/a-decider`);
  await p.waitForLoadState("networkidle");
  const t = await texte(p);
  verifier("À décider (responsable) : la demande du collaborateur est listée", t.includes("Collaborateur Test"));
  await p.goto(`${B}/permissions-absence/${id1}`);
  await p.waitForLoadState("networkidle");
  const td = await texte(p);
  verifier("Détail (responsable) : pas de « Demander une modification »", !td.includes("Demander une modification"));
  await p.getByRole("button", { name: "Approuver", exact: true }).click();
  verifier("Responsable : approuve → « En attente de la RH »", await attendreTexte(p, "En attente de la RH"));
  verifier("Base : EN_ATTENTE_RH", (await statutBase(id1)) === "EN_ATTENTE_RH");
  await ctx.close();
}
verifier("RH : approuve → « Approuvée »", await approuverEtape("rh@simassurances.test", id1, "Approuvée"));
verifier("Base : APPROUVEE", await attendreStatut(id1, "APPROUVEE"));
{
  const plages = await q(`SELECT count(*)::int AS n FROM "PlageAbsenceAutorisee" WHERE "demandePermissionId" = $1`, [id1]);
  verifier("Base : une plage d'absence autorisée liée à la permission", plages[0].n === 1);
}

// ── Retour marqué par le demandeur (jour atteint), 20 minutes après l'heure prévue ───────────────────────────────────────
{
  const { ctx, p } = await connecter("collaborateur@simassurances.test");
  await p.goto(`${B}/permissions-absence/${id1}`);
  await p.waitForLoadState("networkidle");
  const t = await texte(p);
  verifier("Retour : le bloc « Retour » est proposé au demandeur", t.includes("Heure de retour réelle"));
  await p.getByLabel("Heure de retour réelle").fill("11:20");
  await p.getByRole("button", { name: "Enregistrer le retour" }).click();
  verifier("Retour : « Consommée » après l'enregistrement", await attendreStatut(id1, "CONSOMMEE"));
  await p.reload();
  await p.waitForLoadState("networkidle");
  const t2 = await texte(p);
  verifier("Retour : écart de 20 min signalé", t2.includes("20 min après l'heure prévue"));
  verifier("Base : CONSOMMEE avec retour réel 11:20", (await q(`SELECT statut, "heureRetourReelle" FROM "DemandePermission" WHERE id = $1`, [id1]))[0].heureRetourReelle === "11:20");
  await ctx.close();
}

// ── Plafond mensuel atteint : soumission permise avec avertissement, dérogation motivée à l'accord ───────────────────────
let id2, id3;
{
  const { ctx, p } = await connecter("collaborateur@simassurances.test");
  await deposer(p, { type: "Démarche administrative", date: aujourdhui, depart: "14:00", retour: "15:00", motif: "Retrait d'un document" });
  id2 = await envoyer(p);
  await ctx.close();
}
await approuverEtape("responsable-commercial@simassurances.test", id2, "En attente de la RH");
verifier("RH : première permission du type accordée (plafond 1 atteint ensuite)", await approuverEtape("rh@simassurances.test", id2, "Approuvée"));
{
  const { ctx, p } = await connecter("collaborateur@simassurances.test");
  await deposer(p, { type: "Démarche administrative", date: aujourdhui, depart: "16:00", retour: "17:00", motif: "Seconde démarche au tribunal" });
  const avert = await attendreTexte(p, "Le plafond mensuel est atteint");
  verifier("Formulaire : avertissement « plafond mensuel atteint » dans l'aperçu", avert);
  id3 = await envoyer(p);
  verifier("Plafond atteint : la soumission reste possible (EN_ATTENTE_RESPONSABLE)", (await statutBase(id3)) === "EN_ATTENTE_RESPONSABLE");
  await ctx.close();
}
await approuverEtape("responsable-commercial@simassurances.test", id3, "En attente de la RH");
{
  const { ctx, p } = await connecter("rh@simassurances.test");
  await p.goto(`${B}/permissions-absence/${id3}`);
  await p.waitForLoadState("networkidle");
  const t = await texte(p);
  verifier("RH : bloc « Accord avec dérogation » affiché", t.includes("Accord avec dérogation") && t.includes("Motif de la dérogation"));
  const approuver = p.getByRole("button", { name: "Approuver", exact: true });
  verifier("RH : le bouton « Approuver » ordinaire est grisé", await approuver.isDisabled());
  const accorder = p.getByRole("button", { name: "Accorder avec dérogation" });
  verifier("RH : « Accorder avec dérogation » grisé sans motif", await accorder.isDisabled());
  await p.getByLabel("Motif de la dérogation").fill("abc");
  verifier("RH : toujours grisé avec 3 caractères", await accorder.isDisabled());
  await p.getByLabel("Motif de la dérogation").fill("Urgence validée par la direction");
  verifier("RH : actif avec un motif de 5 caractères ou plus", await accorder.isEnabled());
  await accorder.click();
  verifier("RH : accord avec dérogation → « Approuvée »", await attendreStatut(id3, "APPROUVEE"));
  await p.reload();
  await p.waitForLoadState("networkidle");
  const t2 = await texte(p);
  verifier("Détail : la dérogation est affichée", t2.includes("Dérogation au plafond mensuel") && t2.includes("Urgence validée par la direction"));
  const base = (await q(`SELECT statut, "motifExceptionPlafond" FROM "DemandePermission" WHERE id = $1`, [id3]))[0];
  verifier("Base : APPROUVEE avec motifExceptionPlafond", base.statut === "APPROUVEE" && base.motifExceptionPlafond === "Urgence validée par la direction");
  await ctx.close();
}

// ── Rejet avec motif (le motif est vu par le demandeur) ──────────────────────────────────────────────────────────────────
const demain = iso(new Date(Date.now() + 86400000));
let id4;
{
  const { ctx, p } = await connecter("collaborateur@simassurances.test");
  await deposer(p, { type: "Autre", date: demain, depart: "10:00", retour: "11:00", motif: "Course personnelle importante" });
  id4 = await envoyer(p);
  await ctx.close();
}
{
  const { ctx, p } = await connecter("responsable-commercial@simassurances.test");
  await p.goto(`${B}/permissions-absence/${id4}`);
  await p.waitForLoadState("networkidle");
  await p.getByRole("button", { name: "Rejeter", exact: true }).click();
  const confirmer = p.getByRole("button", { name: "Confirmer le rejet" });
  verifier("Rejet : confirmation grisée sans motif", await confirmer.isDisabled());
  await p.getByLabel("Motif du rejet").fill("Charge de travail trop importante ce jour");
  await confirmer.click();
  verifier("Rejet : statut « Rejetée »", await attendreTexte(p, "Rejetée"));
  await ctx.close();
}
{
  const { ctx, p } = await connecter("collaborateur@simassurances.test");
  await p.goto(`${B}/permissions-absence/${id4}`);
  await p.waitForLoadState("networkidle");
  const t = await texte(p);
  verifier("Demandeur : voit le motif du rejet", t.includes("Motif du rejet : Charge de travail trop importante ce jour"));
  await ctx.close();
}

// ── Annulation par le demandeur ──────────────────────────────────────────────────────────────────────────────────────────
let id5;
{
  const { ctx, p } = await connecter("collaborateur@simassurances.test");
  await deposer(p, { type: "Autre", date: demain, depart: "12:00", retour: "13:00", motif: "Déjeuner avec un proche" });
  id5 = await envoyer(p);
  await p.getByRole("button", { name: "Annuler la demande" }).click();
  await p.getByLabel("Motif de l'annulation").fill("Plus nécessaire");
  await p.getByRole("button", { name: "Confirmer l'annulation" }).click();
  verifier("Annulation par le demandeur → « Annulée »", await attendreTexte(p, "Annulée"));
  verifier("Base : ANNULEE", (await statutBase(id5)) === "ANNULEE");
  await ctx.close();
}

// ── Accès : un tiers qui n'est ni demandeur, ni responsable, ni RH ne voit rien ───────────────────────────────────────────
{
  const { ctx, p } = await connecter("responsable-technique@simassurances.test");
  const r = await p.goto(`${B}/permissions-absence/${id1}`);
  verifier("Accès : le responsable d'un autre service obtient 404", r.status() === 404, `HTTP ${r.status()}`);
  await ctx.close();
}
{
  const { ctx, p } = await connecter("collaborateur@simassurances.test");
  const r = await p.goto(`${B}/permissions-absence/parametrage`);
  const url = p.url();
  verifier("Accès : le collaborateur n'accède pas au paramétrage des types", !url.endsWith("/permissions-absence/parametrage") || r.status() >= 400, url);
  await ctx.close();
}
{
  const { ctx, p } = await connecter("rh@simassurances.test");
  await p.goto(`${B}/permissions-absence/parametrage`);
  await p.waitForLoadState("networkidle");
  const t = await texte(p);
  verifier("Paramétrage (RH) : types et plafonds affichés", t.includes("Rendez-vous médical") && t.includes("Démarche administrative"));
  await ctx.close();
}

// ── 390 px, sans défilement horizontal ──────────────────────────────────────────────────────────────────────────────────
{
  const mobile = { width: 390, height: 844 };
  for (const [email, chemins] of [
    ["collaborateur@simassurances.test", ["/permissions-absence", "/permissions-absence/nouvelle", `/permissions-absence/${id1}`, `/permissions-absence/${id3}`]],
    ["responsable-commercial@simassurances.test", ["/permissions-absence/a-decider"]],
    ["rh@simassurances.test", ["/permissions-absence/parametrage", "/permissions-absence/a-decider", `/permissions-absence/${id3}`]],
  ]) {
    const { ctx, p } = await connecter(email, mobile);
    for (const chemin of chemins) {
      await p.goto(`${B}${chemin}`);
      await p.waitForLoadState("networkidle");
      const largeur = await p.evaluate(() => document.documentElement.scrollWidth);
      verifier(`390 px : ${chemin.replace(/[a-z0-9]{20,}/, ":id")} (${email.split("@")[0]}) sans défilement horizontal`, largeur <= 390, `scrollWidth=${largeur}`);
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
