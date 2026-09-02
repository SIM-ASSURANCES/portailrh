import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const pointageReportingSchema = z.object({
  dateDebut: z.string().optional(),
  dateFin: z.string().optional(),
  userId: z.string().optional(),
  service: z.string().optional(),
});

export type PointageReportingFilters = z.infer<typeof pointageReportingSchema>;

export async function getServicesUniques() {
  const users = await prisma.user.findMany({
    where: { service: { not: null } },
    select: { service: true },
    distinct: ["service"],
  });
  return users.map((u) => u.service as string).filter(Boolean);
}

export async function getCollaborateursFiltres() {
  return await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, fullName: true, service: true },
    orderBy: { fullName: "asc" },
  });
}

export async function getReportingAgrégé(filters: PointageReportingFilters) {
  const whereUser: any = {};
  if (filters.userId) whereUser.id = filters.userId;
  if (filters.service) whereUser.service = filters.service;

  const wherePointage: any = {};
  if (filters.dateDebut || filters.dateFin) {
    wherePointage.heure = {};
    if (filters.dateDebut) wherePointage.heure.gte = new Date(filters.dateDebut);
    if (filters.dateFin) {
      const fin = new Date(filters.dateFin);
      fin.setHours(23, 59, 59, 999);
      wherePointage.heure.lte = fin;
    }
  }

  const whereAbsence: any = {};
  if (filters.dateDebut || filters.dateFin) {
    whereAbsence.date = {};
    if (filters.dateDebut) whereAbsence.date.gte = new Date(filters.dateDebut);
    if (filters.dateFin) {
      const fin = new Date(filters.dateFin);
      fin.setHours(23, 59, 59, 999);
      whereAbsence.date.lte = fin;
    }
  }

  const users = await prisma.user.findMany({
    where: whereUser,
    select: {
      id: true,
      fullName: true,
      service: true,
      pointagesEffectues: {
        where: {
          ...wherePointage,
          type: "ARRIVEE",
        },
        select: {
          estRetard: true,
          minutesRetard: true,
        },
      },
      absencesDeclarees: {
        where: whereAbsence,
        select: { id: true },
      }
    },
    orderBy: { fullName: "asc" },
  });

  return users.map((u) => {
    const presences = u.pointagesEffectues.length;
    const absences = u.absencesDeclarees.length;
    const joursTravailles = presences + absences;

    const retards = u.pointagesEffectues.filter((p) => p.estRetard);
    const joursRetard = retards.length;
    const minutesRetard = retards.reduce((acc, p) => acc + (p.minutesRetard || 0), 0);
    
    return {
      id: u.id,
      fullName: u.fullName,
      service: u.service,
      joursTravailles,
      presences,
      absences,
      joursRetard,
      minutesRetard,
    };
  });
}

export async function getDetailsRetards(filters: PointageReportingFilters) {
  const where: any = { type: "ARRIVEE", estRetard: true };

  if (filters.userId) where.userId = filters.userId;
  if (filters.service) where.user = { service: filters.service };

  if (filters.dateDebut || filters.dateFin) {
    where.heure = {};
    if (filters.dateDebut) where.heure.gte = new Date(filters.dateDebut);
    if (filters.dateFin) {
      const fin = new Date(filters.dateFin);
      fin.setHours(23, 59, 59, 999);
      where.heure.lte = fin;
    }
  }

  const retards = await prisma.pointage.findMany({
    where,
    include: {
      user: {
        select: { fullName: true, service: true },
      },
    },
    orderBy: { heure: "desc" },
  });

  return retards.map((r) => ({
    id: r.id,
    collaborateur: r.user.fullName,
    service: r.user.service,
    date: r.heure,
    heurePrevue: r.heurePrevue,
    heureReelle: r.heure,
    minutesRetard: r.minutesRetard,
    motif: r.motif,
  }));
}
