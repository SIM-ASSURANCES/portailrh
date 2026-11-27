import { NextResponse } from "next/server";

import { chargerReleveRemunerationCpt, colonnesReleveRemunerationCpt, lignesExportReleveRemunerationCpt, NATURES_REMUNERATION_CPT, prisma } from "backend";

import { getSession, hasPermission } from "@/lib/auth";
import { exporterEnFlux, type FormatExportCpt, TYPE_MIME_EXPORT_CPT } from "@/lib/compta/exportFlux";

/**
 * Export du relevé d'un partenaire pour une nature (lot GC-9g), en flux.
 * `GET /api/compta/export/remuneration?partenaire=ID&nature=COMMISSION|ACCESSOIRES|HONORAIRES&format=csv|xlsx`. Accès
 * `cpt.consulter` (401 sans session, 403 sans la permission). Même relevé que l'écran et le PDF : aucun second calcul.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (!hasPermission(session, "cpt.consulter")) return NextResponse.json({ error: "Action non autorisée." }, { status: 403 });

  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "csv";
  if (format !== "xlsx" && format !== "csv") return NextResponse.json({ error: "Format inconnu (xlsx ou csv)." }, { status: 400 });
  const nature = NATURES_REMUNERATION_CPT.find((n) => n === url.searchParams.get("nature"));
  if (!nature) return NextResponse.json({ error: "Nature obligatoire (COMMISSION, ACCESSOIRES ou HONORAIRES)." }, { status: 400 });
  const donnees = await chargerReleveRemunerationCpt(prisma, url.searchParams.get("partenaire") ?? "", nature, new Date().toISOString().slice(0, 10));
  if (!donnees) return NextResponse.json({ error: "Partenaire introuvable." }, { status: 404 });

  const flux = exporterEnFlux({
    format: format as FormatExportCpt,
    nomFeuille: donnees.releve.libelleNature.slice(0, 31),
    colonnes: colonnesReleveRemunerationCpt(nature),
    lignes: lignesExportReleveRemunerationCpt(donnees.releve),
  });
  return new Response(flux, {
    headers: {
      "Content-Type": TYPE_MIME_EXPORT_CPT[format as FormatExportCpt],
      "Content-Disposition": `attachment; filename="releve-${nature.toLowerCase()}.${format}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
