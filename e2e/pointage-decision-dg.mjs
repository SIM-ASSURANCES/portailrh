// Pointage V2 — décision des justifications en trois niveaux (2026-10-12), sur base JETABLE (voir e2e/README.md).
// Cas « retardataire seul RH » : rh@ est le seul compte RH du seed et le responsable du service RH. Sa justification
// est décidée par le DG (dernier recours), jamais par lui-même ; le DG est notifié, rh@ ne l'est pas. Contre-épreuve :
// un collaborateur ordinaire est décidé par son responsable, et le DG n'est pas notifié.
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

/** Retard de 25 min hier à 08:10, justification attendue (comme la crée le pointage du collaborateur). */
async function retard(uid, suffixe) {
  const hier = new Date();
  hier.setDate(hier.getDate() - 1);
  hier.setHours(8, 10, 0, 0);
  const id = `e2e-retard-${suffixe}`;
  await q(
    `INSERT INTO "Pointage"(id, type, source, heure, "heurePrevue", "estRetard", "minutesRetard", "userId")
     VALUES ($1, 'ARRIVEE', 'ORDINATEUR', $2, '07:45', true, 25, $3)`,
    [id, hier, uid]
  );
  await q(`INSERT INTO "JustificationPointage"(id, "pointageId", "updatedAt") VALUES ($1, $2, now())`, [`j-${id}`, id]);
  return id;
}

async function justifier(email, pointageId, motif) {
  const { ctx, p } = await connecter(email);
  await p.goto(`${B}/pointage/justifier/${pointageId}`);
  const texte = await p.locator("body").innerText();
  await p.fill('textarea[name="motif"]', motif);
  await p.getByRole("button", { name: "Envoyer ma justification" }).click();
  await p.locator('[data-sonner-toast][data-type="success"]').first().waitFor();
  await ctx.close();
  return texte;
}

const notifs = async (uid, depuis) =>
  (await q(`SELECT count(*)::int n FROM "Notification" WHERE "userId" = $1 AND "createdAt" >= $2 AND lien = '/pointage/justifications'`, [uid, depuis]))[0].n;

const rh = await userId("rh@simassurances.test");
const dg = await userId("dg@simassurances.test");
const collab = await userId("collaborateur@simassurances.test");
const respCommercial = await userId("responsable-commercial@simassurances.test");
const [{ n: nbRH }] = await q(
  `SELECT count(*)::int n FROM "User" u WHERE u."isActive" AND EXISTS (SELECT 1 FROM "RolePermission" rp JOIN "Permission" p ON p.id = rp."permissionId" WHERE rp."roleId" = u."roleId" AND p.key = 'pointage.corriger_pointage')`
);
verifier("seed : un seul compte RH actif", nbRH === 1, String(nbRH));

// ── Retardataire seul RH → DG ──────────────────────────────────────────────────────────────────────────────────
{
  const debut = new Date();
  const pid = await retard(rh, "rh");
  const ecran = await justifier("rh@simassurances.test", pid, "Panne de véhicule sur la route");
  verifier("rh@ voit « examinée par le DG »", ecran.includes("le DG"));
  verifier("DG notifié", (await notifs(dg, debut)) === 1);
  verifier("rh@ non notifié", (await notifs(rh, debut)) === 0);

  // rh@ ne décide pas sa propre justification : absente de sa file.
  const r = await connecter("rh@simassurances.test");
  await r.p.goto(`${B}/pointage/justifications`);
  const fileRh = await r.p.locator("body").innerText();
  verifier("rh@ : sa justification absente de sa file", !fileRh.includes("Panne de véhicule"));
  await r.ctx.close();

  // assistant-finance@ (ni RH, ni DG, ni responsable de service) : écran refusé.
  const f = await connecter("assistant-finance@simassurances.test");
  await f.p.goto(`${B}/pointage/justifications`);
  verifier("assistant-finance@ : écran de décision refusé", !f.p.url().includes("/pointage/justifications"), f.p.url());
  await f.ctx.close();

  // Le DG ouvre l'écran (menu présent), voit le repli et accepte.
  const d = await connecter("dg@simassurances.test");
  await d.p.goto(`${B}/pointage/justifications`);
  verifier("DG : écran de décision accessible", d.p.url().includes("/pointage/justifications"), d.p.url());
  verifier("DG : menu « Justifications » présent", (await d.p.locator('a[href="/pointage/justifications"]').count()) > 0);
  verifier("DG : carte « décision DG »", (await d.p.locator("body").innerText()).includes("décision DG (aucun autre compte RH)"));
  await d.p.getByRole("button", { name: "Accepter" }).first().click();
  await d.p.locator('[data-sonner-toast][data-type="success"]').first().waitFor();
  const [j] = await q(`SELECT statut, "decideurId" FROM "JustificationPointage" WHERE "pointageId" = $1`, [pid]);
  verifier("acceptée par le DG", j.statut === "ACCEPTEE" && j.decideurId === dg, `${j.statut} ${j.decideurId === dg}`);
  await d.ctx.close();
}

// ── Contre-épreuve : collaborateur ordinaire → son responsable, DG non notifié ─────────────────────────────────
{
  const debut = new Date();
  const pid = await retard(collab, "collab");
  await justifier("collaborateur@simassurances.test", pid, "Embouteillage sur le pont");
  verifier("responsable du service notifié", (await notifs(respCommercial, debut)) === 1);
  verifier("DG non notifié hors repli", (await notifs(dg, debut)) === 0);
  verifier("RH non notifiée hors repli", (await notifs(rh, debut)) === 0);
  const d = await connecter("dg@simassurances.test");
  await d.p.goto(`${B}/pointage/justifications`);
  verifier("DG : ne voit pas la justification d'un collaborateur ordinaire", !(await d.p.locator("body").innerText()).includes("Embouteillage"));
  await d.ctx.close();
}

verifier("aucune erreur JavaScript", erreursJs.length === 0, erreursJs.join(" ; "));
await browser.close();
await db.end();
console.log(resultats.join("\n"));
const ok = resultats.filter((r) => r.startsWith("OK")).length;
console.log(`${ok}/${resultats.length}`);
process.exit(ok === resultats.length ? 0 : 1);
