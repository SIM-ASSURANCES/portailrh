// Fiabilisation du pointage — phases 2 et 3 (2026-10-14), sur base JETABLE (voir e2e/README.md).
// Phase 2 : le planificateur intégré écrit ses lignes ExecutionTache sans aucun appel externe ; le verrou fait ignorer
//           une exécution concurrente ; la route manuelle exige le secret.
// Phase 3 : moniteur, incidents (SMTP faux), santé de configuration, « Lancer maintenant », accès réservé à l'Admin,
//           invariant « le retard va au supérieur, pas à la RH ».
// Variables : E2E_ATTENDRE_CRENEAU=1 attend aussi le prochain créneau de 5 minutes (jusqu'à ~6 min).
import { chromium } from "playwright";
import pg from "pg";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
const SECRET = process.env.CRON_SECRET ?? "secret-e2e";
if (!/localhost:55497|e2e/.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");

const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const userId = async (email) => (await q(`SELECT id FROM "User" WHERE email = $1`, [email]))[0].id;
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
const appel = (chemin, avecSecret = true) =>
  fetch(`${B}${chemin}`, { headers: avecSecret ? { authorization: `Bearer ${SECRET}` } : {} });

// ── Phase 2 : le planificateur écrit tout seul (premier passage ~15 s après le démarrage) ─────────────────────────────
let lignes = [];
for (let i = 0; i < 60; i++) {
  lignes = await q(`SELECT tache, declenchement, statut FROM "ExecutionTache" WHERE declenchement = 'PLANIFICATEUR'`);
  if (new Set(lignes.map((l) => l.tache)).size >= 3) break;
  await attendre(2000);
}
for (const t of ["RELANCES_JUSTIFICATION", "ABSENCES", "PURGE"]) {
  const l = lignes.find((x) => x.tache === t);
  verifier(`Planificateur : ${t} exécutée sans appel externe`, !!l && l.statut === "SUCCES", l ? l.statut : "aucune ligne");
}

if (process.env.E2E_ATTENDRE_CRENEAU === "1") {
  const avant = (await q(`SELECT count(*)::int n FROM "ExecutionTache" WHERE tache='RELANCES_JUSTIFICATION' AND declenchement='PLANIFICATEUR'`))[0].n;
  for (let i = 0; i < 80; i++) {
    const n = (await q(`SELECT count(*)::int n FROM "ExecutionTache" WHERE tache='RELANCES_JUSTIFICATION' AND declenchement='PLANIFICATEUR'`))[0].n;
    if (n > avant) break;
    await attendre(5000);
  }
  const apres = (await q(`SELECT count(*)::int n FROM "ExecutionTache" WHERE tache='RELANCES_JUSTIFICATION' AND declenchement='PLANIFICATEUR'`))[0].n;
  verifier("Planificateur : une nouvelle ligne SUCCES au créneau de 5 minutes suivant", apres > avant, `${avant} → ${apres}`);
}

// Route manuelle : secret obligatoire.
verifier("Route manuelle sans secret : 401", (await appel("/api/cron/relances-justification", false)).status === 401);
verifier("Route absences sans secret : 401", (await appel("/api/cron/absences", false)).status === 401);

// ── Verrou : une exécution concurrente est ignorée ─────────────────────────────────────────────────────────────────────
{
  const verrou = new pg.Client({ connectionString: DB });
  await verrou.connect();
  await verrou.query(`SELECT pg_advisory_lock(hashtext('tache:RELANCES_JUSTIFICATION'))`);
  const avant = new Date();
  const r = await (await appel("/api/cron/relances-justification")).json();
  const ligne = (await q(`SELECT statut, declenchement FROM "ExecutionTache" WHERE tache='RELANCES_JUSTIFICATION' AND debut >= $1 ORDER BY debut DESC LIMIT 1`, [avant]))[0];
  verifier("Verrou pris par une autre instance : exécution ignorée", r.ignoree === true && ligne?.statut === "IGNOREE" && ligne?.declenchement === "MANUEL", JSON.stringify(ligne));
  await verrou.query(`SELECT pg_advisory_unlock(hashtext('tache:RELANCES_JUSTIFICATION'))`);
  await verrou.end();
  const r2 = await (await appel("/api/cron/relances-justification")).json();
  const ligne2 = (await q(`SELECT statut FROM "ExecutionTache" WHERE tache='RELANCES_JUSTIFICATION' AND declenchement='MANUEL' ORDER BY debut DESC LIMIT 1`))[0];
  verifier("Verrou libéré : exécution réussie", r2.success === true && !r2.ignoree && ligne2?.statut === "SUCCES", JSON.stringify(ligne2));
}

// Exécutions simultanées : jamais deux SUCCES chevauchants ; chaque appel laisse une ligne.
{
  const avant = new Date();
  await Promise.all([appel("/api/cron/absences"), appel("/api/cron/absences"), appel("/api/cron/absences")]);
  const l = await q(`SELECT statut, debut, fin FROM "ExecutionTache" WHERE tache='ABSENCES' AND debut >= $1`, [avant]);
  const succes = l.filter((x) => x.statut === "SUCCES");
  let chevauche = false;
  for (const a of succes) for (const b of succes) if (a !== b && a.debut < b.fin && b.debut < a.fin) chevauche = true;
  verifier("3 appels simultanés : 3 lignes, aucun SUCCES chevauchant", l.length === 3 && !chevauche, `${l.length} lignes dont ${succes.length} SUCCES`);
}

// ── Phase 3 : invariant « le retard va au supérieur, pas à la RH » ────────────────────────────────────────────────────
{
  const collab = await userId("collaborateur@simassurances.test");
  const resp = await userId("responsable-commercial@simassurances.test");
  const rh = await userId("rh@simassurances.test");
  const dg = await userId("dg@simassurances.test");
  const depuis = new Date();
  const hier = new Date();
  hier.setDate(hier.getDate() - 1);
  hier.setHours(8, 10, 0, 0);
  await q(
    `INSERT INTO "Pointage"(id, type, source, heure, "heurePrevue", "estRetard", "minutesRetard", "userId")
     VALUES ('e2e-inv', 'ARRIVEE', 'ORDINATEUR', $1, '07:45', true, 25, $2)`,
    [hier, collab]
  );
  await q(`INSERT INTO "JustificationPointage"(id, "pointageId", "updatedAt") VALUES ('j-e2e-inv', 'e2e-inv', now())`);
  await appel("/api/cron/relances-justification");
  await attendre(1500);
  const n = async (uid, lien) =>
    (await q(`SELECT count(*)::int n FROM "Notification" WHERE "userId" = $1 AND "createdAt" >= $2 AND lien LIKE $3`, [uid, depuis, lien]))[0].n;
  verifier("Invariant : le responsable du service est alerté (1)", (await n(resp, "/pointage/justifications")) === 1);
  verifier("Invariant : AUCUNE notification de retard pour rh@", (await n(rh, "/pointage/%")) === 0);
  verifier("Invariant : aucune notification pour le DG", (await n(dg, "/pointage/%")) === 0);
  verifier("Le collaborateur reçoit sa demande de justification", (await n(collab, "/pointage/justifier/%")) === 1);
}

// ── Phase 3 : incidents (SMTP volontairement faux), écrans d'administration ──────────────────────────────────────────
{
  // Une notification CRITIQUE déclenche l'envoi e-mail : le premier envoi de justification est CRITIQUE. SMTP faux : voir
  // e2e/README (le serveur est lancé avec SMTP_HOST=127.0.0.1 SMTP_PORT=1 SMTP_USER=x SMTP_PASS=y).
  for (let i = 0; i < 20; i++) {
    const inc = await q(`SELECT code FROM "JournalTechnique" WHERE code = 'SMTP_ECHEC'`);
    if (inc.length > 0) break;
    await attendre(1000);
  }
  const incidents = await q(`SELECT niveau, source, code, message, contexte FROM "JournalTechnique" WHERE code = 'SMTP_ECHEC'`);
  verifier("Journal : SMTP_ECHEC enregistré après une relance", incidents.length >= 1 && incidents[0].source === "EMAIL");
  const texte = JSON.stringify(incidents);
  verifier("Journal : aucune adresse e-mail ni mot de passe dans l'incident", !/@simassurances|password|pass":/i.test(texte), texte.slice(0, 200));
}

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

{
  const { ctx, p } = await connecter("admin@simassurances.test");
  await p.goto(`${B}/admin/journal-technique`);
  const corps = await p.locator("body").innerText();
  verifier("Moniteur : les 3 tâches sont listées", ["Relances de justification", "Absences et oublis de départ", "Purge des journaux"].every((t) => corps.includes(t)));
  verifier("Moniteur : prochaine exécution et dernière exécution réussie affichées", /Prochaine exécution attendue/.test(corps) && /Dernière exécution réussie/.test(corps));

  // « Lancer maintenant » crée une ligne MANUEL.
  const avant = (await q(`SELECT count(*)::int n FROM "ExecutionTache" WHERE tache='PURGE' AND declenchement='MANUEL'`))[0].n;
  await p.locator('[data-tache="PURGE"]').getByRole("button", { name: "Lancer maintenant" }).click();
  await p.locator('[data-sonner-toast]').first().waitFor();
  const apres = (await q(`SELECT count(*)::int n FROM "ExecutionTache" WHERE tache='PURGE' AND declenchement='MANUEL'`))[0].n;
  verifier("« Lancer maintenant » crée une ligne MANUEL", apres === avant + 1, `${avant} → ${apres}`);

  await p.goto(`${B}/admin/journal-technique?onglet=incidents`);
  const inc = await p.locator("body").innerText();
  verifier("Incidents : SMTP_ECHEC visible", inc.includes("SMTP_ECHEC"));
  await p.goto(`${B}/admin/journal-technique?onglet=incidents&niveau=AVERTISSEMENT&source=PUSH`);
  verifier("Incidents : le filtre niveau/source masque SMTP_ECHEC", !(await p.locator("body").innerText()).includes("SMTP_ECHEC"));

  await p.goto(`${B}/admin/journal-technique?onglet=sante`);
  const sante = await p.locator("body").innerText();
  verifier("Santé : SMTP configuré, Firebase, AUTH_URL, planificateur présents", /SMTP configuré/.test(sante) && /Firebase serveur/.test(sante) && /AUTH_URL/.test(sante) && /Planificateur actif/.test(sante));
  verifier("Santé : compteurs sur 7 jours affichés", (await p.locator('[data-valeur="critiques-sans-email"]').count()) === 1);
  verifier("Santé : aucune valeur de secret affichée", !/secret-e2e|password|AIza/i.test(sante));

  await p.goto(`${B}/admin`);
  verifier("Accueil admin : carte Journal technique", (await p.locator('[data-carte="journal-technique"]').count()) === 1);

  // 390 px sans défilement horizontal.
  await p.setViewportSize({ width: 390, height: 800 });
  for (const onglet of ["taches", "incidents", "sante"]) {
    await p.goto(`${B}/admin/journal-technique?onglet=${onglet}`);
    const debord = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    verifier(`390 px sans défilement horizontal (${onglet})`, !debord);
  }
  await ctx.close();
}

{
  // Un compte non admin est refusé.
  const { ctx, p } = await connecter("collaborateur@simassurances.test");
  await p.goto(`${B}/admin/journal-technique`);
  verifier("Collaborateur : redirigé hors de /admin/journal-technique", !p.url().includes("/admin/journal-technique"), p.url());
  await ctx.close();
}

// Planificateur coupé → « En retard » : exécuté par e2e/planificateur-retard.mjs (serveur relancé avec PLANIFICATEUR_ACTIF=false).

verifier("Aucune erreur JavaScript", erreursJs.length === 0, erreursJs.join(" | "));
await browser.close();
await db.end();
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko ? 1 : 0);
