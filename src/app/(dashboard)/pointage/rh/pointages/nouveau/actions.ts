"use server";

import { z } from "zod";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { timeToMinutes } from "@/lib/pointage-utils";
import { revalidatePath } from "next/cache";
import { ActionState, fieldErrorsFromZod } from "@/lib/validation";

const pointageExceptionnelSchema = z.object({
  collaborateurId: z.string().min(1, "Veuillez sélectionner un collaborateur"),
  type: z.enum(["ARRIVEE", "DEPART"]),
  heure: z.string().min(1, "Veuillez spécifier l'heure du pointage"),
  motif: z.string().min(3, "Un motif explicatif détaillé est obligatoire (au moins 3 caractères)"),
});

export async function enregistrerPointageRHAction(
  input: { collaborateurId: string; type: "ARRIVEE" | "DEPART"; heure: string; motif: string }
): Promise<ActionState> {
  const session = await getSession();
  if (!session || !session.user) {
    return { status: "error", message: "Non authentifié" };
  }

  if (!hasPermission(session, "pointage.pointage_exceptionnel")) {
    return { status: "error", message: "Vous n'avez pas l'autorisation d'enregistrer un pointage exceptionnel." };
  }

  const parsed = pointageExceptionnelSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "Données invalides", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const { collaborateurId, type, heure, motif } = parsed.data;
  
  const pointageDate = new Date(heure);
  if (isNaN(pointageDate.getTime())) {
    return { status: "error", message: "La date et l'heure fournies sont invalides.", fieldErrors: { heure: "Date invalide" } };
  }

  // Vérifier que le collaborateur existe
  const collaborateur = await prisma.user.findUnique({
    where: { id: collaborateurId }
  });

  if (!collaborateur) {
    return { status: "error", message: "Collaborateur introuvable." };
  }

  // Vérification côté serveur des règles d'horaires pour calculer le retard
  const parametrage = await prisma.parametrageHoraire.findFirst({
    where: { isActive: true }
  });
  
  const limiteArriveeMinutes = timeToMinutes(parametrage?.heureDebutMatin || "07:45");
  
  const currentMinutes = pointageDate.getHours() * 60 + pointageDate.getMinutes();
  
  let estRetard = false;
  let minutesRetard = null;
  
  if (type === "ARRIVEE" && currentMinutes > limiteArriveeMinutes) {
    estRetard = true;
    minutesRetard = currentMinutes - limiteArriveeMinutes;
  } 

  try {
    await prisma.$transaction(async (tx) => {
      const pointage = await tx.pointage.create({
        data: {
          type,
          source: "RH_EXCEPTIONNEL",
          heure: pointageDate,
          estRetard,
          minutesRetard,
          motif,
          userId: collaborateurId,
          effectueParId: session.user.id
        }
      });

      // Historisation générale requise par la sécurité
      await tx.historiqueEntry.create({
        data: {
          entity: "Pointage",
          entityId: pointage.id,
          action: "CREATE_EXCEPTIONNEL",
          detail: `Type: ${type}, Date réelle: ${pointageDate.toISOString()}, Saisi par: ${session.user.fullName}`,
          userId: session.user.id
        }
      });

      // Si c'est une arrivée, effacer les absences A_CONTROLER pour cette journée
      if (type === "ARRIVEE") {
        const startOfToday = new Date(pointageDate);
        startOfToday.setHours(0, 0, 0, 0);
        const endOfToday = new Date(pointageDate);
        endOfToday.setHours(23, 59, 59, 999);

        await tx.absence.deleteMany({
          where: {
            userId: collaborateurId,
            date: { gte: startOfToday, lte: endOfToday },
            statut: "A_CONTROLER",
          },
        });
      }
    });

    revalidatePath("/pointage");
    return { status: "success", message: "Le pointage exceptionnel a été enregistré avec succès." };
  } catch (error) {
    return { status: "error", message: "Erreur lors de l'enregistrement en base." };
  }
}
