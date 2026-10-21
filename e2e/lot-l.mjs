// Lot L — sur base JETABLE (voir e2e/README.md). Nécessite unzip et pdftotext.
//   Signature manuscrite (dessinée à la souris ou au doigt) sur les actions sensibles :
//   1. enrôlement dans le profil (canevas souris + tactile sans défilement de la page, Effacer / Enregistrer, aperçu, nouvelle version,
//      anciennes versions conservées) ; l'image est revalidée côté serveur (PNG, 100 Ko, dimensions, tracé vide refusé) ;
//   2. une action signée est REFUSÉE par le serveur sans signature enrôlée, même si l'interface est contournée ; à l'écran, le bouton
//      porte la plume et le clic ouvre la création de la signature avant de continuer ;
//   3. l'action signée est tracée (signataire, version de signature, adresse IP, date) ; la version utilisée à ce moment est conservée
//      après un nouvel enrôlement ; elle s'affiche dans l'historique ;
//   4. délégation : « signé par X, au nom de Y » ;
//   5. reçu de règlement (PDF) et reporting (page + Excel) : signatures dans l'ordre du circuit, « Antérieur à la signature » avant la
//      mise en service ; droits de lecture de l'image ; aucune écriture de caisse.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import pg from "pg";
import { assurerSignatures, dataUrlSignatureTest } from "./signatures-auto.mjs";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/i.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");

const db = new pg.Client({ connectionString: DB });
await db.connect();
await assurerSignatures(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
process.on("uncaughtException", (e) => {
  console.log(resultats.join("\n"));
  console.log("\nINTERROMPU :", e.message.split("\n").slice(0, 4).join(" | "));
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
const dossier = mkdtempSync(join(tmpdir(), "lotl-"));
const P = "e2e-lotl-";

const uid = async (email) => (await q(`SELECT id FROM "User" WHERE email = $1`, [email]))[0].id;
const nom = async (id) => (await q(`SELECT "fullName" FROM "User" WHERE id=$1`, [id]))[0].fullName;
const idCollab = await uid("collaborateur@simassurances.test");
const idFinance = await uid("finance@simassurances.test");
const idAssistant = await uid("assistant-finance@simassurances.test");
const idRespTechnique = await uid("responsable-technique@simassurances.test");
const idRespCommercial = await uid("responsable-commercial@simassurances.test");
const idRespMarketing = await uid("responsable-marketing@simassurances.test");
const nomFinance = await nom(idFinance);
const nomAssistant = await nom(idAssistant);
const nomRespCommercial = await nom(idRespCommercial);
const MESSAGE_SANS_SIGNATURE = "enregistrer votre signature";

await q(`DELETE FROM "HistoriqueEntry" WHERE action='enregistrement_signature'`);
const nettoyer = async () => {
  await q(`DELETE FROM "Notification" WHERE message LIKE '%DEM-LOTL-%'`);
  await q(`DELETE FROM "ActionSignee" WHERE "demandeId" LIKE '${P}%' OR "signataireId" IN ($1,$2) AND action='annulation_reglement'`, [idFinance, idAssistant]);
  await q(`DELETE FROM "HistoriqueEntry" WHERE "entityId" LIKE '${P}%' OR detail LIKE '%DEM-LOTL-%'`);
  await q(`DELETE FROM "SignatureUtilisateur" WHERE id LIKE '${P}%'`);
  await q(`DROP TRIGGER IF EXISTS e2e_refus_signature ON "ActionSignee"`);
  await q(`DROP TRIGGER IF EXISTS e2e_refus_historique ON "HistoriqueEntry"`);
  await q(`DELETE FROM "JournalBanque" WHERE "reglementId" LIKE '${P}%'`);
  await q(`DELETE FROM "Reglement" WHERE id LIKE '${P}%'`);
  await q(`DELETE FROM "LigneDemande" WHERE "demandeId" LIKE '${P}%'`);
  await q(`DELETE FROM "Demande" WHERE id LIKE '${P}%'`);
  await q(`DELETE FROM "PermissionDelegation" WHERE "donneurId"=$1 AND "beneficiaireId"=$2`, [idFinance, idAssistant]);
};
await nettoyer();

const sessions = new Map();
async function connecter(email, options = {}) {
  const cle = `${email}|${options.mobile ? "m" : "d"}`;
  let ctx = sessions.get(cle);
  if (!ctx) {
    ctx = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" },
      ...(options.mobile ? { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true } : {}),
    });
    const connexion = await ctx.newPage();
    connexion.on("pageerror", (e) => erreursJs.push(e.message));
    await connexion.goto(`${B}/login`);
    await connexion.fill('input[name="email"]', email);
    await connexion.fill('input[name="password"]', "password123");
    await Promise.all([connexion.waitForURL((u) => !u.pathname.startsWith("/login")), connexion.click('button[type="submit"]')]);
    await connexion.close();
    sessions.set(cle, ctx);
  }
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(e.message));
  return p;
}
const journalEmpreinte = async () => (await q(`SELECT COALESCE(md5(string_agg(id || ':' || type || ':' || montant::text, ',' ORDER BY id)), '') AS h, count(*)::int AS n FROM "JournalCaisse"`))[0];
const caisse0 = await journalEmpreinte();

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

/** Trace à la souris dans un canevas de signature. */
async function dessinerSouris(page, racine = "") {
  // L'invitation « Alertes en temps réel » (notifications push) est une fenêtre flottante qui peut recouvrir le cadre : on la ferme.
  const plusTard = page.getByRole("button", { name: "Plus tard" });
  if (await plusTard.count()) await plusTard.first().click().catch(() => {});
  const c = page.locator(`${racine} [data-signature-canvas]`.trim()).first();
  await c.scrollIntoViewIfNeeded();
  const box = await c.boundingBox();
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.5);
  await page.mouse.down();
  for (let i = 0; i <= 40; i++) await page.mouse.move(box.x + box.width * (0.1 + (0.8 * i) / 40), box.y + box.height * (0.5 + 0.3 * Math.sin(i / 4)));
  await page.mouse.up();
}

/** Demande à articles, créée en SQL (étape Finance par défaut). */
async function demande(suffixe, numero, articles, extra = {}) {
  const D = `${P}${suffixe}`;
  const total = articles.reduce((s, a) => s + a.montant, 0);
  const valide = articles.filter((a) => a.statut === "VALIDEE").reduce((s, a) => s + a.montant, 0);
  await q(
    `INSERT INTO "Demande"(id, reference, montant, "montantValide", statut, "createurId", "updatedAt", "beneficiaireType", "beneficiaireUserId", "etapeCircuit", "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", "typeDemande", "descriptionOriginale")
     VALUES ($1, $2, $3, $4, $5, $6, now(), 'COLLABORATEUR', $6, $7, true, false, 'OPTIONNELLE', 'STANDARD', 'test e2e lot L')`,
    [D, `DEM-LOTL-${numero}`, total, valide, extra.statut ?? "EN_ATTENTE_VALIDATION", idCollab, extra.etape ?? "FINANCE"]
  );
  for (const [i, a] of articles.entries()) {
    await q(
      `INSERT INTO "LigneDemande"(id, libelle, "libelleOriginal", quantite, "prixUnitaire", "demandeId", motif, "statutValidation", "decideParId", "decideAt", "decideurFinanceId")
       VALUES ($1,$2,$2,1,$3,$4,'motif e2e',$5,$6,$7,$6)`,
      [`${D}-l${i + 1}`, a.libelle, a.montant, D, a.statut ?? "EN_ATTENTE", a.statut === "VALIDEE" ? idFinance : null, a.statut === "VALIDEE" ? new Date() : null]
    );
  }
  return D;
}
const actionsSignees = async (D) =>
  q(`SELECT a.*, s.version FROM "ActionSignee" a JOIN "SignatureUtilisateur" s ON s.id = a."signatureId" WHERE a."demandeId"=$1 ORDER BY a."creeAt"`, [D]);

// ======================================================================================================================
// PARTIE 1 — ENRÔLEMENT (responsable-technique@ : aucune action signée avant ce script)
// ======================================================================================================================
// Base rejouée après d'autres scripts : leurs actions signées (ajout seul, clé RESTRICT) empêcheraient de retirer les signatures de ces comptes.
await q(`DELETE FROM "ActionSignee" WHERE "signataireId" IN ($1,$2,$3) OR "auNomDeId" IN ($1,$2,$3)`, [idRespTechnique, idFinance, idAssistant]);
await q(`DELETE FROM "SignatureUtilisateur" WHERE "userId"=$1`, [idRespTechnique]);
let idEnrolement = null;
{
  const p = await connecter("responsable-technique@simassurances.test");
  await p.goto(`${B}/profil`);
  await p.locator("[data-section-signature]").waitFor();
  const section = p.locator("[data-section-signature]");
  verifier("1a. profil : aucune signature enregistrée (message dédié)", (await section.locator("[data-signature-absente]").count()) === 1);
  verifier("1a. … bandeau « Créer ma signature » pour un responsable de service sans signature", (await p.locator("[data-banniere-signature]").count()) === 1);
  verifier("1a. … la mention honnête : traçabilité interne, pas une signature électronique qualifiée", net(await section.innerText()).includes("sans valeur de signature électronique qualifiée"));
  const boutonEnregistrer = section.getByRole("button", { name: "Enregistrer", exact: true });
  verifier("1b. « Enregistrer » et « Effacer » grisés tant que rien n'est dessiné", (await boutonEnregistrer.isDisabled()) && (await section.getByRole("button", { name: "Effacer" }).isDisabled()));
  await dessinerSouris(p, "[data-section-signature]");
  verifier("1b. après le tracé : les deux boutons sont actifs", (await boutonEnregistrer.isEnabled()) && (await section.getByRole("button", { name: "Effacer" }).isEnabled()));
  await section.getByRole("button", { name: "Effacer" }).click();
  verifier("1b. « Effacer » vide le cadre (boutons de nouveau grisés)", await boutonEnregistrer.isDisabled());
  await dessinerSouris(p, "[data-section-signature]");
  await boutonEnregistrer.click();
  verifier("1c. enregistrement : une signature en version 1 en base", await attendre(async () => (await q(`SELECT 1 FROM "SignatureUtilisateur" WHERE "userId"=$1`, [idRespTechnique])).length === 1));
  const v1 = (await q(`SELECT id, version, largeur, hauteur, empreinte, "creeAt", length(image) AS taille, substring(image from 2 for 3) AS magic FROM "SignatureUtilisateur" WHERE "userId"=$1`, [idRespTechnique]))[0];
  idEnrolement = v1.id;
  verifier("1c. PNG 600 × 200 reconstruit côté serveur, moins de 100 Ko, empreinte SHA-256", v1.version === 1 && v1.largeur === 600 && v1.hauteur === 200 && v1.taille < 100 * 1024 && v1.magic.toString() === "PNG" && /^[0-9a-f]{64}$/.test(v1.empreinte), `${v1.taille} octets`);
  verifier("1c. l'enregistrement est tracé dans l'historique du compte", (await q(`SELECT 1 FROM "HistoriqueEntry" WHERE action='enregistrement_signature' AND "userId"=$1`, [idRespTechnique])).length === 1);
  await p.locator("[data-signature-apercu]").waitFor();
  verifier("1d. aperçu de la signature actuelle affiché dans le profil", (await p.locator("[data-signature-version]").innerText()).includes("Version 1"));
  const image = await p.context().request.get(`${B}/api/signatures/${v1.id}`);
  verifier("1d. l'image est servie à son propriétaire (PNG, jamais d'URL publique)", image.status() === 200 && (image.headers()["content-type"] ?? "") === "image/png");
  const anonyme = await browser.newContext();
  const refusAnonyme = await anonyme.request.get(`${B}/api/signatures/${v1.id}`);
  verifier("1d. sans session : 401", refusAnonyme.status() === 401);
  await anonyme.close();
  const marketing = await connecter("responsable-marketing@simassurances.test");
  const refusMarketing = await marketing.context().request.get(`${B}/api/signatures/${v1.id}`);
  verifier("1d. un autre compte sans lien avec une action signée avec cette signature : 403", refusMarketing.status() === 403);
  await marketing.close();

  // Nouvelle version : l'ancienne n'est jamais modifiée. (On attend que la page ait fini de se mettre à jour : le cadre est effacé après l'envoi.)
  await attendre(async () => boutonEnregistrer.isDisabled());
  await p.waitForTimeout(800);
  await dessinerSouris(p, "[data-section-signature]");
  await boutonEnregistrer.click();
  verifier("1e. nouvelle signature = nouvelle VERSION (2 lignes)", await attendre(async () => (await q(`SELECT 1 FROM "SignatureUtilisateur" WHERE "userId"=$1`, [idRespTechnique])).length === 2));
  const versions = await q(`SELECT id, version, empreinte, "creeAt" FROM "SignatureUtilisateur" WHERE "userId"=$1 ORDER BY version`, [idRespTechnique]);
  verifier("1e. la version 1 est intacte (même id, même empreinte, même date)", versions[0].id === v1.id && versions[0].empreinte === v1.empreinte && new Date(versions[0].creeAt).getTime() === new Date(v1.creeAt).getTime());
  await p.reload();
  verifier("1e. le profil affiche la version 2 et conserve la liste des anciennes versions", (await p.locator("[data-signature-version]").innerText()).includes("Version 2") && net(await p.locator("[data-section-signature]").innerText()).includes("Anciennes versions (1)"));

  // Revalidation côté serveur (appel direct de l'action : jamais cru du navigateur).
  const idEnregistrer = await idAction(p, "enregistrerSignatureAction");
  verifier("0. identifiant de l'action d'enrôlement trouvé", !!idEnregistrer);
  const nb = async () => (await q(`SELECT count(*)::int AS n FROM "SignatureUtilisateur" WHERE "userId"=$1`, [idRespTechnique]))[0].n;
  const refus = async (valeur) => appelerAction(p, idEnregistrer, [valeur]);
  const blanc = await refus(dataUrlSignatureTest(0, { vide: true }));
  verifier("1f. serveur : un cadre VIDE est refusé", !blanc.succes && /vide|trop courte/.test(blanc.message), blanc.message);
  const jpeg = await refus("data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD");
  verifier("1f. serveur : un JPEG est refusé (PNG seulement)", !jpeg.succes && /PNG/.test(jpeg.message), jpeg.message);
  const faux = await refus("data:image/png;base64," + Buffer.from("<svg onload=alert(1)></svg>".repeat(10)).toString("base64"));
  verifier("1f. serveur : un faux PNG (contenu SVG déguisé) est refusé", !faux.succes, faux.message);
  const lourd = await refus(dataUrlSignatureTest(0, { remplissage: 120 * 1024 }));
  verifier("1f. serveur : une image de plus de 100 Ko est refusée", !lourd.succes && /volumineuse/.test(lourd.message), lourd.message);
  const petit = await refus(dataUrlSignatureTest(0, { w: 100, h: 100 }));
  verifier("1f. serveur : des dimensions hors limites sont refusées", !petit.succes && /Dimensions/.test(petit.message), petit.message);
  const texte = await refus("pas une image");
  verifier("1f. serveur : une valeur qui n'est pas une image est refusée", !texte.succes, texte.message);
  verifier("1f. … aucune de ces tentatives n'a créé de version", (await nb()) === 2);
  const ok = await refus(dataUrlSignatureTest(10));
  verifier("1f. serveur : un PNG valide, lui, est accepté (version 3)", ok.succes && (await nb()) === 3, ok.message);
  await p.close();
}

// Tactile : le doigt dessine SANS faire défiler la page.
{
  await q(`DELETE FROM "SignatureUtilisateur" WHERE "userId"=$1 AND version=3`, [idRespTechnique]);
  const m = await connecter("responsable-technique@simassurances.test", { mobile: true });
  await m.goto(`${B}/profil`);
  const canvas = m.locator("[data-section-signature] [data-signature-canvas]");
  await canvas.waitFor();
  await canvas.scrollIntoViewIfNeeded();
  const touchAction = await canvas.evaluate((el) => getComputedStyle(el).touchAction);
  verifier("1g. mobile : le canevas a touch-action: none (le doigt ne fait pas défiler la page)", touchAction === "none", touchAction);
  const box = await canvas.boundingBox();
  const scrollAvant = await m.evaluate(() => window.scrollY);
  const cdp = await m.context().newCDPSession(m);
  const pt = (i) => ({ x: box.x + box.width * (0.1 + (0.8 * i) / 30), y: box.y + box.height * (0.5 + 0.3 * Math.sin(i / 3)) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pt(0)] });
  for (let i = 1; i <= 30; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [pt(i)] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const scrollApres = await m.evaluate(() => window.scrollY);
  verifier("1g. mobile : un tracé au doigt ne fait pas défiler la page", scrollAvant === scrollApres, `${scrollAvant} → ${scrollApres}`);
  const enregistrer = m.locator("[data-section-signature]").getByRole("button", { name: "Enregistrer", exact: true });
  verifier("1g. mobile : le tracé au doigt est pris en compte (« Enregistrer » actif)", await enregistrer.isEnabled());
  const largeur = await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  verifier("1g. mobile (390 px) : pas de défilement horizontal du profil", largeur);
  await enregistrer.click();
  verifier("1g. mobile : enregistrement au doigt", await attendre(async () => (await q(`SELECT 1 FROM "SignatureUtilisateur" WHERE "userId"=$1 AND version=3`, [idRespTechnique])).length === 1));
  await m.close();
}

// ======================================================================================================================
// PARTIE 2 — REFUS SANS SIGNATURE (serveur) ET CRÉATION À L'ÉCRAN
// ======================================================================================================================
const D1 = await demande("d1", 1, [{ libelle: "Fournitures e2e lot L", montant: 50000 }]);
const L1 = `${D1}-l1`;
await q(`DELETE FROM "SignatureUtilisateur" WHERE "userId" IN ($1,$2)`, [idFinance, idAssistant]);
{
  const fin = await connecter("finance@simassurances.test");
  await fin.goto(`${B}/treso/finance/demandes/${D1}`);
  await fin.locator("[data-banniere-signature]").waitFor();
  verifier("2a. Finance sans signature : bandeau « Créer ma signature »", (await fin.locator("[data-banniere-signature]").count()) === 1);
  const idValider = await idAction(fin, "validerLignesAction");
  verifier("0. identifiant de validerLignesAction trouvé", !!idValider);
  const refusServeur = await appelerAction(fin, idValider, [D1, [{ ligneId: L1, statut: "VALIDEE" }]]);
  verifier("2b. SERVEUR : décision refusée sans signature enrôlée (appel direct, interface contournée)", !refusServeur.succes && refusServeur.message.includes(MESSAGE_SANS_SIGNATURE), refusServeur.message);
  verifier("2b. … l'article est resté en attente et aucune action signée n'est enregistrée", (await q(`SELECT "statutValidation" FROM "LigneDemande" WHERE id=$1`, [L1]))[0].statutValidation === "EN_ATTENTE" && (await actionsSignees(D1)).length === 0);

  // Même refus pour une autre action sensible (règlement) et un autre compte (Assistant Finance).
  const D0 = await demande("d0", 0, [{ libelle: "Article validé e2e", montant: 20000, statut: "VALIDEE" }], { etape: "TERMINEE", statut: "VALIDEE_NON_REGLEE" });
  await q(`INSERT INTO "Reglement"(id, montant, mode, "estConfirme", "demandeId", "ligneDemandeId", "auteurId", motif) VALUES ($1,20000,'BANQUE',false,$2,$3,$4,'Règlement e2e lot L')`, [`${P}r0`, D0, `${D0}-l1`, idAssistant]);
  const ass = await connecter("assistant-finance@simassurances.test");
  await ass.goto(`${B}/treso/finance/demandes/${D0}`);
  const idConfirmer = await idAction(ass, "confirmerReglementAction");
  const refusRegl = await appelerAction(ass, idConfirmer, [`${P}r0`]);
  verifier("2c. SERVEUR : confirmation d'un règlement refusée sans signature (Assistant Finance)", !refusRegl.succes && refusRegl.message.includes(MESSAGE_SANS_SIGNATURE), refusRegl.message);
  verifier("2c. … le règlement n'est pas confirmé", (await q(`SELECT "estConfirme" FROM "Reglement" WHERE id=$1`, [`${P}r0`]))[0].estConfirme === false);
  await ass.close();

  // À l'écran : le bouton porte la plume et le rappel ; le clic propose de créer la signature, puis l'action reprend.
  await fin.getByRole("button", { name: "Valider", exact: true }).first().click();
  const bouton = fin.getByRole("button", { name: /Enregistrer les décisions/ });
  verifier("2d. le bouton de l'action signée porte la plume et le rappel « Signer et valider … »", (await bouton.getAttribute("data-signe")) === "true" && /Signer et valider/.test((await bouton.getAttribute("title")) ?? ""));
  await bouton.click();
  await fin.locator("[data-dialogue-signature]").waitFor();
  verifier("2d. sans signature, le clic ouvre la création de la signature au lieu d'exécuter l'action", (await q(`SELECT "statutValidation" FROM "LigneDemande" WHERE id=$1`, [L1]))[0].statutValidation === "EN_ATTENTE");
  await dessinerSouris(fin, "[data-dialogue-signature]");
  await fin.locator("[data-dialogue-signature]").getByRole("button", { name: /Enregistrer ma signature et continuer/ }).click();
  verifier("2e. la signature est créée, puis l'action reprend sans nouveau clic : l'article est validé", await attendre(async () => (await q(`SELECT "statutValidation" FROM "LigneDemande" WHERE id=$1`, [L1]))[0].statutValidation === "VALIDEE", 20000));
  await fin.close();
}

// ======================================================================================================================
// PARTIE 3 — TRAÇABILITÉ : signataire, version, adresse IP, date ; version conservée ; historique
// ======================================================================================================================
let sigFinanceV1 = null;
const D2 = await demande("d2", 2, [{ libelle: "Second article e2e lot L", montant: 30000 }]);
{
  const a1 = (await actionsSignees(D1))[0];
  sigFinanceV1 = a1?.signatureId;
  verifier("3a. une action signée enregistrée : décision de la Finance, signataire, version 1", !!a1 && a1.action === "decision_lignes" && a1.signataireId === idFinance && a1.version === 1 && a1.demandeId === D1);
  verifier("3a. … adresse IP et date conservées, aucune délégation", a1?.ip === "10.9.9.9" && a1?.creeAt && a1?.auNomDeId === null, a1?.ip);
  const fin = await connecter("finance@simassurances.test");
  await fin.goto(`${B}/treso/finance/demandes/${D1}`);
  const mention = fin.locator("[data-signature-mention]").first();
  await mention.waitFor();
  verifier("3b. l'historique de la demande montre la signature : miniature + « signé par … »", (await mention.locator("[data-signature-miniature]").count()) === 1 && net(await mention.innerText()).includes(`signé par ${nomFinance}`));

  // Nouvel enrôlement (version 2), puis une seconde action signée : chacune garde SA version.
  await fin.goto(`${B}/profil`);
  await dessinerSouris(fin, "[data-section-signature]");
  await fin.locator("[data-section-signature]").getByRole("button", { name: "Enregistrer", exact: true }).click();
  await attendre(async () => (await q(`SELECT 1 FROM "SignatureUtilisateur" WHERE "userId"=$1`, [idFinance])).length === 2);
  await fin.goto(`${B}/treso/finance/demandes/${D2}`);
  await fin.getByRole("button", { name: "Valider", exact: true }).first().click();
  await fin.getByRole("button", { name: /Enregistrer les décisions/ }).click();
  await attendre(async () => (await actionsSignees(D2)).length === 1);
  const a2 = (await actionsSignees(D2))[0];
  verifier("3c. la seconde action utilise la version 2 de la signature", a2?.version === 2 && a2?.signataireId === idFinance, `v${a2?.version}`);
  verifier("3c. la PREMIÈRE action a gardé la version 1 (jamais réécrite)", (await actionsSignees(D1))[0].version === 1 && (await actionsSignees(D1))[0].signatureId === sigFinanceV1);
  await fin.goto(`${B}/treso/finance/demandes/${D1}`);
  const v1Affichee = await fin.locator("[data-signature-mention]").first().getAttribute("data-signature-version");
  await fin.goto(`${B}/treso/finance/demandes/${D2}`);
  const v2Affichee = await fin.locator("[data-signature-mention]").first().getAttribute("data-signature-version");
  verifier("3d. l'historique affiche, pour chaque action, la version utilisée à ce moment (1 puis 2)", v1Affichee === "1" && v2Affichee === "2", `${v1Affichee} / ${v2Affichee}`);
  await fin.close();

  // Droits de lecture de l'image : le demandeur la voit (c'est l'histoire de SA demande), un compte étranger non.
  const collab = await connecter("collaborateur@simassurances.test");
  const accesCollab = await collab.context().request.get(`${B}/api/signatures/${sigFinanceV1}`);
  verifier("3e. le demandeur peut voir la signature de la Finance sur SA demande", accesCollab.status() === 200);
  await collab.goto(`${B}/treso/demandes/${D1}`);
  verifier("3e. … l'historique de sa demande porte la mention de signature", (await collab.locator("[data-signature-mention]").count()) >= 1);
  await collab.close();
  const marketing = await connecter("responsable-marketing@simassurances.test");
  const accesMarketing = await marketing.context().request.get(`${B}/api/signatures/${sigFinanceV1}`);
  verifier("3e. un compte étranger à la demande n'y a pas accès (403)", accesMarketing.status() === 403);
  await marketing.close();
}

// ======================================================================================================================
// PARTIE 4 — DÉLÉGATION : « signé par X, au nom de Y »
// ======================================================================================================================
await assurerSignatures(db); // l'Assistant Finance retrouve une signature (supprimée en partie 2)
const D3 = await demande("d3", 3, [{ libelle: "Article réglé e2e lot L", montant: 20000, statut: "VALIDEE" }], { etape: "TERMINEE", statut: "REGLEE" });
await q(`INSERT INTO "Reglement"(id, montant, mode, "estConfirme", "confirmeAt", "demandeId", "ligneDemandeId", "auteurId", motif) VALUES ($1,10000,'BANQUE',true,now(),$2,$3,$4,'Règlement e2e lot L')`, [`${P}r3a`, D3, `${D3}-l1`, idAssistant]);
await q(`INSERT INTO "Reglement"(id, montant, mode, "estConfirme", "confirmeAt", "demandeId", "ligneDemandeId", "auteurId", motif) VALUES ($1,10000,'BANQUE',true,now(),$2,$3,$4,'Règlement e2e lot L')`, [`${P}r3b`, D3, `${D3}-l1`, idAssistant]);
{
  const ass = await connecter("assistant-finance@simassurances.test");
  await ass.goto(`${B}/treso/finance/demandes/${D3}`);
  const idAnnuler = await idAction(ass, "annulerReglementAction");
  verifier("0. identifiant de annulerReglementAction trouvé", !!idAnnuler);
  const sansDelegation = await appelerAction(ass, idAnnuler, [`${P}r3a`, "annulation e2e sans délégation"]);
  verifier("4a. sans délégation : annuler un règlement est refusé (permission), rien n'est signé", !sansDelegation.succes && /non autorisée/.test(sansDelegation.message) && (await actionsSignees(D3)).length === 0, sansDelegation.message);
  const [{ id: idPerm }] = await q(`SELECT id FROM "Permission" WHERE key='treso.annuler_reglement'`);
  await q(`INSERT INTO "PermissionDelegation"(id, "beneficiaireId", "donneurId", "permissionId", "estActive") VALUES ($1,$2,$3,$4,true)`, [`${P}deleg1`, idAssistant, idFinance, idPerm]);
  await ass.reload();
  const avecDelegation = await appelerAction(ass, idAnnuler, [`${P}r3a`, "annulation e2e par délégation de la Finance"]);
  verifier("4b. avec la délégation de la Finance : l'Assistant annule le règlement", avecDelegation.succes, avecDelegation.message);
  const a = (await actionsSignees(D3))[0];
  verifier("4b. l'action est signée par l'ASSISTANT (sa propre signature), au nom de la Finance", !!a && a.signataireId === idAssistant && a.auNomDeId === idFinance && a.action === "annulation_reglement", JSON.stringify({ s: a?.signataireId === idAssistant, n: a?.auNomDeId === idFinance }));
  verifier("4b. … la signature utilisée est celle de l'Assistant, pas celle du titulaire", a?.signatureId !== sigFinanceV1 && (await q(`SELECT "userId" FROM "SignatureUtilisateur" WHERE id=$1`, [a?.signatureId]))[0]?.userId === idAssistant);
  await ass.goto(`${B}/treso/finance/demandes/${D3}`);
  const texteHisto = net(await ass.locator("[data-signature-mention]").first().innerText());
  verifier("4c. l'historique dit « signé par [délégué], au nom de [titulaire] »", texteHisto.includes(`signé par ${nomAssistant}, au nom de ${nomFinance}`), texteHisto);
  await ass.close();
}

// ======================================================================================================================
// PARTIE 5 — REÇU DE RÈGLEMENT ET REPORTING
// ======================================================================================================================
const mise = (await q(`SELECT "creeAt" FROM "MarqueurUnique" WHERE cle='signatures.mise_en_service'`))[0].creeAt;
{
  // Règlement confirmé par l'Assistant (action signée) sur l'article validé de D1 ; une validation de service d'AVANT la mise en service.
  await q(`INSERT INTO "Reglement"(id, montant, mode, "estConfirme", "demandeId", "ligneDemandeId", "auteurId", motif) VALUES ($1,50000,'BANQUE',false,$2,$3,$4,'Règlement e2e lot L')`, [`${P}r1`, D1, L1, idAssistant]);
  await q(`INSERT INTO "HistoriqueEntry"(id, entity, "entityId", action, detail, "userId", "createdAt") VALUES ($1,'Demande',$2,'validation_service','Validé par le responsable du service (e2e)',$3,$4)`, [`${P}h-service`, D1, idRespCommercial, new Date(new Date(mise).getTime() - 86400000)]);
  const ass = await connecter("assistant-finance@simassurances.test");
  await ass.goto(`${B}/treso/finance/demandes/${D1}`);
  const idConfirmer = await idAction(ass, "confirmerReglementAction");
  const conf = await appelerAction(ass, idConfirmer, [`${P}r1`]);
  verifier("5a. l'Assistant confirme le règlement (action signée, avec sa signature)", conf.succes, conf.message);
  verifier("5a. … l'action signée « confirmation_reglement » est enregistrée", (await actionsSignees(D1)).some((x) => x.action === "confirmation_reglement" && x.signataireId === idAssistant && x.entiteId === `${P}r1`));
  await ass.close();

  const fin = await connecter("finance@simassurances.test");
  await fin.goto(`${B}/treso/finance/demandes/${D1}`);
  const histoTexte = net(await fin.locator("main").innerText());
  verifier("5b. historique : l'action d'avant la mise en service est « Antérieur à la signature » (pas signalée comme anormale)", (await fin.locator("[data-signature-anterieure]").count()) >= 1);
  verifier("5b. parcours de l'article : les signatures sont listées avec ce qui a été signé", (await fin.locator("[data-parcours-signatures]").count()) >= 1 && histoTexte.includes("Confirmation (décaissement) d'un règlement"));

  const r = await fin.request.get(`${B}/api/treso/reglements/${P}r1/recu`);
  verifier("5c. reçu de règlement : PDF généré (200)", r.status() === 200 && (r.headers()["content-type"] ?? "").includes("pdf"));
  const pdf = join(dossier, "recu.pdf");
  writeFileSync(pdf, await r.body());
  const t = net(execFileSync("pdftotext", ["-layout", pdf, "-"]).toString());
  verifier("5c. reçu : bloc « Validations et signatures » avec nom, fonction et date", t.toLowerCase().includes("validations et signatures") && t.includes(nomFinance) && t.includes(nomAssistant) && t.includes(nomRespCommercial));
  const iService = t.indexOf("Validation du responsable de service");
  const iFinance = t.indexOf("Validation de la Finance");
  const iRegl = t.indexOf("Règlement (décaissement)");
  verifier("5c. reçu : les étapes sont dans l'ordre du circuit (Service, Finance, règlement)", iService > 0 && iService < iFinance && iFinance < iRegl, `${iService} < ${iFinance} < ${iRegl}`);
  verifier("5c. reçu : « Antérieur à la signature » pour la validation d'avant la mise en service", t.includes("Antérieur à la signature"));
  verifier("5c. reçu : mention « sans valeur de signature électronique qualifiée »", t.includes("électronique qualifiée"));
  const rBon = await fin.request.get(`${B}/api/treso/reglements/${P}r1/recu`);
  verifier("5c. … le demandeur obtient aussi son reçu (droits inchangés)", rBon.status() === 200);

  // Pré-lot dans le reporting : un règlement confirmé AVANT la mise en service.
  const D5 = await demande("d5", 5, [{ libelle: "Article ancien e2e lot L", montant: 8000, statut: "VALIDEE" }], { etape: "TERMINEE", statut: "REGLEE" });
  await q(`INSERT INTO "Reglement"(id, montant, mode, "estConfirme", "confirmeAt", "demandeId", "ligneDemandeId", "auteurId", motif) VALUES ($1,8000,'BANQUE',true,$2,$3,$4,$5,'Règlement ancien e2e')`, [`${P}r5`, new Date(new Date(mise).getTime() - 2 * 86400000), D5, `${D5}-l1`, idAssistant]);

  // Page de reporting : miniatures de signature sur les lignes signées.
  await fin.goto(`${B}/treso/finance/reporting`);
  const deplier = fin.getByRole("button", { name: /Tout déplier/ });
  if (await deplier.count()) await deplier.first().click();
  await fin.locator('tr[data-niveau="2"]').first().waitFor({ timeout: 15000 }).catch(() => {});
  const lignesSignees = fin.locator("[data-signature-reporting]");
  verifier("6a. reporting (page) : miniatures de signature sur les lignes signées (décision, règlement…)", (await lignesSignees.count()) >= 2, String(await lignesSignees.count()));
  const pageTexte = net(await fin.locator("main").innerText());
  verifier("6a. … colonnes « Signé par », « Signé le », « Au nom de » et « Signature »", ["Signé par", "Signé le", "Au nom de", "Signature"].every((c) => pageTexte.includes(c)));
  verifier("6a. … « signé par [nom] » sur la ligne du règlement et « Antérieur à la signature » sur l'ancien", pageTexte.includes(`signé par ${nomAssistant}`) && pageTexte.includes("Antérieur à la signature"));
  verifier("6a. … la ligne de l'action faite par délégation dit « au nom de »", pageTexte.includes(`signé par ${nomAssistant}, au nom de ${nomFinance}`) || (await q(`SELECT 1 FROM "ActionSignee" WHERE "auNomDeId" IS NOT NULL`)).length === 1);

  // Excel : images dédupliquées par version, colonnes de texte, droit de lecture du reporting.
  const x = await fin.request.get(`${B}/api/treso/reporting/export`);
  verifier("6b. export Excel : 200", x.status() === 200);
  const xlsx = join(dossier, "export.xlsx");
  writeFileSync(xlsx, await x.body());
  const partages = net(execFileSync("unzip", ["-p", xlsx, "xl/sharedStrings.xml"], { maxBuffer: 64 * 1024 * 1024 }).toString());
  verifier("6b. Excel : colonnes « Signé par », « Signé le », « Au nom de », « Signature » et libellés « signé par … »", ["Signé par", "Signé le", "Au nom de", "Signature"].every((c) => partages.includes(c)) && partages.includes(`signé par ${nomAssistant}`));
  verifier("6b. Excel : « Antérieur à la signature » sur les lignes d'avant la mise en service", partages.includes("Antérieur à la signature"));
  const media = execFileSync("unzip", ["-Z1", xlsx]).toString().split("\n").filter((f) => /^xl\/media\/image\d+\.png$/.test(f));
  const distinctes = (await q(`SELECT count(DISTINCT "signatureId")::int AS n FROM "ActionSignee" WHERE "demandeId" IS NOT NULL`))[0].n; // toutes les demandes de la base (d'autres scripts ont pu signer avant)
  verifier("6b. Excel : l'image de signature est intégrée UNE fois par version utilisée (pas une par ligne)", media.length >= 2 && media.length <= distinctes, `${media.length} images pour ${distinctes} signatures distinctes`);
  verifier("6b. Excel : le fichier reste léger", (await x.body()).length < 2 * 1024 * 1024, `${(await x.body()).length} octets`);
  await fin.close();

  const collab = await connecter("collaborateur@simassurances.test");
  const refusExport = await collab.request.get(`${B}/api/treso/reporting/export`);
  verifier("6c. sans droit de reporting : l'export (donc les signatures) est refusé", refusExport.status() === 403 || refusExport.status() === 401);
  await collab.close();
}

// ======================================================================================================================
// PARTIE 7 — LOT L BIS : l'action et sa signature sont écrites dans la MÊME transaction (tout ou rien)
// ======================================================================================================================
{
  const D6 = await demande("d6", 6, [{ libelle: "Atomicité 1 e2e lot L", montant: 12000 }]);
  const D7 = await demande("d7", 7, [{ libelle: "Atomicité 2 e2e lot L", montant: 13000 }]);
  const fin = await connecter("finance@simassurances.test");
  await fin.goto(`${B}/treso/finance/demandes/${D6}`);
  const idValider = await idAction(fin, "validerLignesAction");
  verifier("0. (L bis) identifiant de validerLignesAction trouvé", !!idValider);
  const statutLigne = async (D) => (await q(`SELECT "statutValidation" FROM "LigneDemande" WHERE id=$1`, [`${D}-l1`]))[0].statutValidation;
  const nbHisto = async (D) => (await q(`SELECT count(*)::int AS n FROM "HistoriqueEntry" WHERE action IN ('validation_ligne','rejet_ligne') AND "entityId"=$1`, [`${D}-l1`]))[0].n;

  // 7a. L'enregistrement de la signature échoue : l'action n'a PAS lieu (ni décision, ni historique).
  await q(`CREATE OR REPLACE FUNCTION e2e_refus_signature() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'E2E : échec simulé de l''enregistrement de la signature'; END; $$ LANGUAGE plpgsql`);
  await q(`CREATE TRIGGER e2e_refus_signature BEFORE INSERT ON "ActionSignee" FOR EACH ROW WHEN (NEW."demandeId" = '${D6}') EXECUTE FUNCTION e2e_refus_signature()`);
  const r6 = await appelerAction(fin, idValider, [D6, [{ ligneId: `${D6}-l1`, statut: "VALIDEE" }]]);
  verifier("7a. (L bis) si l'enregistrement de la signature échoue, l'action est refusée", !r6.succes, r6.message);
  verifier("7a. … l'article est resté EN ATTENTE, aucune ligne d'historique, aucune action signée", (await statutLigne(D6)) === "EN_ATTENTE" && (await nbHisto(D6)) === 0 && (await actionsSignees(D6)).length === 0);
  await q(`DROP TRIGGER e2e_refus_signature ON "ActionSignee"`);

  // 7b. L'action échoue APRÈS l'écriture de la signature : la signature n'existe pas non plus (pas de signature orpheline).
  await q(`CREATE OR REPLACE FUNCTION e2e_refus_historique() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'E2E : échec simulé de l''historique'; END; $$ LANGUAGE plpgsql`);
  await q(`CREATE TRIGGER e2e_refus_historique BEFORE INSERT ON "HistoriqueEntry" FOR EACH ROW WHEN (NEW."entityId" = '${D7}-l1' AND NEW.action = 'validation_ligne') EXECUTE FUNCTION e2e_refus_historique()`);
  const r7 = await appelerAction(fin, idValider, [D7, [{ ligneId: `${D7}-l1`, statut: "VALIDEE" }]]);
  verifier("7b. (L bis) si l'action échoue en cours de route, elle est refusée", !r7.succes, r7.message);
  verifier("7b. … ni décision, ni historique, ET AUCUNE signature orpheline (la ligne de signature est annulée avec l'action)", (await statutLigne(D7)) === "EN_ATTENTE" && (await nbHisto(D7)) === 0 && (await actionsSignees(D7)).length === 0);
  await q(`DROP TRIGGER e2e_refus_historique ON "HistoriqueEntry"`);

  // 7c. Sans l'incident, la même action réussit et laisse une action signée ET sa ligne d'historique liée par identifiant.
  const r7bis = await appelerAction(fin, idValider, [D7, [{ ligneId: `${D7}-l1`, statut: "VALIDEE" }]]);
  verifier("7c. (L bis) l'incident levé, la même décision réussit", r7bis.succes, r7bis.message);
  const lies = await q(`SELECT h."actionSigneeId", a.action, a."signataireId" FROM "HistoriqueEntry" h JOIN "ActionSignee" a ON a.id = h."actionSigneeId" WHERE h."entityId"=$1 AND h.action='validation_ligne'`, [`${D7}-l1`]);
  verifier("7c. … la ligne d'historique de la décision est liée PAR IDENTIFIANT à l'action signée du compte", lies.length === 1 && lies[0].signataireId === idFinance, JSON.stringify(lies));
  await q(`DROP FUNCTION IF EXISTS e2e_refus_signature()`);
  await q(`DROP FUNCTION IF EXISTS e2e_refus_historique()`);
  await fin.close();
}

// ======================================================================================================================
// PARTIE 8 — LOT L BIS : lien par IDENTIFIANT — deux actions du même compte à moins d'une minute, deux versions de signature
// ======================================================================================================================
{
  const D8 = await demande("d8", 8, [
    { libelle: "Premier article e2e lot L bis", montant: 11000 },
    { libelle: "Second article e2e lot L bis", montant: 14000 },
  ]);
  const fin = await connecter("finance@simassurances.test");
  await fin.goto(`${B}/treso/finance/demandes/${D8}`);
  const idValider = await idAction(fin, "validerLignesAction");
  const a1 = await appelerAction(fin, idValider, [D8, [{ ligneId: `${D8}-l1`, statut: "VALIDEE" }]]);
  // Nouvelle version de signature (enrôlement simulé en base : même effet que le profil), puis la seconde décision, dans la minute.
  await q(`INSERT INTO "SignatureUtilisateur"(id, "userId", version, image, largeur, hauteur, empreinte)
           SELECT $2 || version::text, "userId", version + 1, image, largeur, hauteur, empreinte || 'bis' FROM "SignatureUtilisateur" WHERE "userId"=$1 ORDER BY version DESC LIMIT 1`, [idFinance, `${P}sigv`]);
  const a2 = await appelerAction(fin, idValider, [D8, [{ ligneId: `${D8}-l2`, statut: "VALIDEE" }]]);
  verifier("8a. (L bis) deux décisions du même compte à quelques secondes d'écart réussissent", a1.succes && a2.succes, `${a1.message} / ${a2.message}`);
  const actions = await actionsSignees(D8);
  verifier("8a. … deux actions signées, avec DEUX versions de signature différentes", actions.length === 2 && actions[0].signatureId !== actions[1].signatureId && actions[1].version === actions[0].version + 1, JSON.stringify(actions.map((x) => x.version)));
  const ecart = new Date(actions[1].creeAt).getTime() - new Date(actions[0].creeAt).getTime();
  verifier("8a. … à moins de 60 secondes l'une de l'autre (le cas que l'ancienne fenêtre de temps confondait)", ecart < 60000, `${ecart} ms`);
  const histo = await q(`SELECT h."entityId", h."actionSigneeId" FROM "HistoriqueEntry" h WHERE h.action='validation_ligne' AND h."entityId" LIKE $1 ORDER BY h."entityId"`, [`${D8}-l%`]);
  verifier("8b. chaque ligne d'historique pointe vers l'action signée de SA décision (identifiant)", histo.length === 2 && histo[0].actionSigneeId === actions[0].id && histo[1].actionSigneeId === actions[1].id, JSON.stringify(histo));

  await fin.goto(`${B}/treso/finance/demandes/${D8}`);
  await fin.locator("[data-signature-mention]").first().waitFor();
  const versions = await fin.locator("[data-signature-mention]").evaluateAll((els) => els.map((e) => e.getAttribute("data-signature-version")));
  verifier("8c. l'historique affiche, pour chaque décision, SA version de signature (1 et 2, jamais deux fois la même)", versions.filter((v) => v === String(actions[0].version)).length >= 1 && versions.filter((v) => v === String(actions[1].version)).length >= 1, versions.join(","));
  verifier("8c. … aucune mention « Signature non rattachée » sur des actions faites depuis le lot L bis", (await fin.locator("[data-signature-non-rattachee]").count()) === 0);

  await fin.goto(`${B}/treso/finance/reporting`);
  const deplier = fin.getByRole("button", { name: /Tout déplier/ });
  if (await deplier.count()) await deplier.first().click();
  await fin.locator("[data-signature-reporting]").first().waitFor({ timeout: 15000 });
  const sur = async (id) => fin.locator(`[data-signature-reporting][href="/api/signatures/${id}"]`).count();
  verifier("8d. reporting (page) : les deux signatures distinctes y figurent (chaque article garde la sienne)", (await sur(actions[0].signatureId)) >= 1 && (await sur(actions[1].signatureId)) >= 1);

  // Une ancienne ligne du lot L, laissée SANS lien (ambiguïté de la reprise), est signalée honnêtement — jamais devinée.
  const mise2 = (await q(`SELECT "creeAt" FROM "MarqueurUnique" WHERE cle='signatures.mise_en_service'`))[0].creeAt;
  await q(`INSERT INTO "HistoriqueEntry"(id, entity, "entityId", action, detail, "userId", "createdAt") VALUES ($1,'Demande',$2,'validation_service','Validé (ancien, lot L, sans lien) e2e',$3,$4)`, [`${P}h-orph`, D8, idRespCommercial, new Date(new Date(mise2).getTime() + 3600000)]);
  await fin.goto(`${B}/treso/finance/demandes/${D8}`);
  verifier("8e. une ligne d'historique signable, postérieure à la mise en service et sans lien, affiche « Signature non rattachée »", (await fin.locator("[data-signature-non-rattachee]").count()) === 1);
  await fin.close();
}

// ======================================================================================================================
// FIN
// ======================================================================================================================
const caisse1 = await journalEmpreinte();
verifier("7. AUCUNE écriture du journal de caisse créée ni modifiée (règlements Banque seulement)", caisse0.h === caisse1.h && caisse0.n === caisse1.n, `${caisse0.n} → ${caisse1.n}`);
verifier("8. aucune erreur JavaScript dans les pages", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));
await nettoyer();
await browser.close();
await db.end();
console.log(resultats.join("\n"));
const ko = resultats.filter((x) => x.startsWith("KO")).length;
console.log(`\n${resultats.length} contrôles, ${ko} KO`);
process.exit(ko ? 1 : 0);
