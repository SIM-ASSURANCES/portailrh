import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";

import { STATUT_DEMANDE_LABEL } from "@/components/tresorerie/demandeStatut";
import { JUSTIFICATION_LABEL } from "@/components/tresorerie/justification";
import { getSession, hasPermission } from "@/lib/auth";
import {
  getReportingDemandesDetail,
  getReportingJournalDetail,
  getReportingReglementsDetail,
  getReportingRetoursDetail,
  getReportingRows,
  parseReportingFilters,
} from "@/lib/reporting";

const MODE_LABEL: Record<"CAISSE" | "BANQUE", string> = { CAISSE: "Caisse", BANQUE: "Banque" };

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

  const [demandes, reglements, retours, journal, rows] = await Promise.all([
    getReportingDemandesDetail(filters),
    getReportingReglementsDetail(filters),
    getReportingRetoursDetail(filters),
    getReportingJournalDetail(filters),
    getReportingRows(filters),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Portail SIM Assurances";
  workbook.created = new Date();

  const sheetDemandes = workbook.addWorksheet("Demandes");
  sheetDemandes.columns = [
    { header: "Référence", key: "reference", width: 20 },
    { header: "Créateur", key: "createur", width: 22 },
    { header: "Service", key: "service", width: 18 },
    { header: "Catégorie", key: "categorie", width: 18 },
    { header: "Objet", key: "objet", width: 26 },
    { header: "Montant (FCFA)", key: "montant", width: 16 },
    { header: "Statut", key: "statut", width: 18 },
    { header: "Créée le", key: "createdAt", width: 14 },
  ];
  demandes.forEach((d) =>
    sheetDemandes.addRow({
      reference: d.reference,
      createur: d.createurNom,
      service: d.service ?? "—",
      categorie: d.categorieLabel,
      objet: d.objetLabel,
      montant: d.montant,
      statut: STATUT_DEMANDE_LABEL[d.statut],
      createdAt: d.createdAt.toLocaleDateString("fr-FR"),
    })
  );
  styleHeaderRow(sheetDemandes);

  const sheetReglements = workbook.addWorksheet("Règlements");
  sheetReglements.columns = [
    { header: "Référence demande", key: "reference", width: 20 },
    { header: "Montant (FCFA)", key: "montant", width: 16 },
    { header: "Mode", key: "mode", width: 12 },
    { header: "Date de confirmation", key: "confirmeLe", width: 18 },
    { header: "Auteur", key: "auteur", width: 22 },
  ];
  reglements.forEach((r) =>
    sheetReglements.addRow({
      reference: r.demandeReference,
      montant: r.montant,
      mode: MODE_LABEL[r.mode],
      confirmeLe: r.confirmeLe.toLocaleDateString("fr-FR"),
      auteur: r.auteurNom,
    })
  );
  styleHeaderRow(sheetReglements);

  const sheetRetours = workbook.addWorksheet("Retours de caisse");
  sheetRetours.columns = [
    { header: "Référence demande", key: "reference", width: 20 },
    { header: "Montant dépensé (FCFA)", key: "montantDepense", width: 18 },
    { header: "Montant à retourner (FCFA)", key: "montantARetourner", width: 20 },
    { header: "Justification", key: "justification", width: 22 },
    { header: "Statut", key: "statut", width: 18 },
    { header: "Déclaré le", key: "declareLe", width: 14 },
  ];
  retours.forEach((r) =>
    sheetRetours.addRow({
      reference: r.demandeReference,
      montantDepense: r.montantDepense,
      montantARetourner: r.montantARetourner,
      justification: JUSTIFICATION_LABEL[r.justification],
      statut: r.estReceptionne ? "Réceptionné" : "En attente",
      declareLe: r.declareLe.toLocaleDateString("fr-FR"),
    })
  );
  styleHeaderRow(sheetRetours);

  const sheetJournal = workbook.addWorksheet("Journal de caisse");
  sheetJournal.columns = [
    { header: "Type", key: "type", width: 12 },
    { header: "Montant (FCFA)", key: "montant", width: 16 },
    { header: "Source", key: "source", width: 28 },
    { header: "Date", key: "date", width: 14 },
  ];
  journal.forEach((j) =>
    sheetJournal.addRow({
      type: j.type,
      montant: j.montant,
      source: j.source,
      date: j.createdAt.toLocaleDateString("fr-FR"),
    })
  );
  styleHeaderRow(sheetJournal);

  const sheetReporting = workbook.addWorksheet("Reporting");
  sheetReporting.columns = [
    { header: "Catégorie", key: "categorie", width: 18 },
    { header: "Objet", key: "objet", width: 26 },
    { header: "Nb. demandes", key: "nombre", width: 14 },
    { header: "Montant demandé (FCFA)", key: "montantDemande", width: 20 },
    { header: "Montant réglé (FCFA)", key: "montantRegle", width: 20 },
  ];
  rows.forEach((r) =>
    sheetReporting.addRow({
      categorie: r.categorieLabel,
      objet: r.objetLabel,
      nombre: r.nombreDemandes,
      montantDemande: r.montantDemande,
      montantRegle: r.montantRegle,
    })
  );
  const totalRow = sheetReporting.addRow({
    categorie: "Total général",
    objet: "",
    nombre: rows.reduce((s, r) => s + r.nombreDemandes, 0),
    montantDemande: rows.reduce((s, r) => s + r.montantDemande, 0),
    montantRegle: rows.reduce((s, r) => s + r.montantRegle, 0),
  });
  totalRow.font = { bold: true };
  styleHeaderRow(sheetReporting);

  const rowsAvecBudget = rows.filter(
    (r): r is typeof r & { budgetAlloue: number } => r.budgetAlloue != null
  );
  const sheetBudget = workbook.addWorksheet("Suivi budgétaire");
  sheetBudget.columns = [
    { header: "Catégorie", key: "categorie", width: 18 },
    { header: "Objet", key: "objet", width: 26 },
    { header: "Budget alloué (FCFA)", key: "budget", width: 18 },
    { header: "Montant réglé (FCFA)", key: "montantRegle", width: 18 },
    { header: "Écart (FCFA)", key: "ecart", width: 16 },
  ];
  rowsAvecBudget.forEach((r) => {
    const ecart = r.budgetAlloue - r.montantRegle;
    const row = sheetBudget.addRow({
      categorie: r.categorieLabel,
      objet: r.objetLabel,
      budget: r.budgetAlloue,
      montantRegle: r.montantRegle,
      ecart,
    });
    if (ecart < 0) {
      row.getCell("ecart").font = { bold: true, color: { argb: "FFDA0101" } };
    }
  });
  styleHeaderRow(sheetBudget);

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
