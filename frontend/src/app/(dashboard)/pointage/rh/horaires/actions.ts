"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { publishDataChanged } from "@/lib/eventBus";
import { prisma } from "backend";
import { getSession, hasPermission } from "@/lib/auth";
import { type ActionState, fieldErrorsFromZod } from "backend";

const timeStringSchema = z
  .string()
  .regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/, "Format invalide (HH:MM attendu)");

const updateHorairesSchema = z.object({
  heureDebutMatin: timeStringSchema,
  heureFinMatin: timeStringSchema,
  heureDebutApresMidi: timeStringSchema,
  heureFinApresMidi: timeStringSchema,
});

export async function updateHorairesAction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await getSession();
  if (!session) {
    return { status: "error", message: "Non authentifié." };
  }
  if (!hasPermission(session, "pointage.gerer_horaires")) {
    return { status: "error", message: "Accès refusé. Vous n'avez pas la permission de modifier le paramétrage." };
  }

  const parseResult = updateHorairesSchema.safeParse({
    heureDebutMatin: formData.get("heureDebutMatin"),
    heureFinMatin: formData.get("heureFinMatin"),
    heureDebutApresMidi: formData.get("heureDebutApresMidi"),
    heureFinApresMidi: formData.get("heureFinApresMidi"),
  });

  if (!parseResult.success) {
    return {
      status: "error",
      message: "Veuillez vérifier les heures saisies.",
      fieldErrors: fieldErrorsFromZod(parseResult.error),
    };
  }

  const { data } = parseResult;

  try {
    const actif = await prisma.parametrageHoraire.findFirst({
      where: { isActive: true },
    });

    if (actif) {
      await prisma.parametrageHoraire.update({
        where: { id: actif.id },
        data,
      });
    } else {
      await prisma.parametrageHoraire.create({
        data: {
          ...data,
          isActive: true,
        },
      });
    }

    revalidatePath("/pointage");
    publishDataChanged();
    return { status: "success", message: "Les horaires ont été mis à jour avec succès." };
  } catch (error) {
    console.error("updateHorairesAction error:", error);
    return { status: "error", message: "Une erreur est survenue lors de la mise à jour des horaires." };
  }
}
