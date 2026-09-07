import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export async function GET(request: Request) {
  // Basic security check (Mandatory for Cron jobs)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. Date de lancement du système
    const systemStartDateStr = process.env.SYSTEM_START_DATE || "2026-09-07";
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
    
    const dateMin = new Date(today);
    dateMin.setDate(today.getDate() - (joursAnalyses - 1));
    dateMin.setHours(0, 0, 0, 0);

    const startOfPeriod = dateMin < systemStartDate ? systemStartDate : dateMin;
    const endOfPeriod = new Date(today);
    endOfPeriod.setHours(23, 59, 59, 999);

    const formatDate = (date: Date) => {
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };

    const joursFeries = await prisma.jourFerie.findMany({
      where: { date: { gte: startOfPeriod, lte: endOfPeriod } }
    });
    const joursFeriesSet = new Set(joursFeries.map(jf => formatDate(jf.date)));

    const pointages = await prisma.pointage.findMany({
      where: { type: "ARRIVEE", heure: { gte: startOfPeriod, lte: endOfPeriod } },
      select: { userId: true, heure: true }
    });
    const pointagesSet = new Set(pointages.map(p => `${p.userId}_${formatDate(p.heure)}`));

    const absences = await prisma.absence.findMany({
      where: { date: { gte: startOfPeriod, lte: endOfPeriod } },
      select: { userId: true, date: true }
    });
    const absencesSet = new Set(absences.map(a => `${a.userId}_${formatDate(a.date)}`));

    const absencesToCreate: Prisma.AbsenceCreateManyInput[] = [];

    for (let i = 0; i < joursAnalyses; i++) {
      const currentDate = new Date(today);
      currentDate.setDate(today.getDate() - i);
      currentDate.setHours(0, 0, 0, 0);

      if (currentDate < systemStartDate) continue;

      const dayOfWeek = currentDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;

      const dateStr = formatDate(currentDate);
      if (joursFeriesSet.has(dateStr)) continue;

      for (const user of users) {
        const key = `${user.id}_${dateStr}`;
        if (!pointagesSet.has(key) && !absencesSet.has(key)) {
          absencesToCreate.push({
            userId: user.id,
            date: currentDate,
            statut: "A_CONTROLER"
          });
          absencesSet.add(key);
        }
      }
    }

    if (absencesToCreate.length > 0) {
      await prisma.absence.createMany({
        data: absencesToCreate
      });
      nouvellesAbsences = absencesToCreate.length;
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
