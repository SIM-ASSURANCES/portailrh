// FeedbackApp privé : module réservé aux comptes connectés, noms et avis « Conditions de travail » pour RH/DG, un avis par
// collègue et par jour. Base JETABLE NEUVE (voir e2e/README.md). Les avis sont envoyés par de vraies connexions (écran, ou
// rejeu de la vraie requête de la Server Action) ; la base n'est écrite que pour préparer (renommages, ancien avis sans
// notes) et pour vieillir une trace de quota.
// E2E_SERVER_LOG=<fichier> : journal du serveur, contrôlé à la fin (aucune empreinte, aucune mention de la table).
import { chromium } from "playwright";
import pg from "pg";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");

const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const un = async (sql, params = []) => (await q(sql, params))[0];
const userId = async (email) => (await un(`SELECT id FROM "User" WHERE email = $1`, [email])).id;
const nbAvis = async () => (await un(`SELECT count(*)::int n FROM "Feedback"`)).n;
// Un toast d'un envoi précédent peut encore être à l'écran : on attend l'écriture en base, pas le texte.
const attendreAvis = async (n) => {
  for (let i = 0; i < 60 && (await nbAvis()) < n; i++) await new Promise((r) => setTimeout(r, 250));
};
const cles = async () => (await q(`SELECT cle FROM "FeedbackQuota"`)).map((r) => r.cle);

let ko = 0;
const verifier = (nom, ok, detail = "") => {
  if (!ok) ko++;
  console.log(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
};

const MSG_COLLAB = "Vous avez déjà donné un avis sur ce collègue aujourd'hui. Vous pourrez recommencer demain.";
const MSG_CT = "Vous avez déjà donné votre avis sur les conditions de travail aujourd'hui. Vous pourrez recommencer demain.";
const MSG_OK = "Merci, votre avis a bien été envoyé.";

// ── Destinataires aux noms reconnaissables (pour chercher leur présence dans les charges utiles) ────────────────────────
const collab = await userId("collaborateur@simassurances.test");
const adminId = await userId("admin@simassurances.test");
const paul = await userId("responsable-technique@simassurances.test");
const emile = await userId("responsable-comptabilite@simassurances.test");
const zoe = await userId("responsable-marketing@simassurances.test");
const chloe = await userId("responsable-commercial@simassurances.test");
const NOMS = { [paul]: "Paul Qzxdestinataire", [emile]: "Émile Qzxdestinataire", [zoe]: "Zoé Qzxdestinataire", [chloe]: "Chloé Qzxdestinataire" };
for (const [id, nom] of Object.entries(NOMS)) await q(`UPDATE "User" SET "fullName" = $2 WHERE id = $1`, [id, nom]);

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const erreursJs = [];
async function connecter(email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // La demande d'activation des notifications push (en bas à droite) recouvre parfois un bouton du tableau.
  await ctx.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = 'aside[aria-label*="notifications push"] { display: none !important; }';
      document.head.appendChild(style);
    });
  });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(`${email} ${p.url()} : ${e.message}`));
  await p.goto(`${B}/login`, { waitUntil: "networkidle" });
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', "password123");
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click('button[type="submit"]')]);
  return { ctx, p };
}

// ── 1. Sans session ───────────────────────────────────────────────────────────────────────────────────────────────────
const anonyme = await browser.newContext();
for (const chemin of ["/feedback", "/feedback/nouveau", "/feedback/mes-retours", "/feedback/admin"]) {
  const r = await anonyme.request.get(`${B}${chemin}`, { maxRedirects: 0 });
  verifier(`1. Sans session : ${chemin} redirige vers la connexion`, r.status() === 307 && (r.headers()["location"] ?? "").includes("/login"), `${r.status()} ${r.headers()["location"] ?? ""}`);
}

// ── 2 et 3. Collaborateur : envois par l'écran ────────────────────────────────────────────────────────────────────────
const c = await connecter("collaborateur@simassurances.test");
await c.p.goto(`${B}/feedback`, { waitUntil: "networkidle" });
const corps = await c.p.locator("main").innerText();
verifier("2. /feedback : nouveau texte d'anonymat, coquille du portail", (await c.p.locator("[data-texte-anonymat]").innerText()).includes("trace technique chiffrée jusqu'au lendemain") && (await c.p.locator("main").count()) === 1);
verifier("2. /feedback : plus de liste publique des avis", !corps.includes("Avis sur l'entreprise"));
const options = await c.p.locator("select option").allInnerTexts();
verifier("2. Liste des destinataires : ni soi-même ni le compte Admin", !options.some((o) => /Collaborateur Test|Admin Test/.test(o)), options.join(" | "));

let requete; // dernière requête d'envoi (pour la rejouer telle quelle)
c.p.on("request", (r) => {
  if (r.method() === "POST" && r.headers()["next-action"] && (r.postData() ?? "").includes("ratingsJson")) {
    requete = { action: r.headers()["next-action"], type: r.headers()["content-type"], corps: r.postData(), url: r.url() };
  }
});

async function noterCollaboration(page) {
  const cartes = page.locator("form button[type=button]");
  // 5e étoile de chaque question, puis la note globale 8.
  const etoiles = page.getByRole("button", { name: /^5 (étoiles?|sur 5)/i });
  if ((await etoiles.count()) >= 6) {
    for (let i = 0; i < 6; i++) await etoiles.nth(i).click();
  } else {
    throw new Error(`Étoiles introuvables (${await etoiles.count()}), ${await cartes.count()} boutons`);
  }
  await page.getByRole("button", { name: /^(Noter )?8( sur 10)?$/ }).click();
}

async function envoyerCollaboration(destinataire) {
  const attendu = (await nbAvis()) + 1;
  await c.p.getByRole("button", { name: "Collaboration entre collègues" }).click();
  await c.p.locator("form select").selectOption(destinataire);
  await noterCollaboration(c.p);
  await c.p.getByRole("button", { name: "Envoyer mon avis" }).click();
  await attendreAvis(attendu);
}

await envoyerCollaboration(paul);
const requeteCollab = requete;
const clesApresPaul = await cles();
const clePaul = clesApresPaul[0];
verifier("2. Premier avis sur Paul : accepté (1 avis, 1 trace)", (await nbAvis()) === 1 && clesApresPaul.length === 1);

/** Rejoue la vraie requête d'envoi avec la session d'un contexte donné ; `remplacements` change le destinataire. */
async function rejouer(contexte, modele, remplacements = [], url = `${B}/feedback`) {
  let data = modele.corps;
  for (const [de, vers] of remplacements) data = data.split(de).join(vers);
  const r = await contexte.request.post(url, {
    headers: { "next-action": modele.action, "content-type": modele.type, accept: "text/x-component", origin: B },
    data: Buffer.from(data, "utf8"),
    maxRedirects: 0,
  });
  return { statut: r.status(), texte: await r.text(), location: r.headers()["location"] ?? "" };
}

let r = await rejouer(c.ctx, requeteCollab);
verifier("2. Second avis sur Paul le même jour : refusé avec le bon message", r.texte.includes(MSG_COLLAB) && (await nbAvis()) === 1, r.texte.slice(-220));

await c.p.getByRole("button", { name: "Conditions de travail" }).waitFor();
await c.p.waitForTimeout(3500); // fin de la confirmation puis router.refresh()
await c.p.getByRole("button", { name: "Collaboration entre collègues" }).click();
const optionPaul = await c.p.locator(`form select option[value="${paul}"]`).innerText();
await c.p.locator("form select").selectOption(paul);
verifier("2. Confort : Paul marqué « déjà évalué aujourd'hui », envoi grisé", optionPaul.includes("déjà évalué aujourd'hui") && (await c.p.locator("[data-avis-deja-donne]").innerText()) === MSG_COLLAB && (await c.p.getByRole("button", { name: "Envoyer mon avis" }).isDisabled()));

await envoyerCollaboration(emile);
verifier("2. Avis sur un autre collègue le même jour : accepté", (await nbAvis()) === 2 && (await cles()).length === 2);

await c.p.waitForTimeout(3500);
await c.p.getByRole("button", { name: "Conditions de travail" }).click();
for (let etape = 0; etape < 4; etape++) {
  // Choix : première option de chaque question à choix (les curseurs ont déjà une valeur).
  for (const libelle of [["Oui totalement", "Oui"], ["Toujours", "Oui"], ["Excellente", "Oui"], ["Oui"]][etape]) {
    const boutons = c.p.getByRole("button", { name: libelle, exact: true });
    for (let i = 0; i < (await boutons.count()); i++) await boutons.nth(i).click();
  }
  if (etape < 3) await c.p.getByRole("button", { name: "Suivant" }).click();
}
await c.p.getByRole("button", { name: "Envoyer mon avis" }).click();
await attendreAvis(3);
const requeteCT = requete;
verifier("3. Premier avis « Conditions de travail » : accepté", (await nbAvis()) === 3 && (await cles()).length === 3);
r = await rejouer(c.ctx, requeteCT);
verifier("3. Second avis « Conditions de travail » le même jour : refusé avec le bon message", r.texte.includes(MSG_CT) && (await nbAvis()) === 3, r.texte.slice(-220));
await c.p.waitForTimeout(3500);
verifier("3. Confort : le formulaire annonce que l'avis du jour est donné", (await c.p.locator("[data-avis-deja-donne]").innerText()) === MSG_CT);
verifier("2-3. Tous les nouveaux avis sont INTERNAL", (await un(`SELECT count(*)::int n FROM "Feedback" WHERE source <> 'INTERNAL'`)).n === 0);

// 1 (suite) : l'action elle-même refuse sans session, y compris postée sur une route que le middleware laisse passer.
const avant1 = await nbAvis();
r = await rejouer(anonyme, requeteCollab, [[paul, zoe]]);
verifier("1. Sans session : POST de l'action sur /feedback arrêté par le middleware", r.statut === 307 && r.location.includes("/login") && (await nbAvis()) === avant1, `${r.statut} ${r.location}`);
r = await rejouer(anonyme, requeteCollab, [[paul, zoe]], `${B}/login`);
verifier("1. Sans cookie : action postée sur /login (hors middleware) sans effet, rien écrit", !r.texte.includes(MSG_OK) && (await nbAvis()) === avant1 && (await cles()).length === 3, `${r.statut} ${r.texte.slice(-200)}`);

// ── 5. Rejeux directs : compte Admin et soi-même ──────────────────────────────────────────────────────────────────────
r = await rejouer(c.ctx, requeteCollab, [[paul, adminId]]);
verifier("5. Rejeu vers le compte Admin (peutRecevoirFeedback: false) : refusé", r.texte.includes("Destinataire introuvable.") && (await nbAvis()) === 3);
r = await rejouer(c.ctx, requeteCollab, [[paul, collab]]);
verifier("5. Rejeu vers soi-même : refusé", r.texte.includes("Vous ne pouvez pas vous envoyer un avis à vous-même.") && (await nbAvis()) === 3);
verifier("5. Les deux refus ne consomment aucune limite", (await cles()).length === 3);

// Deux envois simultanés vers le même collègue.
const deux = await Promise.all([rejouer(c.ctx, requeteCollab, [[paul, zoe]]), rejouer(c.ctx, requeteCollab, [[paul, zoe]])]);
verifier("Deux envois simultanés : un seul réussit", deux.filter((x) => x.texte.includes(MSG_OK)).length === 1 && deux.filter((x) => x.texte.includes(MSG_COLLAB)).length === 1 && (await nbAvis()) === 4);

// ── 4. Changement de jour ─────────────────────────────────────────────────────────────────────────────────────────────
await q(`UPDATE "FeedbackQuota" SET jour = jour - 1 WHERE cle = $1`, [clePaul]);
r = await rejouer(c.ctx, requeteCollab);
verifier("4. Trace de Paul vieillie à hier : un nouvel avis est accepté", r.texte.includes(MSG_OK) && (await nbAvis()) === 5, r.texte.slice(-200));
verifier("4. La trace est de nouveau au jour courant", (await un(`SELECT jour = (now() AT TIME ZONE 'UTC')::date AS auj FROM "FeedbackQuota" WHERE cle = $1`, [clePaul])).auj === true);
await q(`UPDATE "FeedbackQuota" SET jour = jour - 1 WHERE cle = $1`, [clePaul]);
const a = await connecter("admin@simassurances.test");
await a.p.goto(`${B}/admin/journal-technique`, { waitUntil: "networkidle" });
await a.p.locator('xpath=//*[normalize-space(text())="Purge des journaux"]/ancestor::*[.//button[normalize-space(.)="Lancer maintenant"]][1]').getByRole("button", { name: "Lancer maintenant" }).click();
for (let i = 0; i < 40 && (await cles()).includes(clePaul); i++) await a.p.waitForTimeout(250);
const restantes = await cles();
verifier("4. La purge efface la trace d'hier, garde celles du jour", !restantes.includes(clePaul) && restantes.length === 3, `${restantes.length} traces`);
const bilan = await un(`SELECT bilan FROM "ExecutionTache" WHERE tache = 'PURGE' AND declenchement = 'MANUEL' ORDER BY debut DESC LIMIT 1`);
verifier("4. Bilan de la purge : 1 trace de quota comptée", bilan?.bilan?.quotasFeedbackSupprimes === 1, JSON.stringify(bilan?.bilan));

// ── 8. En base ────────────────────────────────────────────────────────────────────────────────────────────────────────
const colonnes = (await q(`SELECT column_name || ':' || data_type AS c FROM information_schema.columns WHERE table_name = 'FeedbackQuota' ORDER BY 1`)).map((x) => x.c);
verifier("8. FeedbackQuota : seulement cle (texte) et jour (date)", JSON.stringify(colonnes) === JSON.stringify(["cle:text", "jour:date"]), colonnes.join(", "));
const fk = (await un(`SELECT count(*)::int n FROM information_schema.table_constraints WHERE table_name = 'FeedbackQuota' AND constraint_type = 'FOREIGN KEY'`)).n;
verifier("8. FeedbackQuota : aucune relation", fk === 0);
const lignes = await q(`SELECT cle, jour::text FROM "FeedbackQuota"`);
verifier("8. Clés : 64 caractères hexadécimaux, aucun id d'auteur", lignes.every((l) => /^[0-9a-f]{64}$/.test(l.cle) && !l.cle.includes(collab)));
const avisJson = JSON.stringify(await q(`SELECT * FROM "Feedback"`));
verifier("8. Aucun id d'auteur dans Feedback", !avisJson.includes(collab));
const historique = await q(`SELECT entity, action FROM "HistoriqueEntry" WHERE "userId" = $1`, [collab]);
verifier("8. Historique de l'auteur : seulement des connexions", historique.every((h) => h.entity === "Auth"), JSON.stringify([...new Set(historique.map((h) => `${h.entity}:${h.action}`))]));
const toutesCles = [...new Set([clePaul, ...lignes.map((l) => l.cle)])];
const traces = (await q(`SELECT coalesce(string_agg(coalesce(detail,'') || coalesce("entityId",''), ' '), '') t FROM "HistoriqueEntry"`))[0].t
  + JSON.stringify(await q(`SELECT * FROM "JournalTechnique"`)) + JSON.stringify(await q(`SELECT bilan, erreur FROM "ExecutionTache"`));
verifier("8. Aucune empreinte dans l'historique, le journal technique ni les exécutions", !toutesCles.some((k) => traces.includes(k)));

// Avis antérieur à la notation structurée (sans notes), pour la fenêtre de détail.
await q(`INSERT INTO "Feedback"(id, content, "recipientId", source, "submittedAt", type) VALUES ('fb-ancien', 'Ancien avis rédigé avant la notation structurée, sans aucune note.', $1, 'PUBLIC', '2026-09-01', 'COLLABORATION')`, [chloe]);

const contenuCT = (await un(`SELECT content FROM "Feedback" WHERE type = 'CONDITIONS_TRAVAIL'`)).content;
const idCT = (await un(`SELECT id FROM "Feedback" WHERE type = 'CONDITIONS_TRAVAIL'`)).id;
const phraseCT = contenuCT.split(". ")[0];

// ── 6. RH et DG ───────────────────────────────────────────────────────────────────────────────────────────────────────
for (const email of ["rh@simassurances.test", "dg@simassurances.test"]) {
  const qui = email.split("@")[0];
  const s = await connecter(email);
  await s.p.goto(`${B}/feedback/admin`, { waitUntil: "networkidle" });
  const tableau = await s.p.locator("table").innerText();
  verifier(`6. ${qui} : noms réels et avis « Conditions de travail » en modération`, tableau.includes(NOMS[paul]) && tableau.includes(NOMS[emile]) && tableau.includes("Conditions de travail") && tableau.includes(phraseCT));
  const csv = await (await s.ctx.request.get(`${B}/api/feedback/export`)).text();
  verifier(`6. ${qui} : export avec noms réels et conditions de travail`, csv.includes(NOMS[paul]) && csv.includes("Conditions de travail") && csv.includes(phraseCT));
  verifier(`6. ${qui} : total = 6 avis`, (await s.p.locator("main").innerText()).includes("Messages (6)"));

  if (qui !== "rh") { await s.ctx.close(); continue; }

  // ── 9. Écran de modération (RH) ────────────────────────────────────────────────────────────────────────────────────
  const ligneCollab = s.p.locator("table tbody tr", { hasText: NOMS[emile] }).first();
  await ligneCollab.getByRole("button", { name: "Voir" }).click();
  const dialogue = s.p.getByRole("dialog");
  const attendu = (await un(`SELECT content FROM "Feedback" WHERE "recipientId" = $1`, [emile])).content;
  const notes = await dialogue.locator("[data-note]").allInnerTexts();
  verifier("9. « Voir » : texte entier, destinataire réel", (await dialogue.locator("[data-texte-complet]").innerText()) === attendu && (await dialogue.innerText()).includes(NOMS[emile]));
  verifier("9. « Voir » : 7 notes (6 en /5, la globale en /10)", notes.length === 7 && notes.filter((n) => /5\/5/.test(n)).length === 6 && notes.some((n) => /8\/10/.test(n)), notes.join(" | ").replace(/\s+/g, " "));
  await dialogue.getByRole("button", { name: "Fermer" }).click();
  await s.p.locator("table tbody tr", { hasText: "Conditions de travail" }).first().getByRole("button", { name: "Voir" }).click();
  const notesCT = await s.p.getByRole("dialog").locator("[data-note]").allInnerTexts();
  verifier("9. « Voir » conditions de travail : 11 réponses avec libellés des choix", notesCT.length === 11 && notesCT.some((n) => n.includes("Oui totalement")) && notesCT.some((n) => n.includes("3/5")), `${notesCT.length} réponses`);
  await s.p.getByRole("dialog").getByRole("button", { name: "Fermer" }).click();
  await s.p.locator("table tbody tr", { hasText: "Ancien avis" }).getByRole("button", { name: "Voir" }).click();
  verifier("9. Ancien avis sans notes : texte seul", (await s.p.getByRole("dialog").locator("[data-note]").count()) === 0 && (await s.p.getByRole("dialog").locator("[data-texte-complet]").innerText()).startsWith("Ancien avis"));
  await s.p.getByRole("dialog").getByRole("button", { name: "Fermer" }).click();

  const noms = async () => (await s.p.locator("table [data-destinataire]").allInnerTexts()).filter((n) => n !== "—");
  const enTete = s.p.locator("thead button", { hasText: "Destinataire" });
  await enTete.click();
  const croissant = await noms();
  await enTete.click();
  const decroissant = await noms();
  const reference = [...croissant].sort((x, y) => x.localeCompare(y, "fr"));
  verifier("9. Tri par destinataire (accents compris), croissant puis décroissant", JSON.stringify(croissant) === JSON.stringify(reference) && JSON.stringify(decroissant) === JSON.stringify([...reference].reverse()), croissant.map((n) => n.split(" ")[0]).join(", "));

  const choix = await s.p.locator('select[name="destinataire"] option').allInnerTexts();
  verifier("9. Filtre « Destinataire » : les seules personnes évaluées, triées", JSON.stringify(choix.slice(1)) === JSON.stringify([NOMS[chloe], NOMS[emile], NOMS[paul], NOMS[zoe]]), choix.join(" | "));
  await s.p.selectOption('select[name="destinataire"]', paul);
  await Promise.all([s.p.waitForURL((u) => u.searchParams.get("destinataire") === paul), s.p.getByRole("button", { name: "Filtrer" }).click()]);
  await s.p.waitForLoadState("networkidle");
  const filtres = await noms();
  verifier("9. Filtre appliqué : seulement les 2 avis de Paul", filtres.length === 2 && filtres.every((n) => n === NOMS[paul]) && (await s.p.locator("table tbody tr").count()) === 2);
  const href = await s.p.getByRole("link", { name: "Exporter en CSV" }).getAttribute("href");
  const csvFiltre = await (await s.ctx.request.get(`${B}${href}`)).text();
  verifier("9. Export filtré : seulement Paul", href.includes(`destinataire=${paul}`) && csvFiltre.includes(NOMS[paul]) && !csvFiltre.includes(NOMS[emile]) && !csvFiltre.includes(phraseCT) && csvFiltre.trim().split("\n").length === 3);
  await s.p.goto(`${B}/feedback/admin?type=CONDITIONS_TRAVAIL`, { waitUntil: "networkidle" });
  verifier("9. Filtre « Type » = Conditions de travail", (await s.p.locator("table tbody tr").count()) === 1);
  await s.ctx.close();
}

// ── 7. Admin : pseudonymes seulement, aucun avis « Conditions de travail » ────────────────────────────────────────────
await a.p.goto(`${B}/feedback/admin`, { waitUntil: "networkidle" });
const affichage = await a.p.locator("main").innerText();
verifier("7. Admin : pseudonymes, aucun nom réel à l'écran, 5 avis comptés", affichage.includes("Collaborateur #") && !affichage.includes("Qzxdestinataire") && affichage.includes("Messages (5)") && !affichage.includes(phraseCT));
verifier("7. Admin : total des statistiques sans les conditions de travail (5)", /Total des messages\s*5/i.test(affichage));
// Charge utile réelle : HTML servi puis flux RSC (celui d'une navigation).
const html = await (await a.ctx.request.get(`${B}/feedback/admin`)).text();
const rscReponse = await a.ctx.request.get(`${B}/feedback/admin`, { headers: { RSC: "1" } });
const rsc = await rscReponse.text();
verifier("7. Admin : le flux RSC est bien celui des données du tableau", rsc.includes("Collaborateur #") && (rscReponse.headers()["content-type"] ?? "").includes("text/x-component"));
for (const [nom, charge] of [["HTML", html], ["RSC", rsc]]) {
  verifier(`7. Admin, ${nom} : aucun nom réel ni identifiant de destinataire`, !charge.includes("Qzxdestinataire") && ![paul, emile, zoe, chloe].some((id) => charge.includes(id)));
  verifier(`7. Admin, ${nom} : aucun avis « Conditions de travail » (id, texte, notes)`, !charge.includes(idCT) && !charge.includes(phraseCT) && !charge.includes("Tu disposes des outils"));
}
verifier("7. Admin : ni filtre « Destinataire », ni choix « Conditions de travail », ni tri", (await a.p.locator('select[name="destinataire"]').count()) === 0 && (await a.p.locator('select[name="type"] option[value="CONDITIONS_TRAVAIL"]').count()) === 0 && (await a.p.locator("thead button", { hasText: "Destinataire" }).count()) === 0);
await a.p.goto(`${B}/feedback/admin?destinataire=${paul}&type=CONDITIONS_TRAVAIL`, { waitUntil: "networkidle" });
verifier("9. Admin : ?destinataire=… et ?type=… passés à la main sont ignorés (toujours 5 avis)", (await a.p.locator("table tbody tr").count()) === 5 && !(await a.p.locator("main").innerText()).includes("Qzxdestinataire"));
const csvAdmin = await (await a.ctx.request.get(`${B}/api/feedback/export?destinataire=${paul}&type=CONDITIONS_TRAVAIL`)).text();
verifier("7. Admin, export (paramètres forcés) : 5 avis pseudonymisés, sans conditions de travail", csvAdmin.trim().split("\n").length === 6 && csvAdmin.includes("Collaborateur #") && !csvAdmin.includes("Qzxdestinataire") && !csvAdmin.includes(phraseCT) && !csvAdmin.includes(idCT));
const refusExport = await c.ctx.request.get(`${B}/api/feedback/export`);
await c.p.goto(`${B}/feedback/admin`);
verifier("7. Collaborateur : modération et export refusés", refusExport.status() === 403 && c.p.url().includes("acces_refuse_moderation"), `${refusExport.status()} ${c.p.url()}`);

// ── 10. Non-régression ────────────────────────────────────────────────────────────────────────────────────────────────
const d = await connecter("responsable-technique@simassurances.test");
await d.p.goto(`${B}/feedback/mes-retours`, { waitUntil: "networkidle" });
const textesPaul = await q(`SELECT content FROM "Feedback" WHERE "recipientId" = $1`, [paul]);
let recus = await d.p.locator("main").innerText();
verifier("10. « Mes critiques reçues » : le destinataire voit ses avis, jamais les conditions de travail", textesPaul.every((x) => recus.includes(x.content)) && !recus.includes(phraseCT));

const rh = await connecter("rh@simassurances.test");
await rh.p.goto(`${B}/feedback/admin?destinataire=${zoe}`, { waitUntil: "networkidle" });
await rh.p.locator("table").getByRole("button", { name: "Modérer" }).click();
await rh.p.getByLabel("Motif de modération").fill("Retrait de test e2e");
await rh.p.getByRole("button", { name: "Confirmer le retrait" }).click();
await rh.p.locator("table").getByText("Retiré par RH Test").waitFor();
const zoeSession = await connecter("responsable-marketing@simassurances.test");
await zoeSession.p.goto(`${B}/feedback/mes-retours`, { waitUntil: "networkidle" });
verifier("10. Modération : avis masqué pour son destinataire, « Voir » reste disponible", (await zoeSession.p.locator("main").innerText()).includes("pas encore reçu") && (await rh.p.locator("table").getByRole("button", { name: "Voir" }).count()) === 1);

await a.p.goto(`${B}/admin/roles`, { waitUntil: "networkidle" });
const LIBELLE = "Voir les destinataires et les avis sur les conditions de travail (FeedbackApp)";
const caseDe = (role) => a.p.locator("section", { has: a.p.getByRole("heading", { level: 2, name: role, exact: true }) }).getByLabel(LIBELLE);
const etats = {};
for (const role of ["RH", "DG", "Admin", "Collaborateur", "Finance", "Assistant Finance"]) etats[role] = await caseDe(role).isChecked();
verifier("10. /admin/roles : case cochée pour RH et DG seulement", etats.RH && etats.DG && !etats.Admin && !etats.Collaborateur && !etats.Finance && !etats["Assistant Finance"], JSON.stringify(etats));
const porte = async (role) => (await un(`SELECT count(*)::int n FROM "RolePermission" rp JOIN "Role" r ON r.id = rp."roleId" JOIN "Permission" p ON p.id = rp."permissionId" WHERE r.name = $1 AND p.key = 'feedback.voir_details'`, [role])).n === 1;
async function basculer(role, voulu) {
  await caseDe(role).click();
  for (let i = 0; i < 40 && (await porte(role)) !== voulu; i++) await a.p.waitForTimeout(250);
  await a.p.waitForTimeout(500);
}
await basculer("RH", false);
await rh.p.goto(`${B}/feedback/admin`, { waitUntil: "networkidle" });
const sansDroit = await rh.p.locator("main").innerText();
verifier("10. Case décochée pour la RH : pseudonymes dès la page suivante", !(await porte("RH")) && !sansDroit.includes("Qzxdestinataire") && !sansDroit.includes(phraseCT));
await d.p.goto(`${B}/feedback/mes-retours`);
await a.p.reload({ waitUntil: "networkidle" });
verifier("10. La case reste décochée après d'autres connexions et rechargements (aucune réattribution)", !(await porte("RH")) && !(await caseDe("RH").isChecked()));
await basculer("RH", true);
verifier("10. Case recochée", await porte("RH"));

// 390 px
await rh.p.setViewportSize({ width: 390, height: 800 });
for (const chemin of ["/feedback", "/feedback/admin"]) {
  await rh.p.goto(`${B}${chemin}`, { waitUntil: "networkidle" });
  verifier(`390 px sans défilement horizontal : ${chemin}`, !(await rh.p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
}

// ── 1 (fin). L'action elle-même sans session : cookie que le middleware accepte, mais getSession() renvoie null ────────
await q(`UPDATE "User" SET "tokenVersion" = "tokenVersion" + 1 WHERE id = $1`, [collab]);
const avantPerime = [await nbAvis(), (await cles()).length];
r = await rejouer(c.ctx, requeteCollab, [[paul, chloe]]);
verifier("1. Sans session : la Server Action exécutée refuse elle-même, rien écrit", r.texte.includes("Connectez-vous pour donner un avis.") && (await nbAvis()) === avantPerime[0] && (await cles()).length === avantPerime[1], `${r.statut} ${r.texte.slice(-160)}`);

// ── 8 (fin). Journaux du serveur et de PostgreSQL ─────────────────────────────────────────────────────────────────────
const finales = [...new Set([...toutesCles, ...(await cles())])];
const journalPg = execSync("docker logs pg-e2e 2>&1", { encoding: "utf8", maxBuffer: 50e6, shell: true });
verifier("8. Journal PostgreSQL : aucune empreinte, aucune violation d'unicité sur FeedbackQuota", !finales.some((k) => journalPg.includes(k)) && !journalPg.includes("FeedbackQuota_cle_key"));
if (process.env.E2E_SERVER_LOG) {
  const journal = readFileSync(process.env.E2E_SERVER_LOG, "utf8");
  verifier("8. Journal du serveur : aucune empreinte, ni FeedbackQuota, ni id de l'auteur", !finales.some((k) => journal.includes(k)) && !journal.includes("FeedbackQuota") && !journal.includes(collab), `${journal.split("\n").length} lignes`);
}
verifier("Aucune erreur JavaScript", erreursJs.length === 0, erreursJs.join(" ; "));

await browser.close();
await db.end();
console.log(ko ? `\n${ko} contrôle(s) KO` : "\nTout est OK");
process.exit(ko ? 1 : 0);
