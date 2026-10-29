import { NextResponse } from "next/server";
import { refusCron } from "@/lib/cronAuth";
import { executerTache } from "@/lib/taches/executer";

/**
 * Déclenchement MANUEL (et secours) des absences et oublis de départ. Depuis le 2026-10-14 (fiabilisation du pointage,
 * phase 2), la tâche tourne toute seule du lundi au vendredi à 17:30 et 20:00 dans le planificateur intégré : cette route
 * n'est plus appelée par cron-job.org. SEC-06 : secret comparé à temps constant, refus sans CRON_SECRET (`refusCron`).
 * La logique est dans `@/lib/taches/absences`.
 */
export async function GET(request: Request) {
  const refus = refusCron(request);
  if (refus) return refus;

  const resultat = await executerTache("ABSENCES", "MANUEL");
  if (resultat.statut === "ECHEC") {
    return NextResponse.json({ error: "Erreur serveur interne" }, { status: 500 });
  }
  if (resultat.statut === "IGNOREE") {
    return NextResponse.json({ success: true, ignoree: true, message: "Une exécution est déjà en cours." });
  }
  const { message } = resultat.bilan as { message: string };
  return NextResponse.json({ success: true, message });
}
