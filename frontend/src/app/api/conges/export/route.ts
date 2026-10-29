import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";

import { getSession, hasPermission } from "@/lib/auth";
import { aujourdhui } from "@/lib/conges/format";
import {
  COLONNES_EXPORT_CONGE,
  filtresCongesDepuisRecherche,
  ligneExportConge,
  listerCongesVueEnsemble,
  prisma,
} from "backend";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF004B9C" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
};

function styleHeaderRow(sheet: ExcelJS.Worksheet) {
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new NextResponse("Non authentifié.", { status: 401 });
  }

  const autorise =
    hasPermission(session, "conges.consulter_tous") ||
    session.rolePermissions.includes("conges.valider_rh");
  if (!autorise) {
    return new NextResponse("Accès refusé.", { status: 403 });
  }

  const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
  const filtres = filtresCongesDepuisRecherche(searchParams, aujourdhui());
  if (!filtres.ok) {
    return new NextResponse(filtres.erreur, { status: 400 });
  }

  const { lignes } = await listerCongesVueEnsemble(prisma, filtres);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Portail SIM Assurances";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Congés", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = COLONNES_EXPORT_CONGE.map((colonne) => ({
    header: colonne.header,
    key: colonne.cle,
    width: colonne.width,
    style: colonne.date ? { numFmt: "dd/mm/yyyy" } : undefined,
  }));

  for (const demande of lignes) {
    sheet.addRow(ligneExportConge(demande));
  }

  styleHeaderRow(sheet);

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `conges_${filtres.du}_${filtres.au}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

