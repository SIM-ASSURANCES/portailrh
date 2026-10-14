"use server";

import { revalidatePath } from "next/cache";
import { TOUTES_LES_TACHES, type NomTache } from "backend";

import { getSession, isAdmin } from "@/lib/auth";
import { executerTache } from "@/lib/taches/executer";
import type { ActionState } from "backend";

/**
 * « Lancer maintenant » : exécute une tâche planifiée à la demande d'un Admin (déclenchement MANUEL — même fonction, même
 * verrou, même ligne `ExecutionTache` que le planificateur). Revérifie `isAdmin` ; la garde du layout ne suffit jamais.
 */
export async function lancerTacheAction(tache: NomTache): Promise<ActionState> {
  const session = await getSession();
  if (!isAdmin(session)) return { status: "error", message: "Action non autorisée." };
  if (!TOUTES_LES_TACHES.includes(tache)) return { status: "error", message: "Tâche inconnue." };

  const resultat = await executerTache(tache, "MANUEL");
  revalidatePath("/admin/journal-technique");
  revalidatePath("/admin");
  if (resultat.statut === "ECHEC") return { status: "error", message: `Échec de la tâche : ${resultat.erreur ?? "erreur inconnue"}` };
  if (resultat.statut === "IGNOREE") return { status: "error", message: "Une exécution est déjà en cours : rien n'a été lancé." };
  return { status: "success", message: "Tâche exécutée." };
}
