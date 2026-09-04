import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  // Basic security check (Optional but recommended for Cron jobs)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const today = new Date();

    // 1. Vérifier si on est avant la date de lancement
    const systemStartDateStr = process.env.SYSTEM_START_DATE || "2026-09-01";
    const systemStartDate = new Date(systemStartDateStr);

    if (today < systemStartDate) {
      return NextResponse.json({ message: "Système non encore actif (avant SYSTEM_START_DATE). Ignoré." });
    }

    // 2. Vérifier si c'est le week-end
    const dayOfWeek = today.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return NextResponse.json({ message: "Week-end. Pas de détection d'absence." });
    }

    // 3. Vérifier si c'est un jour férié
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const jourFerie = await prisma.jourFerie.findFirst({
      where: {
        date: {
          gte: startOfDay,
          lte: endOfDay
        }
      }
    });

    if (jourFerie) {
      return NextResponse.json({ message: "Jour férié. Pas de détection d'absence." });
    }

    // 4. Récupérer tous les collaborateurs qui doivent pointer (hors ADMIN)
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        role: { name: { not: "ADMIN" } }
      },
      select: { id: true }
    });

    let nouvellesAbsences = 0;

    for (const user of users) {
      // 5. Vérifier s'il y a un pointage "ARRIVEE" aujourd'hui
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
        // 6. Vérifier s'il y a déjà une absence pour éviter les doublons
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

    return NextResponse.json({
      success: true,
      message: `Cron exécuté avec succès. ${nouvellesAbsences} absence(s) détectée(s) pour aujourd'hui.`
    });
  } catch (error) {
    console.error("Erreur lors du cron des absences:", error);
    return NextResponse.json({ error: "Erreur serveur interne" }, { status: 500 });
  }
}
