// Lot O (2026-10-30) — rattrapage des données existantes : `prisma/rattrapage-production.ts` et les 5 scripts de reprise.
// AUTONOME : crée sa PROPRE base jetable `lot_o` (PostgreSQL de test, port 55497), migre, seed, y fabrique des données « anciennes »
// (e2e/lot-o-donnees-anciennes.ts), puis supprime la base. Aucun serveur web nécessaire. Vérifie :
//  - chaque script est en SIMULATION par défaut (aucune écriture) et affiche ses compteurs ;
//  - le script chaîné : simulation (rien écrit) -> refus sans phrase de confirmation -> application (avant / écrites / restant) ->
//    seconde simulation qui ne trouve plus RIEN (idempotence) -> nouvelle application sans effet ;
//  - les cas ambigus ne sont jamais devinés (règlement à deux articles validés, historique à deux signatures candidates) ;
//  - aucune écriture de caisse touchée ; l'historique garde une trace de chaque reprise ;
//  - le rattachement manuel (--affecter) du script de règlements fonctionne toujours.
import pg from "pg";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND = path.join(RACINE, "backend");
const ADMIN_URL = "postgresql://postgres:pw@localhost:55497/postgres";
const BASE = "lot_o";
const URL_PG = `postgresql://postgres:pw@localhost:55497/${BASE}`;
const ENV = { ...process.env, DATABASE_URL: `${URL_PG}?schema=public` };

const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
const sh = (cmd, args) => spawnSync(cmd, args, { cwd: BACKEND, env: ENV, encoding: "utf8" });
const tsx = (fichier, args = []) => sh("npx", ["tsx", fichier, ...args]);
const sortie = (r) => `${r.stdout ?? ""}${r.stderr ?? ""}`;

const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${BASE}'`);
await admin.query(`DROP DATABASE IF EXISTS ${BASE}`);
await admin.query(`CREATE DATABASE ${BASE}`);
let r = sh("npx", ["prisma", "migrate", "deploy", "--config", "prisma7.config.ts"]);
verifier("0. migrations appliquées", /successfully applied/.test(sortie(r)));
r = tsx("prisma/seed.ts");
verifier("0. seed", r.status === 0);
const db = new pg.Client({ connectionString: URL_PG });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
r = tsx("../e2e/lot-o-donnees-anciennes.ts");
verifier("0. données anciennes créées", r.status === 0 && /Données anciennes créées/.test(sortie(r)), sortie(r).trim().split("\n").pop());

const TABLES = ["Demande", "LigneDemande", "Reglement", "HistoriqueEntry", "ActionSignee", "JournalCaisse", "JournalBanque", "RetourCaisse", "Notification"];
const instantane = async () => JSON.stringify(await Promise.all(TABLES.map(async (t) => [t, (await q(`SELECT count(*)::int AS n FROM "${t}"`))[0].n])));
const contenu = async () => JSON.stringify([await q(`SELECT reference, statut, "etapeCircuit", "montantValide"::text, "clotureForcee" FROM "Demande" ORDER BY reference`), await q(`SELECT id, "ligneDemandeId" FROM "Reglement" ORDER BY id`), await q(`SELECT id, "actionSigneeId" FROM "HistoriqueEntry" WHERE action IN ('validation_ligne','decision_ligne_dg') ORDER BY id`)]);
const base0 = await instantane();
const contenu0 = await contenu();

// ---- 1. Chaque script : simulation par défaut ----
for (const [script, attendu, args] of [
  ["recalculer-statuts-articles", /2 à corriger \(simulation/, []],
  ["recalculer-reglements-articles", /1 règlement\(s\) rattachable\(s\) \(simulation/, ["--automatique"]], // sans --automatique : liste seulement
  ["simuler-cloture-articles", /1 incohérente\(s\).*\(simulation/, []],
  ["rattacher-signatures", /Simulation : rien n'a été écrit/, []],
]) {
  r = tsx(`prisma/${script}.ts`, args);
  verifier(`1. ${script} : simulation par défaut, compteurs affichés`, r.status === 0 && attendu.test(sortie(r)), sortie(r).trim().split("\n").pop());
  verifier(`1. ${script} : aucune écriture en simulation`, (await contenu()) === contenu0 && (await instantane()) === base0);
}
{
  const sql = await q(`SELECT 1`); // garde la connexion vivante
  void sql;
  r = sh("psql", [URL_PG, "-f", "prisma/comptage-reglements-articles.sql"]);
  verifier("1. comptage-reglements-articles.sql : s'exécute (AMBIGUS / rattachés / détail)", r.status === 0 && /AMBIGUS/.test(sortie(r)) && /OLD-C/.test(sortie(r)), sortie(r).slice(0, 120));
}

// ---- 2. Script chaîné : simulation ----
r = tsx("prisma/rattrapage-production.ts");
const s1 = sortie(r);
verifier("2. simulation chaînée : réussit et annonce « RIEN n'a été écrit »", r.status === 0 && /SIMULATION/.test(s1) && /RIEN n'a été écrit/.test(s1));
verifier("2. simulation chaînée : les 5 étapes dans l'ordre (comptage, statuts B, règlements D, clôture C, signatures L bis)", [...s1.matchAll(/--- Étape (\d) :/g)].map((m) => m[1]).join("") === "12345");
verifier("2. simulation chaînée : liste le cas AMBIGU (OLD-C) sans le deviner", /\[AMBIGU\] OLD-C/.test(s1) && /Signature non rattachée|AMBIGUËS 1/.test(s1));
verifier("2. simulation chaînée : signale les écritures non défaisables", /non défaisables par le script/.test(s1));
verifier("2. simulation chaînée : aucune écriture", (await contenu()) === contenu0 && (await instantane()) === base0);

// ---- 3. Refus sans confirmation ----
r = tsx("prisma/rattrapage-production.ts", ["--appliquer", "--confirmation", "rattraper"]);
verifier("3. --appliquer sans la phrase exacte : refusé, rien écrit", r.status === 1 && /phrase de confirmation incorrecte/.test(sortie(r)) && (await contenu()) === contenu0);

// ---- 4. Application ----
const caisseAvant = await q(`SELECT count(*)::int AS n FROM "JournalCaisse"`);
r = tsx("prisma/rattrapage-production.ts", ["--appliquer", "--confirmation", "RATTRAPER"]);
const s2 = sortie(r);
verifier("4. application chaînée réussie (code 0)", r.status === 0 && /APPLIQUÉ/.test(s2), s2.trim().split("\n").pop());
verifier("4. bilan : idempotence annoncée (plus rien à traiter automatiquement)", /Idempotence : une nouvelle simulation ne trouve plus RIEN/.test(s2));
const dem = Object.fromEntries((await q(`SELECT reference, statut, "etapeCircuit", "montantValide"::float AS mv, "clotureForcee" FROM "Demande"`)).map((d) => [d.reference, d]));
verifier("4. étape B : OLD-A → VALIDEE_NON_REGLEE, étape TERMINEE, montant validé 100 000", dem["OLD-A"].statut === "VALIDEE_NON_REGLEE" && dem["OLD-A"].etapeCircuit === "TERMINEE" && dem["OLD-A"].mv === 100000);
verifier("4. étape B : OLD-B (réglée en entier) → REGLEE", dem["OLD-B"].statut === "REGLEE");
const regl = Object.fromEntries((await q(`SELECT d.reference, r."ligneDemandeId" FROM "Reglement" r JOIN "Demande" d ON d.id = r."demandeId"`)).map((x) => [x.reference, x.ligneDemandeId]));
verifier("4. étape D : le règlement à UN article validé (OLD-B) est rattaché", !!regl["OLD-B"]);
verifier("4. étape D : le règlement AMBIGU (OLD-C, deux articles validés) n'est PAS deviné", regl["OLD-C"] === null);
verifier("4. étape C : OLD-D marquée « clôturée sans régularisation », statut CLOTUREE conservé", dem["OLD-D"].clotureForcee === true && dem["OLD-D"].statut === "CLOTUREE");
const hist = await q(`SELECT action, "actionSigneeId" FROM "HistoriqueEntry" WHERE action IN ('validation_ligne','decision_ligne_dg') ORDER BY "createdAt"`);
verifier("4. étape L bis : la ligne à une seule candidate est rattachée", hist.filter((h) => h.action === "validation_ligne" && h.actionSigneeId).length === 1);
verifier("4. étape L bis : la ligne à deux candidates différentes reste « non rattachée » (jamais devinée)", hist.filter((h) => h.action === "decision_ligne_dg")[0]?.actionSigneeId === null);
verifier("4. étape L bis : la ligne antérieure à la mise en service n'est pas touchée", hist.filter((h) => h.action === "validation_ligne" && !h.actionSigneeId).length === 1);
const traces = Object.fromEntries((await q(`SELECT action, count(*)::int AS n FROM "HistoriqueEntry" WHERE action LIKE 'reprise_%' OR action LIKE 'rattachement_%' GROUP BY action`)).map((x) => [x.action, x.n]));
verifier("4. traces d'historique : une par reprise (statuts ×2, rattachement ×1, clôture ×1)", traces.reprise_statut_articles === 2 && traces.rattachement_reglement_article === 1 && traces.reprise_cloture_articles === 1, JSON.stringify(traces));
verifier("4. journal de caisse non touché", (await q(`SELECT count(*)::int AS n FROM "JournalCaisse"`))[0].n === caisseAvant[0].n);

// ---- 5. Seconde simulation : plus rien ; nouvelle application sans effet ----
const contenu1 = await contenu();
r = tsx("prisma/rattrapage-production.ts");
const s3 = sortie(r);
const aTraiter = [...s3.matchAll(/^\d\. .*?\s{2,}(\d+)\s+(\d+)\s*$/gm)].map((m) => Number(m[1]));
verifier("5. seconde simulation : plus rien à traiter automatiquement (5 étapes à 0)", aTraiter.length === 5 && aTraiter.every((n) => n === 0), aTraiter.join(","));
verifier("5. seconde simulation : seul le cas ambigu est encore signalé", /\[AMBIGU\] OLD-C/.test(s3));
r = tsx("prisma/rattrapage-production.ts", ["--appliquer", "--confirmation", "RATTRAPER"]);
verifier("5. nouvelle application : aucun effet (idempotente)", r.status === 0 && (await contenu()) === contenu1);

// ---- 6. Rattachement manuel du cas ambigu (script de règlements) ----
const reglC = (await q(`SELECT r.id FROM "Reglement" r JOIN "Demande" d ON d.id = r."demandeId" WHERE d.reference = 'OLD-C'`))[0].id;
const ligneC = (await q(`SELECT l.id FROM "LigneDemande" l JOIN "Demande" d ON d.id = l."demandeId" WHERE d.reference = 'OLD-C' AND l.libelle = 'C1'`))[0].id;
r = tsx("prisma/recalculer-reglements-articles.ts", ["--affecter", `${reglC}:${ligneC}`]);
verifier("6. --affecter en simulation : « permis », rien écrit", /permis \(simulation\)/.test(sortie(r)) && (await q(`SELECT "ligneDemandeId" FROM "Reglement" WHERE id = $1`, [reglC]))[0].ligneDemandeId === null);
r = tsx("prisma/recalculer-reglements-articles.ts", ["--affecter", `${reglC}:${ligneC}`, "--appliquer"]);
verifier("6. --affecter --appliquer : le règlement ambigu est rattaché à l'article choisi", /appliqué/.test(sortie(r)) && (await q(`SELECT "ligneDemandeId" FROM "Reglement" WHERE id = $1`, [reglC]))[0].ligneDemandeId === ligneC);
r = tsx("prisma/rattrapage-production.ts");
verifier("6. après rattachement manuel : plus aucun cas ambigu de règlement", !/\[AMBIGU\] OLD-C/.test(sortie(r)));
verifier("6. journal de caisse toujours non touché", (await q(`SELECT count(*)::int AS n FROM "JournalCaisse"`))[0].n === caisseAvant[0].n);

// ---- Nettoyage ----
await db.end();
await new Promise((res) => setTimeout(res, 800));
await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${BASE}'`).catch(() => {});
await admin.query(`DROP DATABASE IF EXISTS ${BASE}`).catch(() => {});
await admin.end();

console.log(resultats.join("\n"));
const ko = resultats.filter((x) => x.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles OK`);
process.exit(ko ? 1 : 0);
