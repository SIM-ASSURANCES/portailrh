import { endOfDay, startOfDay } from "date-fns";
import { horairesPointage, justificationAffichee, prisma, utilisateursCouvertsParAbsence } from "backend";

import type { PresenceData } from "@/app/(dashboard)/pointage/rh/presence/PresenceTabs";

/**
 * Présence d'une journée : une seule lecture, partagée par la page « Présence du jour » de la RH (tous les comptes) et par
 * « Mon équipe » du responsable (`userIds` = ses membres). Extraite de la page de la RH le 2026-10-14 (phase 5 de la
 * fiabilisation du pointage) : aucun second calcul, la restriction par `userIds` s'applique à chaque requête.
 *
 * Retard, minutes et départ anticipé sont ceux stockés au pointage (règles du lot 3) ; justification via
 * `justificationAffichee` ; absences autorisées via `utilisateursCouvertsParAbsence` (même règle que le cron des absences).
 */
export async function chargerPresenceJour(now: Date, userIds?: string[]) {
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;
  const filtreComptes = userIds ? { userId: { in: userIds } } : {};

  const [pointagesDb, absentsDb, parametrage, jourFerie, plagesDuJour] = await Promise.all([
    prisma.pointage.findMany({
      where: {
        heure: { gte: todayStart, lte: todayEnd },
        user: { isActive: true },
        ...filtreComptes,
      },
      orderBy: { heure: "asc" },
      select: {
        id: true,
        userId: true,
        type: true,
        heure: true,
        heurePrevue: true,
        estRetard: true,
        minutesRetard: true,
        estDepartAnticipe: true,
        motif: true,
        source: true,
        geoDistance: true,
        user: { select: { fullName: true, email: true } },
        // Pointage V2, lot 7 : statut réel de la justification (retard ou départ anticipé) et son motif.
        justification: { select: { statut: true, motif: true, decideur: { select: { fullName: true } } } },
      },
    }),
    prisma.absence.findMany({
      where: { date: { gte: todayStart, lte: todayEnd }, user: { isActive: true }, ...filtreComptes },
      include: { user: { select: { fullName: true, email: true } } },
    }),
    prisma.parametrageHoraire.findFirst({ where: { isActive: true } }),
    prisma.jourFerie.findFirst({ where: { date: { gte: todayStart, lte: todayEnd } } }),
    // Pointage V2, lot 7 : absences autorisées du jour (congés, permissions).
    prisma.plageAbsenceAutorisee.findMany({
      where: { date: { gte: todayStart, lte: todayEnd }, user: { isActive: true }, ...filtreComptes },
      select: { userId: true, heureDebut: true, heureFin: true, source: true, user: { select: { fullName: true, email: true } } },
      orderBy: { heureDebut: "asc" },
    }),
  ]);

  const isJourNonOuvre = isWeekend || !!jourFerie;

  const userPointagesMap = new Map<string, PresenceData>();

  pointagesDb.forEach((p) => {
    let u = userPointagesMap.get(p.userId);
    if (!u) {
      u = {
        userId: p.userId,
        fullName: p.user.fullName,
        email: p.user.email,
        estRetard: false,
        minutesRetard: 0,
      };
      userPointagesMap.set(p.userId, u);
    }

    if (p.type === "ARRIVEE" && !u.arrivee) {
      u.arriveeId = p.id;
      u.arrivee = p.heure.toISOString();
      u.arriveePrevue = p.heurePrevue;
      u.sourceArrivee = p.source;
      u.geoDistance = p.geoDistance;
      if (p.estRetard) {
        u.estRetard = true;
        u.minutesRetard = (u.minutesRetard || 0) + (p.minutesRetard || 0);
        // Statut réel et motif de la justification, repli sur l'ancien motif du pointage (`justificationAffichee`).
        u.justification = justificationAffichee(p);
        u.motif = u.justification.motif;
      }
    } else if (p.type === "DEPART" && !u.depart) {
      u.depart = p.heure.toISOString();
      u.departPrevu = p.heurePrevue;
      u.departAnticipe = p.estDepartAnticipe;
      // Départ anticipé : justification lue de la même façon (aucune pour un départ à l'heure).
      if (p.justification) u.justificationDepart = justificationAffichee(p);
    }
  });

  const presents: PresenceData[] = Array.from(userPointagesMap.values());
  const retards = presents.filter((p) => p.estRetard);

  // Absence autorisée (lot 7) : journée entièrement couverte par un congé ou une permission, même règle que le cron des
  // absences (`journeeCouverteParAbsence`) — apparaît comme telle, jamais comme absent ni manquant.
  const presentsIds = presents.map((p) => p.userId);
  const couvertsIds = utilisateursCouvertsParAbsence(plagesDuJour, horairesPointage(parametrage));
  presentsIds.forEach((id) => couvertsIds.delete(id));
  const absentsReels = absentsDb.filter((a) => !couvertsIds.has(a.userId));

  // Calcul des manquants (ni présents, ni déclarés absents, ni en absence autorisée)
  const absentsIds = absentsDb.map((a) => a.userId);
  const exclusIds = [...presentsIds, ...absentsIds, ...couvertsIds];

  const [manquantsDb, activationsRecentes] = await Promise.all([
    prisma.user.findMany({
      where: {
        isActive: true,
        id: { notIn: exclusIds, ...(userIds ? { in: userIds } : {}) },
        // Option B : Le collaborateur n'est attendu que s'il a été créé avant ce jour
        createdAt: { lt: todayStart },
        role: { permissions: { some: { permission: { key: "pointage.pointer" } } } },
      },
      select: { id: true, fullName: true, email: true },
    }),
    prisma.historiqueEntry.findMany({
      where: { entity: "User", action: { in: ["ACTIVATE", "INVITATION_ACTIVATED"] }, createdAt: { gte: todayStart } },
      select: { entityId: true },
    }),
  ]);

  const activationsApresDateIds = new Set(activationsRecentes.map((a) => a.entityId).filter(Boolean));
  const manquantsEffectifs = isJourNonOuvre ? [] : manquantsDb.filter((m) => !activationsApresDateIds.has(m.id));

  const absents: PresenceData[] = absentsReels.map((a) => ({
    userId: a.userId,
    fullName: a.user.fullName,
    email: a.user.email,
  }));

  const autorises: PresenceData[] = [...couvertsIds].map((id) => {
    const plages = plagesDuJour.filter((pl) => pl.userId === id);
    return {
      userId: id,
      fullName: plages[0].user.fullName,
      email: plages[0].user.email,
      absenceAutorisee: plages
        .map((pl) => `${pl.source === "CONGE" ? "Congé" : "Permission"} ${pl.heureDebut}–${pl.heureFin}`)
        .join(", "),
    };
  });

  const manquants: PresenceData[] = manquantsEffectifs.map((m) => ({
    userId: m.id,
    fullName: m.fullName,
    email: m.email,
  }));

  return { presents, retards, absents, autorises, manquants, isJourNonOuvre, jourFerie, parametrage };
}
