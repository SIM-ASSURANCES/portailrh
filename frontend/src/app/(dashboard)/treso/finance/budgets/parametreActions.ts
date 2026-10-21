"use server";

import { revalidatePath } from "next/cache";

import { getSession, hasPermission, isAdmin } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { definirDateCategorisationObligatoire, validerDateCategorisation } from "backend";

/**
 * Lot I (2026-10-19) : fixe la date à partir de laquelle la catégorisation est obligatoire pour valider (vide = jamais).
 * Même garde que l'écran des catégories (`isAdmin` ou `treso.gerer_categories`, la Finance), revérifiée ici ; le
 * changement est historisé (`HistoriqueEntry`, entité `ParametreTresorerie`). Ne modifie aucune demande, aucun article ni
 * aucune écriture : seule la règle de validation change.
 */
export async function definirDateCategorisationAction(saisie: string): Promise<{ status: "success" | "error"; message: string }> {
  const session = await getSession();
  if (!session || !(isAdmin(session) || hasPermission(session, "treso.gerer_categories"))) {
    return { status: "error", message: "Action non autorisée." };
  }
  const verdict = validerDateCategorisation(saisie);
  if (!verdict.ok) return { status: "error", message: verdict.message };

  const r = await definirDateCategorisationObligatoire(verdict.date, session.user.id);
  revalidatePath("/treso/finance", "layout");
  publishDataChanged();
  if (!r.change) return { status: "success", message: "Aucun changement : cette date était déjà celle en vigueur." };
  return {
    status: "success",
    message: verdict.date
      ? `La catégorisation sera obligatoire pour valider à partir du ${verdict.date.split("-").reverse().join("/")}.`
      : "La catégorisation n'est plus obligatoire pour valider (aucune date fixée).",
  };
}
