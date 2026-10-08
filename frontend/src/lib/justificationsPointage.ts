// Pointage V2, lot 4 (2026-10-08) : lecture des justifications et calcul du décideur ACTUEL.
//
// Le décideur n'est jamais stocké avant la décision : il est recalculé à chaque lecture et à chaque action à partir du
// service actuel du collaborateur et de son responsable (`resoudreDecideurJustification`). Les volumes sont faibles
// (quelques retards par jour) : la file d'un décideur est filtrée en code.

import {
  prisma,
  refusDecideur,
  resoudreDecideurJustification,
  PERMISSION_RH_POINTAGE,
  type DecideurJustification,
  type Prisma,
  type StatutJustificationPointage,
} from "backend";
import { hasPermission } from "@/lib/auth";

/** Collaborateur avec son service actuel et le responsable de ce service (de quoi résoudre le décideur). */
export const SELECT_COLLABORATEUR_JUSTIFICATION = {
  id: true,
  fullName: true,
  service: {
    select: {
      name: true,
      responsableId: true,
      responsable: { select: { isActive: true, fullName: true } },
    },
  },
} satisfies Prisma.UserSelect;

export type CollaborateurJustification = Prisma.UserGetPayload<{ select: typeof SELECT_COLLABORATEUR_JUSTIFICATION }>;

/** Décideur actuel d'une justification de ce collaborateur. */
export function decideurDuCollaborateur(collaborateur: CollaborateurJustification): DecideurJustification {
  const s = collaborateur.service;
  return resoudreDecideurJustification({
    collaborateurId: collaborateur.id,
    service: s ? { name: s.name, responsableId: s.responsableId, responsableActif: s.responsable?.isActive ?? false } : null,
  });
}

/** Session telle que lue par `getSession()` (les champs utiles ici). */
export interface SessionDecideur {
  user: { id: string };
  permissions: string[];
}

/** Le compte peut-il avoir des justifications à décider (responsable d'au moins un service, ou RH du pointage) ? */
export async function estDecideurJustifications(session: SessionDecideur): Promise<boolean> {
  if (hasPermission(session, PERMISSION_RH_POINTAGE)) return true;
  const n = await prisma.service.count({ where: { responsableId: session.user.id } });
  return n > 0;
}

const INCLUDE_JUSTIFICATION = {
  pointage: {
    select: {
      id: true,
      type: true,
      heure: true,
      minutesRetard: true,
      user: { select: SELECT_COLLABORATEUR_JUSTIFICATION },
    },
  },
  decideur: { select: { fullName: true } },
} satisfies Prisma.JustificationPointageInclude;

export type JustificationAvecContexte = Prisma.JustificationPointageGetPayload<{ include: typeof INCLUDE_JUSTIFICATION }>;

/**
 * Justifications dont le compte est le décideur ACTUEL, dans les statuts demandés (les plus anciennes d'abord pour une
 * file à traiter). `inclureDecideesPar` ajoute celles qu'il a lui-même décidées (onglet « Traitées »), même si le
 * responsable du service a changé depuis.
 */
export async function chargerJustificationsDecideur(
  session: SessionDecideur,
  statuts: StatutJustificationPointage[],
  options: { inclureDecideesPar?: boolean; ordre?: "asc" | "desc"; limite?: number } = {}
): Promise<JustificationAvecContexte[]> {
  const lignes = await prisma.justificationPointage.findMany({
    where: { statut: { in: statuts } },
    include: INCLUDE_JUSTIFICATION,
    orderBy: options.ordre === "desc" ? { updatedAt: "desc" } : { soumiseAt: "asc" },
    take: options.limite,
  });
  const acteur = { id: session.user.id, permissions: session.permissions };
  return lignes.filter((j) => {
    if (options.inclureDecideesPar && j.decideurId === session.user.id) return true;
    const collaborateur = j.pointage.user;
    return refusDecideur(decideurDuCollaborateur(collaborateur), acteur, collaborateur.id) === null;
  });
}
