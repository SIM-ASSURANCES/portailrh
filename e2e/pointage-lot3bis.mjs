// Pointage V2, lot 3 bis — vérification de bout en bout sur base JETABLE (voir e2e/README.md).
//   1. Jour non ouvré (jour férié du jour) : présence exceptionnelle sans retard ni justification, comptée dans les
//      présences du reporting, absente des retards ; départ sans départ anticipé ; tâche de relances sans rien à traiter.
//   3. Arrivée de moins de 30 min : « Départ possible à partir de HH:MM » en information, bouton désactivé puis réactivé
//      sans rechargement, aucun toast rouge.
//   4. Deux confirmations de départ simultanées : un seul départ, l'autre refusé « déjà pointé ».
// Le jour non ouvré est celui du test : un week-end s'il est lancé un samedi ou un dimanche, sinon un jour férié inséré
// pour aujourd'hui. Le samedi, le dimanche et le jour férié sont aussi couverts par vitest (jourNonOuvrePointage.test.ts).
import { chromium } from "playwright";
import pg from "pg";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");

const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const userId = async (email) => (await q(`SELECT id FROM "User" WHERE email = $1`, [email]))[0].id;

const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);

const browser = await chromium.launch();
const erreursJs = [];

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
const toastsErreur = (p) => p.locator('[data-sonner-toast][data-type="error"]');

async function arriveeIlYA(uid, millisecondes) {
  await q(
    `INSERT INTO "Pointage"(id, type, source, heure, "heurePrevue", "userId") VALUES ($1, 'ARRIVEE', 'ORDINATEUR', $2, '07:45', $3)`,
    [`e2e-${uid}-${Date.now()}`, new Date(Date.now() - millisecondes), uid]
  );
}
const PRESQUE_30_MIN = 30 * 60 * 1000 - 90 * 1000; // marge de 90 s : le serveur peut être lent au premier affichage

// ── 3. Arrivée de moins de 30 min (jour ouvré) ──────────────────────────────────────────────────────────────────
{
  const uid = await userId("responsable-marketing@simassurances.test");
  await arriveeIlYA(uid, PRESQUE_30_MIN);
  const { ctx, p } = await connecter("responsable-marketing@simassurances.test");
  await p.goto(`${B}/pointage/pointer`);
  const info = p.locator("[data-depart-possible]");
  await info.waitFor();
  const texte = await info.innerText();
  verifier("3. message d'information", /^Départ possible à partir de \d{2}:\d{2}$/.test(texte), texte);
  verifier("3. en ton information", (await info.getAttribute("class")).includes("text-info"));
  const bouton = p.getByRole("button", { name: "Pointer mon départ" });
  verifier("3. bouton désactivé", await bouton.isDisabled());
  verifier("3. aucun toast rouge", (await toastsErreur(p).count()) === 0);
  await bouton.waitFor({ state: "visible" });
  await p.waitForFunction(() => !document.querySelector("[data-depart-possible]"), null, { timeout: 150000 });
  verifier("3. bouton réactivé sans rechargement", await bouton.isEnabled());
  const departs = await q(`SELECT count(*)::int n FROM "Pointage" WHERE "userId" = $1 AND type = 'DEPART'`, [uid]);
  verifier("3. aucun départ créé tout seul", departs[0].n === 0);
  await ctx.close();
}

// ── 4. Deux confirmations de départ simultanées ────────────────────────────────────────────────────────────────
{
  const email = "responsable-comptabilite@simassurances.test";
  const uid = await userId(email);
  await arriveeIlYA(uid, PRESQUE_30_MIN);
  const { ctx, p } = await connecter(email);
  const p2 = await ctx.newPage();
  p2.on("pageerror", (e) => erreursJs.push(e.message));
  await Promise.all([p.goto(`${B}/pointage/pointer`), p2.goto(`${B}/pointage/pointer`)]);
  for (const page of [p, p2]) {
    const bouton = page.getByRole("button", { name: "Pointer mon départ" });
    await page.waitForFunction(() => !document.querySelector("[data-depart-possible]"), null, { timeout: 150000 });
    await bouton.click();
  }
  await Promise.all([
    p.getByRole("button", { name: "Confirmer mon départ" }).click(),
    p2.getByRole("button", { name: "Confirmer mon départ" }).click(),
  ]);
  const refus = p.locator("[data-sonner-toast]", { hasText: "Vous avez déjà pointé votre départ aujourd'hui." });
  const refus2 = p2.locator("[data-sonner-toast]", { hasText: "Vous avez déjà pointé votre départ aujourd'hui." });
  await Promise.race([refus.waitFor({ timeout: 10000 }), refus2.waitFor({ timeout: 10000 })]).catch(() => {});
  const departs = await q(`SELECT count(*)::int n FROM "Pointage" WHERE "userId" = $1 AND type = 'DEPART'`, [uid]);
  verifier("4. un seul départ créé", departs[0].n === 1, String(departs[0].n));
  verifier("4. l'autre refusé « déjà pointé »", (await refus.count()) + (await refus2.count()) === 1);
  await ctx.close();
}

// ── 1. Jour non ouvré : jour férié aujourd'hui ─────────────────────────────────────────────────────────────────
{
  const debut = new Date();
  debut.setHours(0, 0, 0, 0);
  const weekEnd = [0, 6].includes(debut.getDay());
  if (!weekEnd) {
    await q(`INSERT INTO "JourFerie"(id, date, libelle) VALUES ('e2e-ferie', $1, 'Férié E2E') ON CONFLICT DO NOTHING`, [debut]);
  }
  verifier("1. jour non ouvré testé", true, weekEnd ? "week-end réel" : "jour férié inséré");
  const email = "collaborateur@simassurances.test";
  const uid = await userId(email);
  const { ctx, p } = await connecter(email);
  await p.goto(`${B}/pointage/pointer`);
  await p.getByRole("button", { name: "Pointer une présence exceptionnelle" }).click();
  await p.getByRole("button", { name: "Pointer mon arrivée" }).click();
  await p.locator('[data-sonner-toast][data-type="success"]').first().waitFor();
  const [arrivee] = await q(
    `SELECT p."estRetard", p."minutesRetard", (SELECT count(*)::int FROM "JustificationPointage" j WHERE j."pointageId" = p.id) AS justif
     FROM "Pointage" p WHERE p."userId" = $1 AND p.type = 'ARRIVEE'`,
    [uid]
  );
  verifier("1. présence exceptionnelle enregistrée", !!arrivee);
  verifier("1. aucun retard", arrivee && arrivee.estRetard === false && arrivee.minutesRetard === null);
  verifier("1. aucune justification à l'arrivée", arrivee && arrivee.justif === 0);
  const heureTest = new Date().toTimeString().slice(0, 5);
  verifier("2. présence exceptionnelle acceptée", !!arrivee, `heure du test ${heureTest}`);

  // Arrivée de plus de 30 min (reculée d'1 h en base), réouverture de la page : un jour non ouvré, jamais de départ
  // automatique (décision du 2026-10-11) — bouton « Pointer mon départ », puis confirmation explicite.
  await q(`UPDATE "Pointage" SET heure = heure - interval '1 hour' WHERE "userId" = $1 AND type = 'ARRIVEE'`, [uid]);
  await p.goto(`${B}/pointage/pointer`);
  const boutonDepart = p.getByRole("button", { name: "Pointer mon départ", exact: true });
  await boutonDepart.waitFor();
  await new Promise((r) => setTimeout(r, 3000));
  const [{ n: departsAvant }] = await q(`SELECT count(*)::int n FROM "Pointage" WHERE "userId" = $1 AND type = 'DEPART'`, [uid]);
  verifier("1. réouverture après 30 min : aucun départ automatique", departsAvant === 0, String(departsAvant));
  verifier("1. bouton « Pointer mon départ » présent et actif", await boutonDepart.isEnabled());
  verifier("1. pas de libellé « départ anticipé »", (await p.getByRole("button", { name: "Pointer mon départ anticipé" }).count()) === 0);
  await boutonDepart.click();
  await p.getByRole("button", { name: "Confirmer mon départ" }).click();
  for (let i = 0; i < 30; i++) {
    const [{ n }] = await q(`SELECT count(*)::int n FROM "Pointage" WHERE "userId" = $1 AND type = 'DEPART'`, [uid]);
    if (n > 0) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const [depart] = await q(
    `SELECT p."estDepartAnticipe", (SELECT count(*)::int FROM "JustificationPointage" j WHERE j."pointageId" = p.id) AS justif
     FROM "Pointage" p WHERE p."userId" = $1 AND p.type = 'DEPART'`,
    [uid]
  );
  verifier("1. départ sans départ anticipé", depart && depart.estDepartAnticipe === false);
  verifier("1. aucune justification au départ", depart && depart.justif === 0);
  await ctx.close();

  // Tâche de relances : aucune justification du collaborateur à traiter.
  const rep = await fetch(`${B}/api/cron/relances-justification`, { headers: { Authorization: "Bearer secret-e2e" } });
  const bilan = await rep.json();
  const [{ n: enAttente }] = await q(
    `SELECT count(*)::int n FROM "JustificationPointage" j JOIN "Pointage" p ON p.id = j."pointageId" WHERE p."userId" = $1`,
    [uid]
  );
  verifier("1. tâche de relances : rien pour ce jour non ouvré", rep.ok && enAttente === 0, `examinées ${bilan.examinees}`);

  // 2. Reporting (rh@) : compté dans les présences, absent des retards.
  const rh = await connecter("rh@simassurances.test");
  await rh.p.goto(`${B}/pointage/rh/reporting?userId=${uid}`);
  const ligne = rh.p.locator("section", { hasText: "Résumé par collaborateur" }).locator("tr", { hasText: "Collaborateur Test" });
  const cellules = await ligne.locator("td").allInnerTexts();
  verifier("2. reporting : 1 présence", cellules[3] === "1", cellules.join(" | "));
  const totaux = await rh.p.locator("[data-total]").allInnerTexts();
  verifier("2. reporting : aucun retard ni départ anticipé", totaux[0] === "Total : 0" && totaux[1] === "Total : 0", totaux.join(" | "));
  await rh.ctx.close();
}

verifier("aucune erreur JavaScript", erreursJs.length === 0, erreursJs.join(" ; "));
await browser.close();
await db.end();
console.log(resultats.join("\n"));
const ok = resultats.filter((r) => r.startsWith("OK")).length;
console.log(`${ok}/${resultats.length}`);
process.exit(ok === resultats.length ? 0 : 1);
