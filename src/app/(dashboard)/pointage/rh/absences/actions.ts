"use server";

import { revalidatePath } from "next/cache";
import { pointageEmitter } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { StatutAbsence } from "@/generated/prisma/client";


export async function traiterAbsence(absenceId: string, statut: StatutAbsence, motif: string) {
  const session = await getSession();
  
  if (!session || !hasPermission(session, "pointage.voir_dashboard_rh")) {
    return { status: "error", message: "Non autorisé" };
  }

  try {
    if (statut === "A_CONTROLER") {
      return { status: "error", message: "Statut invalide" };
    }

    if (!motif || motif.trim() === "") {
      return { status: "error", message: "Le motif est obligatoire" };
    }

    await prisma.absence.update({
      where: { id: absenceId },
      data: {
        statut,
        motif,
        controleParId: session.user.id,
      }
    });

    revalidatePath("/pointage/rh/absences");
    pointageEmitter.emit("pointage-updated");
    return { status: "success", message: "Absence traitée avec succès" };
  } catch (error) {
    console.error("Erreur traiterAbsence:", error);
    return { status: "error", message: "Erreur lors du traitement de l'absence" };
  }
}
