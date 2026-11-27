import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";

import { chargerReleveRemunerationCpt, lirePeriodeReleveCpt, NATURES_REMUNERATION_CPT, prisma } from "backend";

import { getSession } from "@/lib/auth";
import { peutVoirRemunerationCpt } from "@/lib/compta/droitsRemuneration";
import { RelevePdfRemuneration } from "@/lib/compta/RelevePdfRemuneration";

/**
 * Relevé d'un partenaire en PDF (lot GC-9g). `GET /api/compta/partenaires/[id]/releve?nature=…[&du=&au=|&periode=tout]` (par défaut,
 * le trimestre civil en cours) : 401 sans session, 403 sans la lecture de la rémunération (C-36), 400 sans nature, 404 partenaire
 * inconnu. Mêmes chiffres que l'écran (`chargerReleveRemunerationCpt`).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return new NextResponse("Non authentifié.", { status: 401 });
  if (!peutVoirRemunerationCpt(session)) return new NextResponse("Action non autorisée.", { status: 403 });
  const nature = NATURES_REMUNERATION_CPT.find((n) => n === new URL(request.url).searchParams.get("nature"));
  if (!nature) return new NextResponse("Nature obligatoire.", { status: 400 });
  const maintenant = new Date();
  const aujourdhui = maintenant.toISOString().slice(0, 10);
  const periode = lirePeriodeReleveCpt(Object.fromEntries(new URL(request.url).searchParams), aujourdhui);
  const donnees = await chargerReleveRemunerationCpt(prisma, id, nature, aujourdhui, periode);
  if (!donnees) return new NextResponse("Partenaire introuvable.", { status: 404 });

  const buffer = await renderToBuffer(<RelevePdfRemuneration partenaire={donnees.partenaire.nom} releve={donnees.releve} edite={maintenant} />);
  const nom = donnees.partenaire.nom.normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "partenaire";
  return new NextResponse(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="releve-${nom}-${nature.toLowerCase()}.pdf"`, "Cache-Control": "no-store" },
  });
}
