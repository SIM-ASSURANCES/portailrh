import { NextResponse } from "next/server";

import { getSession, hasPermission } from "@/lib/auth";
import { PERMISSION_REINITIALISER_POINTAGE, genererSauvegardePointage, pointageEnService } from "backend";

export const dynamic = "force-dynamic";

/**
 * Sauvegarde JSON des tables du Pointage qui seront purgées. Réservée à `pointage.reinitialiser`, refusée une fois le
 * Pointage en service. L'empreinte SHA-256 est renvoyée dans `X-Backup-Sha256` : la purge la revérifie.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return new NextResponse("Non authentifié.", { status: 401 });
  if (!hasPermission(session, PERMISSION_REINITIALISER_POINTAGE)) return new NextResponse("Accès refusé.", { status: 403 });
  if (await pointageEnService()) return new NextResponse("Le Pointage est en service : sa purge est refusée.", { status: 409 });

  const { contenu, empreinte } = await genererSauvegardePointage(session.user.id);
  const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
  return new NextResponse(contenu, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="sauvegarde-avant-reinitialisation-pointage-${horodatage}.json"`,
      "X-Backup-Sha256": empreinte,
      "Cache-Control": "no-store",
    },
  });
}
