// Réinitialisation du Pointage seul (2026-10-14), sur base JETABLE (voir e2e/README.md). À lancer sur une base neuve.
// Refus sans permission, mot faux, empreinte périmée, deux purges successives, deux exécutions simultanées (une seule
// réussit), mise en service puis refus,
// Serveur lancé avec PLANIFICATEUR_ACTIF=false : sinon la tâche des absences recrée aussitôt des lignes après chaque purge.
//  données Trésorerie / comptes / configuration intactes, audit permanent.
import { chromium } from "playwright";
import pg from "pg";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");

const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const un = async (sql, params = []) => (await q(sql, params))[0];
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);

const MOT_PURGE = "REINITIALISER-POINTAGE";
const MOT_SERVICE = "METTRE-EN-SERVICE-POINTAGE";

const admin = (await un(`SELECT id, "roleId" FROM "User" WHERE email = 'admin@simassurances.test'`));
const collab = (await un(`SELECT id FROM "User" WHERE email = 'collaborateur@simassurances.test'`)).id;
const permission = (await un(`SELECT id FROM "Permission" WHERE key = 'pointage.reinitialiser'`));
verifier("Permission pointage.reinitialiser créée et attribuée explicitement au rôle Admin (une RolePermission)", !!permission && !!(await un(`SELECT 1 FROM "RolePermission" WHERE "roleId" = $1 AND "permissionId" = $2`, [admin.roleId, permission.id])));
verifier("Le rôle DG (systeme.reinitialiser) n'a PAS la nouvelle permission", !(await un(`SELECT 1 FROM "RolePermission" rp JOIN "Role" r ON r.id = rp."roleId" WHERE r.name = 'DG' AND rp."permissionId" = $1`, [permission.id])));

// ── Données : Pointage (purgées) et sentinelles (conservées) ────────────────────────────────────────────────────────
let n = 0;
async function donneesPointage() {
  const pid = `e2e-rp-p${++n}`;
  await q(`INSERT INTO "Pointage"(id, type, source, heure, "heurePrevue", "estRetard", "minutesRetard", "userId") VALUES ($1, 'ARRIVEE', 'ORDINATEUR', now() - interval '1 day', '07:45', true, 25, $2)`, [pid, collab]);
  await q(`INSERT INTO "JustificationPointage"(id, "pointageId", statut, "updatedAt") VALUES ($1, $2, 'SOUMISE', now())`, [`j-${pid}`, pid]);
  await q(`INSERT INTO "Absence"(id, date, statut, "userId", "updatedAt") VALUES ($1, now() - interval '${n + 3} days', 'A_CONTROLER', $2, now())`, [`a-${pid}`, collab]);
  await q(`INSERT INTO "PlageAbsenceAutorisee"(id, date, "heureDebut", "heureFin", source, "userId") VALUES ($1, now(), '08:00', '12:00', 'CONGE', $2)`, [`pl-${pid}`, collab]);
  await q(`INSERT INTO "Notification"(id, titre, message, category, "userId") VALUES ($1, 'Pointage', 'm', 'POINTAGE', $2), ($3, 'RH', 'm', 'RH', $2)`, [`np-${pid}`, collab, `nr-${pid}`]);
  await q(`INSERT INTO "HistoriqueEntry"(id, entity, "entityId", action, detail, "userId") VALUES ($1, 'Pointage', $2, 'POINTAGE', 'test', $3)`, [`h-${pid}`, pid, collab]);
  await q(`INSERT INTO "JournalTechnique"(id, niveau, source, code, message) VALUES ($1, 'ERREUR', 'EMAIL', 'SMTP_ECHEC', 'test')`, [`jt-${pid}`]);
  await q(`INSERT INTO "ExecutionTache"(id, tache, declenchement, debut, fin, statut) VALUES ($1, 'PURGE', 'MANUEL', now(), now(), 'SUCCES')`, [`et-${pid}`]);
}
await donneesPointage();

// Sentinelles : Trésorerie (demande, historique, notification), FeedbackApp, configuration.
await q(`INSERT INTO "Demande"(id, reference, montant, "beneficiaireType", "createurId", "etapeCircuit", "updatedAt") VALUES ('e2e-dem', 'DEM-E2E-000001', 1000, 'COLLABORATEUR', $1, 'TERMINEE', now())`, [collab]);
await q(`INSERT INTO "HistoriqueEntry"(id, entity, "entityId", action, detail, "userId") VALUES ('h-treso', 'Demande', 'e2e-dem', 'CREATION', 'treso', $1)`, [collab]);
await q(`INSERT INTO "Notification"(id, titre, message, category, "userId") VALUES ('n-treso', 'Treso', 'm', 'TRESORERIE', $1)`, [collab]);
await q(`INSERT INTO "Feedback"(id, content, "recipientId", source, "submittedAt", type) VALUES ('fb-e2e', 'Un message de test suffisamment long.', $1, 'PUBLIC', now(), 'COLLABORATION')`, [collab]);
const garde = async () => ({
  demandes: (await un(`SELECT count(*)::int n FROM "Demande"`)).n,
  historiqueTreso: (await un(`SELECT count(*)::int n FROM "HistoriqueEntry" WHERE entity = 'Demande'`)).n,
  notifTreso: (await un(`SELECT count(*)::int n FROM "Notification" WHERE category = 'TRESORERIE'`)).n,
  feedbacks: (await un(`SELECT count(*)::int n FROM "Feedback"`)).n,
  users: (await un(`SELECT count(*)::int n FROM "User"`)).n,
  roles: (await un(`SELECT count(*)::int n FROM "Role"`)).n,
  permissions: (await un(`SELECT count(*)::int n FROM "RolePermission"`)).n,
  services: (await un(`SELECT count(*)::int n FROM "Service"`)).n,
  horaires: (await un(`SELECT count(*)::int n FROM "ParametrageHoraire"`)).n,
  joursFeries: (await un(`SELECT count(*)::int n FROM "JourFerie"`)).n,
});
const gardeAvant = await garde();
const pointageVide = async () =>
  (await un(`SELECT (SELECT count(*) FROM "Pointage") + (SELECT count(*) FROM "JustificationPointage") + (SELECT count(*) FROM "Absence") + (SELECT count(*) FROM "PlageAbsenceAutorisee") + (SELECT count(*) FROM "Notification" WHERE category IN ('POINTAGE','RH')) + (SELECT count(*) FROM "HistoriqueEntry" WHERE entity IN ('Pointage','PointageQR','PointageGeo','JustificationPointage')) + (SELECT count(*) FROM "JournalTechnique") + (SELECT count(*) FROM "ExecutionTache") AS n`)).n == 0;

const browser = await chromium.launch();
async function connecter(email) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" }, acceptDownloads: true });
  const p = await ctx.newPage();
  await p.goto(`${B}/login`);
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', "password123");
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click('button[type="submit"]')]);
  return { ctx, p };
}

/** Identifiants des Server Actions, lus dans les scripts client de la page (ils portent le nom de la fonction). */
async function trouverActions(p) {
  const ressources = await p.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name).filter((u) => u.includes("/_next/static/") && u.endsWith(".js")));
  const ids = {};
  for (const url of ressources) {
    const texte = await (await fetch(url)).text();
    for (const m of texte.matchAll(/createServerReference\)?\(\s*"([0-9a-f]{20,})"[^)]*?"(reinitialiserPointageAction|mettreEnServicePointageAction)"/g)) ids[m[2]] = m[1];
  }
  return ids;
}
async function appeler(ctx, idAction, args) {
  const r = await ctx.request.post(`${B}/admin/reinitialisation-pointage`, {
    headers: { "Next-Action": idAction, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" },
    data: JSON.stringify(args),
  });
  const texte = await r.text();
  const succes = /"status":"success"/.test(texte);
  const message = /"message":"((?:[^"\\]|\\.)*)"/.exec(texte)?.[1] ?? texte.slice(0, 200);
  return { succes, message };
}
async function sauvegarde(ctx) {
  const r = await ctx.request.get(`${B}/api/admin/reinitialisation-pointage/sauvegarde`);
  return { status: r.status(), sha: r.headers()["x-backup-sha256"], corps: await r.text() };
}

// ── Accès ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const { ctx, p } = await connecter("admin@simassurances.test");
await p.goto(`${B}/admin/reinitialisation-pointage`);
verifier("Admin avec la permission : écran accessible", (await p.locator("body").innerText()).includes("Réinitialisation du Pointage"));
verifier("Lien « Purge du Pointage » dans le menu", (await p.locator('a[href="/admin/reinitialisation-pointage"]').count()) > 0);
const actions = await trouverActions(p);
verifier("Identifiants des Server Actions retrouvés", !!actions.reinitialiserPointageAction && !!actions.mettreEnServicePointageAction, JSON.stringify(Object.keys(actions)));
const idPurge = actions.reinitialiserPointageAction;
const idService = actions.mettreEnServicePointageAction;

{
  // Sans permission : retirée du rôle (retirable dans /admin/roles), l'effet est immédiat.
  await q(`DELETE FROM "RolePermission" WHERE "roleId" = $1 AND "permissionId" = $2`, [admin.roleId, permission.id]);
  const s = await sauvegarde(ctx);
  verifier("Sans permission : sauvegarde 403", s.status === 403);
  await p.goto(`${B}/admin/reinitialisation-pointage`);
  verifier("Sans permission : l'écran redirige (le contournement estAdmin ne suffit PAS)", !p.url().includes("/admin/reinitialisation-pointage"), p.url());
  const a = await appeler(ctx, idPurge, [MOT_PURGE, "0".repeat(64)]);
  verifier("Sans permission : l'action de purge est refusée", !a.succes && /non autoris/i.test(a.message), a.message);
  const b = await appeler(ctx, idService, [MOT_SERVICE]);
  verifier("Sans permission : la mise en service est refusée", !b.succes && /non autoris/i.test(b.message), b.message);
  verifier("Sans permission : rien n'a été supprimé", !(await pointageVide()) && (await un(`SELECT count(*)::int n FROM "PointageMiseEnService"`)).n === 0);
  await q(`INSERT INTO "RolePermission"("roleId", "permissionId") VALUES ($1, $2)`, [admin.roleId, permission.id]);

  const rh = await connecter("rh@simassurances.test");
  verifier("Compte RH : sauvegarde 403", (await sauvegarde(rh.ctx)).status === 403);
  await rh.ctx.close();
}

// ── Mot faux, empreinte périmée ──────────────────────────────────────────────────────────────────────────────────────────
let s = await sauvegarde(ctx);
verifier("Sauvegarde : 200, empreinte SHA-256, contenu JSON des tables purgées", s.status === 200 && /^[0-9a-f]{64}$/.test(s.sha) && JSON.parse(s.corps).tables.pointage.length === 1);
{
  const a = await appeler(ctx, idPurge, ["reinitialiser-pointage", s.sha]);
  verifier("Mot faux (casse) : purge refusée, rien supprimé", !a.succes && /exactement/.test(a.message) && !(await pointageVide()), a.message);
  const b = await appeler(ctx, idPurge, ["REINITIALISER", s.sha]);
  verifier("Mot de la réinitialisation globale refusé", !b.succes && /exactement/.test(b.message));
  const c = await appeler(ctx, idPurge, [MOT_PURGE, "pas-une-empreinte"]);
  verifier("Empreinte invalide : refusée", !c.succes && /sauvegarde/i.test(c.message));
  await donneesPointage(); // les données changent après la sauvegarde
  const d = await appeler(ctx, idPurge, [MOT_PURGE, s.sha]);
  verifier("Empreinte périmée (données modifiées depuis la sauvegarde) : purge refusée", !d.succes && /ont chang/.test(d.message) && !(await pointageVide()), d.message);
}

// ── Première purge, par l'écran ───────────────────────────────────────────────────────────────────────────────────────────
{
  await p.goto(`${B}/admin/reinitialisation-pointage`);
  const bouton = p.getByRole("button", { name: "Purger le Pointage" });
  verifier("Écran : bouton de purge désactivé tant qu'aucune sauvegarde n'est téléchargée", await bouton.isDisabled());
  const [telechargement] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: /Générer et télécharger/ }).click()]);
  verifier("Écran : la sauvegarde JSON est téléchargée", /sauvegarde-avant-reinitialisation-pointage-.*\.json$/.test(telechargement.suggestedFilename()));
  await p.locator('input[name="confirmation-purge"]').fill("REINITIALISER-POINTAG");
  verifier("Écran : mot incomplet ⇒ bouton désactivé", await bouton.isDisabled());
  await p.locator('input[name="confirmation-purge"]').fill(MOT_PURGE);
  verifier("Écran : sauvegarde + mot exact ⇒ bouton actif", await bouton.isEnabled());
  await bouton.click();
  await p.locator('[data-resultat="purge"]').waitFor({ timeout: 20_000 });
  const message = await p.locator('[data-resultat="purge"]').innerText();
  verifier("Écran : message de succès indiquant que la date de purge est enregistrée (aucun réglage de SYSTEM_START_DATE demandé)", /date de cette purge est enregistr/.test(message) && !/Réglez SYSTEM_START_DATE/.test(message), message.slice(0, 120));
  verifier("Première purge : tables du Pointage, journal technique et notifications POINTAGE/RH vides", await pointageVide());
  verifier("Première purge : Trésorerie, FeedbackApp, comptes, rôles, permissions, services, horaires, jours fériés intacts", JSON.stringify(await garde()) === JSON.stringify(gardeAvant), JSON.stringify(await garde()));
  const audit = await q(`SELECT decompte, "sauvegardeSha256" FROM "ReinitialisationPointage"`);
  verifier("Audit permanent : une ligne avec décompte et empreinte", audit.length === 1 && audit[0].decompte.pointage === 2 && /^[0-9a-f]{64}$/.test(audit[0].sauvegardeSha256), JSON.stringify(audit[0]?.decompte));
  await p.locator("[data-purge]").first().waitFor({ timeout: 15_000 }).catch(() => {}); // le rafraîchissement de la page suit la purge
  verifier("Audit affiché sur l'écran", (await p.locator('[data-section="audit"]').innerText()).includes("ligne(s) supprimée(s)"));
}

// ── La tâche des absences ne recrée rien avant la date de purge (plus de dépendance à SYSTEM_START_DATE) ───────────────────
{
  // Comptes « anciens » : sinon la règle d'ancienneté (aucune absence le jour de la création du compte) masquerait le contrôle.
  await q(`UPDATE "User" SET "createdAt" = now() - interval '60 days'`);
  const lancer = async () => (await fetch(`${B}/api/cron/absences`, { headers: { authorization: "Bearer secret-e2e" } })).status;

  verifier("Tâche des absences relancée juste après la purge : HTTP 200", (await lancer()) === 200);
  const apresPurge = (await un(`SELECT count(*)::int n FROM "Absence"`)).n;
  verifier("Après la purge : aucune absence recréée (rien avant la date de purge, SYSTEM_START_DATE inchangé)", apresPurge === 0, `${apresPurge} absence(s)`);

  // Contre-épreuve : la purge « vieillie » de 5 jours (audit antidaté) ne bloque plus la veille → les absences réapparaissent.
  const hier = new Date();
  hier.setDate(hier.getDate() - 1);
  const hierOuvre = hier.getDay() !== 0 && hier.getDay() !== 6;
  await q(`UPDATE "ReinitialisationPointage" SET "effectueeAt" = "effectueeAt" - interval '5 days'`);
  verifier("Contre-épreuve : relance après antidatation de la purge, HTTP 200", (await lancer()) === 200);
  const apresAntidatation = (await un(`SELECT count(*)::int n FROM "Absence"`)).n;
  verifier(
    "Contre-épreuve : la date de purge est bien ce qui bloquait (absences de la veille recréées une fois la purge ancienne)",
    hierOuvre ? apresAntidatation > 0 : true,
    hierOuvre ? `${apresAntidatation} absence(s) recréée(s)` : "non applicable ce jour (la veille est un week-end)"
  );
}

// ── Deuxième purge successive (répétable)───────────────────────────────────────────────────────────────────────────────
{
  await donneesPointage();
  s = await sauvegarde(ctx);
  const a = await appeler(ctx, idPurge, [MOT_PURGE, s.sha]);
  verifier("Deuxième purge successive : réussie", a.succes && (await pointageVide()), a.message.slice(0, 80));
  verifier("Audit : deux lignes", (await un(`SELECT count(*)::int n FROM "ReinitialisationPointage"`)).n === 2);
  verifier("Deuxième purge : données hors Pointage toujours intactes", JSON.stringify(await garde()) === JSON.stringify(gardeAvant));
}

// ── Deux exécutions simultanées : une seule réussit ──────────────────────────────────────────────────────────────────────
{
  await donneesPointage();
  s = await sauvegarde(ctx);
  const avant = (await un(`SELECT count(*)::int n FROM "ReinitialisationPointage"`)).n;
  const [a, b] = await Promise.all([appeler(ctx, idPurge, [MOT_PURGE, s.sha]), appeler(ctx, idPurge, [MOT_PURGE, s.sha])]);
  const apres = (await un(`SELECT count(*)::int n FROM "ReinitialisationPointage"`)).n;
  verifier("Deux purges simultanées : une seule réussit, une seule ligne d'audit ajoutée", [a, b].filter((x) => x.succes).length === 1 && apres === avant + 1, `${a.succes}/${b.succes} — ${a.message.slice(0, 60)} | ${b.message.slice(0, 60)}`);
  verifier("Après les purges simultanées : Pointage vide et données hors Pointage intactes", (await pointageVide()) && JSON.stringify(await garde()) === JSON.stringify(gardeAvant));
}

// ── Mise en service : définitive ─────────────────────────────────────────────────────────────────────────────────────────
{
  const a = await appeler(ctx, idService, ["METTRE-EN-SERVICE"]);
  verifier("Mise en service : mot faux refusé", !a.succes && /exactement/.test(a.message) && (await un(`SELECT count(*)::int n FROM "PointageMiseEnService"`)).n === 0, a.message);
  await donneesPointage();
  s = await sauvegarde(ctx); // sauvegarde valide obtenue AVANT la mise en service
  const b = await appeler(ctx, idService, [MOT_SERVICE]);
  verifier("Mise en service : mot exact ⇒ marqueur posé", b.succes && (await un(`SELECT count(*)::int n FROM "PointageMiseEnService"`)).n === 1, b.message);
  const c = await appeler(ctx, idService, [MOT_SERVICE]);
  verifier("Mise en service : une seule fois", !c.succes && (await un(`SELECT count(*)::int n FROM "PointageMiseEnService"`)).n === 1, c.message);
  const d = await appeler(ctx, idPurge, [MOT_PURGE, s.sha]);
  verifier("Après la mise en service : purge refusée même avec une sauvegarde valide", !d.succes && /en service/.test(d.message) && !(await pointageVide()), d.message);
  verifier("Après la mise en service : route de sauvegarde 409", (await sauvegarde(ctx)).status === 409);
  await p.goto(`${B}/admin/reinitialisation-pointage`);
  const corps = await p.locator("body").innerText();
  verifier("Après la mise en service : l'écran n'affiche plus que l'audit (aucun formulaire)", (await p.locator('[data-etat="en-service"]').count()) === 1 && (await p.locator('input[name="confirmation-purge"]').count()) === 0 && corps.includes("Audit des purges"));
  verifier("Après la mise en service : lien de menu retiré", (await p.locator('a[href="/admin/reinitialisation-pointage"]').count()) === 0);
  verifier("Audit permanent conservé (3 purges)", (await un(`SELECT count(*)::int n FROM "ReinitialisationPointage"`)).n === 3);
}

// 390 px.
await p.setViewportSize({ width: 390, height: 800 });
await p.goto(`${B}/admin/reinitialisation-pointage`);
verifier("390 px sans défilement horizontal", !(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));

await browser.close();
await db.end();
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko ? 1 : 0);
