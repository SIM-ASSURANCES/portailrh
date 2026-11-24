// Gestion Compta, lot GC-1e — SUPPRESSION DE COMPTE (W8) : un compte qui a la moindre trace Gestion Compta ne se supprime pas.
// Sur base JETABLE (voir e2e/README.md : `next build` puis `bash e2e/base-jetable.sh`, avec AUTH_SECRET et AUTH_TRUST_HOST).
//  1. un compte par type de trace Compta (audit, mise en service, paramètre, pièce jointe, période clôturée) : suppression
//     refusée, message précis, compte toujours en base ;
//  2. un compte sans aucune trace : suppression acceptée (le comptage ne bloque pas à tort) ;
//  3. le refus ne dépend que de la trace Compta : le compte « libre » avait pourtant les mêmes rôle et service que les autres.
// Les lignes Compta insérées ici restent dans la base jetable (l'audit est en ajout seul après la mise en service) : elle est détruite à l'arrêt.
import { chromium } from "playwright";
import pg from "pg";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/i.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");

const db = new pg.Client({ connectionString: DB });
await db.connect();
const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);

// ---------- Données synthétiques ----------
const service = (await db.query(`SELECT id FROM "Service" ORDER BY name LIMIT 1`)).rows[0]?.id ?? null;
await db.query(`INSERT INTO "Role" (id, name) VALUES ('r-w8', 'Rôle W8') ON CONFLICT DO NOTHING`);
const COMPTES = [
  { id: "u-w8-audit", nom: "W8 Compte Audit", trace: `INSERT INTO "CptAudit" (entite, "entiteId", action, "userId") VALUES ('Test','w8','creation','u-w8-audit')`, phrase: /journal d'audit de Gestion Compta/ },
  { id: "u-w8-param", nom: "W8 Compte Parametre", trace: `UPDATE "CptParametre" SET "majParId"='u-w8-param' WHERE cle='relance.jours'`, phrase: /modifié 1 paramètre\(s\) de Gestion Compta/ },
  { id: "u-w8-piece", nom: "W8 Compte Piece", trace: `INSERT INTO "CptPieceJointe" (id, url, mime, taille, sha256, "deposeeParId") VALUES ('pj-w8','uploads/w8.pdf','application/pdf',10,'abc','u-w8-piece')`, phrase: /déposé 1 pièce\(s\) jointe\(s\) de Gestion Compta/ },
  { id: "u-w8-periode", nom: "W8 Compte Periode", trace: `INSERT INTO "CptPeriode" (id, mois, statut, "clotureeParId", "clotureeAt") VALUES ('pe-w8','2026-01-01','CLOTUREE','u-w8-periode', now())`, phrase: /clôturé 1 période\(s\) de Gestion Compta/ },
  // Dernier : une fois le module « mis en service », l'audit devient intouchable (triggers) — sans effet sur les lignes déjà posées.
  { id: "u-w8-service", nom: "W8 Compte MiseEnService", trace: `INSERT INTO "CptMiseEnService" ("activeeParId","sauvegardeSha256") VALUES ('u-w8-service','sha-synthetique')`, phrase: /mis le module Gestion Compta en service/ },
];
const LIBRE = { id: "u-w8-libre", nom: "W8 Compte Libre" };
for (const c of [...COMPTES, LIBRE]) {
  await db.query(
    // Un mot de passe (haché synthétique, jamais utilisé pour se connecter) : sans lui, l'écran traite le compte comme une invitation en attente.
    `INSERT INTO "User" (id, "fullName", email, "roleId", "serviceId", "passwordHash", "updatedAt") VALUES ($1, $2, $3, 'r-w8', $4, 'hash-synthetique-w8', now()) ON CONFLICT DO NOTHING`,
    [c.id, c.nom, `${c.id}@simassurances.test`, service]
  );
}
for (const c of COMPTES) await db.query(c.trace);

// ---------- Connexion de l'Admin ----------
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
const erreursJs = [];
const p = await ctx.newPage();
p.on("pageerror", (e) => erreursJs.push(e.message));
await p.goto(`${B}/login`);
await p.fill('input[name="email"]', "admin@simassurances.test");
await p.fill('input[name="password"]', "password123");
await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click('button[type="submit"]')]);

/** Clique « Supprimer » puis « Confirmer la suppression » sur la ligne du compte, renvoie le texte du toast. */
async function supprimer(nom) {
  await p.goto(`${B}/admin/users`);
  const ligne = p.locator("tr", { hasText: nom }).first();
  await ligne.waitFor({ state: "visible", timeout: 15000 });
  await ligne.getByRole("button", { name: "Supprimer", exact: true }).click();
  await ligne.getByRole("button", { name: "Confirmer la suppression" }).click();
  const toast = p.locator("[data-sonner-toast]").last();
  await toast.waitFor({ state: "visible", timeout: 15000 });
  return (await toast.innerText()).replace(/\s+/g, " ");
}
const existe = async (id) => (await db.query(`SELECT 1 FROM "User" WHERE id = $1`, [id])).rowCount === 1;

// ---------- 1. Refus pour chaque type de trace ----------
for (const c of COMPTES) {
  const message = await supprimer(c.nom);
  verifier(`1. ${c.nom} : suppression refusée avec le motif Compta`, /Impossible de supprimer/.test(message) && c.phrase.test(message), message);
  verifier(`1. ${c.nom} : le compte existe toujours en base`, await existe(c.id));
}

// ---------- 2. Un compte sans trace se supprime ----------
const succes = await supprimer(LIBRE.nom);
verifier("2. compte sans aucune trace : supprimé définitivement", /supprimé définitivement/.test(succes), succes);
verifier("2. compte sans trace : absent de la base", !(await existe(LIBRE.id)));

// ---------- 4. Tâches planifiées vides (W9) : visibles dans le moniteur, exécutables, bilan lisible ----------
await p.goto(`${B}/admin/journal-technique`);
const TACHES = {
  COMPTA_CONTROLE_HEBDO: "Gestion Compta : contrôle hebdomadaire",
  COMPTA_RELANCES: "Gestion Compta : relances de créances",
  COMPTA_RAPPEL_TCA: "Gestion Compta : rappel de la taxe (TCA)",
};
for (const [cle, libelle] of Object.entries(TACHES)) {
  const carte = p.locator(`[data-tache="${cle}"]`);
  verifier(`4. le moniteur affiche la tâche ${cle}`, (await carte.count()) === 1 && (await carte.innerText()).includes(libelle));
}
await p.locator('[data-tache="COMPTA_RELANCES"]').getByRole("button", { name: "Lancer maintenant" }).click();
// Base jetable neuve, planificateur coupé : la première ligne COMPTA_RELANCES est celle du clic.
let ligne;
for (let i = 0; i < 30 && !ligne; i++) {
  ligne = (await db.query(`SELECT declenchement, statut, bilan, erreur FROM "ExecutionTache" WHERE tache = 'COMPTA_RELANCES' ORDER BY debut DESC LIMIT 1`)).rows[0];
  if (!ligne) await new Promise((r) => setTimeout(r, 500));
}
verifier("4. « Lancer maintenant » écrit une exécution MANUELLE réussie", ligne?.declenchement === "MANUEL" && ligne?.statut === "SUCCES", JSON.stringify(ligne));
verifier("4. le bilan est celui d'une tâche vide", ligne?.bilan?.enAttenteDuModule === true && ligne?.bilan?.traites === 0 && ligne?.bilan?.erreurs === 0);
await p.goto(`${B}/admin/journal-technique`);
verifier("4. le moniteur dit « Aucun traitement pour l'instant »", /Aucun traitement pour l'instant/.test(await p.locator('[data-tache="COMPTA_RELANCES"]').innerText()));
const incidents = (await db.query(`SELECT count(*)::int AS n FROM "JournalTechnique" WHERE contexte->>'tache' LIKE 'COMPTA\\_%'`)).rows[0].n;
verifier("4. aucun incident technique n'est journalisé par ces tâches", incidents === 0, `${incidents} incident(s)`);

verifier("5. aucune erreur JavaScript dans les pages visitées", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));

await ctx.close();
await browser.close();
await db.end();

console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\nGC-1e : ${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko === 0 ? 0 : 1);
