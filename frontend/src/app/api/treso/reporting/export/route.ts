import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";

import { STATUT_DEMANDE_LABEL } from "@/components/tresorerie/demandeStatut";
import { getSession, hasPermission } from "@/lib/auth";
import {
  COLONNES_REPORTING_DEMANDE,
  getReportingDashboardSnapshot,
  getReportingFondsRemis,
  getReportingJournalBanqueDetail,
  getReportingJournalDetail,
  getReportingParDemande,
  getReportingRetoursExternesDetail,
  getReportingRows,
  getReportingSuiviBudgetaire,
  parseReportingFilters,
} from "backend";

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF004B9C" } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" } };

function styleHeaderRow(sheet: ExcelJS.Worksheet) {
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });
}

/**
 * Export Excel multi-feuilles du reporting Trésorerie (Ticket 10).
 * Mêmes query params de filtres et mêmes fonctions de requête
 * (`src/lib/reporting.ts`) que l'écran `treso/finance/reporting` : le
 * classeur téléchargé désigne toujours exactement les mêmes données que ce
 * qui est affiché à l'écran pour un même jeu de filtres.
 *
 * Protégée par `treso.voir_reporting` (401 si non authentifié, 403 sinon).
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new NextResponse("Non authentifié.", { status: 401 });
  }
  if (!hasPermission(session, "treso.voir_reporting")) {
    return new NextResponse("Accès refusé.", { status: 403 });
  }

  const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
  const filters = parseReportingFilters(searchParams);

  const [demandes, journal, rows, fondsRemis, suiviBudgetaire, dashboard, mouvementsBanque, retoursExternes] =
    await Promise.all([
      getReportingParDemande(filters, (statut) => STATUT_DEMANDE_LABEL[statut]),
      getReportingJournalDetail(filters),
      getReportingRows(filters),
      getReportingFondsRemis(filters),
      getReportingSuiviBudgetaire(),
      getReportingDashboardSnapshot(),
      getReportingJournalBanqueDetail(filters),
      getReportingRetoursExternesDetail(filters),
    ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Portail SIM Assurances";
  workbook.created = new Date();

  // Une seule ligne par demande (2026-10-08) : tout ce qui est rattaché à une demande (lignes d'articles, validations,
  // règlements, dépenses, retours, remboursements, ajustements) est regroupé ici, une cellule par nature avec un
  // élément par ligne de la cellule, et les totaux numériques à côté — plus de feuilles séparées par nature. Mêmes
  // colonnes que l'écran (`COLONNES_REPORTING_DEMANDE`).
  const sheetDemandes = workbook.addWorksheet("Demandes", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
  sheetDemandes.columns = COLONNES_REPORTING_DEMANDE.map((c) => ({
    header: c.montant ? `${c.titre} (FCFA)` : c.titre,
    key: c.cle,
    width: c.multi ? 60 : c.montant ? 16 : c.cle === "reference" ? 20 : 18,
    style: c.montant ? { numFmt: "#,##0" } : c.cle === "creeLe" ? { numFmt: "dd/mm/yyyy" } : undefined,
  }));
  for (const d of demandes) {
    const valeurs: Record<string, string | number | Date> = {};
    for (const c of COLONNES_REPORTING_DEMANDE) {
      const v = d[c.cle];
      valeurs[c.cle] = Array.isArray(v) ? (v.length > 0 ? v.join("\n") : "—") : v;
    }
    const ligne = sheetDemandes.addRow(valeurs);
    ligne.alignment = { vertical: "top", wrapText: true };
  }
  styleHeaderRow(sheetDemandes);

  // Mouvements banque (voir CLAUDE.md "Retour sur règlement Banque") : historique
  // de traçabilité, aucun solde.
  const sheetBanque = workbook.addWorksheet("Mouvements banque");
  sheetBanque.columns = [
    { header: "Référence demande", key: "reference", width: 20 },
    { header: "Type", key: "type", width: 14 },
    { header: "Montant (FCFA)", key: "montant", width: 16 },
    { header: "Date", key: "date", width: 14 },
    { header: "Auteur", key: "auteur", width: 22 },
    { header: "Bordereau joint", key: "bordereau", width: 16 },
  ];
  mouvementsBanque.forEach((m) =>
    sheetBanque.addRow({
      reference: m.demandeReference,
      type: m.type === "SORTIE" ? "Sortie" : m.type === "RETOUR" ? "Retour" : "Annulation",
      montant: m.montant,
      date: m.date.toLocaleDateString("fr-FR"),
      auteur: m.auteurNom,
      bordereau: m.bordereau ? "Oui" : "—",
    })
  );
  styleHeaderRow(sheetBanque);

  // Retours externes (voir CLAUDE.md "Retour externe") : feuille distincte,
  // jamais mélangée aux retours de caisse liés à une demande.
  const sheetExternes = workbook.addWorksheet("Retours externes");
  sheetExternes.columns = [
    { header: "Personne", key: "personne", width: 28 },
    { header: "Type", key: "type", width: 16 },
    { header: "Chèque initial déclaré (FCFA)", key: "cheque", width: 26 },
    { header: "Montant retourné (FCFA)", key: "retourne", width: 22 },
    { header: "Motif", key: "motif", width: 40 },
    { header: "Date", key: "date", width: 14 },
    { header: "Enregistré par", key: "auteur", width: 22 },
    { header: "Justificatif du chèque initial", key: "pjCheque", width: 30 },
    { header: "Justificatif du retour", key: "pjRetour", width: 26 },
  ];
  retoursExternes.forEach((r) =>
    sheetExternes.addRow({
      personne: r.personne,
      type: r.estExterne ? "Personne externe" : "Collaborateur",
      cheque: r.montantChequeInitial,
      retourne: r.montantRetourne,
      motif: r.motif,
      date: r.date.toLocaleDateString("fr-FR"),
      auteur: r.auteurNom,
      pjCheque: r.pieceChequeId
        ? { text: "Télécharger", hyperlink: `${request.nextUrl.origin}/api/treso/pieces-jointes/${r.pieceChequeId}` }
        : "—",
      pjRetour: { text: "Télécharger", hyperlink: `${request.nextUrl.origin}/api/treso/pieces-jointes/${r.pieceRetourId}` },
    })
  );
  styleHeaderRow(sheetExternes);

  // Section 15 du cahier des charges : tableau "Fonds remis" dédié, groupé
  // par Catégorie/Objet comme la feuille "Reporting" mais restreint aux
  // demandes ayant au moins un règlement Caisse confirmé (voir
  // `getReportingFondsRemis`, reporting.ts).
  const sheetFondsRemis = workbook.addWorksheet("Fonds remis");
  sheetFondsRemis.columns = [
    { header: "Catégorie", key: "categorie", width: 18 },
    { header: "Objet", key: "objet", width: 26 },
    { header: "Nb. opérations", key: "nombre", width: 16 },
    { header: "Montant demandé (FCFA)", key: "montantDemande", width: 20 },
    { header: "Montant validé (FCFA)", key: "montantValide", width: 20 },
    { header: "Montant remis (FCFA)", key: "montantRemis", width: 20 },
    { header: "Dépenses effectuées (FCFA)", key: "depensesDeclarees", width: 22 },
    { header: "Retours reçus (FCFA)", key: "retoursRecus", width: 20 },
    { header: "Restant à régulariser (FCFA)", key: "restant", width: 24 },
  ];
  fondsRemis.forEach((f) =>
    sheetFondsRemis.addRow({
      categorie: f.categorieLabel,
      objet: f.objetLabel,
      nombre: f.nombreOperations,
      montantDemande: f.montantDemande,
      montantValide: f.montantValide,
      montantRemis: f.montantRemis,
      depensesDeclarees: f.depensesDeclarees,
      retoursRecus: f.retoursRecus,
      restant: f.montantRestantARegulariser,
    })
  );
  styleHeaderRow(sheetFondsRemis);

  const sheetJournal = workbook.addWorksheet("Journal de caisse");
  sheetJournal.columns = [
    { header: "Type", key: "type", width: 12 },
    { header: "Montant (FCFA)", key: "montant", width: 16 },
    { header: "Source", key: "source", width: 28 },
    { header: "Référence demande", key: "reference", width: 20 },
    { header: "Utilisateur", key: "utilisateur", width: 22 },
    { header: "Date", key: "date", width: 14 },
  ];
  journal.forEach((j) =>
    sheetJournal.addRow({
      type: j.type,
      montant: j.montant,
      source: j.source === "retour_externe" ? "Retour externe (hors système)" : j.source,
      reference: j.demandeReference,
      utilisateur: j.userNom,
      date: j.createdAt.toLocaleDateString("fr-FR"),
    })
  );
  styleHeaderRow(sheetJournal);

  // Phase H : "Validé" est désormais la somme de Demande.montantValide
  // (capture les validations partielles) ; "Reste à régler" renommée
  // "Validé restant à régler" et nouvelle colonne "Restant à valider" —
  // voir ReportingRow dans reporting.ts, les deux notions ne se confondent
  // jamais.
  const sheetReporting = workbook.addWorksheet("Reporting");
  sheetReporting.columns = [
    { header: "Catégorie", key: "categorie", width: 18 },
    { header: "Objet", key: "objet", width: 26 },
    { header: "Nb. lignes/demandes", key: "nombre", width: 14 },
    { header: "Demandé (FCFA)", key: "montantDemande", width: 18 },
    { header: "Validé (FCFA)", key: "montantValide", width: 18 },
    { header: "Restant à valider (FCFA)", key: "montantRestantAValider", width: 20 },
    { header: "Réglé (FCFA)", key: "montantRegle", width: 18 },
    { header: "Validé restant à régler (FCFA)", key: "valideResteARegler", width: 24 },
    { header: "Réglé Caisse (FCFA)", key: "montantRegleCaisse", width: 18 },
    { header: "Réglé Banque (FCFA)", key: "montantRegleBanque", width: 18 },
  ];
  rows.forEach((r) =>
    sheetReporting.addRow({
      categorie: r.categorieLabel,
      objet: r.objetLabel,
      nombre: r.nombreDemandes,
      montantDemande: r.montantDemande,
      montantValide: r.montantValide,
      montantRestantAValider: r.montantRestantAValider,
      montantRegle: r.montantRegle,
      valideResteARegler: r.valideResteARegler,
      montantRegleCaisse: r.montantRegleCaisse,
      montantRegleBanque: r.montantRegleBanque,
    })
  );
  const totalMontantDemande = rows.reduce((s, r) => s + r.montantDemande, 0);
  const totalMontantValide = rows.reduce((s, r) => s + r.montantValide, 0);
  const totalMontantRegle = rows.reduce((s, r) => s + r.montantRegle, 0);
  const totalRow = sheetReporting.addRow({
    categorie: "Total général",
    objet: "",
    nombre: rows.reduce((s, r) => s + r.nombreDemandes, 0),
    montantDemande: totalMontantDemande,
    montantValide: totalMontantValide,
    montantRestantAValider: Math.max(0, totalMontantDemande - totalMontantValide),
    montantRegle: totalMontantRegle,
    valideResteARegler: Math.max(0, totalMontantValide - totalMontantRegle),
    montantRegleCaisse: rows.reduce((s, r) => s + r.montantRegleCaisse, 0),
    montantRegleBanque: rows.reduce((s, r) => s + r.montantRegleBanque, 0),
  });
  totalRow.font = { bold: true };
  styleHeaderRow(sheetReporting);

  // Budget PARTAGÉ par Catégorie, décompté au règlement — voir CLAUDE.md
  // "Budget partagé par Catégorie". Volontairement non filtré par les
  // paramètres du reporting (même principe que la feuille "Dashboard") :
  // c'est une enveloppe cumulative, pas une donnée découpable par période.
  const sheetBudget = workbook.addWorksheet("Suivi budgétaire");
  sheetBudget.columns = [
    { header: "Catégorie", key: "categorie", width: 22 },
    { header: "Budget alloué (FCFA)", key: "budget", width: 18 },
    { header: "Consommé - réglé (FCFA)", key: "consomme", width: 20 },
    { header: "Restant (FCFA)", key: "restant", width: 16 },
  ];
  if (suiviBudgetaire.length === 0) {
    const noteRow = sheetBudget.addRow({
      categorie: "Aucune catégorie n'a de budget alloué défini pour l'instant (voir /admin/categories).",
    });
    sheetBudget.mergeCells(noteRow.number, 1, noteRow.number, 4);
    noteRow.getCell(1).alignment = { wrapText: true, vertical: "top" };
    noteRow.getCell(1).font = { italic: true, color: { argb: "FF64748B" } };
    sheetBudget.getRow(noteRow.number).height = 30;
  }
  suiviBudgetaire.forEach((r) => {
    const row = sheetBudget.addRow({
      categorie: r.categorieLabel,
      budget: r.budgetAlloue,
      consomme: r.montantConsomme,
      restant: r.budgetRestant,
    });
    if (r.budgetRestant < 0) {
      row.getCell("restant").font = { bold: true, color: { argb: "FFDA0101" } };
    }
  });
  styleHeaderRow(sheetBudget);

  // Section 16 : instantané des indicateurs du dashboard Finance (Phase G)
  // au moment de l'export — jamais filtré par les paramètres du reporting
  // (voir `getReportingDashboardSnapshot`), ce sont des indicateurs
  // organisationnels globaux, pas des données découpables par période.
  const sheetDashboard = workbook.addWorksheet("Dashboard");
  sheetDashboard.columns = [
    { header: "Indicateur", key: "indicateur", width: 40 },
    { header: "Nombre", key: "nombre", width: 14 },
    { header: "Montant (FCFA)", key: "montant", width: 18 },
  ];
  dashboard.forEach((d) =>
    sheetDashboard.addRow({
      indicateur: d.indicateur,
      nombre: d.nombre ?? "",
      montant: d.montant ?? "",
    })
  );
  styleHeaderRow(sheetDashboard);

  const buffer = await workbook.xlsx.writeBuffer();
  const dateStr = new Date().toISOString().slice(0, 10);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="reporting-tresorerie-${dateStr}.xlsx"`,
    },
  });
}
