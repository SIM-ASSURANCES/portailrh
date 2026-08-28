"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fieldErrorsFromZod, type ActionState } from "@/lib/validation";

const categorisationSchema = z.object({
  demandeId: z.string().min(1),
  categorieId: z.string().min(1, "Catégorie requise"),
  objetId: z.string().min(1, "Objet requis"),
  budgetDisponible: z.coerce.number().positive("Le budget doit être supérieur à 0"),
});

/**
 * Renseigne catégorie/objet/budget d'une demande. Réservée à
 * `treso.categoriser_demande`.
 *
 * Défense en profondeur (règle impérative du cahier des charges) : le
 * statut EN_ATTENTE est revérifié ici, côté serveur, juste avant l'écriture
 * — jamais uniquement via l'UI qui ne propose le formulaire que dans ce
 * cas. Le statut a pu changer entre l'affichage de la page et la
 * soumission (ex: validée entre-temps par un autre utilisateur Finance).
 * Une fois VALIDEE, ces champs sont définitivement verrouillés, y compris
 * pour Finance.
 */
export async function categoriserDemandeAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.categoriser_demande")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = categorisationSchema.safeParse({
    demandeId: formData.get("demandeId"),
    categorieId: formData.get("categorieId"),
    objetId: formData.get("objetId"),
    budgetDisponible: formData.get("budgetDisponible"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const { demandeId, categorieId, objetId, budgetDisponible } = parsed.data;

  const demande = await prisma.demande.findUnique({ where: { id: demandeId } });
  if (!demande) {
    return { status: "error", message: "Demande introuvable." };
  }
  if (demande.statut !== "EN_ATTENTE") {
    return {
      status: "error",
      message: `Cette demande n'est plus modifiable (statut actuel : ${demande.statut}).`,
    };
  }

  const objet = await prisma.objet.findUnique({ where: { id: objetId } });
  if (!objet || objet.categorieId !== categorieId) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: { objetId: "Cet objet n'appartient pas à la catégorie sélectionnée." },
    };
  }

  await prisma.demande.update({
    where: { id: demandeId },
    data: { categorieId, objetId, budgetDisponible },
  });

  await prisma.historiqueEntry.create({
    data: {
      entity: "Demande",
      entityId: demandeId,
      action: "CATEGORISER",
      detail: `Catégorisation : catégorie=${categorieId}, objet=${objetId}, budget=${budgetDisponible}`,
      userId: session.user.id,
    },
  });

  revalidatePath("/treso/finance/demandes");
  revalidatePath(`/treso/finance/demandes/${demandeId}`);

  return { status: "success", message: "Catégorisation enregistrée." };
}
