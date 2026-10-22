import { NextResponse } from "next/server";

import { getSession, hasPermission } from "@/lib/auth";
import {
  ACTION_SAUVEGARDE,
  genererSauvegardeReinitialisation,
  lireEtatEtapes,
  refusSauvegarde,
  tracerEtapeReinitialisation,
} from "backend";

export const dynamic = "force-dynamic";

/**
 * Étape 2 — sauvegarde JSON des tables qui seront purgées (voir CLAUDE.md "Lot R"). Réservée à `systeme.reinitialiser` et
 * à l'étape 1 faite (simulation tracée par ce compte). Autorisée même si le verrou est actif : la levée du verrou (étape 3)
 * vient APRÈS la sauvegarde. L'empreinte SHA-256 est renvoyée dans `X-Backup-Sha256` ET tracée dans l'audit : la purge
 * n'accepte que l'empreinte de la dernière sauvegarde générée pour ce compte, puis revérifie que les données n'ont pas changé.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return new NextResponse("Non authentifié.", { status: 401 });
  }
  if (!hasPermission(session, "systeme.reinitialiser")) {
    return new NextResponse("Accès refusé.", { status: 403 });
  }
  const { etat } = await lireEtatEtapes(session.user.id);
  const refus = refusSauvegarde(etat);
  if (refus) {
    return new NextResponse(refus, { status: 409 });
  }

  const { contenu, empreinte, decompte } = await genererSauvegardeReinitialisation(session.user.id);
  const total = Object.values(decompte).reduce((a, b) => a + b, 0);
  await tracerEtapeReinitialisation(
    session.user.id,
    ACTION_SAUVEGARDE,
    `Sauvegarde générée et envoyée (empreinte ${empreinte}, ${total} ligne(s)).`
  );
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
