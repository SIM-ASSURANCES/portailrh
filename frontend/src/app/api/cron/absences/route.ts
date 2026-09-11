import { NextResponse } from "next/server";
import { prisma } from "backend";
import type { Prisma } from "backend";

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

    // Fetch ParametrageHoraire to get end of day
    const parametrage = await prisma.parametrageHoraire.findFirst({
      where: { isActive: true }
    });

    // Check if current time has passed heureFinApresMidi
    let hasPassedEndOfDay = false;
    const now = new Date();
    if (parametrage && parametrage.heureFinApresMidi) {
      const [endHour, endMinute] = parametrage.heureFinApresMidi.split(":").map(Number);
      if (now.getHours() > endHour || (now.getHours() === endHour && now.getMinutes() >= endMinute)) {
        hasPassedEndOfDay = true;
      }
    } else {
      // Fallback: 18:00
      if (now.getHours() >= 18) {
        hasPassedEndOfDay = true;
      }
    }

    // 2. Récupérer tous les collaborateurs qui doivent pointer (ceux qui ont la permission pointage.pointer)
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        role: {
          permissions: {
            some: {
              permission: {
                key: "pointage.pointer"
              }
            }
          }
        }
      },
      select: { id: true }
    });

    let nouvellesAbsences = 0;

    // 3. Boucle de rattrapage : on analyse les 2 derniers jours (y compris aujourd'hui)
    const joursAnalyses = 2;

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

      // Skip today if the end of the work day hasn't passed yet
      if (i === 0 && !hasPassedEndOfDay) continue;

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

    // 4. Détection des oublis de pointage de départ (uniquement pour la journée en cours)
    let oublisDetectes = 0;
    if (hasPassedEndOfDay) {
      const todayStart = new Date(today);
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(today);
      todayEnd.setHours(23, 59, 59, 999);

      const pointagesArriveeAuj = await prisma.pointage.findMany({
        where: { type: "ARRIVEE", heure: { gte: todayStart, lte: todayEnd } },
        include: { user: { select: { id: true, fullName: true } } }
      });

      const pointagesDepartAuj = await prisma.pointage.findMany({
        where: { type: "DEPART", heure: { gte: todayStart, lte: todayEnd } },
        select: { userId: true }
      });
      const departAujSet = new Set(pointagesDepartAuj.map(p => p.userId));

      const adminsAndRh = await prisma.user.findMany({
        where: { isActive: true, role: { name: { in: ["ADMIN", "RH"] } } },
        select: { id: true }
      });

      for (const arrivee of pointagesArriveeAuj) {
        // S'il n'y a pas de pointage de départ pour ce collaborateur aujourd'hui
        if (!departAujSet.has(arrivee.userId)) {
          // Vérifier si la notification a déjà été envoyée aujourd'hui
          const existingNotif = await prisma.notification.findFirst({
            where: {
              userId: arrivee.userId,
              titre: "Oubli de pointage de départ",
              createdAt: { gte: todayStart }
            }
          });

          if (!existingNotif) {
             // Notifier le collaborateur concerné
             await prisma.notification.create({
               data: {
                 userId: arrivee.userId,
                 titre: "Oubli de pointage de départ",
                 message: "Vous avez pointé votre arrivée mais vous avez oublié de pointer votre départ aujourd'hui.",
                 lien: "/pointage/historique"
               }
             });

             // Notifier les RH et Administrateurs
             const alertNotifs = adminsAndRh.map(admin => ({
               userId: admin.id,
               titre: "Oubli de pointage détecté",
               message: `Le collaborateur ${arrivee.user.fullName} n'a pas pointé son départ aujourd'hui.`,
               lien: `/pointage/rh/presence?date=${formatDate(today)}`
             }));

             if (alertNotifs.length > 0) {
               await prisma.notification.createMany({ data: alertNotifs });
             }

             oublisDetectes++;
          }
        }
      }
    }

    let baseMessage = `Cron exécuté avec succès. ${nouvellesAbsences} nouvelle(s) absence(s) détectée(s) sur les ${joursAnalyses} derniers jours. ${oublisDetectes} oubli(s) de pointage notifié(s).`;
    
    if (!hasPassedEndOfDay) {
      baseMessage += " L'heure de fin de journée n'est pas encore passée. Seules les absences des jours précédents ont été analysées.";
    }

    return NextResponse.json({
      success: true,
      message: baseMessage
    });
  } catch (error) {
    console.error("Erreur lors du cron des absences:", error);
    return NextResponse.json({ error: "Erreur serveur interne" }, { status: 500 });
  }
}
