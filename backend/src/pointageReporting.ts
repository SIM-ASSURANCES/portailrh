import { prisma } from "./prisma";
import { Prisma } from "./generated/prisma/client";
import { z } from "zod";

export const pointageReportingSchema = z.object({
  dateDebut: z.string().optional(),
  dateFin: z.string().optional(),
  userId: z.string().optional(),
  service: z.string().optional(),
});

export type PointageReportingFilters = z.infer<typeof pointageReportingSchema>;

export function getReportingPeriodConstraints(dateDebut?: string, dateFin?: string) {
  if (!dateDebut || !dateFin) return { error: null };
  const debut = new Date(dateDebut);
  const fin = new Date(dateFin);
  const diffTime = Math.abs(fin.getTime() - debut.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays > 180) {
    return { error: "La période sélectionnée ne peut pas dépasser 6 mois (180 jours)." };
  }
  return { error: null };
}

export async function getServicesUniques(): Promise<string[]> {
  const services = await prisma.service.findMany({
    orderBy: { name: "asc" },
    select: { name: true },
  });
  return services.map((s) => s.name);
}

export async function getCollaborateursFiltres() {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, fullName: true, service: { select: { name: true } } },
    orderBy: { fullName: "asc" },
  });
  return users.map((u) => ({
    id: u.id,
    fullName: u.fullName,
    service: u.service?.name ?? null,
  }));
}

export async function getReportingAgrégé(filters: PointageReportingFilters) {
  const whereUser: Prisma.UserWhereInput = {};
  if (filters.userId) whereUser.id = filters.userId;
  if (filters.service) whereUser.service = { name: filters.service };

  const wherePointage: Prisma.PointageWhereInput = {};
  if (filters.dateDebut || filters.dateFin) {
    wherePointage.heure = {};
    if (filters.dateDebut) wherePointage.heure.gte = new Date(filters.dateDebut);
    if (filters.dateFin) {
      const fin = new Date(filters.dateFin);
      fin.setHours(23, 59, 59, 999);
      wherePointage.heure.lte = fin;
    }
  }

  const whereAbsence: Prisma.AbsenceWhereInput = {};
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
      service: { select: { name: true } },
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
      service: u.service?.name ?? null,
      joursTravailles,
      presences,
      absences,
      joursRetard,
      minutesRetard,
    };
  });
}

export async function getDetailsRetards(filters: PointageReportingFilters, skip = 0, take = 50) {
  const where: Prisma.PointageWhereInput = { type: "ARRIVEE", estRetard: true };

  if (filters.userId) where.userId = filters.userId;
  if (filters.service) where.user = { service: { name: filters.service } };

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
        select: { fullName: true, service: { select: { name: true } } },
      },
    },
    orderBy: { heure: "desc" },
    skip,
    take,
  });

  const total = await prisma.pointage.count({ where });

  return {
    data: retards.map((r) => ({
      id: r.id,
      collaborateur: r.user.fullName,
      service: r.user.service?.name ?? null,
      date: r.heure,
      heurePrevue: r.heurePrevue,
      heureReelle: r.heure,
      minutesRetard: r.minutesRetard,
      motif: r.motif,
    })),
    total,
  };
}

