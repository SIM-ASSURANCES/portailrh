import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { getSession, hasPermission } from "@/lib/auth";
import {
  getDetailsDepartsAnticipes,
  getDetailsRetards,
  getReportingAgrégé,
  pointageReportingSchema,
  type LigneDetailPointage,
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
 * Feuille de détail (retards ou départs anticipés) : mêmes colonnes et mêmes valeurs qu'à l'écran (`ligneDetailPointage`,
 * `justificationAffichee`). Toutes les lignes, sans limite. Pas de colonne de minutes pour un départ anticipé : l'avance
 * n'est pas enregistrée au pointage et ne doit pas être recalculée ici.
 */
function ajouterFeuilleDetail(
  workbook: ExcelJS.Workbook,
  nom: string,
  lignes: LigneDetailPointage[],
  avecMinutesRetard: boolean,
) {
  const sheet = workbook.addWorksheet(nom);
  sheet.columns = [
    { header: "Date", key: "date", width: 15 },
    { header: "Collaborateur", key: "collaborateur", width: 30 },
    { header: "Heure prévue", key: "heurePrevue", width: 15 },
    { header: "Heure réelle", key: "heureReelle", width: 15 },
    ...(avecMinutesRetard ? [{ header: "Minutes de retard", key: "minutesRetard", width: 20 }] : []),
    { header: "Justification", key: "justification", width: 24 },
    { header: "Motif", key: "motif", width: 40 },
    { header: "Décidée par", key: "decideePar", width: 25 },
  ];
  lignes.forEach((d) => {
    sheet.addRow({
      date: d.date.toLocaleDateString("fr-FR"),
      collaborateur: d.collaborateur,
      heurePrevue: d.heurePrevue || "—",
      heureReelle: d.heureReelle.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
      minutesRetard: d.minutesRetard || 0,
      justification: d.justification,
      motif: d.motif || "—",
      decideePar: d.decideePar || "—",
    });
  });
  styleHeaderRow(sheet);
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new NextResponse("Non authentifié.", { status: 401 });
  }
  // Check RH permission
  if (!hasPermission(session, "pointage.voir_dashboard_rh")) {
    return new NextResponse("Accès refusé.", { status: 403 });
  }

  const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
  
  // Safe parsing of the filters
  const parsedFilters = pointageReportingSchema.safeParse(searchParams);
  const filters = parsedFilters.success ? parsedFilters.data : {};

  // Export complet : aucune pagination, toutes les lignes du détail.
  const [agrege, retards, departs] = await Promise.all([
    getReportingAgrégé(filters),
    getDetailsRetards(filters),
    getDetailsDepartsAnticipes(filters),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Portail SIM Assurances";
  workbook.created = new Date();

  // 1. Feuille Résumé
  const sheetResume = workbook.addWorksheet("Résumé");
  sheetResume.columns = [
    { header: "Collaborateur", key: "collaborateur", width: 30 },
    { header: "Service", key: "service", width: 25 },
    { header: "Jours travaillés", key: "joursTravailles", width: 20 },
    { header: "Présences", key: "presences", width: 15 },
    { header: "Absences", key: "absences", width: 15 },
    { header: "Jours de retard", key: "joursRetard", width: 20 },
    { header: "Minutes de retard", key: "minutesRetard", width: 20 },
  ];

  agrege.forEach((r) => {
    sheetResume.addRow({
      collaborateur: r.fullName,
      service: r.service || "—",
      joursTravailles: r.joursTravailles,
      presences: r.presences,
      absences: r.absences,
      joursRetard: r.joursRetard,
      minutesRetard: r.minutesRetard,
    });
  });
  styleHeaderRow(sheetResume);

  // 2 et 3. Détail des retards, détail des départs anticipés.
  ajouterFeuilleDetail(workbook, "Détails des retards", retards.data, true);
  ajouterFeuilleDetail(workbook, "Départs anticipés", departs.data, false);

  const buffer = await workbook.xlsx.writeBuffer();
  const dateStr = new Date().toISOString().slice(0, 10);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="reporting-pointage-rh-${dateStr}.xlsx"`,
    },
  });
}
