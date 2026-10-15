import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";

import { STATUT_DEMANDE_LABEL } from "@/components/tresorerie/demandeStatut";
import { getSession, hasPermission } from "@/lib/auth";
import { ajouterFeuilleReporting } from "@/lib/reportingArbreExcel";
import {
  getReportingArbre,
  getReportingDashboardSnapshot,
  getReportingJournalDetail,
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
 * Export Excel du reporting Trésorerie : « Reporting » (tableau unique, lot F), « Journal de caisse » (audit), « Synthèse par
 * catégorie », « Suivi budgétaire » et « Dashboard ».
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

  const [arbre, journal, rows, suiviBudgetaire, dashboard] = await Promise.all([
    getReportingArbre(filters, (statut) => STATUT_DEMANDE_LABEL[statut]),
    getReportingJournalDetail(filters),
    getReportingRows(filters),
    getReportingSuiviBudgetaire(),
    getReportingDashboardSnapshot(),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Portail SIM Assurances";
  workbook.created = new Date();

  // Lot F : UN seul tableau, de la demande jusqu'au détail de chaque article (règlements / fonds remis, mouvements banque,
  // retours de caisse, dépenses, retours externes…) — les anciennes feuilles Demandes, Retours de caisse, Mouvements banque,
  // Retours externes et Fonds remis n'existent plus. Mêmes lignes et mêmes colonnes que l'écran (`COLONNES_ARBRE`).
  ajouterFeuilleReporting(workbook, arbre.lignes);

  const sheetJournal = workbook.addWorksheet("Journal de caisse");
  sheetJournal.columns = [
    { header: "Type", key: "type", width: 12 },
    { header: "Montant (FCFA)", key: "montant", width: 16 },
    { header: "Source", key: "source", width: 28 },
    { header: "Référence demande", key: "reference", width: 20 },
    { header: "Utilisateur", key: "utilisateur", width: 22 },
    { header: "Date de l'écriture", key: "date", width: 14 },
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
  const sheetReporting = workbook.addWorksheet("Synthèse par catégorie");
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
