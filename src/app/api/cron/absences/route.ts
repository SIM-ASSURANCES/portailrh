import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  // Basic security check (Optional but recommended for Cron jobs)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
  //   return new NextResponse("Unauthorized", { status: 401 });
  // }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. Date de lancement du système
    const systemStartDateStr = process.env.SYSTEM_START_DATE || "2026-09-01";
    const systemStartDate = new Date(systemStartDateStr);
    systemStartDate.setHours(0, 0, 0, 0);

    // 2. Récupérer tous les collaborateurs qui doivent pointer (hors ADMIN)
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        role: { name: { not: "ADMIN" } }
      },
      select: { id: true }
    });

    let nouvellesAbsences = 0;

    // 3. Boucle de rattrapage : on analyse les 5 derniers jours (y compris aujourd'hui)
    const joursAnalyses = 5;

    for (let i = 0; i < joursAnalyses; i++) {
      const currentDate = new Date(today);
      currentDate.setDate(today.getDate() - i);

      // On ne vérifie pas avant la date de mise en production du système
      if (currentDate < systemStartDate) {
        continue;
      }

      // Ignorer les week-ends
      const dayOfWeek = currentDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        continue;
      }

      const startOfDay = new Date(currentDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(currentDate);
      endOfDay.setHours(23, 59, 59, 999);

      // Vérifier si c'est un jour férié
      const jourFerie = await prisma.jourFerie.findFirst({
        where: {
          date: {
            gte: startOfDay,
            lte: endOfDay
          }
        }
      });

      if (jourFerie) {
        continue; // Pas d'absence sur un jour férié
      }

      // Pour ce jour précis, on vérifie chaque collaborateur
      for (const user of users) {
        // A-t-il pointé son arrivée ?
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
          // A-t-il déjà une absence enregistrée pour ce jour ? (pour éviter les doublons)
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
                date: startOfDay, // On stocke la date exacte de l'absence
                statut: "A_CONTROLER"
              }
            });
            nouvellesAbsences++;
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Cron exécuté avec succès. ${nouvellesAbsences} nouvelle(s) absence(s) détectée(s) sur les ${joursAnalyses} derniers jours.`
    });
  } catch (error) {
    console.error("Erreur lors du cron des absences:", error);
    return NextResponse.json({ error: "Erreur serveur interne" }, { status: 500 });
  }
}
