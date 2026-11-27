import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";

import { chargerReleveRemunerationCpt, NATURES_REMUNERATION_CPT, prisma } from "backend";

import { getSession, hasPermission } from "@/lib/auth";
import { RelevePdfRemuneration } from "@/lib/compta/RelevePdfRemuneration";

/**
 * Relevé d'un partenaire en PDF (lot GC-9g). `GET /api/compta/partenaires/[id]/releve?nature=…` : 401 sans session, 403 sans
 * `cpt.consulter`, 400 sans nature, 404 partenaire inconnu. Mêmes chiffres que l'écran (`chargerReleveRemunerationCpt`).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return new NextResponse("Non authentifié.", { status: 401 });
  if (!hasPermission(session, "cpt.consulter")) return new NextResponse("Action non autorisée.", { status: 403 });
  const nature = NATURES_REMUNERATION_CPT.find((n) => n === new URL(request.url).searchParams.get("nature"));
  if (!nature) return new NextResponse("Nature obligatoire.", { status: 400 });
  const maintenant = new Date();
  const donnees = await chargerReleveRemunerationCpt(prisma, id, nature, maintenant.toISOString().slice(0, 10));
  if (!donnees) return new NextResponse("Partenaire introuvable.", { status: 404 });

  const buffer = await renderToBuffer(<RelevePdfRemuneration partenaire={donnees.partenaire.nom} releve={donnees.releve} edite={maintenant} />);
  const nom = donnees.partenaire.nom.normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "partenaire";
  return new NextResponse(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="releve-${nom}-${nature.toLowerCase()}.pdf"`, "Cache-Control": "no-store" },
  });
}
