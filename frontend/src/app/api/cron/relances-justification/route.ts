import { NextResponse } from "next/server";
import { refusCron } from "@/lib/cronAuth";
import { executerTache } from "@/lib/taches/executer";

/**
 * Déclenchement MANUEL (et secours) des relances de justification du pointage. Depuis le 2026-10-14 (fiabilisation du
 * pointage, phase 2), la tâche tourne toute seule toutes les 5 minutes dans le planificateur intégré à l'application : cette
 * route n'est plus appelée par cron-job.org. Elle reste protégée par `Authorization: Bearer <CRON_SECRET>` (`refusCron` :
 * sinon 401, rien n'est exécuté) et passe par le même `executerTache` (verrou, ligne `ExecutionTache`, déclenchement MANUEL).
 * La logique est dans `@/lib/taches/relancesJustification`.
 */
export async function GET(request: Request) {
  const refus = refusCron(request);
  if (refus) return refus;

  const resultat = await executerTache("RELANCES_JUSTIFICATION", "MANUEL");
  if (resultat.statut === "ECHEC") {
    return NextResponse.json({ success: false, erreur: resultat.erreur }, { status: 500 });
  }
  if (resultat.statut === "IGNOREE") {
    return NextResponse.json({ success: true, ignoree: true, message: "Une exécution est déjà en cours." });
  }
  return NextResponse.json({ success: true, executeLe: new Date().toISOString(), ...(resultat.bilan as object) });
}
