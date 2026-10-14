import { prisma } from "./prisma";
import { Prisma } from "./generated/prisma/client";
import { z } from "zod";
import { justificationAffichee, type JustificationLue } from "./justificationPointage";

export const pointageReportingSchema = z.object({
  dateDebut: z.string().optional(),
  dateFin: z.string().optional(),
  userId: z.string().optional(),
  service: z.string().optional(),
});

export type PointageReportingFilters = z.infer<typeof pointageReportingSchema> & {
  /** Restreint aux comptes listés (« Mon équipe », phase 5 de la fiabilisation) ; absent = tous. */
  userIds?: string[];
};

/**
 * Filtre d'identifiants de comptes d'un reporting : `userId` (un seul compte) et `userIds` (une liste) se combinent
 * par intersection ; `undefined` = aucun filtre.
 */
export function filtreIdentifiants(filters: Pick<PointageReportingFilters, "userId" | "userIds">): string | { in: string[] } | undefined {
  if (filters.userIds) {
    if (filters.userId) return { in: filters.userIds.includes(filters.userId) ? [filters.userId] : [] };
    return { in: filters.userIds };
  }
  return filters.userId;
}

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

export const USER_CAN_POINT_WHERE: Prisma.UserWhereInput = {
  isActive: true,
  OR: [
    {
      role: {
        permissions: {
          some: {
            permission: {
              key: "pointage.pointer",
            },
          },
        },
      },
    },
    {
      delegationsRecues: {
        some: {
          estActive: true,
          revokedAt: null,
          permission: {
            key: "pointage.pointer",
          },
        },
      },
    },
  ],
};

export async function getServicesUniques(): Promise<string[]> {
  const services = await prisma.service.findMany({
    where: {
      users: {
        some: USER_CAN_POINT_WHERE,
      },
    },
    orderBy: { name: "asc" },
    select: { name: true },
  });
  return services.map((s) => s.name);
}

export async function getCollaborateursFiltres() {
  const users = await prisma.user.findMany({
    where: USER_CAN_POINT_WHERE,
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
  const whereUser: Prisma.UserWhereInput = {
    ...USER_CAN_POINT_WHERE,
  };
  const idFiltre = filtreIdentifiants(filters);
  if (idFiltre !== undefined) whereUser.id = idFiltre;
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

/** Détail du reporting : retards (arrivées) ou départs anticipés. */
export type TypeDetailPointage = "RETARD" | "DEPART_ANTICIPE";

/** Pagination de l'écran ; absente = toutes les lignes (export complet). */
export interface PaginationDetails {
  skip: number;
  take: number;
}

/**
 * Requête du détail, partagée par l'écran et l'export (même filtre, même tri) : seule la pagination diffère. Retard =
 * arrivée avec `estRetard`, départ anticipé = départ avec `estDepartAnticipe`, tous deux calculés au pointage (lot 3),
 * jamais recalculés ici.
 */
export function construireRequeteDetails(
  type: TypeDetailPointage,
  filters: PointageReportingFilters,
  pagination?: PaginationDetails,
) {
  const where: Prisma.PointageWhereInput =
    type === "RETARD" ? { type: "ARRIVEE", estRetard: true } : { type: "DEPART", estDepartAnticipe: true };
  where.user = {
    ...USER_CAN_POINT_WHERE,
    ...(filters.service ? { service: { name: filters.service } } : {}),
  };
  const idFiltre = filtreIdentifiants(filters);
  if (idFiltre !== undefined) where.userId = idFiltre;
  if (filters.dateDebut || filters.dateFin) {
    where.heure = {};
    if (filters.dateDebut) where.heure.gte = new Date(filters.dateDebut);
    if (filters.dateFin) {
      const fin = new Date(filters.dateFin);
      fin.setHours(23, 59, 59, 999);
      where.heure.lte = fin;
    }
  }
  return {
    where,
    orderBy: { heure: "desc" as const },
    ...(pagination ? { skip: pagination.skip, take: pagination.take } : {}),
  };
}

interface PointageDetailLu {
  id: string;
  heure: Date;
  heurePrevue: string | null;
  minutesRetard: number | null;
  motif: string | null;
  user: { fullName: string; service: { name: string } | null };
  justification: JustificationLue | null;
}

/** Une ligne du détail : une seule source pour l'écran et l'export (`justificationAffichee`). */
export function ligneDetailPointage(r: PointageDetailLu) {
  const j = justificationAffichee({ motif: r.motif, justification: r.justification });
  return {
    id: r.id,
    collaborateur: r.user.fullName,
    service: r.user.service?.name ?? null,
    date: r.heure,
    heurePrevue: r.heurePrevue,
    heureReelle: r.heure,
    minutesRetard: r.minutesRetard,
    justificationStatut: j.statut,
    justification: j.libelle,
    motif: j.motif,
    decideePar: j.decideePar,
  };
}

export type LigneDetailPointage = ReturnType<typeof ligneDetailPointage>;

async function getDetails(type: TypeDetailPointage, filters: PointageReportingFilters, pagination?: PaginationDetails) {
  const requete = construireRequeteDetails(type, filters, pagination);
  const [lignes, total] = await Promise.all([
    prisma.pointage.findMany({
      ...requete,
      include: {
        user: { select: { fullName: true, service: { select: { name: true } } } },
        // Pointage V2, lot 7 : statut réel de la justification, son motif et l'auteur de la décision.
        justification: { select: { statut: true, motif: true, decideur: { select: { fullName: true } } } },
      },
    }),
    prisma.pointage.count({ where: requete.where }),
  ]);
  return { data: lignes.map(ligneDetailPointage), total };
}

/** Détail des retards ; sans pagination, toutes les lignes (export). */
export function getDetailsRetards(filters: PointageReportingFilters, pagination?: PaginationDetails) {
  return getDetails("RETARD", filters, pagination);
}

/** Détail des départs anticipés ; sans pagination, toutes les lignes (export). */
export function getDetailsDepartsAnticipes(filters: PointageReportingFilters, pagination?: PaginationDetails) {
  return getDetails("DEPART_ANTICIPE", filters, pagination);
}

export interface SyntheseEquipeMembre {
  userId: string;
  departsAnticipes: number;
  /** Justifications refusées ou clôturées sans justification (statuts REFUSEE et NON_JUSTIFIEE) sur la période. */
  justificationsRefuseesOuNonJustifiees: number;
}

/**
 * Compléments du reporting pour « Mon équipe » : départs anticipés et justifications refusées ou non justifiées par
 * membre sur la période. Même périmètre de pointages que le reporting (`construireRequeteDetails`) : retards, absences et
 * minutes viennent de `getReportingAgrégé`, jamais recalculés ailleurs.
 */
export async function getSyntheseEquipe(filters: PointageReportingFilters): Promise<Map<string, SyntheseEquipeMembre>> {
  const departs = construireRequeteDetails("DEPART_ANTICIPE", filters);
  const [departsPar, justifications] = await Promise.all([
    prisma.pointage.groupBy({ by: ["userId"], where: departs.where, _count: { id: true } }),
    prisma.justificationPointage.findMany({
      where: {
        statut: { in: ["REFUSEE", "NON_JUSTIFIEE"] },
        pointage: {
          ...(departs.where.heure ? { heure: departs.where.heure } : {}),
          userId: filtreIdentifiants(filters),
          user: { ...USER_CAN_POINT_WHERE, ...(filters.service ? { service: { name: filters.service } } : {}) },
        },
      },
      select: { pointage: { select: { userId: true } } },
    }),
  ]);
  const synthese = new Map<string, SyntheseEquipeMembre>();
  const ligne = (userId: string) => {
    let l = synthese.get(userId);
    if (!l) synthese.set(userId, (l = { userId, departsAnticipes: 0, justificationsRefuseesOuNonJustifiees: 0 }));
    return l;
  };
  for (const d of departsPar) ligne(d.userId).departsAnticipes = d._count.id;
  for (const j of justifications) ligne(j.pointage.userId).justificationsRefuseesOuNonJustifiees += 1;
  return synthese;
}
