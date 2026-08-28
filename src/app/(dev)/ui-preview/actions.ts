"use server";

import { z } from "zod";

import { fieldErrorsFromZod, type ActionState } from "@/lib/validation";

const demoSchema = z.object({
  titre: z.string().min(3, "Le titre doit contenir au moins 3 caractères"),
  montant: z.coerce.number().positive("Le montant doit être positif"),
});

/**
 * Server Action de démonstration : valide avec Zod, renvoie un ActionState.
 * Sert d'exemple pour le pattern "Server Action -> toast" documenté dans
 * CLAUDE.md. Ne fait aucune écriture réelle en base.
 */
export async function demoFormAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const raw = {
    titre: formData.get("titre"),
    montant: formData.get("montant"),
  };

  const parsed = demoSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  return {
    status: "success",
    message: `Démo enregistrée : "${parsed.data.titre}" (${parsed.data.montant.toLocaleString("fr-FR")} XOF)`,
  };
}
