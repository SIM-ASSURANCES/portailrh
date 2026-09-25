import { NextResponse } from "next/server";

import { getSession, hasPermission } from "@/lib/auth";
import { genererSauvegardeReinitialisation, reinitialisationEffectuee } from "backend";

export const dynamic = "force-dynamic";

/**
 * Sauvegarde JSON des tables qui seront purgées (voir CLAUDE.md "Réinitialisation avant mise en production").
 * Réservée à `systeme.reinitialiser`, refusée une fois la réinitialisation effectuée. L'empreinte SHA-256 est
 * renvoyée dans `X-Backup-Sha256` : la purge la revérifie (refus si les données ont changé depuis).
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return new NextResponse("Non authentifié.", { status: 401 });
  }
  if (!hasPermission(session, "systeme.reinitialiser")) {
    return new NextResponse("Accès refusé.", { status: 403 });
  }
  if (await reinitialisationEffectuee()) {
    return new NextResponse("La réinitialisation a déjà été effectuée.", { status: 409 });
  }

  const { contenu, empreinte } = await genererSauvegardeReinitialisation(session.user.id);
  const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
  return new NextResponse(contenu, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="sauvegarde-avant-reinitialisation-${horodatage}.json"`,
      "X-Backup-Sha256": empreinte,
      "Cache-Control": "no-store",
    },
  });
}
