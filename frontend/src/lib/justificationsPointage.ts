// Pointage V2, lot 4 (2026-10-08) : lecture des justifications et calcul du décideur ACTUEL.
//
// Le décideur n'est jamais stocké avant la décision : il est recalculé à chaque lecture et à chaque action à partir du
// service actuel du collaborateur et de son responsable (`resoudreDecideurJustification`). Les volumes sont faibles
// (quelques retards par jour) : la file d'un décideur est filtrée en code.

import {
  prisma,
  refusDecideur,
  resoudreDecideurJustification,
  PERMISSION_DG_JUSTIFICATION,
  PERMISSION_RH_POINTAGE,
  compteurMenuJustifications,
  type DecideurJustification,
  type Prisma,
  type StatutJustificationPointage,
} from "backend";

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

/**
 * Comptes RH du pointage : actifs, dont le RÔLE porte `PERMISSION_RH_POINTAGE` (même lecture que `notifyByPermission`).
 * Sert à savoir si un autre compte RH que le collaborateur peut décider, sinon le DG décide (2026-10-12).
 */
export async function chargerComptesRH(): Promise<string[]> {
  const comptes = await prisma.user.findMany({
    where: { isActive: true, role: { permissions: { some: { permission: { key: PERMISSION_RH_POINTAGE } } } } },
    select: { id: true },
  });
  return comptes.map((c) => c.id);
}

/** Décideur actuel d'une justification de ce collaborateur (`comptesRH` : `chargerComptesRH`). */
export function decideurDuCollaborateur(
  collaborateur: CollaborateurJustification,
  comptesRH: readonly string[]
): DecideurJustification {
  const s = collaborateur.service;
  return resoudreDecideurJustification({
    collaborateurId: collaborateur.id,
    service: s ? { name: s.name, responsableId: s.responsableId, responsableActif: s.responsable?.isActive ?? false } : null,
    comptesRH,
  });
}

/**
 * Session telle que lue par `getSession()` (les champs utiles ici). Le droit de DÉCIDER une justification se lit sur
 * `rolePermissions` (rôle réel), jamais sur `permissions` qui inclut les délégations (2026-10-12).
 */
export interface SessionDecideur {
  user: { id: string };
  rolePermissions: string[];
}

/**
 * Le compte peut-il avoir des justifications à décider : responsable d'au moins un service, RH du pointage, ou DG
 * quand le repli est possible (au plus un compte RH actif : le seul RH ne décide pas sa propre justification) ou qu'il
 * a déjà décidé (onglet « Traitées »).
 */
export async function estDecideurJustifications(session: SessionDecideur): Promise<boolean> {
  if (session.rolePermissions.includes(PERMISSION_RH_POINTAGE)) return true;
  const n = await prisma.service.count({ where: { responsableId: session.user.id } });
  if (n > 0) return true;
  if (!session.rolePermissions.includes(PERMISSION_DG_JUSTIFICATION)) return false;
  if ((await chargerComptesRH()).length <= 1) return true;
  return (await prisma.justificationPointage.count({ where: { decideurId: session.user.id } })) > 0;
}

/**
 * Compteur du menu « Justifications » (`null` : menu masqué) — `compteurMenuJustifications` : RH toujours ; DG
 * seulement si sa file n'est pas vide ou s'il a déjà décidé (même responsable d'un service) ; autre responsable toujours.
 */
export async function compteurMenuJustificationsSession(session: SessionDecideur): Promise<number | null> {
  const estRH = session.rolePermissions.includes(PERMISSION_RH_POINTAGE);
  const estDG = session.rolePermissions.includes(PERMISSION_DG_JUSTIFICATION);
  const estResponsable = (await prisma.service.count({ where: { responsableId: session.user.id } })) > 0;
  if (!estRH && !estDG && !estResponsable) return null;
  const file = (await chargerJustificationsDecideur(session, ["SOUMISE"])).length;
  const dejaDecide =
    !estRH && estDG && file === 0
      ? (await prisma.justificationPointage.count({ where: { decideurId: session.user.id } })) > 0
      : false;
  return compteurMenuJustifications({ estResponsable, estRH, estDG, file, dejaDecide });
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
  const acteur = { id: session.user.id, rolePermissions: session.rolePermissions };
  const comptesRH = await chargerComptesRH();
  return lignes.filter((j) => {
    if (options.inclureDecideesPar && j.decideurId === session.user.id) return true;
    const collaborateur = j.pointage.user;
    return refusDecideur(decideurDuCollaborateur(collaborateur, comptesRH), acteur, collaborateur.id) === null;
  });
}
