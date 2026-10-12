"use server";

import { z } from "zod";
import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { prisma, reglesPointage, horairesPointage } from "backend";
import { lireJourNonOuvre } from "@/lib/joursOuvres";
import { revalidatePath } from "next/cache";
import { ActionState, fieldErrorsFromZod } from "backend";
import { notify } from "@/lib/notifications";

const correctionSchema = z.object({
  pointageId: z.string().min(1, "L'identifiant du pointage est requis"),
  nouvelleHeure: z.string().min(1, "Veuillez spécifier la nouvelle heure du pointage"),
  motif: z.string().min(3, "Un motif explicatif détaillé est obligatoire (au moins 3 caractères)"),
});

function formatDateTime(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const year = date.getFullYear();
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

export async function corrigerPointageAction(
  input: { pointageId: string; nouvelleHeure: string; motif: string }
): Promise<ActionState> {
  const session = await getSession();
  if (!session || !session.user) {
    return { status: "error", message: "Non authentifié" };
  }

  if (!hasPermission(session, "pointage.corriger_pointage")) {
    return { status: "error", message: "Vous n'avez pas l'autorisation de corriger un pointage." };
  }

  const parsed = correctionSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "Données invalides", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const { pointageId, nouvelleHeure, motif } = parsed.data;

  const newDate = new Date(nouvelleHeure);
  if (isNaN(newDate.getTime())) {
    return { status: "error", message: "La nouvelle date et heure fournies sont invalides.", fieldErrors: { nouvelleHeure: "Date invalide" } };
  }

  const existingPointage = await prisma.pointage.findUnique({
    where: { id: pointageId }
  });

  if (!existingPointage) {
    return { status: "error", message: "Pointage introuvable." };
  }

  const parametrage = await prisma.parametrageHoraire.findFirst({
    where: { isActive: true }
  });
  // Lot 3 : même règle que le pointage du collaborateur (tolérance, permissions du jour corrigé).
  const horaires = horairesPointage(parametrage);
  const debutJour = new Date(newDate.getFullYear(), newDate.getMonth(), newDate.getDate());
  const finJour = new Date(newDate.getFullYear(), newDate.getMonth(), newDate.getDate(), 23, 59, 59, 999);
  const plagesDuJour = await prisma.plageAbsenceAutorisee.findMany({
    where: { userId: existingPointage.userId, date: { gte: debutJour, lte: finJour } },
    select: { heureDebut: true, heureFin: true },
  });

  // Lot 3 bis : un jour non ouvré n'a ni retard ni départ anticipé (même règle que le pointage du collaborateur).
  const { jourNonOuvre } = await lireJourNonOuvre(newDate);
  const { estRetard, minutesRetard, estDepartAnticipe } = reglesPointage(
    existingPointage.type,
    newDate,
    horaires,
    plagesDuJour,
    jourNonOuvre
  );

  try {
    await prisma.$transaction(async (tx) => {
      // Create correction entry
      await tx.correctionPointage.create({
        data: {
          ancienneValeur: formatDateTime(existingPointage.heure),
          nouvelleValeur: formatDateTime(newDate),
          motif,
          pointageId: existingPointage.id,
          effectueParId: session.user.id
        }
      });

      // Update pointage
      await tx.pointage.update({
        where: { id: existingPointage.id },
        data: {
          heure: newDate,
          estRetard,
          minutesRetard,
          estDepartAnticipe,
          motif: existingPointage.motif,
        }
      });

      // History
      await tx.historiqueEntry.create({
        data: {
          entity: "Pointage",
          entityId: existingPointage.id,
          action: "CORRECTION_RH",
          detail: `Heure modifiée de ${formatDateTime(existingPointage.heure)} à ${formatDateTime(newDate)} par ${session.user.fullName}`,
          userId: session.user.id
        }
      });
    });

    // Notification in-app et push FCM au collaborateur concerné
    const typeLabel = existingPointage.type === "ARRIVEE" ? "d'arrivée" : "de départ";
    await notify({
      userId: existingPointage.userId,
      titre: "Pointage modifié par les RH",
      message: `Votre pointage ${typeLabel} du ${formatDateTime(existingPointage.heure)} a été modifié à ${formatDateTime(newDate)} par ${session.user.fullName}. Motif : ${motif}`,
      lien: "/pointage/historique",
      priority: "IMPORTANT",
      category: "POINTAGE",
    });

    revalidatePath("/pointage");
    publishDataChanged();
    return { status: "success", message: "Le pointage a été corrigé avec succès." };
  } catch (error) {
    console.error("Error during correction:", error);
    return { status: "error", message: "Erreur lors de la correction en base." };
  }
}
