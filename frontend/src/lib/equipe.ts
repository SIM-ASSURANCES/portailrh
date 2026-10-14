import { USER_CAN_POINT_WHERE, prisma } from "backend";

export interface MembreEquipe {
  id: string;
  fullName: string;
  service: string | null;
}

export interface EquipeResponsable {
  services: Array<{ id: string; name: string }>;
  membres: MembreEquipe[];
}

/**
 * Équipe d'un responsable (« Mon équipe », phase 5 de la fiabilisation du pointage) : les membres ACTIFS des services dont
 * il est le responsable ACTUEL (`Service.responsableId`, désignation dans Admin > Services — aucune permission), SANS lui-même,
 * parmi les comptes qui pointent (`USER_CAN_POINT_WHERE`, le périmètre du reporting RH). Relue à chaque appel : un changement
 * de responsable ou de service est pris en compte immédiatement. `services` vide = pas responsable (accès refusé).
 */
export async function chargerEquipeResponsable(responsableId: string): Promise<EquipeResponsable> {
  const services = await prisma.service.findMany({
    where: { responsableId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (services.length === 0) return { services, membres: [] };
  const membres = await prisma.user.findMany({
    where: {
      AND: [USER_CAN_POINT_WHERE, { serviceId: { in: services.map((s) => s.id) }, id: { not: responsableId } }],
    },
    select: { id: true, fullName: true, service: { select: { name: true } } },
    orderBy: { fullName: "asc" },
  });
  return { services, membres: membres.map((m) => ({ id: m.id, fullName: m.fullName, service: m.service?.name ?? null })) };
}
