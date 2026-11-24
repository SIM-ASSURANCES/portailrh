// Gestion Compta, lot GC-6b — RELANCES 7 / 30 / 60 JOURS et RÉSUMÉ DU LUNDI, de bout en bout dans l'application réelle : le moniteur
// d'administration (« Lancer maintenant ») exécute les vraies tâches (`executerTache`, vrai service de notification). Sur base JETABLE et
// neuve, planificateur coupé (voir e2e/README.md : `next build` puis `PLANIFICATEUR_ACTIF=false bash e2e/base-jetable.sh`). Ce script
// ÉCRIT en base (dont la mise en service du module) et ne se rejoue pas sur la même base. Les paliers à horloge simulée, la concurrence
// et le résumé hebdomadaire sont dans e2e/compta-gc6b-relances.ts ; ici on prouve l'envoi réel et ses destinataires.
//  1. module non mis en service : « Lancer maintenant » ne lit, n'écrit et n'envoie rien ;
//  2. premier passage après la mise en service : l'arriéré est réservé sans envoi, aucune notification ;
//  3. une ligne qui franchit un palier APRÈS : notification groupée, aux porteurs de la permission du palier, et à eux seuls ;
//  4. un second « Lancer maintenant » n'envoie rien de plus ;
//  5. résumé de la semaine : une fois, au commercial et à la production ; le moniteur affiche des chiffres, aucun incident ;
//  6. palier sans aucun destinataire : réservé (jamais renvoyé), compté en erreur, TRACÉ au journal technique (une ligne, sans donnée
//     personnelle), aucun envoi, pas de doublon au passage suivant.
import { chromium } from "playwright";
import pg from "pg";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/i.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");

const db = new pg.Client({ connectionString: DB });
await db.connect();
const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
const jour = (decalage) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + decalage);
  return d.toISOString().slice(0, 10);
};

// ---------- Jeu d'essai ----------
const adminId = (await db.query(`SELECT id FROM "User" WHERE email = 'admin@simassurances.test'`)).rows[0].id;
await db.query(`INSERT INTO "CptCompte" (id, libelle, type, "majAt") VALUES ('co-wave', 'Wave Business', 'WAVE_BUSINESS', now())`);
await db.query(`INSERT INTO "CptProduit" (id, code, libelle, branche, "majAt") VALUES ('pr-1', 'P1', 'Produit 1', 'ACCIDENTS', now())`);
await db.query(`INSERT INTO "CptClient" (id, nom, "majAt") VALUES ('cl-1', 'Kouassi Ama', now())`);
let n = 0;
async function encaissement(reference, age) {
  n++;
  await db.query(
    `INSERT INTO "CptEncaissement" (id, reference, "compteId", "referenceReleve", "dateValeur", montant, "typeFlux", statut, "resteARattacher", "creeParId", "majAt")
     VALUES ($1,$1,'co-wave',$2,$3,2500,'ENCAISSEMENT','A_RATTACHER',2500,$4,now())`,
    [reference, `T_${n}`, jour(-age), adminId]
  );
}
async function contrat(police, age) {
  await db.query(
    `INSERT INTO "CptContrat" (id, "numPolice", "produitId", "natureContrat", "clientId", "dateEffet", "dateEcheance", "primeNetteHt", "primeTtc", "creeParId", "majAt", "declarePaye", "datePaiementDeclaree", fractionnement)
     VALUES ($1,$1,'pr-1','INDIVIDUEL','cl-1','2026-01-01','2026-12-31',10000,10000,$2,now(),true,$3,'COMPTANT')`,
    [police, adminId, jour(-age)]
  );
  await db.query(
    `INSERT INTO "CptEcheance" (id, "contratId", rang, "periodeDebut", "periodeFin", "datePrevue", "primeTtc", "primeHt", "montantDu", "majAt")
     VALUES ($1,$2,1,'2026-01-01','2026-12-31','2026-01-05',10000,10000,10000,now())`,
    [`${police}-e1`, police]
  );
}
// Arriéré d'avant la mise en service : une encaissement de 50 jours, un contrat de 80 jours.
await encaissement("CPE-ARRIERE-1", 50);
await contrat("POL-ARRIERE", 80);

// ---------- Connexion de l'Admin et lancement manuel ----------
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
const erreursJs = [];
const p = await ctx.newPage();
p.on("pageerror", (e) => erreursJs.push(e.message));
await p.goto(`${B}/login`);
await p.fill('input[name="email"]', "admin@simassurances.test");
await p.fill('input[name="password"]', "password123");
await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click('button[type="submit"]')]);

/** Clique « Lancer maintenant » sur la tâche et renvoie la ligne d'exécution créée par ce clic. */
async function lancer(tache) {
  await p.goto(`${B}/admin/journal-technique`);
  const avant = Number((await db.query(`SELECT count(*)::int AS n FROM "ExecutionTache" WHERE tache = $1`, [tache])).rows[0].n);
  await p.locator(`[data-tache="${tache}"]`).getByRole("button", { name: "Lancer maintenant" }).click();
  for (let i = 0; i < 40; i++) {
    const rows = (await db.query(`SELECT declenchement, statut, bilan, erreur FROM "ExecutionTache" WHERE tache = $1 ORDER BY debut ASC`, [tache])).rows;
    if (rows.length > avant) return rows[rows.length - 1];
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}
const notifications = async (filtre = "") => (await db.query(`SELECT "userId", titre, message, priority, category FROM "Notification" WHERE category = 'SYSTEME' ${filtre}`)).rows;
const porteurs = async (...permissions) =>
  (
    await db.query(
      `SELECT DISTINCT u.id FROM "User" u JOIN "RolePermission" rp ON rp."roleId" = u."roleId" JOIN "Permission" pe ON pe.id = rp."permissionId"
       WHERE u."isActive" = true AND pe.key = ANY($1::text[])`,
      [permissions]
    )
  ).rows.map((r) => r.id).sort();

// ---------- 1. Module non mis en service ----------
let e = await lancer("COMPTA_RELANCES");
verifier("1. « Lancer maintenant » : exécution manuelle réussie", e?.declenchement === "MANUEL" && e?.statut === "SUCCES", JSON.stringify(e));
verifier("1. module non mis en service : bilan « en attente du module », aucun traitement", e?.bilan?.enAttenteDuModule === true && e?.bilan?.moduleNonMisEnService === true && e?.bilan?.traites === 0 && e?.bilan?.silencieuses === 0);
verifier("1. rien n'a été réservé ni marqué, aucune notification", (await db.query(`SELECT count(*)::int AS n FROM "CptAlerteControle"`)).rows[0].n === 0 && (await notifications()).length === 0);
e = await lancer("COMPTA_CONTROLE_HEBDO");
verifier("1. résumé du lundi : rien non plus avant la mise en service", e?.bilan?.moduleNonMisEnService === true && (await notifications()).length === 0);

// ---------- 2. Premier passage après la mise en service ----------
await db.query(`INSERT INTO "CptMiseEnService" ("activeeParId", "sauvegardeSha256") VALUES ($1, 'sha-synthetique')`, [adminId]);
e = await lancer("COMPTA_RELANCES");
// L'arriéré : l'encaissement de 50 jours (relance + alerte) et le contrat de 80 jours (relance + alerte + escalade) = 5 paliers.
verifier("2. premier passage : aucune ligne relancée, 5 paliers réservés sans envoi", e?.bilan?.premierPassage === true && e?.bilan?.traites === 0 && e?.bilan?.silencieuses === 5 && e?.bilan?.notifications === 0, JSON.stringify(e?.bilan));
verifier("2. AUCUNE notification pour l'arriéré", (await notifications()).length === 0);
await p.goto(`${B}/admin/journal-technique`);
verifier("2. le moniteur le dit : « Premier passage : arriéré réservé sans envoi »", /Premier passage : arriéré réservé sans envoi/.test(await p.locator('[data-tache="COMPTA_RELANCES"]').innerText()));

// ---------- 3. Lignes qui franchissent un palier APRÈS ----------
await encaissement("CPE-NOUVEAU-8J", 8); // relance, commercial
await encaissement("CPE-NOUVEAU-70J", 70); // 70 jours d'un coup : escalade seule, direction
await contrat("POL-NOUVEAU-10J", 10); // relance, production
await encaissement("CPE-JEUNE-3J", 3); // pas encore de palier
e = await lancer("COMPTA_RELANCES");
verifier("3. 3 lignes relancées, 3 paliers réservés sans envoi (relance et alerte de la ligne de 70 jours)", e?.bilan?.premierPassage === false && e?.bilan?.traites === 3 && e?.bilan?.silencieuses === 2 && e?.bilan?.erreurs === 0, JSON.stringify(e?.bilan));
const notifs = await notifications();
const commerciaux = await porteurs("cpt.confirmer_rattachement", "cpt.identifier_encaissement");
const production = await porteurs("cpt.importer_production", "cpt.saisir_contrat");
const direction = await porteurs("cpt.trancher_litige");
const idsDe = (prefixe) => notifs.filter((x) => x.titre.startsWith(prefixe)).map((x) => x.userId).sort();
verifier("3. relance des encaissements : aux porteurs de confirmer/identifier, et à eux seuls", JSON.stringify(idsDe("Relance : 1 encaissement sans contrat")) === JSON.stringify(commerciaux) && commerciaux.length > 0, `${idsDe("Relance : 1 encaissement sans contrat").length}/${commerciaux.length}`);
verifier("3. relance du contrat : aux porteurs de importer_production/saisir_contrat, et à eux seuls", JSON.stringify(idsDe("Relance : 1 contrat déclaré payé")) === JSON.stringify(production) && production.length > 0, `${idsDe("Relance : 1 contrat déclaré payé").length}/${production.length}`);
verifier("3. escalade à 60 jours : à la direction (trancher_litige) seulement", JSON.stringify(idsDe("Escalade : 1 encaissement sans contrat")) === JSON.stringify(direction) && direction.length > 0, `${idsDe("Escalade : 1 encaissement sans contrat").length}/${direction.length}`);
verifier("3. aucune alerte de 30 jours pour la ligne de 70 jours (un seul palier, le plus élevé)", notifs.every((x) => !x.titre.startsWith("Alerte")));
verifier("3. aucun message ne cite l'arriéré, la ligne trop jeune ni un nom de personne", notifs.every((x) => !/ARRIERE|JEUNE|Kouassi/.test(`${x.titre} ${x.message}`)));
verifier("3. le message cite la référence de la ligne", notifs.some((x) => x.message.includes("CPE-NOUVEAU-8J")) && notifs.some((x) => x.message.includes("POL-NOUVEAU-10J")) && notifs.some((x) => x.message.includes("CPE-NOUVEAU-70J")));
verifier("3. priorités : relance INFO, escalade IMPORTANT ; catégorie SYSTEME", notifs.filter((x) => x.titre.startsWith("Relance")).every((x) => x.priority === "INFO") && notifs.filter((x) => x.titre.startsWith("Escalade")).every((x) => x.priority === "IMPORTANT"));
verifier("3. une notification groupée par destinataire et par palier (pas une par ligne)", notifs.length === commerciaux.length + production.length + direction.length, `${notifs.length}`);
const nbApres = notifs.length;

// ---------- 4. Second lancement : rien de plus ----------
e = await lancer("COMPTA_RELANCES");
verifier("4. second « Lancer maintenant » : aucune ligne relancée, aucune notification de plus", e?.bilan?.traites === 0 && e?.bilan?.notifications === 0 && e?.bilan?.silencieuses === 0 && (await notifications()).length === nbApres, JSON.stringify(e?.bilan));

// ---------- 5. Résumé de la semaine ----------
const avantResume = nbApres;
e = await lancer("COMPTA_CONTROLE_HEBDO");
const resume = (await notifications()).filter((x) => x.titre.startsWith("Contrôle de la semaine"));
verifier("5. résumé : une notification par porteur, aux deux équipes", e?.bilan?.notifications === commerciaux.length + production.length && resume.length === commerciaux.length + production.length, JSON.stringify(e?.bilan));
verifier("5. résumé des encaissements : 4 encaissements sans contrat (arriéré, 8J, 70J, 3J) — les chiffres de la liste", resume.some((x) => x.titre === "Contrôle de la semaine : 4 encaissements sans contrat"), resume.map((x) => x.titre).join(" | "));
verifier("5. résumé des contrats : 2 contrats déclarés payés sans encaissement", resume.some((x) => x.titre === "Contrôle de la semaine : 2 contrats déclarés payés sans encaissement"), resume.map((x) => x.titre).join(" | "));
e = await lancer("COMPTA_CONTROLE_HEBDO");
verifier("5. second lancement la même semaine : rien de plus", e?.bilan?.notifications === 0 && (await notifications()).length === avantResume + resume.length);
await p.goto(`${B}/admin/journal-technique`);
verifier("5. le moniteur affiche des chiffres pour le résumé", /notifications? de résumé/.test(await p.locator('[data-tache="COMPTA_CONTROLE_HEBDO"]').innerText()));
const incidents = (await db.query(`SELECT count(*)::int AS n FROM "JournalTechnique" WHERE contexte->>'tache' LIKE 'COMPTA\\_%'`)).rows[0].n;
verifier("5. aucun incident technique journalisé par ces tâches", incidents === 0, `${incidents} incident(s)`);
verifier("5. aucune erreur JavaScript", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));

// ---------- 6. Palier sans destinataire : tracé au journal technique ----------
await db.query(`DELETE FROM "RolePermission" WHERE "permissionId" IN (SELECT id FROM "Permission" WHERE key = 'cpt.trancher_litige')`);
await encaissement("CPE-SANS-DEST-65J", 65); // escalade (60 jours) : plus aucun porteur de cpt.trancher_litige
const avantSans = (await notifications()).length;
e = await lancer("COMPTA_RELANCES");
verifier("6. palier sans destinataire : compté en erreur, aucun envoi", e?.bilan?.sansDestinataire === 1 && e?.bilan?.erreurs === 1 && e?.bilan?.notifications === 0 && (await notifications()).length === avantSans, JSON.stringify(e?.bilan));
const lignes = (await db.query(`SELECT niveau, source, message, contexte FROM "JournalTechnique" WHERE code = 'COMPTA_PALIER_SANS_DESTINATAIRE'`)).rows;
verifier("6. UNE ligne de journal (source TACHE, avertissement)", lignes.length === 1 && lignes[0].source === "TACHE" && lignes[0].niveau === "AVERTISSEMENT", JSON.stringify(lignes));
const ctxt = lignes[0]?.contexte ?? {};
verifier("6. contexte : type d'objet, palier, permission attendue — et rien de personnel", ctxt.typeObjet === "ENCAISSEMENT" && ctxt.palier === "ESCALADE" && ctxt.permissionAttendue === "cpt.trancher_litige" && !/CPE-|Kouassi/.test(JSON.stringify(lignes[0])), JSON.stringify(ctxt));
e = await lancer("COMPTA_RELANCES");
verifier("6. passage suivant : pas de doublon (palier réservé, jamais renvoyé, aucune nouvelle ligne)", e?.bilan?.sansDestinataire === 0 && (await db.query(`SELECT count(*)::int AS n FROM "JournalTechnique" WHERE code = 'COMPTA_PALIER_SANS_DESTINATAIRE'`)).rows[0].n === 1, JSON.stringify(e?.bilan));

await ctx.close();
await browser.close();
await db.end();
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\nGC-6b (application réelle) : ${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko === 0 ? 0 : 1);
