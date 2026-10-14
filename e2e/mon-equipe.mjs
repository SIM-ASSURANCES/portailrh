// Fiabilisation du pointage — phase 5 (2026-10-14) : « Mon équipe » du responsable, sur base JETABLE (voir e2e/README.md).
// - responsable-commercial@ voit les seuls membres de Commercial (jamais lui-même) ;
// - un collaborateur sans responsabilité reçoit 404 et ne voit pas le menu ;
// - après un changement de responsable (Admin > Services), l'accès suit immédiatement ;
// - les chiffres de la période sont IDENTIQUES à ceux du reporting RH (même période, même service) ;
// - 390 px sans défilement horizontal.
import { chromium } from "playwright";
import pg from "pg";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");

const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const userId = async (email) => (await q(`SELECT id FROM "User" WHERE email = $1`, [email]))[0].id;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);

// ── Données : un second membre de Commercial, et des pointages variés sur le mois ──────────────────────────────────────
const collab = await userId("collaborateur@simassurances.test");
const resp = await userId("responsable-commercial@simassurances.test");
const techResp = await userId("responsable-technique@simassurances.test");
const commercial = (await q(`SELECT "serviceId" AS id FROM "User" WHERE id = $1`, [collab]))[0].id;
await q(
  `INSERT INTO "User"(id, "fullName", email, "passwordHash", "roleId", "serviceId", "isActive", "createdAt", "updatedAt")
   SELECT 'e2e-membre2', 'Membre Deux Test', 'membre2@simassurances.test', "passwordHash", "roleId", "serviceId", true, now() - interval '60 days', now()
   FROM "User" WHERE id = $1`,
  [collab]
);
const membre2 = "e2e-membre2";

const jourDuMois = (decalage, h, m) => {
  const d = new Date();
  d.setDate(d.getDate() - decalage);
  d.setHours(h, m, 0, 0);
  return d;
};
let n = 0;
async function pointage({ uid, type, heure, retard = 0, anticipe = false, statutJustif = null }) {
  const id = `e2e-p${++n}`;
  await q(
    `INSERT INTO "Pointage"(id, type, source, heure, "heurePrevue", "estRetard", "minutesRetard", "estDepartAnticipe", "userId")
     VALUES ($1, $2, 'ORDINATEUR', $3, '07:45', $4, $5, $6, $7)`,
    [id, type, heure, retard > 0, retard || null, anticipe, uid]
  );
  if (statutJustif) {
    await q(`INSERT INTO "JustificationPointage"(id, "pointageId", statut, "updatedAt") VALUES ($1, $2, $3::"StatutJustificationPointage", now())`, [`j-${id}`, id, statutJustif]);
  }
}
// collab : retards (25 + 10 min), un départ anticipé non justifié, une absence ; membre2 : un retard refusé.
await pointage({ uid: collab, type: "ARRIVEE", heure: jourDuMois(1, 8, 10), retard: 25, statutJustif: "SOUMISE" });
await pointage({ uid: collab, type: "ARRIVEE", heure: jourDuMois(2, 7, 55), retard: 10, statutJustif: "ACCEPTEE" });
await pointage({ uid: collab, type: "DEPART", heure: jourDuMois(2, 15, 0), anticipe: true, statutJustif: "NON_JUSTIFIEE" });
await pointage({ uid: membre2, type: "ARRIVEE", heure: jourDuMois(3, 8, 20), retard: 35, statutJustif: "REFUSEE" });
await pointage({ uid: membre2, type: "ARRIVEE", heure: jourDuMois(4, 7, 40) });
await q(`INSERT INTO "Absence"(id, date, statut, "userId", "updatedAt") VALUES ('e2e-abs1', $1, 'A_CONTROLER', $2, now())`, [jourDuMois(5, 0, 0), collab]);
// Un pointage du responsable lui-même et d'un membre d'un AUTRE service : jamais visibles dans « Mon équipe ».
await pointage({ uid: resp, type: "ARRIVEE", heure: jourDuMois(1, 9, 0), retard: 75 });
await pointage({ uid: techResp, type: "ARRIVEE", heure: jourDuMois(1, 9, 5), retard: 80 });

const browser = await chromium.launch();
const erreursJs = [];
async function connecter(email, viewport) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" }, ...(viewport ? { viewport } : {}) });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(e.message));
  await p.goto(`${B}/login`);
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', "password123");
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click('button[type="submit"]')]);
  return { ctx, p };
}

const debut = new Date();
debut.setDate(1);
const periode = `du=${iso(debut)}&au=${iso(new Date())}`;

// ── Le responsable de Commercial ──────────────────────────────────────────────────────────────────────────────────────
let valeursEquipe;
{
  const { ctx, p } = await connecter("responsable-commercial@simassurances.test");
  // La branche Pointage du menu ne s'ouvre que sur une page du Pointage.
  await p.goto(`${B}/pointage/justifications`);
  verifier("Menu « Mon équipe » visible pour le responsable", (await p.locator('a[href="/pointage/mon-equipe"]').count()) > 0);
  const rep = await p.goto(`${B}/pointage/mon-equipe?${periode}`);
  verifier("Mon équipe : 200 pour le responsable", rep.status() === 200);
  const corps = await p.locator("body").innerText();
  verifier("Mon équipe : les membres de Commercial sont listés", corps.includes("Collaborateur Test") && corps.includes("Membre Deux Test"));
  verifier("Mon équipe : le responsable ne se voit pas lui-même", !corps.includes("Responsable Commercial Test") || !(await p.locator(`[data-membre="${resp}"]`).count()));
  verifier("Mon équipe : aucune ligne pour le responsable ni pour un autre service", (await p.locator(`[data-membre="${resp}"], [data-membre="${techResp}"]`).count()) === 0);
  verifier("Aujourd'hui : section présente, 2 lignes de membres", (await p.locator('[data-section="aujourdhui"] tr[data-membre]').count()) === 2);
  verifier("À décider : lien vers les justifications", (await p.locator('a[href="/pointage/justifications"]').count()) > 0);

  const lire = async (uid) => ({
    retards: Number(await p.locator(`[data-membre-periode="${uid}"] [data-col="retards"]`).innerText()),
    minutes: Number(await p.locator(`[data-membre-periode="${uid}"] [data-col="minutes"]`).innerText()),
    departs: Number(await p.locator(`[data-membre-periode="${uid}"] [data-col="departs"]`).innerText()),
    absences: Number(await p.locator(`[data-membre-periode="${uid}"] [data-col="absences"]`).innerText()),
    refusees: Number(await p.locator(`[data-membre-periode="${uid}"] [data-col="refusees"]`).innerText()),
  });
  valeursEquipe = { collab: await lire(collab), membre2: await lire(membre2) };
  verifier(
    "Période : valeurs attendues pour Collaborateur Test (2 retards, 35 min, 1 départ anticipé, ≥ 1 absence, 1 non justifiée)",
    // Les absences ne sont pas figées ici : le planificateur actif crée aussi celles des 2 derniers jours (comparées au reporting RH plus bas).
    JSON.stringify({ ...valeursEquipe.collab, absences: 0 }) === JSON.stringify({ retards: 2, minutes: 35, departs: 1, absences: 0, refusees: 1 }) && valeursEquipe.collab.absences >= 1,
    JSON.stringify(valeursEquipe.collab)
  );
  verifier(
    "Période : valeurs attendues pour Membre Deux (1 retard, 35 min, 0 départ, 1 refusée)",
    JSON.stringify({ ...valeursEquipe.membre2, absences: 0 }) === JSON.stringify({ retards: 1, minutes: 35, departs: 0, absences: 0, refusees: 1 }),
    JSON.stringify(valeursEquipe.membre2)
  );

  // Historique d'un membre : lecture seule ; 404 pour un membre d'un autre service.
  const h = await p.goto(`${B}/pointage/mon-equipe/${collab}?${periode}`);
  const hCorps = await p.locator("body").innerText();
  verifier("Historique d'un membre : 200, retard visible, aucun bouton d'action", h.status() === 200 && /Retard · 25 min/.test(hCorps) && (await p.locator("main button, main form").count()) === 0);
  const autre = await p.goto(`${B}/pointage/mon-equipe/${techResp}?${periode}`);
  verifier("Historique d'un membre d'un autre service : 404", autre.status() === 404);
  const soi = await p.goto(`${B}/pointage/mon-equipe/${resp}?${periode}`);
  verifier("Historique de soi-même : 404", soi.status() === 404);

  // 390 px.
  await p.setViewportSize({ width: 390, height: 800 });
  await p.goto(`${B}/pointage/mon-equipe?${periode}`);
  verifier("390 px sans défilement horizontal de la page", !(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await ctx.close();
}

// ── Mêmes chiffres que le reporting RH (même période, même service) ────────────────────────────────────────────────────
{
  const { ctx, p } = await connecter("rh@simassurances.test");
  await p.goto(`${B}/pointage/rh/reporting?dateDebut=${iso(debut)}&dateFin=${iso(new Date())}&service=Commercial`);
  const ligne = async (nom) => {
    const texte = await p.locator(`tr:has-text("${nom}")`).first().innerText();
    return texte.split(/\t|\n/).map((x) => x.trim()).filter(Boolean);
  };
  // Colonnes : nom, service, jours travaillés, présences, absences, jours de retard, minutes de retard.
  const lc = await ligne("Collaborateur Test");
  const l2 = await ligne("Membre Deux Test");
  const num = (l, i) => Number(l[i]);
  verifier(
    "Reporting RH : Collaborateur Test identique (absences, retards, minutes)",
    num(lc, 4) === valeursEquipe.collab.absences && num(lc, 5) === valeursEquipe.collab.retards && num(lc, 6) === valeursEquipe.collab.minutes,
    lc.join(" | ")
  );
  verifier(
    "Reporting RH : Membre Deux identique (absences, retards, minutes)",
    num(l2, 4) === valeursEquipe.membre2.absences && num(l2, 5) === valeursEquipe.membre2.retards && num(l2, 6) === valeursEquipe.membre2.minutes,
    l2.join(" | ")
  );
  await ctx.close();
}

// ── Un collaborateur sans responsabilité ──────────────────────────────────────────────────────────────────────────────
{
  const { ctx, p } = await connecter("collaborateur@simassurances.test");
  await p.goto(`${B}/pointage/historique`);
  verifier("Collaborateur : pas de menu « Mon équipe »", (await p.locator('a[href="/pointage/mon-equipe"]').count()) === 0);
  const r = await p.goto(`${B}/pointage/mon-equipe`);
  verifier("Collaborateur : /pointage/mon-equipe → 404", r.status() === 404);
  const r2 = await p.goto(`${B}/pointage/mon-equipe/${collab}`);
  verifier("Collaborateur : /pointage/mon-equipe/[id] → 404", r2.status() === 404);
  await ctx.close();
}

// ── Changement de responsable : l'accès suit immédiatement ────────────────────────────────────────────────────────────
{
  const respB = await userId("responsable-marketing@simassurances.test");
  await q(`UPDATE "Service" SET "responsableId" = $1 WHERE id = $2`, [respB, commercial]);
  const a = await connecter("responsable-commercial@simassurances.test");
  const r = await a.p.goto(`${B}/pointage/mon-equipe`);
  verifier("Ancien responsable de Commercial (qui ne l'est plus d'aucun service) : 404 et plus de menu", r.status() === 404 && (await a.p.locator('a[href="/pointage/mon-equipe"]').count()) === 0);
  await a.ctx.close();
  const b = await connecter("responsable-marketing@simassurances.test");
  const r2 = await b.p.goto(`${B}/pointage/mon-equipe`);
  const corps = await b.p.locator("body").innerText();
  verifier("Nouveau responsable : accès immédiat à l'équipe de Commercial", r2.status() === 200 && corps.includes("Collaborateur Test") && corps.includes("Responsable Commercial Test"));
  await b.ctx.close();
  await q(`UPDATE "Service" SET "responsableId" = $1 WHERE id = $2`, [resp, commercial]);
}

verifier("Aucune erreur JavaScript", erreursJs.length === 0, erreursJs.join(" | "));
await browser.close();
await db.end();
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko ? 1 : 0);
