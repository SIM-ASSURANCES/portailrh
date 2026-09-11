"use server";

import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "backend";
import type { Prisma } from "backend";
import { revalidatePath } from "next/cache";
import { endOfDay, startOfDay, format } from "date-fns";

export async function ajouterMotifRetard(pointageId: string, motif: string) {
  const session = await getSession();
  if (!session || !hasPermission(session, "pointage.corriger_pointage")) {
    return { status: "error", message: "Non autorisé" };
  }

  try {
    await prisma.pointage.update({
      where: { id: pointageId },
      data: { motif },
    });
    revalidatePath("/pointage/rh/presence");
    return { status: "success", message: "Motif ajouté avec succès" };
  } catch (error) {
    console.error("Erreur ajouterMotifRetard:", error);
    return { status: "error", message: "Erreur lors de l'ajout du motif" };
  }
}

export async function recoverAbsencesAction(dateStr: string) {
  const session = await getSession();
  if (!session || !hasPermission(session, "pointage.corriger_pointage")) {
    return { status: "error", message: "Non autorisé" };
  }

  try {
    const targetDate = new Date(dateStr);
    const today = new Date();
    
    const dateStart = startOfDay(targetDate);
    const dateEnd = endOfDay(targetDate);
    const isToday = targetDate.toDateString() === today.toDateString();

    if (targetDate > today && !isToday) {
      return { status: "error", message: "Cette date est dans le futur." };
    }

    if (isToday) {
      const parametrage = await prisma.parametrageHoraire.findFirst({ where: { isActive: true } });
      let isEndOfDayPassed = false;
      
      if (parametrage && parametrage.heureFinApresMidi) {
        const [endHour, endMinute] = parametrage.heureFinApresMidi.split(":").map(Number);
        if (today.getHours() > endHour || (today.getHours() === endHour && today.getMinutes() >= endMinute)) {
          isEndOfDayPassed = true;
        }
      } else if (today.getHours() >= 18) {
         isEndOfDayPassed = true;
      }
      
      if (!isEndOfDayPassed) {
         return { status: "error", message: "L'heure de fin de journée n'est pas encore passée." };
      }
    }

    const jourFerie = await prisma.jourFerie.findFirst({
       where: { date: { gte: dateStart, lte: dateEnd } }
    });
    if (jourFerie) return { status: "error", message: "Cette date est un jour férié." };

    const dayOfWeek = targetDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) return { status: "error", message: "Cette date est un week-end." };

    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        role: { permissions: { some: { permission: { key: "pointage.pointer" } } } }
      },
      select: { id: true }
    });

    const pointages = await prisma.pointage.findMany({
      where: { type: "ARRIVEE", heure: { gte: dateStart, lte: dateEnd } },
      select: { userId: true }
    });
    const pointagesSet = new Set(pointages.map(p => p.userId));

    const absences = await prisma.absence.findMany({
      where: { date: { gte: dateStart, lte: dateEnd } },
      select: { userId: true }
    });
    const absencesSet = new Set(absences.map(a => a.userId));

    const absencesToCreate: Prisma.AbsenceCreateManyInput[] = [];

    for (const user of users) {
      if (!pointagesSet.has(user.id) && !absencesSet.has(user.id)) {
        absencesToCreate.push({
          userId: user.id,
          date: targetDate,
          statut: "A_CONTROLER"
        });
      }
    }

    if (absencesToCreate.length > 0) {
      await prisma.absence.createMany({ data: absencesToCreate });
    }

    revalidatePath("/pointage/rh/presence");
    return { status: "success", message: `${absencesToCreate.length} absence(s) récupérée(s) avec succès.`, count: absencesToCreate.length };

  } catch (error) {
    console.error("Erreur recoverAbsencesAction:", error);
    return { status: "error", message: "Erreur serveur interne" };
  }
}
