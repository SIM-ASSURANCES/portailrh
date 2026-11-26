"use server";

import { getSession, hasPermission, isAdmin } from "@/lib/auth";
import { ENTITE_FEEDBACK_CONDITIONS_TRAVAIL, PERMISSION_FEEDBACK_VOIR_DETAILS, prisma } from "backend";

export async function getLogsAction(skip = 0, take = 50) {
  const session = await getSession();
  // Une Server Action s'appelle directement, sans passer par un layout : le contrôle est fait ICI. Les deux écrans qui
  // l'utilisent (/admin/logs et /pointage/rh/logs) sont réservés à l'Admin.
  if (!session || !isAdmin(session)) throw new Error("Non autorisé");

  // La modération d'un avis « Conditions de travail » ne se montre qu'à qui peut lire ces avis.
  const where = hasPermission(session, PERMISSION_FEEDBACK_VOIR_DETAILS)
    ? {}
    : { entity: { not: ENTITE_FEEDBACK_CONDITIONS_TRAVAIL } };

  const logs = await prisma.historiqueEntry.findMany({
    where,
    skip,
    take,
    orderBy: { createdAt: "desc" },
    include: {
      user: {
        select: {
          fullName: true,
          email: true,
          role: { select: { name: true } }
        }
      }
    }
  });

  const totalCount = await prisma.historiqueEntry.count({ where });

  return { logs, totalCount };
}
