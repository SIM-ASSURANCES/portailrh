// Recette Playwright de bout en bout du module Congés (T11).
// Exécuté sur une base PostgreSQL jetable (voir e2e/README.md).
//
// Usage :
//   PLANIFICATEUR_ACTIF=false bash e2e/base-jetable.sh
//   node e2e/conges-recette.mjs
//   bash e2e/arreter.sh

import fs from "fs";
import pg from "pg";
import { chromium } from "playwright";
import ExcelJS from "exceljs";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:(55497|45497)|jetable|e2e/.test(DB)) {
  throw new Error("E2E_DATABASE_URL doit viser une base jetable.");
}

const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const userId = async (email) => (await q(`SELECT id FROM "User" WHERE email = $1`, [email]))[0].id;

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const ajouterJours = (d, n) => {
  const res = new Date(d);
  res.setDate(res.getDate() + n);
  return res;
};

const estWeekEnd = (d) => d.getDay() === 0 || d.getDay() === 6;

const prochainLundi = (d, minJours = 0) => {
  const cible = ajouterJours(d, minJours);
  while (cible.getDay() !== 1) {
    cible.setDate(cible.getDate() + 1);
  }
  return cible;
};

const prochainsJoursOuvres = (d, n) => {
  const res = [];
  let cur = new Date(d);
  while (res.length < n) {
    if (!estWeekEnd(cur)) res.push(iso(cur));
    cur = ajouterJours(cur, 1);
  }
  return res;
};

const derniersJoursOuvres = (d, n) => {
  const res = [];
  let cur = ajouterJours(d, -1);
  while (res.length < n) {
    if (!estWeekEnd(cur)) res.unshift(iso(cur));
    cur = ajouterJours(cur, -1);
  }
  return res;
};

const attenteMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const resultats = [];
// Une exception (sélecteur introuvable, délai dépassé) affiche quand même les contrôles déjà passés.
process.on("uncaughtException", (e) => {
  console.log(resultats.join("\n"));
  console.error("ARRÊT :", e.message.split("\n")[0]);
  process.exit(1);
});
async function verifier(num, nom, ok, detail = "", page = null) {
  if (ok) {
    resultats.push(`OK ${num} — ${nom}`);
  } else {
    resultats.push(`KO ${num} — ${nom}${detail ? ` (${detail})` : ""}`);
    if (page) {
      try {
        const dir = "./e2e-captures";
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const capturePath = `${dir}/${num.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;
        await page.screenshot({ path: capturePath, fullPage: true });
      } catch (err) {
        console.error("Échec de la capture d'écran :", err.message);
      }
    }
  }
}

// ── Configuration préalable en base ─────────────────────────────────────────────────────────────────
// Antidate createdAt pour tous les utilisateurs afin que la règle d'entrée en vigueur (Option B)
// n'annule pas la création d'absences lors des tests de jours passés.
await q(`UPDATE "User" SET "createdAt" = now() - interval '60 days'`);
// Nettoyage des tables de congés et des notifications RH pour repartir sur un état propre.
await q(`DELETE FROM "PlageAbsenceAutorisee" WHERE "demandeCongeId" IS NOT NULL`);
await q(`DELETE FROM "Notification" WHERE category = 'RH'`);
await q(`DELETE FROM "DemandeConge"`);

const collabId = await userId("collaborateur@simassurances.test");
const respCommercialId = await userId("responsable-commercial@simassurances.test");
const respTechId = await userId("responsable-technique@simassurances.test");
const respMktId = await userId("responsable-marketing@simassurances.test");
const rhId = await userId("rh@simassurances.test");
const dgId = await userId("dg@simassurances.test");
const adminId = await userId("admin@simassurances.test");

const browser = await chromium.launch(
  process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}
);
const erreursJs = [];

// Session mémorisée par compte : la connexion est limitée à 5 tentatives par minute et par compte (checkRateLimit).
const sessions = new Map();
async function connecter(email, viewport) {
  const ctx = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" },
    acceptDownloads: true,
    ...(viewport ? { viewport } : {}),
    ...(sessions.has(email) ? { storageState: sessions.get(email) } : {}),
  });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(`[${email}] ${e.message}`));
  if (sessions.has(email)) return { ctx, p };
  await p.goto(`${B}/login`);
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', "password123");
  await Promise.all([
    p.waitForURL((u) => !u.pathname.startsWith("/login")),
    p.click('button[type="submit"]'),
  ]);
  sessions.set(email, await ctx.storageState());
  return { ctx, p };
}

/**
 * Clique sur le bouton d'envoi et attend que l'URL change vers /conges/<id>
 * (exclut explicitement l'écran de départ et /modifier pour ne pas résoudre prématurément).
 */
async function soumettreEtAttendreId(page, ancienChemin = "/conges/nouvelle") {
  const btn = page.getByRole("button", { name: /Envoyer la demande|Renvoyer la demande/ });
  await btn.waitFor({ state: "visible" });
  await Promise.all([
    page.waitForURL(
      (u) =>
        u.pathname.startsWith("/conges/") &&
        u.pathname !== ancienChemin &&
        !u.pathname.endsWith("/modifier")
    ),
    btn.click(),
  ]);
  const url = page.url();
  return url.split("/conges/")[1].split("?")[0];
}

// ── Scénario 1 ───────────────────────────────────────────────────────────────────────────────────────
// collaborateur@ demande un congé (dans 7 jours, 3 jours) → responsable-commercial@ valide
// → rh@ valide avec une observation → statut « Validé » à l'écran du collaborateur ; en base, plages provisoire = false.
let demandeId1 = null;
let requeteSoumissionValide = null;
{
  const debut1 = prochainLundi(new Date(), 7);
  const fin1 = ajouterJours(debut1, 2); // 3 jours ouvrés (lundi au mercredi)

  const a = await connecter("collaborateur@simassurances.test");
  a.p.on("request", (req) => {
    if (req.method() === "POST" && req.headers()["next-action"]) {
      requeteSoumissionValide = {
        url: req.url(),
        headers: req.headers(),
        postData: req.postData(),
      };
    }
  });

  await a.p.goto(`${B}/conges/nouvelle`);
  await a.p.getByLabel("Motif").fill("Congé annuel 3 jours collaborateur");
  await a.p.getByLabel("Date de début").fill(iso(debut1));
  await a.p.getByLabel("Date de fin").fill(iso(fin1));
  await a.p.waitForTimeout(400);

  demandeId1 = await soumettreEtAttendreId(a.p, "/conges/nouvelle");
  await a.ctx.close();

  const d1 = (await q('SELECT * FROM "DemandeConge" WHERE id = $1', [demandeId1]))[0];
  const plages1 = await q('SELECT * FROM "PlageAbsenceAutorisee" WHERE "demandeCongeId" = $1', [demandeId1]);
  await verifier(
    "1.a",
    "collaborateur@ soumet sa demande → statut EN_ATTENTE_RESPONSABLE et plages provisoires",
    d1?.statut === "EN_ATTENTE_RESPONSABLE" && plages1.length === 3 && plages1.every((pl) => pl.provisoire === true),
    `statut=${d1?.statut}, plages=${plages1.length}`
  );

  // Validation par le responsable commercial
  const b = await connecter("responsable-commercial@simassurances.test");
  await b.p.goto(`${B}/conges/${demandeId1}`);
  await b.p.getByRole("button", { name: "Valider" }).click();
  for (let i = 0; i < 30; i++) {
    const check = (await q('SELECT statut FROM "DemandeConge" WHERE id = $1', [demandeId1]))[0];
    if (check?.statut === "EN_ATTENTE_RH") break;
    await attenteMs(200);
  }
  const d1_step2 = (await q('SELECT * FROM "DemandeConge" WHERE id = $1', [demandeId1]))[0];
  await verifier(
    "1.b",
    "responsable-commercial@ valide → statut EN_ATTENTE_RH en base",
    d1_step2?.statut === "EN_ATTENTE_RH" && d1_step2?.approuveParId === respCommercialId,
    `statut=${d1_step2?.statut}`,
    b.p
  );
  await b.ctx.close();

  // Validation par la RH avec observation
  const c = await connecter("rh@simassurances.test");
  await c.p.goto(`${B}/conges/${demandeId1}`);
  await c.p.getByLabel(/Observation RH/i).fill("Observation RH : Bonnes vacances");
  await c.p.getByRole("button", { name: "Valider" }).click();
  for (let i = 0; i < 30; i++) {
    const check = (await q('SELECT statut FROM "DemandeConge" WHERE id = $1', [demandeId1]))[0];
    if (check?.statut === "VALIDEE") break;
    await attenteMs(200);
  }
  const d1_step3 = (await q('SELECT * FROM "DemandeConge" WHERE id = $1', [demandeId1]))[0];
  await verifier(
    "1.c",
    "rh@ valide avec observation → statut VALIDEE et observationRH en base",
    d1_step3?.statut === "VALIDEE" &&
      d1_step3?.valideParId === rhId &&
      (d1_step3?.observationRH ?? "").includes("Bonnes vacances"),
    `statut=${d1_step3?.statut}, obs=${d1_step3?.observationRH}`,
    c.p
  );
  await c.ctx.close();

  // Contrôle côté collaborateur : statut « Validé » à l'écran et plages définitives
  const d = await connecter("collaborateur@simassurances.test");
  await d.p.goto(`${B}/conges/${demandeId1}`);
  const corps1 = await d.p.locator("main").innerText();
  const plages1_finales = await q('SELECT * FROM "PlageAbsenceAutorisee" WHERE "demandeCongeId" = $1', [demandeId1]);
  await verifier(
    "1.d",
    "collaborateur@ voit le statut « Validé » à l'écran",
    /Validé/i.test(corps1),
    corps1.slice(0, 150),
    d.p
  );
  await verifier(
    "1.e",
    "En base, les plages de la demande validée ont provisoire = false",
    plages1_finales.length === 3 && plages1_finales.every((pl) => pl.provisoire === false),
    `plages=${plages1_finales.length}, provisoires=${plages1_finales.filter((p) => p.provisoire).length}`
  );
  await d.ctx.close();
}

// ── Scénario 2 ───────────────────────────────────────────────────────────────────────────────────────
// responsable-commercial@ demande un congé → frise : étape responsable « non requise » ;
// la demande est dans « À décider » de rh@, pas dans celle de responsable-commercial@.
let demandeId2 = null;
{
  const debut2 = prochainLundi(new Date(), 14);
  const fin2 = ajouterJours(debut2, 2);

  const a = await connecter("responsable-commercial@simassurances.test");
  await a.p.goto(`${B}/conges/nouvelle`);
  await a.p.getByLabel("Motif").fill("Congé responsable commercial test");
  await a.p.getByLabel("Date de début").fill(iso(debut2));
  await a.p.getByLabel("Date de fin").fill(iso(fin2));
  await a.p.waitForTimeout(400);

  demandeId2 = await soumettreEtAttendreId(a.p, "/conges/nouvelle");

  const etapeResp = a.p.locator('li[data-etape="RESPONSABLE"]');
  const etatResp = await etapeResp.getAttribute("data-etat");
  const texteResp = await etapeResp.innerText();
  await verifier(
    "2.a",
    "responsable-commercial@ demande un congé → frise : étape responsable « non requise »",
    etatResp === "non_requise" && /non requise/i.test(texteResp),
    `etat=${etatResp}, texte=${texteResp}`,
    a.p
  );

  await a.p.goto(`${B}/conges/a-decider`);
  const presentDansSaPropreFile = (await a.p.locator(`a[href="/conges/${demandeId2}"]`).count()) > 0;
  await verifier(
    "2.b",
    "La demande est absente de la file « À décider » de responsable-commercial@",
    !presentDansSaPropreFile,
    `present=${presentDansSaPropreFile}`,
    a.p
  );
  await a.ctx.close();

  const b = await connecter("rh@simassurances.test");
  await b.p.goto(`${B}/conges/a-decider`);
  const presentDansFileRH = (await b.p.locator(`a[href="/conges/${demandeId2}"]`).count()) > 0;
  await verifier(
    "2.c",
    "La demande est présente dans la file « À décider » de rh@",
    presentDansFileRH,
    `present=${presentDansFileRH}`,
    b.p
  );
  await b.ctx.close();
}

// ── Scénario 3 ───────────────────────────────────────────────────────────────────────────────────────
// rh@ demande un congé → elle va au DG (repli O1, provisoire) : dg@ la voit et peut décider.
// dg@ ne voit AUCUN bouton de décision sur la demande du scénario 1 (déjà validée) ni sur une demande
// d'un collaborateur en attente du responsable.
let demandeId3 = null;
let demandeIdAttenteResp = null;
{
  const debut3 = prochainLundi(new Date(), 21);
  const fin3 = ajouterJours(debut3, 2);

  const a = await connecter("rh@simassurances.test");
  await a.p.goto(`${B}/conges/nouvelle`);
  await a.p.getByLabel("Motif").fill("Congé annuel RH pour repli DG");
  await a.p.getByLabel("Date de début").fill(iso(debut3));
  await a.p.getByLabel("Date de fin").fill(iso(fin3));
  await a.p.waitForTimeout(400);

  demandeId3 = await soumettreEtAttendreId(a.p, "/conges/nouvelle");
  await a.ctx.close();

  // Soumission d'une demande par un collaborateur, restant en attente du responsable
  const debutAttente = prochainLundi(new Date(), 28);
  const finAttente = ajouterJours(debutAttente, 2);
  const col = await connecter("collaborateur@simassurances.test");
  await col.p.goto(`${B}/conges/nouvelle`);
  await col.p.getByLabel("Motif").fill("Demande collaborateur en attente responsable");
  await col.p.getByLabel("Date de début").fill(iso(debutAttente));
  await col.p.getByLabel("Date de fin").fill(iso(finAttente));
  await col.p.waitForTimeout(400);
  demandeIdAttenteResp = await soumettreEtAttendreId(col.p, "/conges/nouvelle");
  await col.ctx.close();

  // Vérifications par le DG
  const dg = await connecter("dg@simassurances.test");
  await dg.p.goto(`${B}/conges/a-decider`);
  const dgVoitDemandeRH = (await dg.p.locator(`a[href="/conges/${demandeId3}"]`).count()) > 0;
  await verifier(
    "3.a",
    "rh@ demande un congé → elle va au DG : dg@ la voit dans « À décider »",
    dgVoitDemandeRH,
    `demandeId3=${demandeId3}`,
    dg.p
  );

  await dg.p.goto(`${B}/conges/${demandeId3}`);
  const btnValiderRH = dg.p.getByRole("button", { name: "Valider" });
  const dgPeutDecider = !(await btnValiderRH.isDisabled());
  await verifier(
    "3.b",
    "dg@ peut décider sur la demande de la RH (bouton Valider actif)",
    dgPeutDecider,
    `disabled=${await btnValiderRH.isDisabled()}`,
    dg.p
  );

  // Demande 1 (déjà validée) : aucun bouton de décision actif pour dg@
  await dg.p.goto(`${B}/conges/${demandeId1}`);
  const btnValider1 = dg.p.getByRole("button", { name: "Valider" });
  const btnRefuser1 = dg.p.getByRole("button", { name: "Refuser" });
  const boutonsDesactives1 = (await btnValider1.isDisabled()) && (await btnRefuser1.isDisabled());
  await verifier(
    "3.c",
    "dg@ ne voit aucun bouton de décision actif sur la demande du scénario 1 (déjà validée)",
    boutonsDesactives1,
    `valider=${await btnValider1.isDisabled()}, refuser=${await btnRefuser1.isDisabled()}`,
    dg.p
  );

  // Demande en attente du responsable : aucun bouton de décision actif pour dg@
  await dg.p.goto(`${B}/conges/${demandeIdAttenteResp}`);
  const btnValiderAtt = dg.p.getByRole("button", { name: "Valider" });
  const btnRefuserAtt = dg.p.getByRole("button", { name: "Refuser" });
  const boutonsDesactivesAtt = (await btnValiderAtt.isDisabled()) && (await btnRefuserAtt.isDisabled());
  await verifier(
    "3.d",
    "dg@ ne voit aucun bouton de décision actif sur une demande en attente du responsable",
    boutonsDesactivesAtt,
    `valider=${await btnValiderAtt.isDisabled()}, refuser=${await btnRefuserAtt.isDisabled()}`,
    dg.p
  );
  await dg.ctx.close();
}

// ── Scénario 4 ───────────────────────────────────────────────────────────────────────────────────────
// Crée (par l'écran Admin ou en base, à commenter) un membre d'Informatique qui demande un congé
// → admin@ (responsable d'Informatique) le voit dans « À décider » et le valide.
let demandeId4 = null;
{
  // Scénario 4 : création directe en base d'un collaborateur rattaché au service Informatique
  const serviceInfo = (await q(`SELECT id FROM "Service" WHERE name = 'Informatique'`))[0].id;
  const roleCollab = (await q(`SELECT "roleId" FROM "User" WHERE email = 'collaborateur@simassurances.test'`))[0].roleId;
  const pwdHash = (await q(`SELECT "passwordHash" FROM "User" WHERE email = 'collaborateur@simassurances.test'`))[0].passwordHash;
  await q(
    `INSERT INTO "User" (id, "fullName", email, "passwordHash", "roleId", "serviceId", "isActive", "createdAt", "updatedAt")
     VALUES ('e2e-membre-info', 'Membre Info Test', 'membre-info@simassurances.test', $1, $2, $3, true, now() - interval '60 days', now())
     ON CONFLICT (email) DO UPDATE SET "serviceId" = $3, "isActive" = true`,
    [pwdHash, roleCollab, serviceInfo]
  );

  const debut4 = prochainLundi(new Date(), 35);
  const fin4 = ajouterJours(debut4, 2);

  const m = await connecter("membre-info@simassurances.test");
  await m.p.goto(`${B}/conges/nouvelle`);
  await m.p.getByLabel("Motif").fill("Congé membre informatique");
  await m.p.getByLabel("Date de début").fill(iso(debut4));
  await m.p.getByLabel("Date de fin").fill(iso(fin4));
  await m.p.waitForTimeout(400);

  demandeId4 = await soumettreEtAttendreId(m.p, "/conges/nouvelle");
  await m.ctx.close();

  const adm = await connecter("admin@simassurances.test");
  await adm.p.goto(`${B}/conges/a-decider`);
  const adminVoitDansFile = (await adm.p.locator(`a[href="/conges/${demandeId4}"]`).count()) > 0;
  await verifier(
    "4.a",
    "admin@ (responsable d'Informatique) voit la demande du membre d'Informatique dans « À décider »",
    adminVoitDansFile,
    `demandeId4=${demandeId4}`,
    adm.p
  );

  await adm.p.goto(`${B}/conges/${demandeId4}`);
  await adm.p.getByRole("button", { name: "Valider" }).click();
  for (let i = 0; i < 30; i++) {
    const check = (await q('SELECT statut FROM "DemandeConge" WHERE id = $1', [demandeId4]))[0];
    if (check?.statut === "EN_ATTENTE_RH") break;
    await attenteMs(200);
  }
  const d4 = (await q('SELECT * FROM "DemandeConge" WHERE id = $1', [demandeId4]))[0];
  await verifier(
    "4.b",
    "admin@ valide la demande du membre d'Informatique → approuveParId = adminId",
    d4?.statut === "EN_ATTENTE_RH" && d4?.approuveParId === adminId,
    `statut=${d4?.statut}, approuvePar=${d4?.approuveParId}`,
    adm.p
  );
  await adm.ctx.close();
}

// ── Scénario 5 ───────────────────────────────────────────────────────────────────────────────────────
// Demande de modification par le responsable → le collaborateur modifie les dates et renvoie
// → la demande repart à l'étape responsable ; en base, les plages couvrent les NOUVELLES dates seulement.
let demandeId5 = null;
{
  const debut5_old = prochainLundi(new Date(), 42);
  const fin5_old = ajouterJours(debut5_old, 2);
  const debut5_new = prochainLundi(new Date(), 49);
  const fin5_new = ajouterJours(debut5_new, 2);

  const col = await connecter("collaborateur@simassurances.test");
  await col.p.goto(`${B}/conges/nouvelle`);
  await col.p.getByLabel("Motif").fill("Congé pour test de modification de dates");
  await col.p.getByLabel("Date de début").fill(iso(debut5_old));
  await col.p.getByLabel("Date de fin").fill(iso(fin5_old));
  await col.p.waitForTimeout(400);

  demandeId5 = await soumettreEtAttendreId(col.p, "/conges/nouvelle");
  await col.ctx.close();

  // Le responsable demande une modification
  const resp = await connecter("responsable-commercial@simassurances.test");
  await resp.p.goto(`${B}/conges/${demandeId5}`);
  await resp.p.getByRole("button", { name: "Demander une modification" }).click();
  await resp.p.getByLabel("Modification demandée").fill("Merci de décaler d'une semaine");
  await resp.p.getByRole("button", { name: "Envoyer la demande de modification" }).click();
  for (let i = 0; i < 30; i++) {
    const check = (await q('SELECT statut FROM "DemandeConge" WHERE id = $1', [demandeId5]))[0];
    if (check?.statut === "MODIFICATION_DEMANDEE") break;
    await attenteMs(200);
  }
  const d5_step1 = (await q('SELECT * FROM "DemandeConge" WHERE id = $1', [demandeId5]))[0];
  await verifier(
    "5.a",
    "Responsable demande une modification → statut MODIFICATION_DEMANDEE en base",
    d5_step1?.statut === "MODIFICATION_DEMANDEE" && d5_step1?.motifModification?.includes("décaler"),
    `statut=${d5_step1?.statut}, motif=${d5_step1?.motifModification}`,
    resp.p
  );
  await resp.ctx.close();

  // Le collaborateur modifie les dates et renvoie
  const col2 = await connecter("collaborateur@simassurances.test");
  await col2.p.goto(`${B}/conges/${demandeId5}`);
  await col2.p.getByRole("button", { name: "Modifier et renvoyer" }).click();
  await col2.p.waitForURL(/\/modifier$/);
  await col2.p.getByLabel("Date de début").fill(iso(debut5_new));
  await col2.p.getByLabel("Date de fin").fill(iso(fin5_new));
  await col2.p.waitForTimeout(400);
  await soumettreEtAttendreId(col2.p, `/conges/${demandeId5}/modifier`);

  const d5_step2 = (await q('SELECT * FROM "DemandeConge" WHERE id = $1', [demandeId5]))[0];
  await verifier(
    "5.b",
    "Collaborateur renvoie la demande modifiée → repart à l'étape responsable",
    d5_step2?.statut === "EN_ATTENTE_RESPONSABLE",
    `statut=${d5_step2?.statut}`,
    col2.p
  );

  const plages5 = (
    await q(
      `SELECT to_char(date, 'YYYY-MM-DD') as j FROM "PlageAbsenceAutorisee" WHERE "demandeCongeId" = $1 ORDER BY date`,
      [demandeId5]
    )
  ).map((p) => p.j);
  const couvreNouvellesSeulement =
    plages5.includes(iso(debut5_new)) && !plages5.includes(iso(debut5_old)) && plages5.length === 3;
  await verifier(
    "5.c",
    "En base, les plages couvrent les NOUVELLES dates seulement",
    couvreNouvellesSeulement,
    `plages=${plages5.join(",")}, attendu_debut=${iso(debut5_new)}`
  );
  await col2.ctx.close();
}

// ── Scénario 6 ───────────────────────────────────────────────────────────────────────────────────────
// Refus avant le début → plus aucune plage pour cette demande.
let demandeId6 = null;
{
  const debut6 = prochainLundi(new Date(), 56);
  const fin6 = ajouterJours(debut6, 2);

  const col = await connecter("collaborateur@simassurances.test");
  await col.p.goto(`${B}/conges/nouvelle`);
  await col.p.getByLabel("Motif").fill("Congé pour test de refus avant début");
  await col.p.getByLabel("Date de début").fill(iso(debut6));
  await col.p.getByLabel("Date de fin").fill(iso(fin6));
  await col.p.waitForTimeout(400);
  demandeId6 = await soumettreEtAttendreId(col.p, "/conges/nouvelle");
  await col.ctx.close();

  const resp = await connecter("responsable-commercial@simassurances.test");
  await resp.p.goto(`${B}/conges/${demandeId6}`);
  await resp.p.getByRole("button", { name: "Refuser" }).click();
  await resp.p.getByLabel("Motif du refus").fill("Refus pour surcharge de travail");
  await resp.p.getByRole("button", { name: "Confirmer le refus" }).click();
  for (let i = 0; i < 30; i++) {
    const check = (await q('SELECT statut FROM "DemandeConge" WHERE id = $1', [demandeId6]))[0];
    if (check?.statut === "REJETEE") break;
    await attenteMs(200);
  }
  const d6 = (await q('SELECT * FROM "DemandeConge" WHERE id = $1', [demandeId6]))[0];
  await verifier(
    "6.a",
    "Refus avant le début → statut REJETEE en base",
    d6?.statut === "REJETEE",
    `statut=${d6?.statut}`,
    resp.p
  );

  const countPlages6 = (
    await q('SELECT count(*) FROM "PlageAbsenceAutorisee" WHERE "demandeCongeId" = $1', [demandeId6])
  )[0].count;
  await verifier(
    "6.b",
    "Refus avant le début → plus aucune plage en base pour cette demande",
    Number(countPlages6) === 0,
    `count=${countPlages6}`
  );
  await resp.ctx.close();
}

// ── Scénario 7 ───────────────────────────────────────────────────────────────────────────────────────
// Annulation par le demandeur d'un congé qui commence demain → acceptée.
// Pour un congé déjà commencé (dates antidatées en base pour le test), le bouton d'annulation du demandeur
// est absent ou refusé ; rh@ l'annule → seules les plages à partir d'aujourd'hui disparaissent,
// les jours passés restent couverts.
let demandeId7a = null;
let demandeId7b = null;
{
  // 7.a & 7.b : Congé qui commence demain
  const demain = ajouterJours(new Date(), 1);
  const finDemain = ajouterJours(demain, 2);

  const col = await connecter("collaborateur@simassurances.test");
  await col.p.goto(`${B}/conges/nouvelle`);
  await col.p.getByLabel("Motif").fill("Congé commençant demain pour test annulation");
  await col.p.getByLabel("Date de début").fill(iso(demain));
  await col.p.getByLabel("Date de fin").fill(iso(finDemain));
  await col.p.waitForTimeout(400);
  demandeId7a = await soumettreEtAttendreId(col.p, "/conges/nouvelle");

  // Le demandeur annule sa demande qui commence demain
  await col.p.goto(`${B}/conges/${demandeId7a}`);
  await col.p.getByRole("button", { name: "Annuler" }).click();
  await col.p.getByLabel(/Motif de l[’']annulation/i).fill("Annulation par le collaborateur");
  await col.p.getByRole("button", { name: /Confirmer l[’']annulation/i }).click();
  for (let i = 0; i < 30; i++) {
    const check = (await q('SELECT statut FROM "DemandeConge" WHERE id = $1', [demandeId7a]))[0];
    if (check?.statut === "ANNULEE") break;
    await attenteMs(200);
  }
  const d7a = (await q('SELECT * FROM "DemandeConge" WHERE id = $1', [demandeId7a]))[0];
  const plages7a = await q('SELECT * FROM "PlageAbsenceAutorisee" WHERE "demandeCongeId" = $1', [demandeId7a]);
  await verifier(
    "7.a",
    "Annulation par le demandeur d'un congé commençant demain → acceptée (ANNULEE)",
    d7a?.statut === "ANNULEE",
    `statut=${d7a?.statut}`,
    col.p
  );
  await verifier(
    "7.b",
    "Annulation avant le début → plus aucune plage en base",
    plages7a.length === 0,
    `plages=${plages7a.length}`
  );
  await col.ctx.close();

  // 7.c, 7.d, 7.e : Congé déjà commencé
  const rhSaisie = await connecter("rh@simassurances.test");
  await rhSaisie.p.goto(`${B}/conges/saisie-rh`);
  await rhSaisie.p.getByLabel("Salarié").selectOption({ label: "Collaborateur Test" });
  await rhSaisie.p.getByLabel("Motif").fill("Congé commencé pour test annulation RH");
  const debutOrig7b = prochainLundi(new Date(), 63);
  const finOrig7b = ajouterJours(debutOrig7b, 4);
  await rhSaisie.p.getByLabel("Date de début").fill(iso(debutOrig7b));
  await rhSaisie.p.getByLabel("Date de fin").fill(iso(finOrig7b));
  await rhSaisie.p.waitForTimeout(400);
  demandeId7b = await soumettreEtAttendreId(rhSaisie.p, "/conges/saisie-rh");
  await rhSaisie.ctx.close();

  // Scénario 7 : antidate en base pour simuler un congé déjà commencé
  // 2 jours ouvrés passés, aujourd'hui, et 2 jours ouvrés futurs
  const jPasses7b = derniersJoursOuvres(new Date(), 2);
  const jFuturs7b = prochainsJoursOuvres(new Date(), 2);
  const tousJours7b = [...jPasses7b, ...jFuturs7b];
  await q(
    `UPDATE "DemandeConge" SET "dateDebut" = $1, "dateFin" = $2, "nbJoursOuvres" = $3 WHERE id = $4`,
    [jPasses7b[0], jFuturs7b[jFuturs7b.length - 1], tousJours7b.length, demandeId7b]
  );
  await q(`DELETE FROM "PlageAbsenceAutorisee" WHERE "demandeCongeId" = $1`, [demandeId7b]);
  for (let i = 0; i < tousJours7b.length; i++) {
    await q(
      `INSERT INTO "PlageAbsenceAutorisee" (id, date, "heureDebut", "heureFin", source, description, "userId", "demandeCongeId", provisoire)
       VALUES ($1, $2, '08:00', '18:00', 'CONGE', 'Congé', $3, $4, false)`,
      [`plage-sc7b-${i}`, tousJours7b[i], collabId, demandeId7b]
    );
  }

  // Contrôle côté demandeur : bouton absent ou refusé
  const col3 = await connecter("collaborateur@simassurances.test");
  await col3.p.goto(`${B}/conges/${demandeId7b}`);
  const btnAnnulerDemandeur = col3.p.getByRole("button", { name: "Annuler" });
  const interdictionPresente = (await col3.p.locator("text=Ce congé a déjà commencé").count()) > 0;
  const annulationDemandeurBloquee = (await btnAnnulerDemandeur.isDisabled()) || interdictionPresente;
  await verifier(
    "7.c",
    "Pour un congé déjà commencé, le bouton d'annulation du demandeur est absent ou désactivé",
    annulationDemandeurBloquee,
    `disabled=${await btnAnnulerDemandeur.isDisabled()}, msg=${interdictionPresente}`,
    col3.p
  );
  await col3.ctx.close();

  // rh@ annule le congé commencé
  const rhAnnule = await connecter("rh@simassurances.test");
  await rhAnnule.p.goto(`${B}/conges/${demandeId7b}`);
  await rhAnnule.p.getByRole("button", { name: "Annuler" }).click();
  await rhAnnule.p.getByLabel(/Motif de l[’']annulation/i).fill("Annulation RH en cours de congé");
  await rhAnnule.p.getByRole("button", { name: /Confirmer l[’']annulation/i }).click();
  for (let i = 0; i < 30; i++) {
    const check = (await q('SELECT statut FROM "DemandeConge" WHERE id = $1', [demandeId7b]))[0];
    if (check?.statut === "ANNULEE") break;
    await attenteMs(200);
  }
  const d7b = (await q('SELECT * FROM "DemandeConge" WHERE id = $1', [demandeId7b]))[0];
  await verifier(
    "7.d",
    "rh@ annule le congé commencé → statut ANNULEE en base",
    d7b?.statut === "ANNULEE",
    `statut=${d7b?.statut}`,
    rhAnnule.p
  );

  const plages7bRestantes = (
    await q(
      `SELECT to_char(date, 'YYYY-MM-DD') as j FROM "PlageAbsenceAutorisee" WHERE "demandeCongeId" = $1 ORDER BY date`,
      [demandeId7b]
    )
  ).map((p) => p.j);
  const aujourdhuiStr = iso(new Date());
  // Règle du moteur (T03) : une annulation après le début retire les plages à partir de DEMAIN ; le jour en cours,
  // déjà commencé, reste couvert comme les jours passés.
  const attendues7b = estWeekEnd(new Date()) ? jPasses7b : [...jPasses7b, aujourdhuiStr];
  const seulesPassesRestent = plages7bRestantes.join(",") === attendues7b.join(",");
  await verifier(
    "7.e",
    "Seules les plages à partir de demain disparaissent, les jours passés et le jour même restent couverts",
    seulesPassesRestent,
    `restantes=${plages7bRestantes.join(",")}, attendues=${attendues7b.join(",")}`
  );
  await rhAnnule.ctx.close();
}

// ── Scénario 8 ───────────────────────────────────────────────────────────────────────────────────────
// rh@ « Saisir un congé » pour collaborateur@ → statut « Validé », une notification pour le salarié en base ;
// rh@ ne peut pas se choisir elle-même (absente de la liste, ou refus à l'envoi).
let demandeId8 = null;
{
  const a = await connecter("rh@simassurances.test");
  await a.p.goto(`${B}/conges/saisie-rh`);

  // Vérifier que rh@ ne peut pas se choisir elle-même
  const optionsSalaries = await a.p.locator("select").first().locator("option").allInnerTexts();
  const rhAbsente = !optionsSalaries.some((opt) => /RH Test/i.test(opt));
  await verifier(
    "8.a",
    "rh@ ne peut pas se choisir elle-même (absente de la liste des salariés)",
    rhAbsente,
    `options=${optionsSalaries.join(" | ")}`,
    a.p
  );

  await a.p.getByLabel("Salarié").selectOption({ label: "Collaborateur Test" });
  await a.p.getByLabel("Motif").fill("Congé exceptionnel saisi directement par la RH");
  const debut8 = prochainLundi(new Date(), 70);
  const fin8 = ajouterJours(debut8, 2);
  await a.p.getByLabel("Date de début").fill(iso(debut8));
  await a.p.getByLabel("Date de fin").fill(iso(fin8));
  await a.p.waitForTimeout(400);

  demandeId8 = await soumettreEtAttendreId(a.p, "/conges/saisie-rh");

  const corps8 = await a.p.locator("main").innerText();
  await verifier(
    "8.b",
    "rh@ saisit un congé pour collaborateur@ → statut « Validé » à l'écran",
    /Validé/i.test(corps8),
    corps8.slice(0, 150),
    a.p
  );

  const d8 = (await q('SELECT * FROM "DemandeConge" WHERE id = $1', [demandeId8]))[0];
  await verifier(
    "8.c",
    "Demande créée avec statut VALIDEE et saisieParRH = true en base",
    d8?.statut === "VALIDEE" && d8?.saisieParRH === true && d8?.userId === collabId,
    `statut=${d8?.statut}, saisieParRH=${d8?.saisieParRH}`
  );

  const notifs8 = await q(
    `SELECT * FROM "Notification" WHERE "userId" = $1 AND titre LIKE '%Congé enregistré%'`,
    [collabId]
  );
  await verifier(
    "8.d",
    "Une notification est créée en base pour le salarié suite à la saisie RH",
    notifs8.length > 0,
    `count=${notifs8.length}`
  );
  await a.ctx.close();
}

// ── Scénario 9 ───────────────────────────────────────────────────────────────────────────────────────
// Demande en attente qui commence AUJOURD'HUI (dateDebut antidatée à aujourd'hui en base) :
// lance la tâche des absences par GET /api/cron/absences avec l'en-tête Authorization: Bearer secret-e2e
// → aucune Absence pour ce compte aujourd'hui ; « Présence du jour » de rh@ → « Congé en attente de validation ».
let demandeId9 = null;
{
  const aujourdhuiStr = iso(new Date());

  // responsable-technique@ soumet une demande
  const tech = await connecter("responsable-technique@simassurances.test");
  await tech.p.goto(`${B}/conges/nouvelle`);
  await tech.p.getByLabel("Motif").fill("Congé pour test présence du jour en attente");
  const debutFutur = prochainLundi(new Date(), 77);
  await tech.p.getByLabel("Date de début").fill(iso(debutFutur));
  await tech.p.getByLabel("Date de fin").fill(iso(ajouterJours(debutFutur, 2)));
  await tech.p.waitForTimeout(400);
  demandeId9 = await soumettreEtAttendreId(tech.p, "/conges/nouvelle");
  await tech.ctx.close();

  // Scénario 9 : antidate de dateDebut à aujourd'hui pour cette demande en attente
  await q(
    `UPDATE "DemandeConge" SET "dateDebut" = $1, "dateFin" = $1, "nbJoursOuvres" = 1 WHERE id = $2`,
    [aujourdhuiStr, demandeId9]
  );
  await q(`DELETE FROM "PlageAbsenceAutorisee" WHERE "demandeCongeId" = $1`, [demandeId9]);
  await q(
    `INSERT INTO "PlageAbsenceAutorisee" (id, date, "heureDebut", "heureFin", source, description, "userId", "demandeCongeId", provisoire)
     VALUES ('e2e-plage-sc9', $1, '00:00', '23:59', 'CONGE', 'Congé', $2, $3, true)`,
    [aujourdhuiStr, respTechId, demandeId9]
  );
  await q(`DELETE FROM "Absence" WHERE "userId" = $1 AND to_char(date, 'YYYY-MM-DD') = $2`, [
    respTechId,
    aujourdhuiStr,
  ]);

  // Exécution de la tâche des absences par GET
  const repAbsences = await fetch(`${B}/api/cron/absences`, {
    headers: { Authorization: "Bearer secret-e2e" },
  });
  const abs9 = await q(
    `SELECT * FROM "Absence" WHERE "userId" = $1 AND to_char(date, 'YYYY-MM-DD') = $2`,
    [respTechId, aujourdhuiStr]
  );
  await verifier(
    "9.a",
    "Tâche cron des absences exécutée → aucune Absence pour ce compte aujourd'hui",
    repAbsences.status === 200 && abs9.length === 0,
    `cronStatus=${repAbsences.status}, absences=${abs9.length}`
  );

  // « Présence du jour » de la RH
  const rh = await connecter("rh@simassurances.test");
  await rh.p.goto(`${B}/pointage/rh/presence`);
  await rh.p.click('button:has-text("Absence autorisée")');
  await rh.p.waitForTimeout(300);
  const corpsPresence9 = await rh.p.locator("main").innerText();
  await verifier(
    "9.b",
    "« Présence du jour » de rh@ affiche « Congé en attente de validation »",
    /Congé en attente de validation/i.test(corpsPresence9),
    corpsPresence9.slice(0, 200),
    rh.p
  );
  await rh.ctx.close();
}

// ── Scénario 10 ──────────────────────────────────────────────────────────────────────────────────────
// Refus tardif (demande en attente dont les dates sont antidatées en base pour commencer il y a 3 jours ouvrés,
// sans pointage) : rh@ refuse en COCHANT « compter les jours passés » → Absence « à contrôler » sur les
// jours ouvrés passés non pointés. Même situation sur un second compte, case DÉCOCHÉE → aucune absence.
let demandeId10a = null;
let demandeId10b = null;
{
  const passesOuvres = derniersJoursOuvres(new Date(), 3);

  // 10.a : collaborateur@, case cochée
  const col = await connecter("collaborateur@simassurances.test");
  await col.p.goto(`${B}/conges/nouvelle`);
  await col.p.getByLabel("Motif").fill("Congé pour test de refus tardif avec absences");
  const futur10a = prochainLundi(new Date(), 84);
  await col.p.getByLabel("Date de début").fill(iso(futur10a));
  await col.p.getByLabel("Date de fin").fill(iso(ajouterJours(futur10a, 2)));
  await col.p.waitForTimeout(400);
  demandeId10a = await soumettreEtAttendreId(col.p, "/conges/nouvelle");
  await col.ctx.close();

  // Scénario 10a : antidatage en base à 3 jours ouvrés passés, sans pointage
  await q(
    `UPDATE "DemandeConge" SET "dateDebut" = $1, "dateFin" = $2, "nbJoursOuvres" = 3, statut = 'EN_ATTENTE_RH' WHERE id = $3`,
    [passesOuvres[0], passesOuvres[passesOuvres.length - 1], demandeId10a]
  );
  await q(`DELETE FROM "PlageAbsenceAutorisee" WHERE "demandeCongeId" = $1`, [demandeId10a]);
  for (let i = 0; i < passesOuvres.length; i++) {
    await q(
      `INSERT INTO "PlageAbsenceAutorisee" (id, date, "heureDebut", "heureFin", source, description, "userId", "demandeCongeId", provisoire)
       VALUES ($1, $2, '08:00', '18:00', 'CONGE', 'Congé', $3, $4, true)`,
      [`plage-sc10a-${i}`, passesOuvres[i], collabId, demandeId10a]
    );
  }
  await q(`DELETE FROM "Pointage" WHERE "userId" = $1 AND to_char(heure, 'YYYY-MM-DD') = ANY($2)`, [
    collabId,
    passesOuvres,
  ]);
  await q(`DELETE FROM "Absence" WHERE "userId" = $1 AND to_char(date, 'YYYY-MM-DD') = ANY($2)`, [
    collabId,
    passesOuvres,
  ]);

  const rhA = await connecter("rh@simassurances.test");
  await rhA.p.goto(`${B}/conges/${demandeId10a}`);
  await rhA.p.getByRole("button", { name: "Refuser" }).click();
  await rhA.p.check('input[type="checkbox"]');
  await rhA.p.getByLabel("Motif du refus").fill("Refus tardif avec comptabilisation des absences");
  await rhA.p.getByRole("button", { name: "Confirmer le refus" }).click();
  for (let i = 0; i < 30; i++) {
    const check = (await q('SELECT statut FROM "DemandeConge" WHERE id = $1', [demandeId10a]))[0];
    if (check?.statut === "REJETEE") break;
    await attenteMs(200);
  }
  const absences10a = await q(
    `SELECT * FROM "Absence" WHERE "userId" = $1 AND statut = 'A_CONTROLER' AND to_char(date, 'YYYY-MM-DD') = ANY($2)`,
    [collabId, passesOuvres]
  );
  await verifier(
    "10.a",
    "Refus tardif case COCHÉE → Absence « à contrôler » sur les jours ouvrés passés non pointés",
    absences10a.length === 3,
    `absences=${absences10a.length}, attendues=3`,
    rhA.p
  );
  await rhA.ctx.close();

  // 10.b : responsable-marketing@, case décochée
  const mkt = await connecter("responsable-marketing@simassurances.test");
  await mkt.p.goto(`${B}/conges/nouvelle`);
  await mkt.p.getByLabel("Motif").fill("Congé pour test de refus tardif sans absences");
  const futur10b = prochainLundi(new Date(), 91);
  await mkt.p.getByLabel("Date de début").fill(iso(futur10b));
  await mkt.p.getByLabel("Date de fin").fill(iso(ajouterJours(futur10b, 2)));
  await mkt.p.waitForTimeout(400);
  demandeId10b = await soumettreEtAttendreId(mkt.p, "/conges/nouvelle");
  await mkt.ctx.close();

  // Scénario 10b : antidatage en base à 3 jours ouvrés passés, sans pointage
  await q(
    `UPDATE "DemandeConge" SET "dateDebut" = $1, "dateFin" = $2, "nbJoursOuvres" = 3, statut = 'EN_ATTENTE_RH' WHERE id = $3`,
    [passesOuvres[0], passesOuvres[passesOuvres.length - 1], demandeId10b]
  );
  await q(`DELETE FROM "PlageAbsenceAutorisee" WHERE "demandeCongeId" = $1`, [demandeId10b]);
  for (let i = 0; i < passesOuvres.length; i++) {
    await q(
      `INSERT INTO "PlageAbsenceAutorisee" (id, date, "heureDebut", "heureFin", source, description, "userId", "demandeCongeId", provisoire)
       VALUES ($1, $2, '08:00', '18:00', 'CONGE', 'Congé', $3, $4, true)`,
      [`plage-sc10b-${i}`, passesOuvres[i], respMktId, demandeId10b]
    );
  }
  await q(`DELETE FROM "Pointage" WHERE "userId" = $1 AND to_char(heure, 'YYYY-MM-DD') = ANY($2)`, [
    respMktId,
    passesOuvres,
  ]);
  await q(`DELETE FROM "Absence" WHERE "userId" = $1 AND to_char(date, 'YYYY-MM-DD') = ANY($2)`, [
    respMktId,
    passesOuvres,
  ]);

  const rhB = await connecter("rh@simassurances.test");
  await rhB.p.goto(`${B}/conges/${demandeId10b}`);
  await rhB.p.getByRole("button", { name: "Refuser" }).click();
  // Laisser la case décochée (par défaut non cochée)
  await rhB.p.getByLabel("Motif du refus").fill("Refus tardif sans comptabilisation des absences");
  await rhB.p.getByRole("button", { name: "Confirmer le refus" }).click();
  for (let i = 0; i < 30; i++) {
    const check = (await q('SELECT statut FROM "DemandeConge" WHERE id = $1', [demandeId10b]))[0];
    if (check?.statut === "REJETEE") break;
    await attenteMs(200);
  }
  const absences10b = await q(
    `SELECT * FROM "Absence" WHERE "userId" = $1 AND to_char(date, 'YYYY-MM-DD') = ANY($2)`,
    [respMktId, passesOuvres]
  );
  await verifier(
    "10.b",
    "Refus tardif case DÉCOCHÉE → aucune absence créée en base",
    absences10b.length === 0,
    `absences=${absences10b.length}`,
    rhB.p
  );
  await rhB.ctx.close();
}

// ── Scénario 11 ──────────────────────────────────────────────────────────────────────────────────────
// Congé validé couvrant aujourd'hui + une arrivée pointée aujourd'hui (pointage inséré en base, à commenter)
// → « Présence du jour » de rh@ affiche « Pointé pendant un congé » ; le reporting RH de la journée
// affiche 1 jour de congé et 1 jour pointé pendant un congé pour ce compte (colonnes « Jours de congé »
// et « Pointé pendant un congé »).
{
  const aujourdhuiStr = iso(new Date());

  // Enregistrement d'un congé validé couvrant aujourd'hui pour collaborateur@
  const rh = await connecter("rh@simassurances.test");
  await rh.p.goto(`${B}/conges/saisie-rh`);
  await rh.p.getByLabel("Salarié").selectOption({ label: "Collaborateur Test" });
  await rh.p.getByLabel("Motif").fill("Congé couvrant aujourd'hui pour test de pointage");
  await rh.p.getByLabel("Date de début").fill(aujourdhuiStr);
  await rh.p.getByLabel("Date de fin").fill(aujourdhuiStr);
  await rh.p.waitForTimeout(400);
  await soumettreEtAttendreId(rh.p, "/conges/saisie-rh");

  // Scénario 11 : pointage d'arrivée inséré directement en base aujourd'hui pendant le congé validé
  await q(
    `INSERT INTO "Pointage" (id, type, source, heure, "heurePrevue", "userId")
     VALUES ('e2e-pointage-conge-11', 'ARRIVEE', 'ORDINATEUR', now(), '08:00', $1)
     ON CONFLICT (id) DO UPDATE SET heure = now()`,
    [collabId]
  );

  // « Présence du jour »
  await rh.p.goto(`${B}/pointage/rh/presence`);
  const badgePresent = (await rh.p.locator("[data-pointe-en-conge]").count()) > 0;
  await verifier(
    "11.a",
    "« Présence du jour » de rh@ affiche « Pointé pendant un congé »",
    badgePresent,
    `badgeCount=${await rh.p.locator("[data-pointe-en-conge]").count()}`,
    rh.p
  );

  // Reporting RH
  await rh.p.goto(
    `${B}/pointage/rh/reporting?dateDebut=${aujourdhuiStr}&dateFin=${aujourdhuiStr}&service=Commercial`
  );
  const ligneCollab = await rh.p.locator('tr:has-text("Collaborateur Test")').first();
  const texteLigne = await ligneCollab.innerText();
  const cellJoursConge = await ligneCollab.locator("td").nth(7).innerText();
  const cellPointesConge = await ligneCollab.locator("td").nth(8).innerText();
  const reportingOk = cellJoursConge.trim() === "1" && cellPointesConge.includes("1");
  await verifier(
    "11.b",
    "Reporting RH : 1 jour de congé et 1 jour pointé pendant un congé affichés",
    reportingOk,
    `joursConge=${cellJoursConge.trim()}, pointesConge=${cellPointesConge.trim()}, texte=${texteLigne}`,
    rh.p
  );
  await rh.ctx.close();
}

// ── Scénario 12 ──────────────────────────────────────────────────────────────────────────────────────
// /conges/toutes (rh@, onglet « Toutes les demandes », statut « Tous les statuts », période couvrant tous
// les congés créés) → téléchargement de l'export Excel (bouton de la page) → mêmes références, dans le
// même ordre, que les lignes de l'écran (toutes les pages). Lire le fichier avec exceljs.
{
  const rh = await connecter("rh@simassurances.test");
  await rh.p.goto(`${B}/conges/toutes?onglet=toutes`);
  // Période limitée à 366 jours (filtresCongesDepuisRecherche) ; couvre tous les congés créés par la recette.
  await rh.p.locator('input[name="du"]').fill(iso(ajouterJours(new Date(), -60)));
  await rh.p.locator('input[name="au"]').fill(iso(ajouterJours(new Date(), 300)));
  await rh.p.locator('select[name="statut"]').selectOption("TOUS");
  // Pas de « networkidle » : le flux SSE du portail (/api/events) garde une connexion ouverte en permanence.
  const avantFiltre = rh.p.url();
  await rh.p.getByRole("button", { name: "Filtrer" }).click();
  await rh.p.waitForURL((u) => u.toString() !== avantFiltre);

  const refsEcran = [];
  while (true) {
    const liens = await rh.p.locator("table tbody tr td:first-child a").allInnerTexts();
    refsEcran.push(...liens.map((l) => l.trim()));
    const btnSuivant = rh.p.locator('a:has-text("Suivant")');
    if ((await btnSuivant.count()) > 0) {
      const avantPage = rh.p.url();
      await btnSuivant.click();
      await rh.p.waitForURL((u) => u.toString() !== avantPage);
    } else {
      break;
    }
  }

  // Lien du bouton « Exporter en Excel » de la page, appelé avec la session de rh@ (statut et corps vérifiés).
  const hrefExport = await rh.p.getByRole("link", { name: "Exporter en Excel" }).getAttribute("href");
  const repExport = await rh.p.request.get(`${B}${hrefExport}`);
  if (repExport.status() !== 200) {
    console.error("Export :", repExport.status(), (await repExport.text()).slice(0, 300));
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await repExport.body());
  const sheet = workbook.getWorksheet("Congés") ?? workbook.worksheets[0];

  const refsExcel = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // En-tête
    const val = row.getCell(1).text || row.getCell(1).value;
    if (val) refsExcel.push(String(val).trim());
  });

  await verifier(
    "12.a",
    "Téléchargement de l'export Excel réussi et non vide",
    refsExcel.length > 0 && refsEcran.length > 0,
    `excel=${refsExcel.length}, ecran=${refsEcran.length}`,
    rh.p
  );
  await verifier(
    "12.b",
    "Mêmes références dans le même ordre entre l'écran et l'export Excel",
    JSON.stringify(refsEcran) === JSON.stringify(refsExcel),
    `ecran=${refsEcran.slice(0, 5).join(",")}, excel=${refsExcel.slice(0, 5).join(",")}`
  );
  await rh.ctx.close();
}

// ── Scénario 13 ──────────────────────────────────────────────────────────────────────────────────────
// Date de début passée : refusée à l'écran (message), ET par appel direct de l'action serveur.
// Pour l'appel direct, rejoue avec page.request la requête POST que le formulaire envoie
// (capturée par page.on("request") lors d'un envoi valide), en changeant seulement la date :
// la réponse ne doit créer aucune demande (vérifié en base).
{
  const col = await connecter("collaborateur@simassurances.test");
  await col.p.goto(`${B}/conges/nouvelle`);
  await col.p.getByLabel("Motif").fill("Demande de test date passée");
  await col.p.getByLabel("Date de début").fill("2025-01-10");
  await col.p.getByLabel("Date de fin").fill("2025-01-15");
  await col.p.waitForTimeout(500);

  const messagePasseVisible = (await col.p.locator("text=La date de début ne peut pas être dans le passé").count()) > 0;
  await verifier(
    "13.a",
    "Date de début passée : refusée à l'écran avec le message réglementaire",
    messagePasseVisible,
    `visible=${messagePasseVisible}`,
    col.p
  );

  // Rejeu par appel direct de l'action serveur avec une date passée
  const countAvant = Number((await q('SELECT count(*) FROM "DemandeConge"'))[0].count);
  let corpsRejeu = "";
  if (requeteSoumissionValide) {
    const headersRejeu = { ...requeteSoumissionValide.headers };
    delete headersRejeu["content-length"];
    delete headersRejeu["host"];
    const postDataModifie = requeteSoumissionValide.postData.replace(/\d{4}-\d{2}-\d{2}/, "2025-01-10");
    const repRejeu = await col.p.request.post(requeteSoumissionValide.url, {
      headers: headersRejeu,
      data: postDataModifie,
    });
    corpsRejeu = await repRejeu.text();
  }
  const countApres = Number((await q('SELECT count(*) FROM "DemandeConge"'))[0].count);
  // Le refus doit venir de la règle « pas dans le passé » (message dans la réponse de l'action), pas d'une autre cause.
  await verifier(
    "13.b",
    "Appel direct de l'action serveur avec date passée : refusé par la règle « pas dans le passé », aucune demande en base",
    requeteSoumissionValide !== null && /ne peut pas être dans le passé/.test(corpsRejeu) && countAvant === countApres,
    `requeteCapturee=${requeteSoumissionValide !== null}, avant=${countAvant}, apres=${countApres}, reponse=${corpsRejeu.slice(0, 150)}`
  );
  await col.ctx.close();
}

// ── Scénario 14 ──────────────────────────────────────────────────────────────────────────────────────
// Rappel quotidien : une demande en attente dont etapeDepuis est antidaté de 25 h en base ;
// admin@ ouvre /admin/journal-technique, onglet du moniteur, « Lancer maintenant » sur « Rappels des congés en attente »
// → une notification « Demande de congé en attente » pour le décideur en base, aucune pour le demandeur ;
// relancer immédiatement → aucune nouvelle notification.
let demandeId14 = null;
{
  const col = await connecter("collaborateur@simassurances.test");
  await col.p.goto(`${B}/conges/nouvelle`);
  await col.p.getByLabel("Motif").fill("Demande pour test de rappel quotidien");
  const debut14 = prochainLundi(new Date(), 98);
  await col.p.getByLabel("Date de début").fill(iso(debut14));
  await col.p.getByLabel("Date de fin").fill(iso(ajouterJours(debut14, 2)));
  await col.p.waitForTimeout(400);
  demandeId14 = await soumettreEtAttendreId(col.p, "/conges/nouvelle");
  await col.ctx.close();

  // Scénario 14 : antidatage de etapeDepuis de 25 h en base pour déclencher le rappel quotidien
  await q(
    `UPDATE "DemandeConge" SET "etapeDepuis" = now() - interval '25 hours', "dernierRappelAt" = NULL WHERE id = $1`,
    [demandeId14]
  );
  await q(`DELETE FROM "Notification" WHERE category = 'RH'`);

  const adm = await connecter("admin@simassurances.test");
  await adm.p.goto(`${B}/admin/journal-technique?onglet=taches`);

  // Cliquer sur « Lancer maintenant » sur la carte « Rappels des congés en attente »
  const carteRappels = adm.p.locator('[data-tache="RAPPELS_CONGES"]');
  await carteRappels.getByRole("button", { name: "Lancer maintenant" }).click();
  await adm.p.waitForTimeout(1000);

  const notifsDecideur = await q(
    `SELECT * FROM "Notification" WHERE "userId" = $1 AND titre = 'Demande de congé en attente'`,
    [respCommercialId]
  );
  const notifsDemandeur = await q(
    `SELECT * FROM "Notification" WHERE "userId" = $1 AND titre = 'Demande de congé en attente'`,
    [collabId]
  );
  await verifier(
    "14.a",
    "Notification « Demande de congé en attente » créée en base pour le décideur",
    notifsDecideur.length === 1,
    `decideur=${notifsDecideur.length}`,
    adm.p
  );
  await verifier(
    "14.b",
    "Aucune notification de rappel pour le demandeur",
    notifsDemandeur.length === 0,
    `demandeur=${notifsDemandeur.length}`
  );

  // Relancer immédiatement
  await carteRappels.getByRole("button", { name: "Lancer maintenant" }).click();
  await adm.p.waitForTimeout(1000);

  const notifsDecideur2 = await q(
    `SELECT * FROM "Notification" WHERE "userId" = $1 AND titre = 'Demande de congé en attente'`,
    [respCommercialId]
  );
  await verifier(
    "14.c",
    "Relance immédiate : aucune nouvelle notification envoyée au décideur",
    notifsDecideur2.length === 1,
    `count=${notifsDecideur2.length}`,
    adm.p
  );
  await adm.ctx.close();
}

// ── Scénario 15 ──────────────────────────────────────────────────────────────────────────────────────
// Largeur 390 px : /conges, /conges/nouvelle, /conges/a-decider, /conges/toutes, /conges/<id>,
// /conges/saisie-rh → aucune page ne défile horizontalement (document.documentElement.scrollWidth <= 390).
{
  const col = await connecter("collaborateur@simassurances.test", { width: 390, height: 844 });
  const rh = await connecter("rh@simassurances.test", { width: 390, height: 844 });

  const pagesATester = [
    { p: col.p, url: `${B}/conges`, code: "15.a", nom: "/conges" },
    { p: col.p, url: `${B}/conges/nouvelle`, code: "15.b", nom: "/conges/nouvelle" },
    { p: rh.p, url: `${B}/conges/a-decider`, code: "15.c", nom: "/conges/a-decider" },
    { p: rh.p, url: `${B}/conges/toutes`, code: "15.d", nom: "/conges/toutes" },
    { p: col.p, url: `${B}/conges/${demandeId1}`, code: "15.e", nom: `/conges/${demandeId1}` },
    { p: rh.p, url: `${B}/conges/saisie-rh`, code: "15.f", nom: "/conges/saisie-rh" },
  ];

  for (const pageTest of pagesATester) {
    await pageTest.p.goto(pageTest.url);
    const scrollWidth = await pageTest.p.evaluate(() => document.documentElement.scrollWidth);
    await verifier(
      pageTest.code,
      `Largeur 390 px : ${pageTest.nom} sans défilement horizontal`,
      scrollWidth <= 390,
      `scrollWidth=${scrollWidth}`,
      pageTest.p
    );
  }

  await col.ctx.close();
  await rh.ctx.close();
}

// ── Scénario 16 ──────────────────────────────────────────────────────────────────────────────────────
// Aucune erreur JavaScript dans la console pendant toute la recette (page.on("pageerror")).
await verifier(
  "16.a",
  "Aucune erreur JavaScript dans la console pendant toute la recette",
  erreursJs.length === 0,
  erreursJs.join(" | ")
);

await browser.close();
await db.end();

console.log("\n=== Résultats de la recette Congés ===");
console.log(resultats.join("\n"));
const nbKo = resultats.filter((r) => r.startsWith("KO")).length;
const nbOk = resultats.filter((r) => r.startsWith("OK")).length;
console.log(`\n${nbOk}/${resultats.length} contrôles réussis`);

process.exit(nbKo ? 1 : 0);
