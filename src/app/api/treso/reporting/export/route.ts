import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";

import { STATUT_DEMANDE_LABEL } from "@/components/tresorerie/demandeStatut";
import { JUSTIFICATION_LABEL } from "@/components/tresorerie/justification";
import { getSession, hasPermission } from "@/lib/auth";
import {
  getReportingDemandesDetail,
  getReportingDepensesDetail,
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

  const [demandes, reglements, retours, depenses, journal, rows] = await Promise.all([
    getReportingDemandesDetail(filters),
    getReportingReglementsDetail(filters),
    getReportingRetoursDetail(filters),
    getReportingDepensesDetail(filters),
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

  // REFONTE V1 / Phase D (voir CLAUDE.md "Refonte V1 en cours") : un retour
  // n'a plus de justification unique (une par DepenseLigne) — remplacée
  // par le total déclaré et le montant non justifié (lignes SANS_PIECE).
  const sheetRetours = workbook.addWorksheet("Retours de caisse");
  sheetRetours.columns = [
    { header: "Référence demande", key: "reference", width: 20 },
    { header: "Total dépenses déclarées (FCFA)", key: "montantDepenseTotal", width: 24 },
    { header: "Montant à retourner (FCFA)", key: "montantARetourner", width: 20 },
    { header: "Dont non justifié (FCFA)", key: "montantNonJustifie", width: 22 },
    { header: "Statut", key: "statut", width: 18 },
    { header: "Déclaré le", key: "declareLe", width: 14 },
  ];
  retours.forEach((r) =>
    sheetRetours.addRow({
      reference: r.demandeReference,
      montantDepenseTotal: r.montantDepenseTotal,
      montantARetourner: r.montantARetourner,
      montantNonJustifie: r.montantNonJustifie,
      statut: r.estReceptionne ? "Réceptionné" : "En attente",
      declareLe: r.declareLe.toLocaleDateString("fr-FR"),
    })
  );
  styleHeaderRow(sheetRetours);

  // Phase H : détail ligne par ligne des dépenses déclarées (Phase D,
  // "fonds remis") — une ligne par DepenseLigne, pas agrégée par retour
  // comme la feuille "Retours de caisse" ci-dessus. Les lignes non
  // justifiées (SANS_PIECE) sont surlignées (fond jaune pâle) pour un
  // repérage visuel rapide dans Excel, en plus de la colonne "Non justifiée".
  const NON_JUSTIFIEE_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3ED" } };
  const NON_JUSTIFIEE_FONT: Partial<ExcelJS.Font> = { color: { argb: "FFBF470C" }, bold: true };

  const sheetDepenses = workbook.addWorksheet("Dépenses déclarées");
  sheetDepenses.columns = [
    { header: "Référence demande", key: "reference", width: 20 },
    { header: "Bénéficiaire", key: "beneficiaire", width: 24 },
    { header: "Montant (FCFA)", key: "montant", width: 16 },
    { header: "Objet", key: "objet", width: 28 },
    { header: "Date", key: "date", width: 14 },
    { header: "Nature", key: "nature", width: 20 },
    { header: "Justification", key: "justification", width: 22 },
    { header: "Non justifiée", key: "nonJustifiee", width: 14 },
  ];
  depenses.forEach((d) => {
    const row = sheetDepenses.addRow({
      reference: d.demandeReference,
      beneficiaire: d.beneficiaireNom,
      montant: d.montant,
      objet: d.objet,
      date: d.date.toLocaleDateString("fr-FR"),
      nature: d.nature ?? "—",
      justification: JUSTIFICATION_LABEL[d.justification],
      nonJustifiee: d.nonJustifiee ? "Oui" : "Non",
    });
    if (d.nonJustifiee) {
      row.eachCell((cell) => {
        cell.fill = NON_JUSTIFIEE_FILL;
        cell.font = NON_JUSTIFIEE_FONT;
      });
    }
  });
  styleHeaderRow(sheetDepenses);

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

  // Phase H : "Validé" est désormais la somme de Demande.montantValide
  // (capture les validations partielles) ; "Reste à régler" renommée
  // "Validé restant à régler" et nouvelle colonne "Restant à valider" —
  // voir ReportingRow dans reporting.ts, les deux notions ne se confondent
  // jamais.
  const sheetReporting = workbook.addWorksheet("Reporting");
  sheetReporting.columns = [
    { header: "Catégorie", key: "categorie", width: 18 },
    { header: "Objet", key: "objet", width: 26 },
    { header: "Nb. demandes", key: "nombre", width: 14 },
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
  // Phase H, Tâche 4 (voir CLAUDE.md "Refonte V1 en cours") : Catégorie/
  // Objet/Budget ne sont plus au cœur du nouveau cahier des charges depuis
  // la Phase A — une demande créée depuis la refonte V1 n'a normalement
  // plus de `budgetDisponible` renseigné, donc cette feuille reste vide
  // pour tout jeu de filtres portant sur des données récentes. Note
  // explicite ajoutée dans la feuille elle-même plutôt que de la supprimer
  // (elle reste pertinente pour d'éventuelles données antérieures à la
  // refonte qui auraient encore un budget renseigné).
  if (rowsAvecBudget.length === 0) {
    const noteRow = sheetBudget.addRow({
      categorie:
        "Fonctionnalité liée à Catégorie/Objet/Budget, statut à confirmer avec le maître de stage — voir CLAUDE.md (\"Refonte V1 en cours\", section Catégorie/Objet/Budget). Aucune demande de ces filtres n'a de budget disponible renseigné.",
    });
    sheetBudget.mergeCells(noteRow.number, 1, noteRow.number, 5);
    noteRow.getCell(1).alignment = { wrapText: true, vertical: "top" };
    noteRow.getCell(1).font = { italic: true, color: { argb: "FF64748B" } };
    sheetBudget.getRow(noteRow.number).height = 45;
  }
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
