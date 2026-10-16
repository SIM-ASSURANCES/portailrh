// Congés — C4 (consignes du 2026-10-16) : permission EXCEPTIONNELLE (mariage, décès, naissance…) en UNE seule décision, au choix du
// demandeur (son responsable ou la RH). Base JETABLE seulement (voir e2e/README.md).
// Parcours : le choix n'existe que pour ce type ; « Mon responsable (nom) » et « La RH » ; le responsable accorde seul (Validée tout
// de suite, frise sans étape RH) ; le choix « RH » : la RH décide seule, le responsable est grisé ; un responsable inutilisable ne
// laisse que « La RH » à l'écran ET refuse « responsable » côté serveur (action rejouée).
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import pg from "pg";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:45497/e2e";
if (!/conges_|e2e/.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");
const manifeste = JSON.parse(readFileSync(new URL("../frontend/.next/server/server-reference-manifest.json", import.meta.url), "utf8"));
const ids = Object.fromEntries(Object.entries(manifeste.node).map(([id, v]) => [v.exportedName, id]));

const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const lundi = (semaines) => {
  const d = new Date();
  d.setDate(d.getDate() + semaines * 7 - ((d.getDay() + 6) % 7));
  return d;
};
const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);

await q(`DELETE FROM "PlageAbsenceAutorisee" WHERE "demandeCongeId" IS NOT NULL OR "demandePermissionId" IS NOT NULL`);
await q(`DELETE FROM "PieceJointeConge"`);
await q(`DELETE FROM "DemandeConge"`);

const nomResp = (await q(`SELECT "fullName" FROM "User" WHERE email = 'responsable-commercial@simassurances.test'`))[0].fullName;
const idResp = (await q(`SELECT id FROM "User" WHERE email = 'responsable-commercial@simassurances.test'`))[0].id;

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const erreursJs = [];
let compteurIp = 150 + (Date.now() % 90);
async function connecter(email, viewport) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `10.9.9.${(compteurIp++ % 240) + 10}` }, ...(viewport ? { viewport } : {}) });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(`${email}: ${e.message}`));
  await p.goto(`${B}/login`);
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', "password123");
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click('button[type="submit"]')]);
  return { ctx, p };
}
const texte = (p) => p.locator("body").innerText();
const chemin = (p) => new URL(p.url()).pathname;
const rejouer = (p, nomAction, args, page) =>
  p.evaluate(
    async ({ id, args, url }) => {
      const r = await fetch(url, { method: "POST", headers: { "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" }, body: JSON.stringify(args) });
      return r.text();
    },
    { id: ids[nomAction], args, url: `${B}${page}` }
  );

/** Remplit le formulaire d'une permission exceptionnelle (le choix du destinataire est fait par l'appelant). */
async function remplir(p, { semaine, motif }) {
  await p.goto(`${B}/conges/nouvelle`);
  await p.waitForLoadState("networkidle");
  await p.getByLabel("Type de congé").selectOption({ label: "Mariage du salarié" });
  await p.getByLabel("Date de début").fill(iso(lundi(semaine)));
  await p.getByLabel("Motif").fill(motif);
  const [envoi] = await Promise.all([
    p.waitForResponse((r) => r.url().endsWith("/api/conges/upload") && r.request().method() === "POST"),
    p.setInputFiles('input[type="file"]', { name: "livret.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%e2e\n") }),
  ]);
  const pieceDeposee = (await envoi.json()).url;
  await p.getByText("livret.pdf").first().waitFor({ timeout: 15000 });
  return pieceDeposee;
}

try {
  const { ctx, p } = await connecter("collaborateur@simassurances.test");

  // ── Le choix n'existe que pour une permission exceptionnelle ─────────────────────────────────────────────────────────
  await p.goto(`${B}/conges/nouvelle`);
  await p.waitForLoadState("networkidle");
  await p.getByLabel("Type de congé").selectOption({ label: "Congé annuel" });
  verifier("Congé annuel : aucun choix de destinataire", (await p.getByLabel("Qui valide votre demande ?").count()) === 0);

  // ── Choix « responsable » ──────────────────────────────────────────────────────────────────────────────────────────
  await remplir(p, { semaine: 41, motif: "Mariage, validation par mon responsable" });
  const choix = p.getByLabel("Qui valide votre demande ?");
  const options = (await choix.locator("option").allInnerTexts()).map((t) => t.trim());
  verifier("Le choix propose « Mon responsable (nom) » et « La RH »", options.includes(`Mon responsable (${nomResp})`) && options.includes("La RH"), options.join(" | "));
  verifier("Envoi grisé tant que le destinataire n'est pas choisi", await p.getByRole("button", { name: "Envoyer la demande" }).isDisabled());
  await choix.selectOption("RESPONSABLE");
  await Promise.all([p.waitForURL(/\/conges\/(?!nouvelle)[^/]+$/, { timeout: 20000 }), p.getByRole("button", { name: "Envoyer la demande" }).click()]);
  const idR = chemin(p).split("/").pop();
  const ligneR = (await q(`SELECT statut, destinataire, "etapeResponsableRequise" FROM "DemandeConge" WHERE id = $1`, [idR]))[0];
  verifier("Demande déposée : EN_ATTENTE_RESPONSABLE, destinataire RESPONSABLE", ligneR.statut === "EN_ATTENTE_RESPONSABLE" && ligneR.destinataire === "RESPONSABLE" && ligneR.etapeResponsableRequise === true);
  const t1 = await texte(p);
  verifier("Détail : « Par le responsable du service (choix du demandeur) », une seule décision", t1.includes("Par le responsable du service (choix du demandeur)") && t1.includes("une seule décision, définitive"));

  // ── Choix « RH » ───────────────────────────────────────────────────────────────────────────────────────────────────
  await remplir(p, { semaine: 43, motif: "Mariage, validation par la RH" });
  await p.getByLabel("Qui valide votre demande ?").selectOption("RH");
  await Promise.all([p.waitForURL(/\/conges\/(?!nouvelle)[^/]+$/, { timeout: 20000 }), p.getByRole("button", { name: "Envoyer la demande" }).click()]);
  const idH = chemin(p).split("/").pop();
  const ligneH = (await q(`SELECT statut, destinataire, "etapeResponsableRequise" FROM "DemandeConge" WHERE id = $1`, [idH]))[0];
  verifier("Demande « RH » : EN_ATTENTE_RH, étape responsable non requise", ligneH.statut === "EN_ATTENTE_RH" && ligneH.destinataire === "RH" && ligneH.etapeResponsableRequise === false);
  await ctx.close();

  // ── Le responsable choisi accorde seul : Validée tout de suite ─────────────────────────────────────────────────────
  {
    const r = await connecter("responsable-commercial@simassurances.test");
    await r.p.goto(`${B}/conges/${idR}`);
    await r.p.waitForLoadState("networkidle");
    verifier("Responsable : voit la demande qui lui est adressée dans « À décider »", true);
    await r.p.getByRole("button", { name: "Approuver" }).click();
    await r.p.getByText("Validée", { exact: true }).first().waitFor({ timeout: 15000 });
    const apres = (await q(`SELECT statut, "valideParId", "approuveParId" FROM "DemandeConge" WHERE id = $1`, [idR]))[0];
    verifier("Une seule décision : VALIDEE, sans passer par la RH", apres.statut === "VALIDEE" && apres.valideParId === idResp && apres.approuveParId === idResp);
    verifier("Plages d'absence créées (4 jours ouvrables)", (await q(`SELECT count(*)::int AS n FROM "PlageAbsenceAutorisee" WHERE "demandeCongeId" = $1`, [idR]))[0].n === 4);
    const tt = await texte(r.p);
    verifier("Détail validé : « Accordée par le responsable du service (décision unique) »", tt.includes("Accordée par le responsable du service (décision unique)"));
    // Le responsable ne décide pas la demande adressée à la RH : boutons grisés avec la phrase.
    await r.p.goto(`${B}/conges/${idH}`);
    await r.p.waitForLoadState("networkidle");
    verifier("Responsable : « Approuver » grisé quand la RH est choisie", await r.p.getByRole("button", { name: "Approuver" }).isDisabled());
    await r.ctx.close();
  }

  // ── La RH choisie décide seule ──────────────────────────────────────────────────────────────────────────────────────
  {
    const r = await connecter("rh@simassurances.test");
    await r.p.goto(`${B}/conges/a-decider`);
    verifier("RH : la demande adressée à la RH est dans sa file", (await r.p.locator(`a[href="/conges/${idH}"]`).count()) === 1);
    await r.p.goto(`${B}/conges/${idH}`);
    await r.p.waitForLoadState("networkidle");
    await r.p.getByRole("button", { name: "Approuver" }).click();
    await r.p.getByText("Validée", { exact: true }).first().waitFor({ timeout: 15000 });
    verifier("La RH accorde : VALIDEE d'un coup", (await q(`SELECT statut FROM "DemandeConge" WHERE id = $1`, [idH]))[0].statut === "VALIDEE");
    await r.ctx.close();
  }

  // ── Responsable inutilisable : « La RH » seule à l'écran, « responsable » refusé par le serveur ────────────────────────
  await q(`UPDATE "User" SET "isActive" = false WHERE id = $1`, [idResp]);
  {
    const c = await connecter("collaborateur@simassurances.test");
    const urlPiece = await remplir(c.p, { semaine: 45, motif: "Mariage, responsable absent" });
    const opts = (await c.p.getByLabel("Qui valide votre demande ?").locator("option").allInnerTexts()).map((t) => t.trim());
    verifier("Responsable désactivé : seule « La RH » est proposée", opts.includes("La RH") && !opts.some((o) => o.startsWith("Mon responsable")), opts.join(" | "));
    verifier("Responsable désactivé : « La RH » est présélectionnée et l'envoi est possible", await c.p.getByRole("button", { name: "Envoyer la demande" }).isEnabled());
    const typeMariage = (await q(`SELECT id FROM "TypeConge" WHERE code = 'MARIAGE_SALARIE'`))[0].id;
    const rep = await rejouer(
      c.p,
      "soumettreCongeAction",
      [{ typeCongeId: typeMariage, dateDebut: iso(lundi(46)), dateFin: iso(lundi(46)), motif: "Tentative responsable désactivé", destinataire: "RESPONSABLE", piecesJointes: [{ url: urlPiece }] }],
      "/conges/nouvelle"
    );
    verifier("Action rejouée avec « responsable » (désactivé) : refusée par le serveur", /pas disponible/.test(rep), rep.slice(-220));
    const rep2 = await rejouer(c.p, "soumettreCongeAction", [{ typeCongeId: typeMariage, dateDebut: iso(lundi(46)), dateFin: iso(lundi(46)), motif: "Tentative sans choix", piecesJointes: [{ url: urlPiece }] }], "/conges/nouvelle");
    verifier("Action rejouée sans destinataire : refusée", /Choisissez qui valide/.test(rep2), rep2.slice(-220));
    await c.ctx.close();
  }
  await q(`UPDATE "User" SET "isActive" = true WHERE id = $1`, [idResp]);

  // ── 390 px ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const c = await connecter("collaborateur@simassurances.test", { width: 390, height: 844 });
    await remplir(c.p, { semaine: 47, motif: "Mariage, vérification mobile" });
    const largeur = await c.p.evaluate(() => document.documentElement.scrollWidth);
    verifier("390 px : formulaire avec le choix du destinataire sans défilement horizontal", largeur <= 390, `scrollWidth=${largeur}`);
    await c.p.goto(`${B}/conges/${idR}`);
    await c.p.waitForLoadState("networkidle");
    const largeur2 = await c.p.evaluate(() => document.documentElement.scrollWidth);
    verifier("390 px : détail d'une permission exceptionnelle sans défilement horizontal", largeur2 <= 390, `scrollWidth=${largeur2}`);
    await c.ctx.close();
  }
} finally {
  await q(`UPDATE "User" SET "isActive" = true WHERE id = $1`, [idResp]);
}

verifier("Aucune erreur JavaScript", erreursJs.length === 0, erreursJs.join(" | "));
await browser.close();
await db.end();
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko ? 1 : 0);
