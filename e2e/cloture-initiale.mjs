// Clôture INITIALE au premier passage du planificateur en production (2026-10-14), sur base JETABLE (voir e2e/README.md).
// Justifications EN_ATTENTE d'avant le jour courant → NON_JUSTIFIEE sans envoi ; absences A_CONTROLER d'avant le jour
// courant → CONFIRMEE sans notification ; une ligne TACHE au journal technique ; une seule fois (marqueur).
// Le serveur est relancé par ce script (e2e/redemarrer-serveur.sh) : à lancer sur une base neuve, serveur en marche.
import { execSync } from "node:child_process";
import pg from "pg";

const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");

const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
const redemarrer = () => execSync("bash e2e/redemarrer-serveur.sh 3100", { stdio: "pipe" });
const lignesJournal = async () => q(`SELECT niveau, source, code, message, contexte FROM "JournalTechnique" WHERE code = 'CLOTURE_INITIALE'`);
async function attendreJournal(n, ms = 120_000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if ((await lignesJournal()).length >= n) return true;
    await attendre(2000);
  }
  return false;
}

const collab = (await q(`SELECT id FROM "User" WHERE email = 'collaborateur@simassurances.test'`))[0].id;
const jour = (decalage, h = 8, m = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - decalage);
  d.setHours(h, m, 0, 0);
  return d;
};
let n = 0;
async function justification(id, heure, statut = "EN_ATTENTE") {
  const pid = `e2e-ci-p${++n}`;
  await q(
    `INSERT INTO "Pointage"(id, type, source, heure, "heurePrevue", "estRetard", "minutesRetard", "userId") VALUES ($1, 'ARRIVEE', 'ORDINATEUR', $2, '07:45', true, 25, $3)`,
    [pid, heure, collab]
  );
  await q(`INSERT INTO "JustificationPointage"(id, "pointageId", statut, "updatedAt") VALUES ($1, $2, $3::"StatutJustificationPointage", now())`, [id, pid, statut]);
}
const absence = (id, date, statut, motif = null) =>
  q(`INSERT INTO "Absence"(id, date, statut, motif, "userId", "updatedAt") VALUES ($1, $2, $3::"StatutAbsence", $4, $5, now())`, [id, date, statut, motif, collab]);
const statutJ = async (id) => (await q(`SELECT statut, "clotureeAt", "nombreEnvois" FROM "JustificationPointage" WHERE id = $1`, [id]))[0];
const statutA = async (id) => (await q(`SELECT statut, motif FROM "Absence" WHERE id = $1`, [id]))[0];

// ── Données d'avant le premier passage ───────────────────────────────────────────────────────────────────────────────────
await q(`DELETE FROM "MarqueurUnique"`);
await q(`DELETE FROM "JournalTechnique" WHERE code = 'CLOTURE_INITIALE'`);
await justification("j-ci-hier", jour(1));
await justification("j-ci-ancienne", jour(3));
await justification("j-ci-soumise", jour(2), "SOUMISE");
const aujourdhui = new Date();
aujourdhui.setSeconds(0, 0);
await justification("j-ci-aujourdhui", aujourdhui);
await absence("a-ci-hier", jour(1, 0, 0), "A_CONTROLER");
await absence("a-ci-motif", jour(3, 0, 0), "A_CONTROLER", "Motif déjà saisi");
await absence("a-ci-aujourdhui", jour(0, 0, 0), "A_CONTROLER");
await absence("a-ci-justifiee", jour(9, 0, 0), "JUSTIFIEE", "Congé");
const avant = new Date();

// ── Premier démarrage ─────────────────────────────────────────────────────────────────────────────────────────────────────
redemarrer();
verifier("Journal : une ligne TACHE CLOTURE_INITIALE apparaît au premier passage", await attendreJournal(1));
const l = await lignesJournal();
verifier("Journal : source TACHE, nombres corrects (2 justifications, 2 absences)", l.length === 1 && l[0].source === "TACHE" && l[0].contexte?.justificationsCloturees === 2 && l[0].contexte?.absencesConfirmees === 2, JSON.stringify(l.map((x) => x.contexte)));
for (const id of ["j-ci-hier", "j-ci-ancienne"]) {
  const s = await statutJ(id);
  verifier(`Justification ${id} : NON_JUSTIFIEE avec clotureeAt, aucun envoi`, s.statut === "NON_JUSTIFIEE" && s.clotureeAt !== null && s.nombreEnvois === 0, JSON.stringify(s));
}
verifier("Justification SOUMISE d'avant : inchangée", (await statutJ("j-ci-soumise")).statut === "SOUMISE");
{
  const s = await statutJ("j-ci-aujourdhui");
  verifier("Justification du jour courant : intacte (EN_ATTENTE)", s.statut === "EN_ATTENTE" && s.clotureeAt === null, JSON.stringify(s));
}
{
  const a = await statutA("a-ci-hier");
  verifier("Absence antérieure sans motif : CONFIRMEE avec motif de clôture automatique", a.statut === "CONFIRMEE" && /Clôture automatique/.test(a.motif ?? ""), JSON.stringify(a));
  const b = await statutA("a-ci-motif");
  verifier("Absence antérieure avec motif : CONFIRMEE, motif conservé", b.statut === "CONFIRMEE" && b.motif === "Motif déjà saisi", JSON.stringify(b));
  verifier("Absence du jour courant : intacte (A_CONTROLER)", (await statutA("a-ci-aujourdhui")).statut === "A_CONTROLER");
  verifier("Absence JUSTIFIEE : inchangée", (await statutA("a-ci-justifiee")).statut === "JUSTIFIEE");
}
{
  const notifs = (await q(`SELECT count(*)::int n FROM "Notification" WHERE "userId" = $1 AND "createdAt" >= $2 AND (lien LIKE '/pointage/justifier/%' OR titre LIKE 'Absence non justifi%' OR titre LIKE 'Justifiez%')`, [collab, avant]))[0].n;
  verifier("Aucune notification de justification ni d'absence pour la clôture", notifs === 0, `${notifs}`);
  const marqueur = await q(`SELECT cle, bilan FROM "MarqueurUnique"`);
  verifier("Marqueur posé avec son bilan", marqueur.length === 1 && marqueur[0].bilan?.executee === true);
}

// ── Une seule fois : un redémarrage ne rejoue rien ───────────────────────────────────────────────────────────────────────
await justification("j-ci-apres", jour(2, 9, 0));
redemarrer();
await attendre(45_000);
verifier("Redémarrage : toujours une seule ligne au journal", (await lignesJournal()).length === 1);
{
  const s = await statutJ("j-ci-apres");
  verifier("Redémarrage : une justification ancienne ajoutée ensuite n'est PAS clôturée par la clôture initiale", s.statut === "EN_ATTENTE", JSON.stringify(s));
}

// ── Concurrence : l'autre instance a posé le marqueur (non encore validé) ───────────────────────────────────────────────────
await q(`DELETE FROM "MarqueurUnique"`);
await q(`DELETE FROM "JournalTechnique" WHERE code = 'CLOTURE_INITIALE'`);
await justification("j-ci-conc", jour(2, 8, 30));
{
  // Cas 1 : l'autre instance VALIDE son marqueur → ce serveur attend, constate le marqueur et ne clôture rien.
  const autre = new pg.Client({ connectionString: DB });
  await autre.connect();
  await autre.query("BEGIN");
  await autre.query(`INSERT INTO "MarqueurUnique"(cle) VALUES ('pointage.cloture_initiale')`);
  redemarrer();
  await attendre(30_000);
  verifier("Concurrence : le serveur n'a encore rien clôturé pendant que l'autre instance tient le marqueur", (await statutJ("j-ci-conc")).statut === "EN_ATTENTE");
  await autre.query("COMMIT");
  await autre.end();
  await attendre(5000);
  verifier("Concurrence (marqueur validé par l'autre) : pas de seconde exécution", (await lignesJournal()).length === 0);
}
{
  // Cas 2 : l'autre instance ANNULE sa transaction → ce serveur exécute la clôture, une seule fois.
  await q(`DELETE FROM "MarqueurUnique"`);
  const autre = new pg.Client({ connectionString: DB });
  await autre.connect();
  await autre.query("BEGIN");
  await autre.query(`INSERT INTO "MarqueurUnique"(cle) VALUES ('pointage.cloture_initiale')`);
  redemarrer();
  await attendre(30_000);
  await autre.query("ROLLBACK");
  await autre.end();
  verifier("Concurrence (transaction de l'autre annulée) : la clôture a lieu, une seule fois", (await attendreJournal(1)) && (await lignesJournal()).length === 1);
  verifier("La justification en attente est alors clôturée", (await statutJ("j-ci-conc")).statut === "NON_JUSTIFIEE");
}

await db.end();
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko ? 1 : 0);
