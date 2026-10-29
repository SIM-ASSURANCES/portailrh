// Lot K — sur base JETABLE (voir e2e/README.md). Nécessite unzip.
//   PARTIE 1 — réorientation de l'étape Service vers un autre responsable disponible :
//     le demandeur et la Finance (`treso.reorienter_demande`) réorientent ; liste des responsables éligibles (actuel, inactif, absent,
//     bénéficiaire exclus) ; motif de 10 caractères ; le nouveau est notifié, l'ancien est prévenu et ne peut plus décider (page 404,
//     action refusée) ; chronomètre remis à zéro, rappel recalibré sur le nouveau ; réorientations multiples tracées ; refus après l'étape.
//   PARTIE 2 — reprise (retour à l'étape précédente) avec motif obligatoire : Finance → Service, DG → Finance, validation → à décider ;
//     refusée pour un article réglé (même brouillon), rejeté, validé par le DG, une demande clôturée, un bénéficiaire ;
//     dépassement de budget confirmé par le DG : la confirmation devient caduque pour l'article repris, la revalidation en exige une
//     nouvelle ; aucune écriture de caisse ; parcours de l'article et reporting.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import pg from "pg";
import { assurerSignatures } from "./signatures-auto.mjs";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/i.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");

const db = new pg.Client({ connectionString: DB });
await db.connect();
await assurerSignatures(db); // lot L : les actions sensibles exigent une signature enrôlée
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
process.on("uncaughtException", async (e) => {
  console.log(resultats.join("\n"));
  console.log("\nINTERROMPU :", e.message.split("\n").slice(0, 4).join(" | "));
  try {
    await restaurerComptes();
  } catch {}
  process.exit(2);
});
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const erreursJs = [];
const attendre = async (fn, ms = 15000) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};
const net = (t) => t.replace(/\s+/g, " ").replace(/&apos;/g, "'");
const dossier = mkdtempSync(join(tmpdir(), "lotk-"));

const P = "e2e-lotk-";
const CATA = `${P}cata`; // budget 100 000 : article de 120 000 validé avec la confirmation du DG puis repris
const CATS = [CATA];
const MOTIF = "Le responsable est en mission toute la semaine";
const MOTIF_REPRISE = "Une pièce justificative manque au dossier";

const uid = async (email) => (await q(`SELECT id FROM "User" WHERE email = $1`, [email]))[0].id;
const nom = async (id) => (await q(`SELECT "fullName" FROM "User" WHERE id=$1`, [id]))[0].fullName;
const idCollab = await uid("collaborateur@simassurances.test");
const idFinance = await uid("finance@simassurances.test");
const idDG = await uid("dg@simassurances.test");
const idAssistant = await uid("assistant-finance@simassurances.test");
const idRespCommercial = await uid("responsable-commercial@simassurances.test");
const idRespTechnique = await uid("responsable-technique@simassurances.test");
const idRespCompta = await uid("responsable-comptabilite@simassurances.test");
const idRespMarketing = await uid("responsable-marketing@simassurances.test");
const nomRespCommercial = await nom(idRespCommercial);
const nomRespTechnique = await nom(idRespTechnique);
const nomRespCompta = await nom(idRespCompta);
const nomRespMarketing = await nom(idRespMarketing);

async function restaurerComptes() {
  await q(`UPDATE "User" SET "isActive"=true WHERE id=$1`, [idRespCompta]);
  await q(`DELETE FROM "PlageAbsenceAutorisee" WHERE description LIKE 'e2e-lotk%'`);
}
const nettoyer = async () => {
  await restaurerComptes();
  await q(`DELETE FROM "Notification" WHERE message LIKE '%DEM-LOTK-%'`);
  await q(`DELETE FROM "HistoriqueEntry" WHERE "entityId" LIKE '${P}%' OR detail LIKE '%DEM-LOTK-%' OR (entity IN ('Categorie','Objet') AND "entityId" LIKE '${P}%')`);
  await q(`DELETE FROM "ReglementCategorieAllocation" WHERE "reglementId" LIKE '${P}%'`);
  await q(`DELETE FROM "Reglement" WHERE id LIKE '${P}%'`);
  await q(`DELETE FROM "BudgetDepassement" WHERE "demandeId" LIKE '${P}%'`);
  await q(`DELETE FROM "BudgetParametrage" WHERE "categorieId" = ANY($1)`, [CATS]);
  await q(`DELETE FROM "LigneDemande" WHERE "demandeId" LIKE '${P}%'`);
  await q(`DELETE FROM "Demande" WHERE id LIKE '${P}%'`);
  await q(`DELETE FROM "Categorie" WHERE id = ANY($1)`, [CATS]);
};
await nettoyer();
await q(`INSERT INTO "Categorie"(id, label, "isActive") VALUES ($1,'E2E-LK-CATA',true)`, [CATA]);

const sessions = new Map();
async function connecter(email) {
  let ctx = sessions.get(email);
  if (!ctx) {
    ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
    const connexion = await ctx.newPage();
    connexion.on("pageerror", (e) => erreursJs.push(e.message));
    await connexion.goto(`${B}/login`);
    await connexion.fill('input[name="email"]', email);
    await connexion.fill('input[name="password"]', "password123");
    await Promise.all([connexion.waitForURL((u) => !u.pathname.startsWith("/login")), connexion.click('button[type="submit"]')]);
    await connexion.close();
    sessions.set(email, ctx);
  }
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(e.message));
  return p;
}
const journalEmpreinte = async () => (await q(`SELECT COALESCE(md5(string_agg(id || ':' || type || ':' || montant::text, ',' ORDER BY id)), '') AS h, count(*)::int AS n FROM "JournalCaisse"`))[0];

async function idAction(page, nomAction) {
  const ressources = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name).filter((u) => u.includes("/_next/static/") && u.endsWith(".js")));
  for (const url of ressources) {
    const texte = await (await fetch(url)).text();
    const m = new RegExp(`createServerReference\\)?\\(\\s*"([0-9a-f]{20,})"[^)]*?"${nomAction}"`).exec(texte);
    if (m) return m[1];
  }
  return null;
}
async function appelerAction(page, id, args) {
  const r = await page.context().request.post(page.url(), {
    headers: { "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" },
    data: JSON.stringify(args),
  });
  const texte = await r.text();
  return { succes: /"status":"success"/.test(texte), message: /"message":"((?:[^"\\]|\\.)*)"/.exec(texte)?.[1] ?? texte.slice(0, 300) };
}

/** Demande à articles, créée en SQL. `extra` : étape, statut, créateur, etapeServiceRequise, mode DG, ancienneté du chrono. */
async function demande(suffixe, numero, articles, extra = {}) {
  const D = `${P}${suffixe}`;
  const total = articles.reduce((s, a) => s + a.montant, 0);
  const valide = articles.filter((a) => a.statut === "VALIDEE").reduce((s, a) => s + a.montant, 0);
  const createur = extra.createurId ?? idCollab;
  await q(
    `INSERT INTO "Demande"(id, reference, montant, "montantValide", statut, "createurId", "updatedAt", "beneficiaireType", "beneficiaireUserId", "etapeCircuit", "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", "typeDemande", "etapeCircuitDepuis", "soumiseAuDG", "descriptionOriginale")
     VALUES ($1, $2, $3, $7, $8, $4, now(), 'COLLABORATEUR', $4, $5, true, $6, $9, 'STANDARD', now() - ($10 || ' hours')::interval, $11, 'test e2e lot K')`,
    [D, `DEM-LOTK-${numero}`, total, createur, extra.etape ?? "SERVICE", extra.service ?? true, valide, extra.statut ?? "EN_ATTENTE_VALIDATION", extra.mode ?? "OPTIONNELLE", String(extra.ageHeures ?? 0), extra.soumiseAuDG ?? false]
  );
  for (const [i, a] of articles.entries()) {
    await q(
      `INSERT INTO "LigneDemande"(id, libelle, "libelleOriginal", quantite, "prixUnitaire", "demandeId", motif, "categorieId", "statutValidation", "decideParId", "decideAt", "decideurFinanceId", "soumiseAuDG", "decisionDG", "decisionDGParId", "decisionDGAt", "beneficiaireType", "beneficiaireUserId")
       VALUES ($1,$2,$2,1,$3,$4,'motif e2e',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        `${D}-l${i + 1}`,
        a.libelle,
        a.montant,
        D,
        a.categorie ?? null,
        a.statut ?? "EN_ATTENTE",
        a.statut === "VALIDEE" ? (a.decideParId ?? idFinance) : null,
        a.statut === "VALIDEE" ? new Date() : null,
        a.statut === "VALIDEE" && !a.decisionDG ? idFinance : null,
        a.soumiseAuDG ?? a.decisionDG != null,
        a.decisionDG ?? null,
        a.decisionDG ? idDG : null,
        a.decisionDG ? new Date() : null,
        a.beneficiaireUserId ? "COLLABORATEUR" : null,
        a.beneficiaireUserId ?? null,
      ]
    );
  }
  return D;
}
const demandeDB = async (D) => (await q(`SELECT * FROM "Demande" WHERE id=$1`, [D]))[0];
const ligneDB = async (L) => (await q(`SELECT * FROM "LigneDemande" WHERE id=$1`, [L]))[0];
const notifs = async (userId, motif) => q(`SELECT titre, message FROM "Notification" WHERE "userId"=$1 AND message LIKE $2 ORDER BY "createdAt"`, [userId, `%${motif}%`]);
const historique = async (D, action) => q(`SELECT detail, "userId" FROM "HistoriqueEntry" WHERE action=$1 AND ("entityId"=$2 OR "entityId" LIKE $3) ORDER BY "createdAt"`, [action, D, `${D}-l%`]);
const caisse0 = await journalEmpreinte();

// ======================================================================================================================
// PARTIE 1 — RÉORIENTATION
// ======================================================================================================================
const D1 = await demande("d1", 1, [{ libelle: "Fournitures e2e", montant: 50000 }]);
{
  // Absent : le responsable Marketing a une journée entière d'absence autorisée aujourd'hui (congé).
  await q(`INSERT INTO "PlageAbsenceAutorisee"(id, date, "heureDebut", "heureFin", source, description, "userId") VALUES ($1, current_date, '00:00', '23:59', 'CONGE', 'e2e-lotk conge', $2)`, [`${P}abs1`, idRespMarketing]);
  // Inactif : le responsable Comptabilité est désactivé le temps de la liste.
  await q(`UPDATE "User" SET "isActive"=false WHERE id=$1`, [idRespCompta]);

  const collab = await connecter("collaborateur@simassurances.test");
  await collab.goto(`${B}/treso/demandes/${D1}`);
  await collab.locator("[data-reorienter]").waitFor();
  verifier("1a. le demandeur voit « Réorienter vers un autre responsable » tant que la demande attend le responsable de service", (await collab.getByRole("button", { name: "Réorienter vers un autre responsable" }).count()) === 1);
  await collab.locator("[data-reorienter-ouvrir]").click();
  const options = await collab.locator("[data-reorienter-formulaire] select option").allTextContents();
  verifier("1b. liste : le responsable ACTUEL est exclu", !options.some((o) => o.includes(nomRespCommercial)), options.join(" | "));
  verifier("1b. liste : un compte INACTIF est exclu", !options.some((o) => o.includes(nomRespCompta)));
  verifier("1b. liste : un responsable ABSENT (congé déclaré aujourd'hui) est exclu", !options.some((o) => o.includes(nomRespMarketing)));
  verifier("1b. liste : un autre responsable disponible est proposé avec son service", options.some((o) => o.includes(nomRespTechnique) && /Technique/.test(o)));
  verifier("1b. le demandeur ne voit AUCUN reste de budget", !/Reste|reste du budget|Budget après/.test(net(await collab.locator("main").innerText())));
  await q(`UPDATE "User" SET "isActive"=true WHERE id=$1`, [idRespCompta]);

  // Motif trop court : bouton grisé ; appel direct refusé.
  await collab.locator("[data-reorienter-formulaire] select").selectOption({ label: options.find((o) => o.includes(nomRespTechnique)) });
  await collab.locator("[data-reorienter-formulaire] textarea").fill("pas assez");
  verifier("1c. motif de 9 caractères ou moins : « Confirmer la réorientation » grisé", await collab.getByRole("button", { name: "Confirmer la réorientation" }).isDisabled());
  const idReorienter = await idAction(collab, "reorienterDemandeAction");
  verifier("0. identifiant de l'action de réorientation trouvé", !!idReorienter);
  const refusMotif = await appelerAction(collab, idReorienter, [D1, idRespTechnique, "pas assez"]);
  verifier("1c. appel direct avec un motif de 9 caractères : refusé côté serveur", !refusMotif.succes && /10 caractères/.test(refusMotif.message), refusMotif.message);
  verifier("1c. … rien n'a changé", (await demandeDB(D1)).responsableEtapeServiceId === null);

  // Garde 8 : un compte bénéficiaire de la demande ne peut pas devenir le décideur.
  await q(`UPDATE "LigneDemande" SET "beneficiaireType"='COLLABORATEUR', "beneficiaireUserId"=$2 WHERE id=$1`, [`${D1}-l1`, idRespCompta]);
  const refusBenef = await appelerAction(collab, idReorienter, [D1, idRespCompta, MOTIF]);
  verifier("1d. garde 8 : le bénéficiaire d'un article ne peut pas devenir le décideur de l'étape (appel direct refusé)", !refusBenef.succes && /bénéficiaire/.test(refusBenef.message), refusBenef.message);
  await q(`UPDATE "LigneDemande" SET "beneficiaireType"=NULL, "beneficiaireUserId"=NULL WHERE id=$1`, [`${D1}-l1`]);
  const refusActuel = await appelerAction(collab, idReorienter, [D1, idRespCommercial, MOTIF]);
  verifier("1d. la cible ne peut pas être le responsable actuel", !refusActuel.succes && /déjà chez ce responsable/.test(refusActuel.message), refusActuel.message);
  const refusAbsent = await appelerAction(collab, idReorienter, [D1, idRespMarketing, MOTIF]);
  verifier("1d. un responsable absent est refusé même par appel direct", !refusAbsent.succes && /absent/.test(refusAbsent.message), refusAbsent.message);
  const refusNonResp = await appelerAction(collab, idReorienter, [D1, idAssistant, MOTIF]);
  verifier("1d. un compte qui ne dirige aucun service est refusé", !refusNonResp.succes && /d'aucun service/.test(refusNonResp.message), refusNonResp.message);

  // Réorientation réelle par l'écran.
  const avant = await demandeDB(D1);
  await q(`UPDATE "Demande" SET "etapeCircuitDepuis" = now() - interval '50 hours' WHERE id=$1`, [D1]);
  await collab.locator("[data-reorienter-formulaire] textarea").fill(MOTIF);
  await collab.getByRole("button", { name: "Confirmer la réorientation" }).click();
  verifier("1e. réorientation par le demandeur", await attendre(async () => (await demandeDB(D1)).responsableEtapeServiceId === idRespTechnique));
  const apres = await demandeDB(D1);
  verifier("1e. le service du demandeur ne change pas ; la demande reste à l'étape Service", apres.etapeCircuit === "SERVICE");
  verifier("1e. chronomètre remis à zéro (étape de moins d'une minute) et rappel effacé", Date.now() - new Date(apres.etapeCircuitDepuis).getTime() < 60000 && apres.dernierRappelAt === null);
  const h1 = (await historique(D1, "reorientation_service"))[0];
  const th1 = net(h1?.detail ?? "");
  verifier("1f. historique : de qui vers qui, motif, délai écoulé chez l'ancien décideur", !!h1 && th1.includes(`${nomRespCommercial} → ${nomRespTechnique}`) && th1.includes(MOTIF) && /délai écoulé chez .* : 2 j 2 h/.test(th1) && h1.userId === idCollab, th1);
  verifier("1g. le NOUVEAU responsable est notifié (à valider, avec le motif)", (await notifs(idRespTechnique, "DEM-LOTK-1")).some((n) => /réorientée vers vous/.test(n.titre) && n.message.includes(MOTIF)));
  verifier("1g. l'ANCIEN responsable est prévenu du retrait", (await notifs(idRespCommercial, "DEM-LOTK-1")).some((n) => /retirée de votre file/.test(n.titre) && n.message.includes(nomRespTechnique)));
  verifier("1g. l'auteur (le demandeur) n'est pas notifié de sa propre action", (await notifs(idCollab, "DEM-LOTK-1")).filter((n) => /réorientée/.test(n.titre)).length === 0);
  await collab.close();

  // Le nouveau responsable voit la demande et peut décider.
  const technique = await connecter("responsable-technique@simassurances.test");
  await technique.goto(`${B}/treso/service`);
  verifier("1h. le nouveau responsable voit la demande dans « Demandes de mon service à valider »", (await technique.getByText("DEM-LOTK-1").count()) > 0);
  await technique.goto(`${B}/treso/service/${D1}`);
  const idValiderService = await idAction(technique, "validerEtapeServiceAction");
  const idRejeterService = await idAction(technique, "rejeterEtapeServiceAction");
  verifier("1h. … ouvre la demande, bouton « Valider » actif", (await technique.getByRole("button", { name: "Valider", exact: true }).isEnabled()));
  verifier("0. identifiants des actions du responsable de service trouvés", !!idValiderService && !!idRejeterService);

  // L'ancien responsable ne peut plus rien.
  const commercial = await connecter("responsable-commercial@simassurances.test");
  const reponse = await commercial.goto(`${B}/treso/service/${D1}`);
  verifier("1i. ANCIEN responsable : l'ancien lien de la demande est refusé (404)", reponse?.status() === 404);
  await commercial.goto(`${B}/treso/service`);
  verifier("1i. … la demande a disparu de sa file", (await commercial.getByText("DEM-LOTK-1").count()) === 0);
  const refusValider = await appelerAction(commercial, idValiderService, [D1]);
  verifier("1i. … valider par appel direct : refusé côté serveur", !refusValider.succes && /Seul le responsable du service/.test(refusValider.message), refusValider.message);
  const refusRejeter = await appelerAction(commercial, idRejeterService, [D1, "rejet par l'ancien responsable"]);
  verifier("1i. … rejeter par appel direct : refusé côté serveur", !refusRejeter.succes, refusRejeter.message);
  verifier("1i. … la demande n'a pas bougé", (await demandeDB(D1)).etapeCircuit === "SERVICE");
  // Pièce jointe de la demande : lisible par le nouveau décideur de l'étape, plus par l'ancien (route des pièces jointes).
  await q(`INSERT INTO "PieceJointe"(id, url, "demandeId") VALUES ($1, 'inexistant-e2e-lotk.pdf', $2)`, [`${P}pj1`, D1]);
  const accesAncien = await commercial.request.get(`${B}/api/treso/pieces-jointes/${P}pj1`);
  const accesNouveau = await technique.request.get(`${B}/api/treso/pieces-jointes/${P}pj1`);
  verifier("1i. … la pièce jointe de la demande lui est refusée (403) alors que le nouveau responsable y accède (fichier absent du disque : 404, jamais 403)", accesAncien.status() === 403 && accesNouveau.status() === 404, `${accesAncien.status()} / ${accesNouveau.status()}`);
  await q(`DELETE FROM "PieceJointe" WHERE id=$1`, [`${P}pj1`]);

  // Réorientations multiples : de nouveau, vers le responsable d'origine (plus l'actuel).
  await technique.goto(`${B}/treso/finance/demandes/${D1}`).catch(() => {});
  const collab2 = await connecter("collaborateur@simassurances.test");
  await collab2.goto(`${B}/treso/demandes/${D1}`);
  await collab2.locator("[data-reorienter-ouvrir]").click();
  const opt2 = await collab2.locator("[data-reorienter-formulaire] select option").allTextContents();
  verifier("1j. après une réorientation, le décideur actuel change : le premier responsable est de nouveau proposable, le nouveau exclu", opt2.some((o) => o.includes(nomRespCommercial)) && !opt2.some((o) => o.includes(nomRespTechnique)));
  await collab2.locator("[data-reorienter-formulaire] select").selectOption({ label: opt2.find((o) => o.includes(nomRespCommercial)) });
  await collab2.locator("[data-reorienter-formulaire] textarea").fill("Le second responsable est aussi indisponible");
  await collab2.getByRole("button", { name: "Confirmer la réorientation" }).click();
  verifier("1j. seconde réorientation", await attendre(async () => (await demandeDB(D1)).responsableEtapeServiceId === idRespCommercial));
  verifier("1j. deux réorientations tracées, chacune dans l'historique", (await historique(D1, "reorientation_service")).length === 2);
  await collab2.close();
  const refusAncien2 = await appelerAction(technique, idValiderService, [D1]);
  verifier("1j. le second ancien responsable est refusé à son tour", !refusAncien2.succes, refusAncien2.message);
  await technique.close();
  await commercial.close();
}

// Réorientation par la Finance (permission dédiée), refus sans la permission.
const D2 = await demande("d2", 2, [{ libelle: "Mobilier e2e", montant: 80000 }]);
{
  const finance = await connecter("finance@simassurances.test");
  await finance.goto(`${B}/treso/finance/demandes/${D2}`);
  await finance.locator("[data-reorienter]").waitFor();
  verifier("2a. la Finance (treso.reorienter_demande) voit le bouton sur la page de la demande", (await finance.getByRole("button", { name: "Réorienter vers un autre responsable" }).count()) === 1);
  const idReorienter = await idAction(finance, "reorienterDemandeAction");
  await finance.locator("[data-reorienter-ouvrir]").click();
  const options = await finance.locator("[data-reorienter-formulaire] select option").allTextContents();
  await finance.locator("[data-reorienter-formulaire] select").selectOption({ label: options.find((o) => o.includes(nomRespCompta)) });
  await finance.locator("[data-reorienter-formulaire] textarea").fill("Le responsable commercial est en déplacement");
  await finance.getByRole("button", { name: "Confirmer la réorientation" }).click();
  verifier("2b. réorientation par la Finance", await attendre(async () => (await demandeDB(D2)).responsableEtapeServiceId === idRespCompta));
  verifier("2b. historique : « par la Finance »", (await historique(D2, "reorientation_service")).some((h) => /par la Finance/.test(h.detail) && h.userId === idFinance));
  verifier("2b. le demandeur est informé quand ce n'est pas lui qui réoriente", (await notifs(idCollab, "DEM-LOTK-2")).some((n) => /a été réorientée/.test(n.titre)));
  verifier("2b. le nouveau responsable est notifié", (await notifs(idRespCompta, "DEM-LOTK-2")).length >= 1);

  // Sans permission : l'Assistant Finance n'a pas le bouton et l'appel direct est refusé.
  const assistant = await connecter("assistant-finance@simassurances.test");
  await assistant.goto(`${B}/treso/finance/demandes/${D2}`);
  verifier("2c. l'Assistant Finance (sans la permission) ne voit pas le bouton", (await assistant.locator("[data-reorienter]").count()) === 0);
  const refus = await appelerAction(assistant, idReorienter, [D2, idRespTechnique, MOTIF]);
  verifier("2c. … et l'appel direct est refusé", !refus.succes && /non autorisée/.test(refus.message), refus.message);
  const dg = await connecter("dg@simassurances.test");
  await dg.goto(`${B}/treso/dg/${D2}`);
  const refusDG = await appelerAction(dg, idReorienter, [D2, idRespTechnique, MOTIF]);
  verifier("2c. le DG n'a pas non plus la permission : refusé", !refusDG.succes, refusDG.message);
  await assistant.close();
  await dg.close();
  await finance.close();
}

// Le responsable vers lequel la Finance a réorienté décide réellement l'étape (la demande repart vers la Finance).
{
  const compta = await connecter("responsable-comptabilite@simassurances.test");
  await compta.goto(`${B}/treso/service/${D2}`);
  await compta.getByRole("button", { name: "Valider", exact: true }).click();
  verifier("2d. le responsable désigné par la réorientation valide l'étape : la demande passe à la Finance", await attendre(async () => (await demandeDB(D2)).etapeCircuit === "FINANCE"));
  verifier("2d. … sa décision est tracée à son nom", (await historique(D2, "validation_service")).some((h) => h.userId === idRespCompta));
  await compta.close();
}

// Pas de réorientation après l'étape Service.
const D3 = await demande("d3", 3, [{ libelle: "Papeterie e2e", montant: 20000 }], { etape: "FINANCE" });
{
  const collab = await connecter("collaborateur@simassurances.test");
  await collab.goto(`${B}/treso/demandes/${D3}`);
  verifier("3a. après la décision du responsable de service, le bouton n'existe plus", (await collab.locator("[data-reorienter]").count()) === 0);
  await collab.goto(`${B}/treso/demandes/${D1}`);
  const id = await idAction(collab, "reorienterDemandeAction");
  const r = await appelerAction(collab, id, [D3, idRespTechnique, MOTIF]);
  verifier("3a. appel direct après l'étape Service : refusé", !r.succes && /étape du responsable de service/.test(r.message), r.message);
  await collab.close();
}

// Rappels recalibrés sur le nouveau responsable.
const D4 = await demande("d4", 4, [{ libelle: "Rappel e2e", montant: 30000 }], { ageHeures: 72 });
{
  const collab = await connecter("collaborateur@simassurances.test");
  await collab.goto(`${B}/`);
  const rappelAncien = await attendre(async () => (await notifs(idRespCommercial, "DEM-LOTK-4")).some((n) => /^Rappel/.test(n.titre)));
  verifier("4a. avant la réorientation, le rappel (48 h) part vers le responsable du service", rappelAncien);
  await collab.goto(`${B}/treso/demandes/${D4}`);
  await collab.locator("[data-reorienter-ouvrir]").click();
  const options = await collab.locator("[data-reorienter-formulaire] select option").allTextContents();
  await collab.locator("[data-reorienter-formulaire] select").selectOption({ label: options.find((o) => o.includes(nomRespTechnique)) });
  await collab.locator("[data-reorienter-formulaire] textarea").fill("Responsable commercial injoignable");
  await collab.getByRole("button", { name: "Confirmer la réorientation" }).click();
  await attendre(async () => (await demandeDB(D4)).responsableEtapeServiceId === idRespTechnique);
  const d = await demandeDB(D4);
  verifier("4b. après la réorientation : chronomètre à zéro, dernier rappel effacé", Date.now() - new Date(d.etapeCircuitDepuis).getTime() < 60000 && d.dernierRappelAt === null);
  await q(`DELETE FROM "Notification" WHERE message LIKE '%DEM-LOTK-4%' AND titre LIKE 'Rappel%'`);
  await collab.goto(`${B}/`);
  await new Promise((r) => setTimeout(r, 2500));
  verifier("4b. aucun rappel immédiat (le chronomètre repart de zéro)", (await q(`SELECT 1 FROM "Notification" WHERE message LIKE '%DEM-LOTK-4%' AND titre LIKE 'Rappel%'`)).length === 0);
  await q(`UPDATE "Demande" SET "etapeCircuitDepuis" = now() - interval '72 hours' WHERE id=$1`, [D4]);
  await collab.goto(`${B}/`);
  const rappelNouveau = await attendre(async () => (await notifs(idRespTechnique, "DEM-LOTK-4")).some((n) => /^Rappel/.test(n.titre)));
  verifier("4c. 48 h plus tard, le rappel part vers le NOUVEAU responsable", rappelNouveau);
  verifier("4c. … et plus vers l'ancien", (await notifs(idRespCommercial, "DEM-LOTK-4")).filter((n) => /^Rappel/.test(n.titre)).length === 0);
  await collab.close();
}

// ======================================================================================================================
// PARTIE 2 — REPRISE
// ======================================================================================================================
// 5. Finance → Service (demande entière, aucun article décidé).
const D5 = await demande("d5", 5, [{ libelle: "Reprise A", montant: 10000 }, { libelle: "Reprise B", montant: 20000 }], { etape: "FINANCE", ageHeures: 30 });
{
  const finance = await connecter("finance@simassurances.test");
  await finance.goto(`${B}/treso/finance/demandes/${D5}`);
  await finance.locator('[data-reprise-element="demande"]').waitFor();
  const idReprendre = await idAction(finance, "reprendreEtapeAction");
  verifier("0. identifiant de l'action de reprise trouvé", !!idReprendre);
  await finance.locator('[data-reprise-ouvrir="demande"]').click();
  await finance.locator("[data-reprise-formulaire] textarea").fill("court");
  verifier("5a. motif trop court : « Confirmer la reprise » grisé", await finance.getByRole("button", { name: "Confirmer la reprise" }).isDisabled());
  const refusM = await appelerAction(finance, idReprendre, [D5, null, "court"]);
  verifier("5a. appel direct avec un motif de 5 caractères : refusé", !refusM.succes && /10 caractères/.test(refusM.message), refusM.message);
  await finance.locator("[data-reprise-formulaire] textarea").fill(MOTIF_REPRISE);
  await finance.getByRole("button", { name: "Confirmer la reprise" }).click();
  verifier("5b. la demande revient à l'étape Service", await attendre(async () => (await demandeDB(D5)).etapeCircuit === "SERVICE"));
  const d = await demandeDB(D5);
  verifier("5b. chronomètre remis à zéro", Date.now() - new Date(d.etapeCircuitDepuis).getTime() < 60000 && d.dernierRappelAt === null);
  const h = (await historique(D5, "reprise_etape"))[0];
  const th = net(h?.detail ?? "");
  verifier("5c. historique : qui, de quelle étape à quelle étape, motif", !!h && h.userId === idFinance && /Finance → Service/.test(th) && th.includes(MOTIF_REPRISE) && /Finance → Service \(chronomètre/.test(th), th);
  verifier("5c. le responsable du service est notifié avec le motif", (await notifs(idRespCommercial, "DEM-LOTK-5")).some((n) => /reprise par la Finance/i.test(n.titre) && n.message.includes(MOTIF_REPRISE)));
  verifier("5c. le demandeur est informé du retour en arrière", (await notifs(idCollab, "DEM-LOTK-5")).some((n) => /étape précédente/.test(n.titre)));
  await finance.close();
  // Le responsable de service décide de nouveau : le circuit continue.
  const commercial = await connecter("responsable-commercial@simassurances.test");
  await commercial.goto(`${B}/treso/service/${D5}`);
  await commercial.getByRole("button", { name: "Valider", exact: true }).click();
  verifier("5d. le responsable valide de nouveau : la demande repart vers la Finance", await attendre(async () => (await demandeDB(D5)).etapeCircuit === "FINANCE"));
  await commercial.close();
}

// 6. Refus : article déjà décidé → plus de reprise de la demande entière.
const D6 = await demande("d6", 6, [{ libelle: "Décidé", montant: 10000, statut: "VALIDEE" }, { libelle: "Reste", montant: 5000 }], { etape: "FINANCE" });
{
  const finance = await connecter("finance@simassurances.test");
  await finance.goto(`${B}/treso/finance/demandes/${D5}`);
  const idReprendre = await idAction(finance, "reprendreEtapeAction");
  await finance.goto(`${B}/treso/finance/demandes/${D6}`);
  verifier("6a. un article déjà décidé : la reprise de la demande entière n'est plus proposée", (await finance.locator('[data-reprise-element="demande"]').count()) === 0);
  const r = await appelerAction(finance, idReprendre, [D6, null, MOTIF_REPRISE]);
  verifier("6a. … et l'appel direct est refusé", !r.succes && /déjà été décidés ou soumis/.test(r.message), r.message);
  await finance.close();
}

// 7. DG → Finance : le DG renvoie un article, la Finance retire un article.
const D7 = await demande("d7", 7, [{ libelle: "Chez le DG 1", montant: 40000, soumiseAuDG: true }, { libelle: "Chez le DG 2", montant: 15000, soumiseAuDG: true }], { etape: "DG", soumiseAuDG: true });
{
  const dg = await connecter("dg@simassurances.test");
  await dg.goto(`${B}/treso/dg/${D7}`);
  await dg.locator(`[data-reprise-element="${D7}-l1"]`).waitFor();
  await dg.locator(`[data-reprise-ouvrir="${D7}-l1"]`).click();
  await dg.locator("[data-reprise-formulaire] textarea").fill("Le devis joint ne correspond pas au montant demandé");
  await dg.getByRole("button", { name: "Confirmer la reprise" }).click();
  verifier("7a. le DG renvoie l'article à la Finance : la soumission est annulée", await attendre(async () => (await ligneDB(`${D7}-l1`)).soumiseAuDG === false));
  const l1 = await ligneDB(`${D7}-l1`);
  verifier("7a. l'article n'a reçu aucune décision et reste à décider", l1.statutValidation === "EN_ATTENTE" && l1.decisionDG === null && l1.soumiseAuDG === false);
  verifier("7a. l'autre article reste chez le DG ; l'étape de la demande est celle de la Finance (article à décider)", (await ligneDB(`${D7}-l2`)).soumiseAuDG === true && (await demandeDB(D7)).etapeCircuit === "FINANCE");
  verifier("7a. la Finance est notifiée avec le motif ; le DG (auteur) ne l'est pas", (await notifs(idFinance, "DEM-LOTK-7")).some((n) => /Article repris/.test(n.titre) && n.message.includes("devis joint")) && (await notifs(idDG, "DEM-LOTK-7")).filter((n) => /repris/.test(n.titre)).length === 0);
  verifier("7a. historique rattaché à l'article (qui, étape, motif)", (await historique(D7, "reprise_etape")).some((h) => h.userId === idDG && /DG → Finance/.test(h.detail) && /devis joint/.test(h.detail)));
  await dg.close();

  const finance = await connecter("finance@simassurances.test");
  await finance.goto(`${B}/treso/finance/demandes/${D7}`);
  await finance.locator(`[data-reprise-element="${D7}-l2"]`).waitFor();
  await finance.locator(`[data-reprise-ouvrir="${D7}-l2"]`).click();
  await finance.locator("[data-reprise-formulaire] textarea").fill("Soumis par erreur, il manque la catégorie");
  await finance.getByRole("button", { name: "Confirmer la reprise" }).click();
  verifier("7b. la Finance retire elle-même un article de l'étape DG", await attendre(async () => (await ligneDB(`${D7}-l2`)).soumiseAuDG === false));
  verifier("7b. le DG est prévenu que l'article n'est plus à décider", (await notifs(idDG, "DEM-LOTK-7")).some((n) => /retiré de votre étape/.test(n.titre)));
  await finance.close();
}

// 8. Refus : article validé par le DG, rejeté, réglé (brouillon), demande clôturée, bénéficiaire.
const D8 = await demande(
  "d8",
  8,
  [
    { libelle: "Validé par le DG", montant: 10000, statut: "VALIDEE", decisionDG: "VALIDEE" },
    { libelle: "Rejeté", montant: 5000, statut: "REJETEE" },
    { libelle: "Réglé en brouillon", montant: 7000, statut: "VALIDEE" },
    { libelle: "Libre", montant: 3000, statut: "VALIDEE" },
    { libelle: "Bénéficiaire Finance", montant: 2000, statut: "VALIDEE", beneficiaireUserId: idFinance },
  ],
  { etape: "FINANCE", statut: "PARTIELLEMENT_VALIDEE" }
);
{
  await q(`INSERT INTO "Reglement"(id, montant, mode, "estConfirme", "demandeId", "ligneDemandeId", "auteurId", motif) VALUES ($1,7000,'BANQUE',false,$2,$3,$4,'Règlement e2e lot K')`, [`${P}r8`, D8, `${D8}-l3`, idAssistant]);
  const finance = await connecter("finance@simassurances.test");
  await finance.goto(`${B}/treso/finance/demandes/${D5}`);
  const idReprendre = await idAction(finance, "reprendreEtapeAction");
  await finance.goto(`${B}/treso/finance/demandes/${D8}`);
  verifier("8a. article réglé (même en brouillon) : bouton grisé avec la phrase du serveur", (await finance.locator(`[data-reprise-element="${D8}-l3"] [data-reprise-raison]`).innerText()).includes("déjà un règlement"));
  verifier("8a. article validé par le DG et article rejeté : jamais proposés", (await finance.locator(`[data-reprise-element="${D8}-l1"]`).count()) === 0 && (await finance.locator(`[data-reprise-element="${D8}-l2"]`).count()) === 0);
  verifier("8a. article libre : reprise proposée, bouton actif", await finance.locator(`[data-reprise-ouvrir="${D8}-l4"]`).isEnabled());
  const essai = async (n) => appelerAction(finance, idReprendre, [D8, `${D8}-l${n}`, MOTIF_REPRISE]);
  const rDG = await essai(1);
  verifier("8b. appel direct sur un article validé par le DG : refusé (décision définitive)", !rDG.succes && /validé par le DG/.test(rDG.message), rDG.message);
  const rRej = await essai(2);
  verifier("8b. appel direct sur un article rejeté : refusé (définitif)", !rRej.succes && /rejet est définitif/.test(rRej.message), rRej.message);
  const rReg = await essai(3);
  verifier("8b. appel direct sur un article réglé : refusé", !rReg.succes && /déjà un règlement/.test(rReg.message), rReg.message);
  const rBen = await essai(5);
  verifier("8b. garde 8 : le bénéficiaire de l'article ne peut pas le reprendre", !rBen.succes && /bénéficiaire/.test(rBen.message), rBen.message);
  verifier("8b. rien n'a bougé sur ces articles", (await q(`SELECT count(*)::int AS n FROM "LigneDemande" WHERE "demandeId"=$1 AND "statutValidation"='VALIDEE'`, [D8]))[0].n === 4);
  await q(`UPDATE "Demande" SET statut='CLOTUREE' WHERE id=$1`, [D8]);
  const rClos = await essai(4);
  verifier("8c. demande clôturée : reprise refusée", !rClos.succes && /clôturée, rejetée ou abandonnée/.test(rClos.message), rClos.message);
  // Règlement confirmé, hors brouillon : toujours refusé.
  await q(`UPDATE "Demande" SET statut='PARTIELLEMENT_VALIDEE' WHERE id=$1`, [D8]);
  await q(`UPDATE "Reglement" SET "estConfirme"=true, "confirmeAt"=now() WHERE id=$1`, [`${P}r8`]);
  const rConf = await essai(3);
  verifier("8c. article réglé (confirmé) : reprise toujours refusée", !rConf.succes && /déjà un règlement/.test(rConf.message), rConf.message);
  // Sans permission de décision : l'Assistant et le demandeur sont refusés.
  const assistant = await connecter("assistant-finance@simassurances.test");
  await assistant.goto(`${B}/treso/finance/demandes/${D5}`);
  const rAss = await appelerAction(assistant, idReprendre, [D8, `${D8}-l4`, MOTIF_REPRISE]);
  verifier("8d. l'Assistant Finance (aucun droit de décision) : refusé", !rAss.succes && /non autorisée/.test(rAss.message), rAss.message);
  await assistant.close();
  await finance.close();
}

// 9. Validation de la Finance reprise (article validé, sans règlement) + dépassement de budget confirmé par le DG.
await q(`INSERT INTO "BudgetParametrage"(id, portee, "categorieId", montant, "dateDebut", "modeSeuil", "seuilOrange", "seuilRouge", statut, "decideParId", "decideAt", "soumisAt") VALUES ($1,'CATEGORIE',$2,100000, current_date,'POURCENTAGE',20,10,'VALIDE',$3,now(), now())`, [`${P}ba`, CATA, idDG]);
const D9 = await demande("d9", 9, [{ libelle: "Serveur e2e", montant: 120000, categorie: CATA }, { libelle: "Câbles e2e", montant: 10000, categorie: CATA }], { etape: "FINANCE" });
const L9a = `${D9}-l1`;
const L9b = `${D9}-l2`;
{
  const finance = await connecter("finance@simassurances.test");
  const dg = await connecter("dg@simassurances.test");
  await finance.goto(`${B}/treso/finance/demandes/${D9}`);
  await finance.locator(`[data-ligne-card="${L9a}"]`).getByRole("button", { name: "Valider", exact: true }).click();
  await finance.locator("[data-budget-bloc]").waitFor();
  verifier("9a. validation de 120 000 sur un budget de 100 000 : alerte ROUGE, « Enregistrer » grisé", (await finance.locator('[data-alerte-budget="ROUGE"]').count()) === 1 && (await finance.getByRole("button", { name: /Enregistrer les décisions/ }).isDisabled()));
  await finance.locator('[data-motif-echange][name="motifDemandeDepassement"]').fill(MOTIF);
  await finance.locator("[data-demander-confirmation-dg]").click();
  await attendre(async () => (await q(`SELECT statut FROM "BudgetDepassement" WHERE "demandeId"=$1`, [D9])).length === 1);
  await dg.goto(`${B}/treso/finance/budgets`);
  const bd = dg.locator("[data-depassement]").first();
  await bd.locator('[name="motifDepassement"]').fill("Serveur indispensable à la reprise d'activité");
  await bd.getByRole("button", { name: "Confirmer le dépassement" }).click();
  await attendre(async () => (await q(`SELECT statut FROM "BudgetDepassement" WHERE "demandeId"=$1`, [D9]))[0]?.statut === "CONFIRME");
  await finance.goto(`${B}/treso/finance/demandes/${D9}`);
  await finance.locator(`[data-ligne-card="${L9a}"]`).getByRole("button", { name: "Valider", exact: true }).click();
  await finance.getByRole("button", { name: /Enregistrer les décisions/ }).click();
  verifier("9b. l'article est validé grâce à la confirmation du DG (confirmation UTILISÉE)", await attendre(async () => (await ligneDB(L9a)).statutValidation === "VALIDEE") && (await q(`SELECT statut FROM "BudgetDepassement" WHERE "demandeId"=$1`, [D9]))[0].statut === "UTILISE");
  const dep0 = (await q(`SELECT couverture FROM "BudgetDepassement" WHERE "demandeId"=$1`, [D9]))[0];
  verifier("9b. la confirmation couvre l'article de 120 000", Array.isArray(dep0.couverture) && dep0.couverture.some((c) => c.ligneId === L9a && Number(c.montant) === 120000));
  const montant0 = Number((await demandeDB(D9)).montantValide);
  verifier("9b. montant validé de la demande : 120 000", montant0 === 120000, String(montant0));

  // Reprise de la validation par la Finance.
  await finance.goto(`${B}/treso/finance/demandes/${D9}`);
  await q(`UPDATE "Demande" SET "etapeCircuitDepuis" = now() - interval '5 hours' WHERE id=$1`, [D9]);
  await finance.locator(`[data-reprise-ouvrir="${L9a}"]`).click();
  await finance.locator("[data-reprise-formulaire] textarea").fill("Le dépassement n'est finalement pas justifié, on revoit le dossier");
  await finance.getByRole("button", { name: "Confirmer la reprise" }).click();
  verifier("9c. la validation de la Finance est reprise : l'article repasse « à décider »", await attendre(async () => (await ligneDB(L9a)).statutValidation === "EN_ATTENTE"));
  const l9 = await ligneDB(L9a);
  verifier("9c. décision, décideur et photo du budget de l'article effacés", l9.decideParId === null && l9.decideAt === null && l9.decideurFinanceId === null && l9.budgetApresValidation === null);
  const dem9 = await demandeDB(D9);
  verifier("9c. montant validé recalculé (plus d'engagement fantôme) et chronomètre remis à zéro", Number(dem9.montantValide) === 0 && Date.now() - new Date(dem9.etapeCircuitDepuis).getTime() < 60000, String(dem9.montantValide));
  verifier("9c. la demande est de nouveau « en cours » (statut recalculé, jamais REGLEE)", ["EN_ATTENTE_VALIDATION", "PARTIELLEMENT_VALIDEE"].includes(dem9.statut), dem9.statut);
  const dep1 = (await q(`SELECT statut, couverture FROM "BudgetDepassement" WHERE "demandeId"=$1`, [D9]))[0];
  verifier("9d. dépassement confirmé puis article repris : la confirmation devient CADUQUE pour cet article (couverture retirée)", Array.isArray(dep1.couverture) && !dep1.couverture.some((c) => c.ligneId === L9a), JSON.stringify(dep1.couverture));
  verifier("9d. … tracé dans l'historique (confirmation caduque) en plus de la reprise", (await historique(D9, "confirmation_depassement_caduque")).length === 1 && (await historique(D9, "reprise_etape")).length === 1);
  // Revalidation : il faut une NOUVELLE confirmation du DG.
  await finance.goto(`${B}/treso/finance/demandes/${D9}`);
  await finance.locator(`[data-ligne-card="${L9a}"]`).getByRole("button", { name: "Valider", exact: true }).click();
  await finance.locator("[data-budget-bloc]").waitFor();
  verifier("9e. revalidation : l'alerte ROUGE revient (aucune confirmation valable), « Enregistrer » grisé, budget engagé recalculé sans l'article repris", (await finance.locator('[data-alerte-budget="ROUGE"]').count()) === 1 && (await finance.getByRole("button", { name: /Enregistrer les décisions/ }).isDisabled()));
  const idValider = await idAction(finance, "validerLignesAction");
  const revalid = await appelerAction(finance, idValider, [D9, [{ ligneId: L9a, statut: "VALIDEE" }]]);
  verifier("9e. validation par appel direct sans nouvelle confirmation : refusée côté serveur", !revalid.succes && /seuil rouge|confirm/i.test(revalid.message), revalid.message);
  verifier("9e. article toujours à décider", (await ligneDB(L9a)).statutValidation === "EN_ATTENTE");
  verifier("9f. le décideur du dossier est notifié de la reprise avec le motif", (await notifs(idCollab, "DEM-LOTK-9")).some((n) => /étape précédente/.test(n.titre)));

  // Parcours de l'article : réorientation/reprise visibles.
  await finance.goto(`${B}/treso/finance/demandes/${D9}`);
  const parcours = net(await finance.locator(`[data-ligne-card="${L9a}"]`).innerText());
  verifier("9g. parcours de l'article : la reprise (motif) est visible", /Réorientations et reprises/.test(parcours) && /on revoit le dossier/.test(parcours), parcours.slice(0, 200));
  await finance.close();
  await dg.close();
}

// 10. Aucune écriture de caisse, reporting.
{
  const caisse1 = await journalEmpreinte();
  verifier("10a. AUCUNE écriture du journal de caisse créée ni modifiée par une réorientation ou une reprise", caisse0.h === caisse1.h && caisse0.n === caisse1.n, `${caisse0.n} → ${caisse1.n}`);

  const finance = await connecter("finance@simassurances.test");
  const r = await finance.request.get(`${B}/api/treso/reporting/export`);
  const xlsx = join(dossier, "export.xlsx");
  writeFileSync(xlsx, await r.body());
  const partages = net(execFileSync("unzip", ["-p", xlsx, "xl/sharedStrings.xml"], { maxBuffer: 64 * 1024 * 1024 }).toString());
  verifier("10b. reporting (export) : colonne « Réorientations et reprises » dans le tableau unique", partages.includes("Réorientations et reprises"));
  verifier("10b. … avec la réorientation (de qui vers qui, motif)", partages.includes(`${nomRespCommercial} → ${nomRespTechnique}`) && partages.includes(MOTIF));
  verifier("10b. … et la reprise (étapes, motif)", partages.includes("Finance → Service") && partages.includes(MOTIF_REPRISE));
  await finance.goto(`${B}/treso/finance/reporting`);
  const pageTexte = net(await finance.locator("main").innerText());
  verifier("10c. la page de reporting porte la même colonne", pageTexte.includes("Réorientations et reprises"));
  await finance.close();
}

verifier("aucune erreur JavaScript dans les pages", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));
await nettoyer();
await browser.close();
await db.end();
console.log(resultats.join("\n"));
const ko = resultats.filter((x) => x.startsWith("KO")).length;
console.log(`\n${resultats.length} contrôles, ${ko} KO`);
process.exit(ko ? 1 : 0);
