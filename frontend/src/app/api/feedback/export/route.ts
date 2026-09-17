import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { getSession, hasPermission } from "@/lib/auth";
import { getAdminFeedbacks, type AdminFeedbackFilters } from "backend";

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF004B9C" } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" } };

/**
 * Export CSV / Excel des feedbacks pour l'Espace Admin (Modération).
 * Strictement protégé par `feedback.moderer` (RH & DG).
 * Respect du CDC : aucune identification d'auteur ni de destinataire nominatif.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new NextResponse("Non authentifié.", { status: 401 });
  }
  if (!hasPermission(session, "feedback.moderer")) {
    return new NextResponse("Accès refusé.", { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const filters: AdminFeedbackFilters = {
    du: searchParams.get("du") ?? undefined,
    au: searchParams.get("au") ?? undefined,
    statut: (searchParams.get("statut") as AdminFeedbackFilters["statut"]) ?? undefined,
    source: (searchParams.get("source") as AdminFeedbackFilters["source"]) ?? undefined,
    search: searchParams.get("search") ?? undefined,
  };

  const feedbacks = await getAdminFeedbacks(filters);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Feedbacks");

  worksheet.columns = [
    { header: "ID", key: "id", width: 38 },
    { header: "Date de soumission", key: "submittedAt", width: 18 },
    { header: "Source", key: "source", width: 14 },
    { header: "Destinataire", key: "recipient", width: 24 },
    { header: "Statut", key: "statut", width: 14 },
    { header: "Message", key: "content", width: 60 },
    { header: "Modéré par", key: "moderatedBy", width: 24 },
    { header: "Modéré le", key: "moderatedAt", width: 18 },
    { header: "Motif de modération", key: "motif", width: 35 },
  ];

  worksheet.getRow(1).eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });

  for (const f of feedbacks) {
    worksheet.addRow({
      id: f.id,
      submittedAt: new Date(f.submittedAt).toLocaleDateString("fr-FR"),
      source: f.source === "PUBLIC" ? "Public" : "Interne",
      recipient: f.recipientPseudo, // Pseudonymisé
      statut: f.isModerated ? "Modéré (Retiré)" : "Actif",
      content: f.content,
      moderatedBy: f.moderatedByNom ?? "—",
      moderatedAt: f.moderatedAt ? new Date(f.moderatedAt).toLocaleDateString("fr-FR") : "—",
      motif: f.motifModeration ?? "—",
    });
  }

  // Format CSV avec encodage UTF-8 et BOM pour compatibilité Excel
  const csvBuffer = await workbook.csv.writeBuffer({
    formatterOptions: {
      delimiter: ";",
      quote: '"',
    },
  });

  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const finalBuffer = Buffer.concat([bom, Buffer.from(csvBuffer)]);

  return new NextResponse(finalBuffer, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="feedbacks_export_${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
