/**
 * Démarrage du serveur Next.js (appelé une fois par instance) : lance le planificateur intégré des tâches (relances de
 * justification, absences, purge). Runtime Node uniquement — le runtime Edge n'a ni base de données ni minuterie.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { demarrerPlanificateur } = await import("@/lib/taches/planificateur");
    demarrerPlanificateur();
  }
}
