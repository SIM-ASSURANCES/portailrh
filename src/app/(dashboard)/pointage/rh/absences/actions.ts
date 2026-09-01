"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { StatutAbsence } from "@/generated/prisma/client";

export async function analyserAbsences(joursEnArriere: number = 30) {
  const session = await getSession();
  
  if (!session || !hasPermission(session, "pointage.voir_dashboard_rh")) {
    return { status: "error", message: "Non autorisé" };
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const users = await prisma.user.findMany({
      where: { role: { name: { not: "ADMIN" } } }, // Optional filtering if admins don't punch
      select: { id: true }
    });

    let nouvellesAbsences = 0;

    for (let i = 1; i <= joursEnArriere; i++) {
      const dateToCheck = new Date(today);
      dateToCheck.setDate(today.getDate() - i);
      
      const dayOfWeek = dateToCheck.getDay();
      // Skip weekends (0 = Sunday, 6 = Saturday)
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;

      const startOfDay = new Date(dateToCheck);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(dateToCheck);
      endOfDay.setHours(23, 59, 59, 999);

      for (const user of users) {
        // Check if there is an ARRIVEE punch for this user on this date
        const punch = await prisma.pointage.findFirst({
          where: {
            userId: user.id,
            type: "ARRIVEE",
            heure: {
              gte: startOfDay,
              lte: endOfDay
            }
          }
        });

        if (!punch) {
          // Check if an absence already exists
          const existingAbsence = await prisma.absence.findFirst({
            where: {
              userId: user.id,
              date: {
                gte: startOfDay,
                lte: endOfDay
              }
            }
          });

          if (!existingAbsence) {
            await prisma.absence.create({
              data: {
                userId: user.id,
                date: startOfDay,
                statut: "A_CONTROLER"
              }
            });
            nouvellesAbsences++;
          }
        }
      }
    }

    revalidatePath("/pointage/rh/absences");
    return { 
      status: "success", 
      message: `Analyse terminée. ${nouvellesAbsences} absence(s) à contrôler détectée(s).` 
    };
  } catch (error) {
    console.error("Erreur analyserAbsences:", error);
    return { status: "error", message: "Erreur lors de l'analyse des absences" };
  }
}

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
    return { status: "success", message: "Absence traitée avec succès" };
  } catch (error) {
    console.error("Erreur traiterAbsence:", error);
    return { status: "error", message: "Erreur lors du traitement de l'absence" };
  }
}
