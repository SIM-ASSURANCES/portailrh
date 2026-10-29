// Lot F (2026-10-21) — REPORTING ET EXPORT : UN SEUL TABLEAU, de la demande jusqu'au détail de chaque article. Sur base JETABLE (voir
// e2e/README.md). Le classeur Excel est relu avec exceljs (niveaux, formats, total) ; la page est pilotée dans Chromium.
//
// Fixtures (SQL direct) :
//   DEM-LOTF-1 : A (100 000, réglé en CAISSE, dépenses 60 000 + 10 000 sans pièce, retour reçu 30 000), B (100 000, réglé par BANQUE,
//                dépenses 85 000, retour externe rattaché 15 000), C (rejeté) ;
//   DEM-LOTF-2 : devise EUR, 1 article 50 000 réglé 20 000 en caisse (solde 20 000) ;
//   DEM-LOTF-3 : clôturée de force, 1 article validé 40 000 jamais réglé ;
//   DEM-LOTF-4 : « En cours » (un article validé, un en attente) ;
//   un retour externe sans demande (25 000).
// Lot F bis : totaux PAR DEVISE (jamais deux devises additionnées), liens vers les justificatifs des retours externes (seulement pour qui
// peut les télécharger), libellé d'origine du demandeur.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
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
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const erreursJs = [];
const net = (t) => t.replace(/[  ]/g, " ").replace(/\s+/g, " ");
const dossier = mkdtempSync(join(tmpdir(), "lotf-"));
const P = "e2e-lotf-";

const nettoyer = async () => {
  await q(`DELETE FROM "JournalCaisse" WHERE id LIKE '${P}%' OR "demandeId" LIKE '${P}%' OR "refId" IN (SELECT id FROM "RetourExterne" WHERE motif LIKE 'E2E-LF %')`);
  await q(`DELETE FROM "RetourExterne" WHERE motif LIKE 'E2E-LF %'`);
  await q(`DELETE FROM "PieceJointe" WHERE id LIKE '${P}%'`);
  await q(`DELETE FROM "JournalBanque" WHERE id LIKE '${P}%'`);
  await q(`DELETE FROM "DepenseLigne" WHERE "retourCaisseId" LIKE '${P}%'`);
  await q(`DELETE FROM "RetourCaisse" WHERE id LIKE '${P}%'`);
  await q(`DELETE FROM "Reglement" WHERE id LIKE '${P}%'`);
  await q(`DELETE FROM "HistoriqueEntry" WHERE "entityId" LIKE '${P}%'`);
  await q(`DELETE FROM "LigneDemande" WHERE "demandeId" LIKE '${P}%'`);
  await q(`DELETE FROM "Demande" WHERE id LIKE '${P}%'`);
};
await nettoyer();

const uid = async (email) => (await q(`SELECT id FROM "User" WHERE email = $1`, [email]))[0].id;
const idCollab = await uid("collaborateur@simassurances.test");
const idFinance = await uid("finance@simassurances.test");
const idAssistant = await uid("assistant-finance@simassurances.test");
const sessions = new Map();
async function connecter(email) {
  let ctx = sessions.get(email);
  if (!ctx) {
    ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.9.9.9" } });
    const c = await ctx.newPage();
    c.on("pageerror", (e) => erreursJs.push(e.message));
    await c.goto(`${B}/login`);
    await c.fill('input[name="email"]', email);
    await c.fill('input[name="password"]', "password123");
    await Promise.all([c.waitForURL((u) => !u.pathname.startsWith("/login")), c.click('button[type="submit"]')]);
    await c.close();
    sessions.set(email, ctx);
  }
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(e.message));
  return p;
}

// ---------------------------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------------------------
await q(`INSERT INTO "Categorie"(id, label, "isActive") VALUES ('e2e-lotf-cat', 'E2E-LF-CAT', true) ON CONFLICT (id) DO NOTHING`);
const demande = (id, ref, { montant, valide, statut, devise = "XOF", extra = "" }) =>
  q(
    `INSERT INTO "Demande"(id, reference, montant, "montantValide", statut, "createurId", "updatedAt", "beneficiaireType", "beneficiaireUserId", "etapeCircuit", "etapeFinanceRequise", "etapeServiceRequise", "modeEtapeDG", description, devise${extra ? ", " + extra.split("|")[0] : ""})
     VALUES ($1, $2, $3, $4, $5, $6, now(), 'COLLABORATEUR', $6, 'TERMINEE', true, false, 'OPTIONNELLE', 'test e2e lot F', $7${extra ? ", " + extra.split("|")[1] : ""})`,
    [id, ref, montant, valide, statut, idCollab, devise]
  );
const article = (id, demandeId, libelle, montant, statutValidation, motifRejet = null) =>
  q(
    `INSERT INTO "LigneDemande"(id, libelle, "libelleOriginal", quantite, "prixUnitaire", "demandeId", "categorieId", motif, "statutValidation", "decideParId", "decideAt", "decideurFinanceId", "motifRejet")
     VALUES ($1, $2, $2, 1, $3, $4, 'e2e-lotf-cat', 'motif', $5::"StatutLigneDemande", $6, ${statutValidation === "EN_ATTENTE" ? "NULL" : "now()"}, ${statutValidation === "VALIDEE" ? "$6" : "NULL"}, $7)`,
    [id, libelle, montant, demandeId, statutValidation, statutValidation === "EN_ATTENTE" ? null : idFinance, motifRejet]
  );
const reglement = (id, demandeId, ligneId, montant, mode) =>
  q(`INSERT INTO "Reglement"(id, montant, mode, "estConfirme", "demandeId", "ligneDemandeId", "auteurId", "confirmeAt") VALUES ($1, $2, $3::"ModeReglement", true, $4, $5, $6, now())`, [id, montant, mode, demandeId, ligneId, idAssistant]);

// DEM-LOTF-1
await demande(`${P}1`, "DEM-LOTF-1", { montant: 300000, valide: 200000, statut: "PARTIELLEMENT_REGLEE" });
await article(`${P}1A`, `${P}1`, "Article A caisse", 100000, "VALIDEE");
await article(`${P}1B`, `${P}1`, "Article B banque", 100000, "VALIDEE");
await article(`${P}1C`, `${P}1`, "Article C rejeté", 100000, "REJETEE", "hors budget");
await q(`UPDATE "LigneDemande" SET "libelleDemandeur" = 'Ordinateur portable (version demandeur)' WHERE id = $1`, [`${P}1A`]);
await reglement(`${P}rA`, `${P}1`, `${P}1A`, 100000, "CAISSE");
await reglement(`${P}rB`, `${P}1`, `${P}1B`, 100000, "BANQUE");
await q(`INSERT INTO "JournalBanque"(id, type, montant, "reglementId", "creeParId") VALUES ($1, 'SORTIE', 100000, $2, $3)`, [`${P}jb`, `${P}rB`, idAssistant]);
await q(`INSERT INTO "RetourCaisse"(id, "montantARetourner", "estReceptionne", "reglementId", "declarantId", "receptionneParId", "receptionneAt") VALUES ($1, 30000, true, $2, $3, $4, now())`, [`${P}retA`, `${P}rA`, idCollab, idAssistant]);
await q(`INSERT INTO "DepenseLigne"(id, montant, objet, date, justification, "retourCaisseId") VALUES ($1, 60000, 'Ramettes', now(), 'FACTURE', $2)`, [`${P}dA1`, `${P}retA`]);
await q(`INSERT INTO "DepenseLigne"(id, montant, objet, date, justification, "motifNonJustifie", "retourCaisseId") VALUES ($1, 10000, 'Transport', now(), 'SANS_PIECE', 'ticket perdu', $2)`, [`${P}dA2`, `${P}retA`]);
await q(`INSERT INTO "RetourCaisse"(id, "montantARetourner", "estReceptionne", "reglementId", "declarantId", "creeParAssistant") VALUES ($1, 15000, false, $2, $3, true)`, [`${P}ficheB`, `${P}rB`, idAssistant]);
await q(`INSERT INTO "DepenseLigne"(id, montant, objet, date, justification, "retourCaisseId") VALUES ($1, 85000, 'Prestation', now(), 'FACTURE', $2)`, [`${P}dB`, `${P}ficheB`]);
await q(`INSERT INTO "PieceJointe"(id, url) VALUES ($1, 'e2e-lotf-pj1'), ($2, 'e2e-lotf-pj2'), ($3, 'e2e-lotf-pj3')`, [`${P}pj1`, `${P}pj2`, `${P}pj3`]);
await q(`INSERT INTO "RetourExterne"(id, "collaborateurId", "montantChequeInitial", "montantRetourne", motif, "pieceJointeId", "pieceJointeChequeId", "demandeId", "ligneDemandeId", "creeParId") VALUES ($1, $2, 100000, 15000, 'E2E-LF rattaché', $3, $4, $5, $6, $7)`, [`${P}rx1`, idCollab, `${P}pj1`, `${P}pj2`, `${P}1`, `${P}1B`, idFinance]);
await q(`INSERT INTO "JournalCaisse"(id, type, montant, source, "refId", "userId", "demandeId") VALUES ($1, 'ENTREE', 15000, 'retour_externe', $2, $3, $4)`, [`${P}jc1`, `${P}rx1`, idFinance, `${P}1`]);
// DEM-LOTF-2 : EUR
await demande(`${P}2`, "DEM-LOTF-2", { montant: 50000, valide: 50000, statut: "PARTIELLEMENT_REGLEE", devise: "EUR" });
await article(`${P}2A`, `${P}2`, "Article EUR", 50000, "VALIDEE");
await reglement(`${P}rE`, `${P}2`, `${P}2A`, 20000, "CAISSE");
// DEM-LOTF-3 : clôturée de force
const instantane = JSON.stringify([{ ligneId: `${P}3A`, libelle: "Article jamais réglé", beneficiaire: "Collaborateur Test", montantValide: 40000, resteARegler: 40000, solde: 0, manques: ["reste à régler"] }]);
await demande(`${P}3`, "DEM-LOTF-3", {
  montant: 40000,
  valide: 40000,
  statut: "CLOTUREE",
  extra: `"motifCloture", "clotureForcee", "clotureForceeAt", "clotureForceeParId", "clotureForceeArticles"|'fournisseur disparu, dossier abandonné', true, now(), '${idFinance}', '${instantane}'::jsonb`,
});
await article(`${P}3A`, `${P}3`, "Article jamais réglé", 40000, "VALIDEE");
// DEM-LOTF-4 : en cours
await demande(`${P}4`, "DEM-LOTF-4", { montant: 80000, valide: 40000, statut: "PARTIELLEMENT_VALIDEE" });
await article(`${P}4A`, `${P}4`, "Article validé", 40000, "VALIDEE");
await article(`${P}4B`, `${P}4`, "Article en attente", 40000, "EN_ATTENTE");
// Retour externe sans demande
await q(`INSERT INTO "RetourExterne"(id, "nomExterne", "montantChequeInitial", "montantRetourne", motif, "pieceJointeId", "creeParId") VALUES ($1, 'Client Hors Demande', 25000, 25000, 'E2E-LF hors demande', $2, $3)`, [`${P}rx2`, `${P}pj3`, idFinance]);

const f = await connecter("finance@simassurances.test");

// ---------------------------------------------------------------------------------------------------------------------
// 1. EXPORT EXCEL
// ---------------------------------------------------------------------------------------------------------------------
const rep = await f.request.get(`${B}/api/treso/reporting/export`);
verifier("1. export : 200 et classeur xlsx", rep.status() === 200 && /spreadsheetml/.test(rep.headers()["content-type"] ?? ""));
const fichier = join(dossier, "export.xlsx");
writeFileSync(fichier, await rep.body());
const classeur = new ExcelJS.Workbook();
await classeur.xlsx.readFile(fichier);
const noms = classeur.worksheets.map((w) => w.name);
verifier("1. feuilles : « Reporting » et « Journal de caisse » présentes", noms.includes("Reporting") && noms.includes("Journal de caisse"), noms.join(" | "));
verifier("1. anciennes feuilles supprimées (Demandes, Retours de caisse, Mouvements banque, Retours externes, Fonds remis)", !["Demandes", "Retours de caisse", "Mouvements banque", "Retours externes", "Fonds remis"].some((n) => noms.includes(n)));
const ws = classeur.getWorksheet("Reporting");
const entetes = ws.getRow(1).values.slice(1);
const col = (titre) => entetes.indexOf(titre) + 1;
verifier("1. colonnes communes : Type de ligne, Compte dans les totaux, Référence demande, Article", ["Type de ligne", "Compte dans les totaux", "Référence demande", "Article"].every((t) => col(t) > 0), entetes.slice(0, 5).join(", "));
const vue = ws.views[0] ?? {};
verifier("1. volets figés : en-tête + 2 premières colonnes", vue.state === "frozen" && vue.xSplit === 2 && vue.ySplit === 1, JSON.stringify(vue));
verifier("1. filtre automatique sur l'en-tête", !!ws.autoFilter);
verifier("1. regroupement : synthèse au-dessus du détail", ws.properties?.outlineProperties?.summaryBelow === false);

const lignes = [];
ws.eachRow((row, n) => {
  if (n === 1) return;
  const type = row.getCell(col("Type de ligne")).value;
  if (type == null) return;
  lignes.push({ n, row, type: String(type), ref: row.getCell(col("Référence demande")).value, article: row.getCell(col("Article")).value, niveau: row.outlineLevel ?? 0 });
});
const donnees = lignes.filter((l) => !l.type.startsWith("Total"));
const typeNiveau = { Demande: 0, Article: 1 };
verifier("1. niveaux : Demande = 0, Article = 1, tous les événements = 2", donnees.every((l) => l.niveau === (typeNiveau[l.type] ?? (l.ref ? 2 : 0))), donnees.filter((l) => l.niveau !== (typeNiveau[l.type] ?? (l.ref ? 2 : 0))).map((l) => `${l.type}:${l.niveau}`).join(","));
verifier("1. référence demande et article répétés sur chaque ligne (hors retour externe sans demande)", donnees.filter((l) => l.ref).every((l) => String(l.article ?? "") !== ""));
const dem = (ref) => donnees.find((l) => l.type === "Demande" && l.ref === ref);
const val = (l, titre) => l.row.getCell(col(titre)).value;
const num = (l, titre) => Number(val(l, titre) ?? 0);
const R = "Réglé = fonds remis (Caisse + Banque)";
const d1 = dem("DEM-LOTF-1");
verifier("1. DEM-LOTF-1 : 3 articles, demandé 300 000, validé 200 000, réglé 200 000 (caisse 100 000 + banque 100 000)", !!d1 && num(d1, "Nb. articles") === 3 && num(d1, "Demandé") === 300000 && num(d1, "Validé") === 200000 && num(d1, R) === 200000 && num(d1, "Dont Caisse") === 100000 && num(d1, "Dont Banque") === 100000);
verifier("1. DEM-LOTF-1 : dépensé 155 000, retourné 45 000 (30 000 + 15 000 retour externe), solde 0", num(d1, "Dépensé") === 155000 && num(d1, "Retourné") === 45000 && num(d1, "Solde à régulariser") === 0);
const arts1 = donnees.filter((l) => l.type === "Article" && l.ref === "DEM-LOTF-1");
const A = arts1.find((l) => l.article === "Article A caisse");
const Bb = arts1.find((l) => l.article === "Article B banque");
const C = arts1.find((l) => l.article === "Article C rejeté");
verifier("1. article A : réglé caisse 100 000, dépensé 70 000, retourné 30 000, solde 0", !!A && num(A, R) === 100000 && num(A, "Dont Caisse") === 100000 && num(A, "Dépensé") === 70000 && num(A, "Retourné") === 30000 && num(A, "Solde à régulariser") === 0);
verifier("1. article B : réglé banque 100 000 (jamais en caisse), dépensé 85 000, retour externe 15 000, solde 0", !!Bb && num(Bb, R) === 100000 && num(Bb, "Dont Caisse") === 0 && num(Bb, "Dont Banque") === 100000 && num(Bb, "Dépensé") === 85000 && num(Bb, "Retourné") === 15000 && num(Bb, "Solde à régulariser") === 0);
verifier("1. article C : rejeté, aucun montant réglé", !!C && /Rejeté/.test(String(val(C, "Statut"))) && num(C, R) === 0);
verifier("1. Σ des articles = la demande (réglé, dépensé, retourné, solde)", [R, "Dépensé", "Retourné", "Solde à régulariser"].every((t) => arts1.reduce((s, a) => s + num(a, t), 0) === num(d1, t)));
const evts = (nom) => donnees.filter((l) => l.ref === "DEM-LOTF-1" && l.article === nom && !["Demande", "Article"].includes(l.type)).map((l) => l.type);
verifier("1. événements sous l'article A : règlement, retour de caisse, 2 dépenses", JSON.stringify(evts("Article A caisse")) === JSON.stringify(["Règlement / fonds remis", "Retour de caisse", "Dépense", "Dépense"]), evts("Article A caisse").join(", "));
verifier("1. événements sous l'article B : règlement, mouvement banque, retour (fiche), dépense, retour externe", JSON.stringify(evts("Article B banque")) === JSON.stringify(["Règlement / fonds remis", "Mouvement banque", "Retour de caisse", "Dépense", "Retour externe"]), evts("Article B banque").join(", "));
const pos = (l) => donnees.indexOf(l);
verifier("1. ordre : demande, ses articles, sous chacun ses événements (contigus)", pos(d1) < pos(A) && pos(A) < pos(Bb) && pos(Bb) < pos(C) && donnees.slice(pos(A) + 1, pos(Bb)).every((l) => l.niveau === 2));
const dep = donnees.find((l) => l.type === "Dépense" && l.article === "Article A caisse" && /Transport/.test(String(val(l, "Motif / justification / détail"))));
verifier("1. dépense sans pièce : justification et motif Finance dans la ligne", !!dep && /Sans pièce formelle/.test(String(val(dep, "Statut"))) && /ticket perdu/.test(String(val(dep, "Motif / justification / détail"))));
const sans = donnees.find((l) => l.type === "Retour externe" && l.ref == null);
verifier("1. retour externe sans demande : ligne « Hors demande » de 25 000, hors totaux", !!sans && sans.article === "Hors demande" && num(sans, "Montant de l'opération") === 25000 && val(sans, "Compte dans les totaux") === "Non");

const d2 = dem("DEM-LOTF-2");
verifier("1. devise : EUR sur toutes les lignes de DEM-LOTF-2, solde 20 000", !!d2 && donnees.filter((l) => l.ref === "DEM-LOTF-2").every((l) => val(l, "Devise") === "EUR") && num(d2, "Solde à régulariser") === 20000);
const d3 = dem("DEM-LOTF-3");
const a3 = donnees.find((l) => l.type === "Article" && l.ref === "DEM-LOTF-3");
const cl = (l) => String(val(l, "Clôture sans régularisation") ?? "");
verifier("1. clôture forcée : mention, motif et articles sur la demande", !!d3 && /Clôturée de force/.test(cl(d3)) && /fournisseur disparu, dossier abandonné/.test(cl(d3)) && /Article jamais réglé/.test(cl(d3)));
verifier("1. clôture forcée : article jamais réglé = « reste à régler 40 000 FCFA » (pas « solde restant 0 »)", !!a3 && /reste à régler 40[\s  ]000 FCFA/.test(cl(a3)) && !/solde restant 0/.test(cl(a3)), a3 ? cl(a3) : "");
const d4 = dem("DEM-LOTF-4");
verifier("1. demande en cours : « En cours (1/2 traité) »", !!d4 && /^En cours \(1\/2 traité\)$/.test(String(val(d4, "Statut"))), d4 ? String(val(d4, "Statut")) : "");

// Totaux PAR DEVISE (lot F bis)
const lignesTotal = lignes.filter((l) => l.type.startsWith("Total"));
const devisesDonnees = [...new Set(donnees.filter((l) => l.type === "Demande").map((l) => String(val(l, "Devise"))))].sort();
verifier("1. une ligne de total par devise présente (EUR et XOF), libellées « Total EUR » / « Total XOF »", devisesDonnees.includes("EUR") && devisesDonnees.includes("XOF") && lignesTotal.map((l) => l.type).join("|") === devisesDonnees.map((d) => `Total ${d}`).join("|"), lignesTotal.map((l) => l.type).join("|"));
const sommeDemandes = (t, devise) => Math.round(donnees.filter((l) => l.type === "Demande" && String(val(l, "Devise")) === devise).reduce((s, l) => s + num(l, t), 0) * 100) / 100;
// ExcelJS ne relit pas un résultat en cache égal à 0 (le XML contient bien <v>0</v>) : absent = 0.
const resultat = (c) => (c && typeof c === "object" ? Number(c.result ?? 0) : Number(c ?? 0));
const cellTotal = (devise, t) => lignesTotal.find((l) => l.type === `Total ${devise}`).row.getCell(col(t)).value;
const formuleOk = devisesDonnees.every((dv) => { const c = cellTotal(dv, R); return c && typeof c === "object" && /SUMIFS/.test(c.formula) && c.formula.includes(`"${dv}"`) && c.formula.includes('"Oui"') && resultat(c) === sommeDemandes(R, dv); });
verifier("1. chaque total : formule SUMIFS sur « Compte dans les totaux = Oui » ET sur la devise, résultat exact", formuleOk, JSON.stringify(cellTotal("EUR", R)));
const ecartsTotaux = devisesDonnees.flatMap((dv) => [R, "Dépensé", "Retourné", "Solde à régulariser", "Demandé"].filter((t) => resultat(cellTotal(dv, t)) !== sommeDemandes(t, dv)).map((t) => `${dv}/${t}: ${JSON.stringify(cellTotal(dv, t))} vs ${sommeDemandes(t, dv)}`));
verifier("1. totaux par devise = somme des seules lignes Demande de CETTE devise (réglé, dépensé, retourné, solde, demandé)", ecartsTotaux.length === 0, ecartsTotaux.join(" ; "));
verifier("1. les devises ne sont JAMAIS additionnées : total EUR ≠ total toutes devises, DEM-LOTF-2 (EUR, 20 000 réglés) n'entre pas dans le total XOF", sommeDemandes(R, "EUR") >= 20000 && Number(cellTotal("XOF", R).result) === sommeDemandes(R, "XOF") && Number(cellTotal("XOF", R).result) !== sommeDemandes(R, "XOF") + sommeDemandes(R, "EUR"));
verifier("1. un seul « Oui » par demande : aucune ligne Article/événement ne compte dans les totaux", donnees.every((l) => (val(l, "Compte dans les totaux") === "Oui") === (l.type === "Demande")));

// Libellé d'origine et justificatifs (lot F bis)
const articleA = donnees.find((l) => l.type === "Article" && l.article === "Article A caisse");
verifier("1. libellé d'origine du demandeur sur la ligne Article (« Ordinateur portable (version demandeur) »), vide sur les autres types", String(val(articleA, "Libellé d'origine (demandeur)")) === "Ordinateur portable (version demandeur)" && donnees.filter((l) => l.type !== "Article" && l.type !== "Total général").every((l) => !val(l, "Libellé d'origine (demandeur)")));
const exLiens = donnees.find((l) => l.type === "Retour externe" && l.ref === "DEM-LOTF-1");
const lien = (l, titre) => { const v = val(l, titre); return v && typeof v === "object" ? v.hyperlink : null; };
verifier("1. retour externe rattaché : liens « Télécharger » vers le justificatif du retour et du chèque (route de téléchargement existante)", lien(exLiens, "Justificatif du retour") === `${B}/api/treso/pieces-jointes/${P}pj1` && lien(exLiens, "Justificatif du chèque initial") === `${B}/api/treso/pieces-jointes/${P}pj2`, JSON.stringify(val(exLiens, "Justificatif du retour")));
verifier("1. retour externe sans demande : lien du justificatif du retour (pas de chèque), aucun autre type de ligne n'a de lien", !!lien(sans, "Justificatif du retour") && donnees.filter((l) => l.type !== "Retour externe").every((l) => !val(l, "Justificatif du retour") && !val(l, "Justificatif du chèque initial")));
const dlFinance = await f.request.get(lien(exLiens, "Justificatif du retour"));
verifier("1. le lien est ouvrable par Finance (droit creer_retour_externe) : la route ne refuse pas", ![401, 403].includes(dlFinance.status()), String(dlFinance.status()));

// Formats
const montants = [R, "Dépensé", "Retourné", "Solde à régulariser", "Demandé", "Montant de l'opération"];
verifier("1. montants NUMÉRIQUES (pas du texte) avec séparateur de milliers", donnees.filter((l) => l.type !== "Total général").every((l) => montants.every((t) => { const c = l.row.getCell(col(t)); return c.value == null || (typeof c.value === "number" && /#,##0/.test(c.numFmt ?? "")); })));
verifier("1. dates : vraies dates au format jj/mm/aaaa", (() => { const c = d1.row.getCell(col("Demande créée le")); return c.value instanceof Date && /dd\/mm\/yyyy/.test(c.numFmt ?? ""); })());
const motifCol = col("Motif / justification / détail");
let multiligne = 0;
let hauteurExcessive = 0;
let wrapHorsMotif = 0;
for (const l of lignes) {
  l.row.eachCell((cell, c) => {
    if (typeof cell.value === "string" && cell.value.includes("\n")) multiligne += 1;
    if (cell.alignment?.wrapText && c !== motifCol) wrapHorsMotif += 1;
  });
  if ((l.row.height ?? 0) > 40) hauteurExcessive += 1;
}
verifier("1. aucune cellule multi-ligne, aucune hauteur de ligne excessive, retour à la ligne seulement dans « Motif »", multiligne === 0 && hauteurExcessive === 0 && wrapHorsMotif === 0, `${multiligne}/${hauteurExcessive}/${wrapHorsMotif}`);
const journal = classeur.getWorksheet("Journal de caisse");
verifier("1. « Journal de caisse » conservé (audit) avec l'écriture du retour externe rattaché", (() => { let trouve = false; journal.eachRow((r) => { if (/Retour externe/.test(String(r.getCell(3).value)) && Number(r.getCell(2).value) === 15000) trouve = true; }); return trouve; })());
const lignesTotalDonnees = donnees.length;

// Filtres appliqués à l'export (mêmes filtres que la page)
const filtre = await f.request.get(`${B}/api/treso/reporting/export?statut=CLOTUREE`);
const cf = new ExcelJS.Workbook();
await cf.xlsx.load(await filtre.body());
const refsFiltrees = new Set();
cf.getWorksheet("Reporting").eachRow((r, n) => { const ref = r.getCell(col("Référence demande")).value; if (n > 1 && ref) refsFiltrees.add(String(ref)); });
verifier("1. filtre statut=CLOTUREE : seulement les demandes clôturées (DEM-LOTF-3), pas de retour externe sans demande", refsFiltrees.has("DEM-LOTF-3") && !refsFiltrees.has("DEM-LOTF-1") && !refsFiltrees.has("DEM-LOTF-2"));
const colPrefiltre = await f.request.get(`${B}/api/treso/reporting/export?statut=CLOTUREE`);
const nbSansDemande = (() => { let n = 0; cf.getWorksheet("Reporting").eachRow((r, i) => { if (i > 1 && r.getCell(col("Article")).value === "Hors demande") n += 1; }); return n; })();
const totauxFiltre = [];
cf.getWorksheet("Reporting").eachRow((r, n) => { const t = r.getCell(col("Type de ligne")).value; if (n > 1 && typeof t === "string" && t.startsWith("Total")) totauxFiltre.push(t); });
verifier("1. une seule devise dans l'export (filtre) : une seule ligne « Total général »", totauxFiltre.length === 1 && totauxFiltre[0] === "Total général", totauxFiltre.join("|"));
verifier("1. filtre statut : le retour externe sans demande n'apparaît pas", nbSansDemande === 0 && colPrefiltre.status() === 200);
// DG : voit le reporting (treso.voir_reporting) mais n'a PAS le droit de télécharger les justificatifs d'un retour externe → aucun lien.
{
  const dg = await connecter("dg@simassurances.test");
  const exDg = await dg.request.get(`${B}/api/treso/reporting/export`);
  const cdg = new ExcelJS.Workbook();
  await cdg.xlsx.load(await exDg.body());
  const wdg = cdg.getWorksheet("Reporting");
  let externes = 0;
  let avecLien = 0;
  wdg.eachRow((r, n) => {
    if (n > 1 && r.getCell(col("Type de ligne")).value === "Retour externe") {
      externes += 1;
      if (r.getCell(col("Justificatif du retour")).value || r.getCell(col("Justificatif du chèque initial")).value) avecLien += 1;
    }
  });
  verifier("1. DG (sans droit sur les justificatifs) : mêmes lignes de retour externe, mais AUCUN lien dans l'export", exDg.status() === 200 && externes >= 2 && avecLien === 0, `${externes}/${avecLien}`);
  const dlDg = await dg.request.get(`${B}/api/treso/pieces-jointes/${P}pj1`);
  verifier("1. droits inchangés : la route refuse toujours le DG (403)", dlDg.status() === 403, String(dlDg.status()));
  await dg.goto(`${B}/treso/finance/reporting`);
  await dg.locator("[data-deplier-tout]").click();
  verifier("2. page du DG : lignes de retour externe visibles, aucun lien « Télécharger »", (await dg.locator('table[data-reporting-arbre] tr[data-type="RETOUR_EXTERNE"]').count()) >= 2 && (await dg.locator("a[data-justificatif]").count()) === 0);
  await dg.close();
}
const collab = await connecter("collaborateur@simassurances.test");
const refus = await collab.request.get(`${B}/api/treso/reporting/export`);
verifier("1. permissions inchangées : export refusé au collaborateur", refus.status() === 403);
await collab.close();

// ---------------------------------------------------------------------------------------------------------------------
// 2. PAGE : demande dépliable → articles → événements
// ---------------------------------------------------------------------------------------------------------------------
await f.goto(`${B}/treso/finance/reporting`);
const tableau = f.locator("table[data-reporting-arbre]");
await tableau.waitFor();
const visibles = async (niveau) => tableau.locator(`tbody tr[data-niveau="${niveau}"]`).count();
verifier("2. à l'ouverture : seules les demandes sont visibles (articles et événements repliés)", (await visibles(0)) >= 5 && (await visibles(1)) === 0 && (await visibles(2)) === 0, `${await visibles(0)} niveau 0`);
const ligneDemande = tableau.locator('tbody tr[data-niveau="0"][data-ref="DEM-LOTF-1"]');
await ligneDemande.locator("[data-toggle]").click();
const articlesVisibles = tableau.locator('tbody tr[data-niveau="1"][data-ref="DEM-LOTF-1"]');
verifier("2. déplier la demande : ses 3 articles apparaissent, pas d'événements", (await articlesVisibles.count()) === 3 && (await tableau.locator('tbody tr[data-niveau="2"]').count()) === 0);
await tableau.locator('tbody tr[data-niveau="1"][data-article="Article B banque"] [data-toggle]').click();
const typesB = await tableau.locator('tbody tr[data-niveau="2"][data-article="Article B banque"]').evaluateAll((trs) => trs.map((t) => t.getAttribute("data-type")));
verifier("2. déplier l'article B : règlement, mouvement banque, retour de caisse, dépense, retour externe", JSON.stringify(typesB) === JSON.stringify(["REGLEMENT", "MOUVEMENT_BANQUE", "RETOUR_CAISSE", "DEPENSE", "RETOUR_EXTERNE"]), typesB.join(","));
await tableau.locator('tbody tr[data-niveau="0"][data-ref="DEM-LOTF-1"] [data-toggle]').click();
verifier("2. replier la demande masque articles et événements", (await articlesVisibles.count()) === 0 && (await tableau.locator('tbody tr[data-niveau="2"]').count()) === 0);
await f.locator("[data-deplier-tout]").click();
const nbPage = await tableau.locator("tbody tr").count();
verifier("2. « Tout déplier » : autant de lignes que l'export Excel (mêmes filtres, mêmes lignes)", nbPage === lignesTotalDonnees, `${nbPage} vs ${lignesTotalDonnees}`);
const fmt = (n) => Math.round(n).toLocaleString("fr-FR").replace(/[\u202f\u00a0]/g, " ");
const totauxPage = {};
for (const dv of devisesDonnees) totauxPage[dv] = net(await tableau.locator(`tfoot tr[data-total-devise="${dv}"]`).innerText());
verifier("2. page : une ligne de total par devise, égale à celle de l'export (réglé)", devisesDonnees.every((dv) => totauxPage[dv].includes(`Total ${dv}`) && totauxPage[dv].includes(fmt(Number(cellTotal(dv, R).result)))), JSON.stringify(totauxPage));
verifier("2. page : libellé d'origine visible sur l'article, liens « Télécharger » des justificatifs du retour externe (Finance)", (await tableau.locator('tbody tr[data-niveau="1"]', { hasText: "Ordinateur portable (version demandeur)" }).count()) === 1 && (await tableau.locator("tbody a[data-justificatif]").count()) >= 2);
const texteDemandes = net(await tableau.locator('tbody tr[data-niveau="0"][data-ref="DEM-LOTF-3"]').innerText());
verifier("2. clôture forcée visible sur la ligne de la demande", /Clôturée de force/.test(texteDemandes) && /fournisseur disparu/.test(texteDemandes));
await f.locator("[data-replier-tout]").click();
verifier("2. « Tout replier » ramène aux seules demandes", (await visibles(1)) === 0 && (await visibles(2)) === 0);
// Mêmes filtres que l'export
await f.goto(`${B}/treso/finance/reporting?statut=CLOTUREE`);
const refsPage = await f.locator('table[data-reporting-arbre] tbody tr[data-niveau="0"]').evaluateAll((trs) => trs.map((t) => t.getAttribute("data-ref")));
verifier("2. filtre statut=CLOTUREE sur la page : mêmes demandes que l'export filtré", JSON.stringify([...new Set(refsPage)].sort()) === JSON.stringify([...refsFiltrees].sort()), refsPage.join(","));
verifier("2. synthèse par catégorie et suivi budgétaire conservés", /Synthèse par catégorie/.test(await f.locator("main").innerText()) && (await f.locator("#suivi-budgetaire").count()) === 1);

// ---------------------------------------------------------------------------------------------------------------------
// 3. COHÉRENCE avec l'écran de la demande (mêmes chiffres : agrégats de la régularisation)
// ---------------------------------------------------------------------------------------------------------------------
for (const [id, ref] of [[`${P}1`, "DEM-LOTF-1"], [`${P}2`, "DEM-LOTF-2"]]) {
  await f.goto(`${B}/treso/finance/demandes/${id}`);
  const bloc = f.locator("[data-regularisation-total]");
  const lu = async (libelle) => {
    const txt = net(await bloc.locator(`dt:has-text("${libelle}") + dd`).first().innerText());
    return Number(txt.replace(/FCFA/, "").replace(/\s/g, "").replace(",", "."));
  };
  const l = dem(ref);
  verifier(`3. ${ref} : fonds remis, retours reçus et solde de l'écran = ligne Demande du reporting`, (await lu("Fonds remis")) === num(l, R) && (await lu("Retours reçus")) === num(l, "Retourné") && (await lu("Solde à régulariser")) === num(l, "Solde à régulariser"));
  verifier(`3. ${ref} : dépenses justifiées + sans pièce formelle + reste non détaillé = « Dépensé » ou reste (cohérence arithmétique)`, (await lu("Dépenses justifiées")) + (await lu("Dépenses sans pièce formelle")) === num(l, "Dépensé"));
}

// Caisse intacte : lecture seule
const sortiesLF = await q(`SELECT COUNT(*)::int AS n FROM "JournalCaisse" WHERE id LIKE '${P}%'`);
verifier("4. lecture seule : le journal de caisse n'a reçu aucune écriture du reporting (seule la fixture)", sortiesLF[0].n === 1);

await nettoyer();
await browser.close();
await db.end();
console.log(resultats.join("\n"));
console.log(`\nErreurs JavaScript de la page : ${erreursJs.length}${erreursJs.length ? "\n" + erreursJs.join("\n") : ""}`);
const ko = resultats.filter((r) => r.startsWith("KO")).length;
console.log(`\n${resultats.length - ko}/${resultats.length} contrôles réussis`);
process.exit(ko > 0 || erreursJs.length > 0 ? 1 : 0);
