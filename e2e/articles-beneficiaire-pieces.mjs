// Autonomie des articles, lot A (2026-10-14) — bénéficiaire et pièces jointes PAR ARTICLE, sur base JETABLE
// (voir e2e/README.md). Demande à 3 articles créée par le VRAI formulaire (collaborateur@) : bloc « Détails communs »,
// « Détails de l'article », badges « Identique aux autres » / « Personnalisé », « Appliquer à tous » avec confirmation,
// pièces propres à l'article ; puis enregistrement en base, affichage chez le demandeur et la Finance, blocage du
// règlement quand les bénéficiaires diffèrent, correction/resoumission qui conserve les détails de chaque article.
import { chromium } from "playwright";
import pg from "pg";

const B = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:pw@localhost:55497/e2e";
if (!/localhost:55497|e2e/.test(DB)) throw new Error("E2E_DATABASE_URL doit viser une base jetable.");

const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const resultats = [];
const verifier = (nom, ok, detail = "") => resultats.push(`${ok ? "OK " : "KO "} ${nom}${detail ? ` — ${detail}` : ""}`);
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const erreursJs = [];
const PDF = (nom) => ({ name: nom, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n") });

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
const uid = async (email) => (await q(`SELECT id FROM "User" WHERE email = $1`, [email]))[0].id;

// Nettoyage des demandes de test d'un lancement précédent.
const anciennes = (await q(`SELECT id FROM "Demande" WHERE reference IN (SELECT reference FROM "Demande" d JOIN "LigneDemande" l ON l."demandeId" = d.id WHERE l.libelle LIKE 'E2E-ART-%')`)).map((r) => r.id);
if (anciennes.length) {
  await q(`DELETE FROM "PieceJointe" WHERE "demandeId" = ANY($1)`, [anciennes]);
  await q(`DELETE FROM "HistoriqueEntry" WHERE "entityId" = ANY($1) OR "entityId" IN (SELECT id FROM "LigneDemande" WHERE "demandeId" = ANY($1))`, [anciennes]);
  await q(`DELETE FROM "Notification" WHERE lien LIKE ANY (SELECT '%' || id || '%' FROM unnest($1::text[]) AS id)`, [anciennes]);
  await q(`DELETE FROM "LigneDemande" WHERE "demandeId" = ANY($1)`, [anciennes]);
  await q(`DELETE FROM "Demande" WHERE id = ANY($1)`, [anciennes]);
}
const idRh = await uid("rh@simassurances.test");
const idCollab = await uid("collaborateur@simassurances.test");

// --- 1. Création par le vrai formulaire -------------------------------------------------------------------------
let demandeId;
{
  const { ctx, p } = await connecter("collaborateur@simassurances.test");
  await p.goto(`${B}/treso/demandes/nouvelle`);
  // 3 articles
  await p.getByRole("button", { name: "Ajouter une ligne" }).click();
  await p.getByRole("button", { name: "Ajouter une ligne" }).click();
  for (const [i, nom] of ["E2E-ART-A", "E2E-ART-B", "E2E-ART-C"].entries()) {
    await p.locator('input[aria-label="Libellé de l\'article"]').nth(i).fill(nom);
    await p.locator('input[aria-label="Motif de la ligne"]').nth(i).fill(`motif de ${nom}`);
    await p.locator('input[aria-label="Prix unitaire"]').nth(i).fill("10000");
  }
  verifier("formulaire : bloc « Détails communs » présent", (await p.getByText("Détails communs").count()) >= 1);
  verifier("formulaire : bouton « Appliquer à tous les articles »", (await p.locator("[data-appliquer-a-tous]").count()) === 1);
  const editeurs = p.locator("[data-details-article-editeur]");
  verifier("formulaire : « Détails de l'article » sous chaque article (3)", (await editeurs.count()) === 3);
  for (let i = 0; i < 3; i++) {
    verifier(`formulaire : article ${i + 1} « Identique aux autres » au départ`, (await editeurs.nth(i).innerText()).includes("Identique aux autres"));
  }

  // Pièce commune (bloc Détails communs)
  await p.locator('input[type="file"]').first().setInputFiles(PDF("commune.pdf"));
  await p.getByText("Fichier envoyé : commune.pdf").waitFor();

  // Article A : bénéficiaire = moi-même (égal à la valeur commune) -> rien ne sera enregistré
  await editeurs.nth(0).getByRole("button", { name: "Détails de l'article" }).click();
  await editeurs.nth(0).getByLabel("Bénéficiaire de cet article").selectOption("MOI");
  verifier("formulaire : article A = valeur commune reste « Identique aux autres »", (await editeurs.nth(0).innerText()).includes("Identique aux autres"));

  // Article B : nom libre -> Personnalisé
  await editeurs.nth(1).getByRole("button", { name: "Détails de l'article" }).click();
  await editeurs.nth(1).getByLabel("Bénéficiaire de cet article").selectOption("NOM");
  await editeurs.nth(1).getByLabel("Nom du bénéficiaire").fill("Papeterie Centrale");
  verifier("formulaire : article B passe à « Personnalisé »", (await editeurs.nth(1).innerText()).includes("Personnalisé"));
  verifier("formulaire : lien « Rétablir la valeur commune » sur B", (await editeurs.nth(1).locator("[data-retablir-commun]").count()) === 1);

  // Article C : un autre compte + 2 pièces propres
  await editeurs.nth(2).getByRole("button", { name: "Détails de l'article" }).click();
  await editeurs.nth(2).getByLabel("Bénéficiaire de cet article").selectOption("COMPTE");
  await editeurs.nth(2).getByLabel("Compte bénéficiaire").selectOption(idRh);
  await editeurs.nth(2).locator('input[type="file"]').setInputFiles(PDF("devis-c1.pdf"));
  await editeurs.nth(2).getByText("devis-c1.pdf").waitFor();
  await editeurs.nth(2).locator('input[type="file"]').setInputFiles(PDF("devis-c2.pdf"));
  await editeurs.nth(2).getByText("devis-c2.pdf").waitFor();
  verifier("formulaire : article C « Personnalisé » avec 2 pièces", (await editeurs.nth(2).innerText()).includes("Personnalisé") && (await editeurs.nth(2).locator("[data-pieces-article-champ] li").count()) === 2);

  // « Appliquer à tous » : confirmation car B et C sont personnalisés ; Annuler garde, Remplacer écrase.
  await p.locator("[data-appliquer-a-tous]").click();
  verifier("« Appliquer à tous » : confirmation demandée (articles personnalisés)", (await p.locator("[data-confirmation-appliquer]").count()) === 1);
  await p.locator("[data-confirmation-appliquer]").getByRole("button", { name: "Annuler" }).click();
  verifier("« Appliquer à tous » annulé : B reste personnalisé", (await editeurs.nth(1).innerText()).includes("Personnalisé"));
  await p.locator("[data-appliquer-a-tous]").click();
  await p.locator("[data-confirmation-appliquer]").getByRole("button", { name: "Remplacer" }).click();
  verifier("« Appliquer à tous » confirmé : B et C « Identique aux autres »",
    (await editeurs.nth(1).innerText()).includes("Identique aux autres") && (await editeurs.nth(2).innerText()).includes("Identique aux autres"));
  verifier("« Appliquer à tous » : les pièces propres de C sont conservées", (await editeurs.nth(2).innerText()).includes("2 pièce(s)"));
  // Sans personnalisation, plus de confirmation.
  await p.locator("[data-appliquer-a-tous]").click();
  verifier("« Appliquer à tous » sans personnalisation : pas de confirmation", (await p.locator("[data-confirmation-appliquer]").count()) === 0);

  // On re-personnalise B (nom libre) et C (compte RH) pour l'enregistrement.
  await editeurs.nth(1).getByLabel("Bénéficiaire de cet article").selectOption("NOM");
  await editeurs.nth(1).getByLabel("Nom du bénéficiaire").fill("Papeterie Centrale");
  await editeurs.nth(2).getByLabel("Bénéficiaire de cet article").selectOption("COMPTE");
  await editeurs.nth(2).getByLabel("Compte bénéficiaire").selectOption(idRh);
  // « Rétablir la valeur commune » sur B puis on re-saisit : le lien remet « Identique ».
  await editeurs.nth(1).locator("[data-retablir-commun]").click();
  verifier("« Rétablir la valeur commune » : B redevient « Identique aux autres »", (await editeurs.nth(1).innerText()).includes("Identique aux autres"));
  await editeurs.nth(1).getByLabel("Bénéficiaire de cet article").selectOption("NOM");
  await editeurs.nth(1).getByLabel("Nom du bénéficiaire").fill("Papeterie Centrale");

  await p.getByRole("button", { name: "Envoyer la demande" }).click();
  await p.getByText("Demande créée avec succès.").waitFor();
  demandeId = (await p.getByRole("link", { name: "Voir ma demande" }).getAttribute("href")).split("/").pop();
  await ctx.close();
}

// --- 2. Enregistrement en base ------------------------------------------------------------------------------------
{
  const lignes = await q(`SELECT libelle, "beneficiaireType", "beneficiaireUserId", "beneficiaireNom", id FROM "LigneDemande" WHERE "demandeId" = $1 ORDER BY libelle`, [demandeId]);
  const [a, b, c] = lignes;
  verifier("base : A (égal à la valeur commune) n'enregistre aucun bénéficiaire propre", a.beneficiaireType === null && a.beneficiaireUserId === null && a.beneficiaireNom === null);
  verifier("base : B = FOURNISSEUR « Papeterie Centrale »", b.beneficiaireType === "FOURNISSEUR" && b.beneficiaireNom === "Papeterie Centrale");
  verifier("base : C = compte RH", c.beneficiaireType === "COLLABORATEUR" && c.beneficiaireUserId === idRh);
  const demande = (await q(`SELECT "beneficiaireUserId" FROM "Demande" WHERE id = $1`, [demandeId]))[0];
  verifier("base : bénéficiaire par défaut de la demande = le créateur (« moi-même »)", demande.beneficiaireUserId === idCollab);
  const pieces = await q(`SELECT "ligneDemandeId" FROM "PieceJointe" WHERE "demandeId" = $1`, [demandeId]);
  verifier("base : 1 pièce commune (sans article) + 2 pièces sur l'article C", pieces.filter((x) => x.ligneDemandeId === null).length === 1 && pieces.filter((x) => x.ligneDemandeId === c.id).length === 2, JSON.stringify(pieces.length));
}

// --- 3. Affichage : demandeur et Finance -------------------------------------------------------------------------
{
  const { ctx, p } = await connecter("collaborateur@simassurances.test");
  await p.goto(`${B}/treso/demandes/${demandeId}`);
  const html = await p.content();
  verifier("demandeur : « Plusieurs bénéficiaires » dans l'en-tête", html.includes("Plusieurs bénéficiaires"));
  verifier("demandeur : bénéficiaire de B affiché sous l'article", (await p.locator("[data-beneficiaire-article]").filter({ hasText: "Papeterie Centrale" }).count()) === 1);
  verifier("demandeur : pièces de C (2 liens) et pièce commune rappelée", (await p.locator("[data-pieces-article] a").count()) === 2 && (await p.locator("[data-pieces-communes]").count()) >= 1);
  await ctx.close();
}
{
  const { ctx, p } = await connecter("finance@simassurances.test");
  await p.goto(`${B}/treso/finance/demandes/${demandeId}`);
  verifier("Finance : « Plusieurs bénéficiaires » et bénéficiaire par article", (await p.content()).includes("Plusieurs bénéficiaires") && (await p.locator("[data-beneficiaire-article]").count()) >= 2);
  await p.goto(`${B}/treso/finance/demandes/toutes`);
  verifier("Finance : la liste « Toutes les demandes » dit « Plusieurs bénéficiaires »", (await p.content()).includes("Plusieurs bénéficiaires"));
  await ctx.close();
}
{
  // Un compte bénéficiaire d'un article peut télécharger les pièces de la demande ; un compte étranger non.
  const piece = (await q(`SELECT id FROM "PieceJointe" WHERE "demandeId" = $1 AND "ligneDemandeId" IS NULL`, [demandeId]))[0].id;
  const { ctx, p } = await connecter("rh@simassurances.test");
  const r = await p.request.get(`${B}/api/treso/pieces-jointes/${piece}`);
  verifier("téléchargement : le bénéficiaire d'un article (rh@) y a accès", r.status() === 200, String(r.status()));
  await ctx.close();
  const autre = await connecter("responsable-technique@simassurances.test");
  const r2 = await autre.p.request.get(`${B}/api/treso/pieces-jointes/${piece}`);
  verifier("téléchargement : un compte étranger reste refusé", r2.status() === 403, String(r2.status()));
  await autre.ctx.close();
}

// --- 4. Règlement bloqué tant que les bénéficiaires diffèrent ---------------------------------------------------
{
  await q(`UPDATE "LigneDemande" SET "statutValidation" = 'VALIDEE', "categorieId" = (SELECT id FROM "Categorie" LIMIT 1) WHERE "demandeId" = $1`, [demandeId]);
  await q(`UPDATE "Demande" SET "montantValide" = montant, statut = 'VALIDEE_NON_REGLEE', "etapeCircuit" = 'TERMINEE' WHERE id = $1`, [demandeId]);
  const { ctx, p } = await connecter("assistant-finance@simassurances.test");
  await p.goto(`${B}/treso/finance/demandes/${demandeId}`);
  await p.getByRole("button", { name: "Ajouter un règlement" }).click();
  await p.locator('input[name="montant"]').fill("1000");
  await p.locator("form").filter({ has: p.locator('input[name="montant"]') }).getByRole("button", { name: /Enregistrer|Créer|Ajouter/ }).first().click();
  await p.waitForTimeout(1500);
  const reglements = (await q(`SELECT count(*)::int AS n FROM "Reglement" WHERE "demandeId" = $1`, [demandeId]))[0].n;
  verifier("règlement : aucun règlement créé (plusieurs bénéficiaires)", reglements === 0);
  verifier("règlement : phrase « plusieurs bénéficiaires » affichée", (await p.content()).includes("plusieurs bénéficiaires"));
  await ctx.close();
}

// --- 5. Correction : les détails de chaque article sont conservés et modifiables -----------------------------------
{
  await q(`UPDATE "Demande" SET "etapeCircuit" = 'A_CORRIGER', "niveauRejet" = 'FINANCE', "motifRejet" = 'à revoir', statut = 'EN_ATTENTE_VALIDATION', "montantValide" = NULL WHERE id = $1`, [demandeId]);
  await q(`UPDATE "LigneDemande" SET "statutValidation" = 'EN_ATTENTE' WHERE "demandeId" = $1`, [demandeId]);
  const { ctx, p } = await connecter("collaborateur@simassurances.test");
  await p.goto(`${B}/treso/demandes/${demandeId}`);
  await p.getByRole("button", { name: "Corriger et resoumettre" }).click();
  const editeurs = p.locator("[data-details-article-editeur]");
  verifier("correction : B et C restent « Personnalisé », A « Identique aux autres »",
    (await editeurs.nth(0).innerText()).includes("Identique aux autres") &&
      (await editeurs.nth(1).innerText()).includes("Personnalisé") &&
      (await editeurs.nth(2).innerText()).includes("Personnalisé"));
  // B repasse à la valeur commune, A reçoit une nouvelle pièce
  await editeurs.nth(1).locator("[data-retablir-commun]").click();
  await editeurs.nth(0).getByRole("button", { name: "Détails de l'article" }).click();
  await editeurs.nth(0).locator('input[type="file"]').setInputFiles(PDF("ajout-a.pdf"));
  await editeurs.nth(0).getByText("ajout-a.pdf").waitFor();
  await p.getByRole("button", { name: "Resoumettre la demande" }).click();
  await p.getByText(/corrigée et resoumise/).first().waitFor();
  const lignes = await q(`SELECT libelle, "beneficiaireType", "beneficiaireUserId" FROM "LigneDemande" WHERE "demandeId" = $1 ORDER BY libelle`, [demandeId]);
  verifier("correction : B n'a plus de bénéficiaire propre, C garde le sien", lignes[1].beneficiaireType === null && lignes[2].beneficiaireUserId === idRh);
  const piecesA = (await q(`SELECT count(*)::int AS n FROM "PieceJointe" p JOIN "LigneDemande" l ON l.id = p."ligneDemandeId" WHERE l."demandeId" = $1 AND l.libelle = 'E2E-ART-A'`, [demandeId]))[0].n;
  const piecesC = (await q(`SELECT count(*)::int AS n FROM "PieceJointe" p JOIN "LigneDemande" l ON l.id = p."ligneDemandeId" WHERE l."demandeId" = $1 AND l.libelle = 'E2E-ART-C'`, [demandeId]))[0].n;
  verifier("correction : pièce ajoutée à A, les 2 pièces de C conservées", piecesA === 1 && piecesC === 2);
  await ctx.close();
}

verifier("aucune erreur JavaScript en console", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));
console.log(resultats.join("\n"));
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles réussis.`);
await browser.close();
await db.end();
process.exit(ko ? 1 : 0);
