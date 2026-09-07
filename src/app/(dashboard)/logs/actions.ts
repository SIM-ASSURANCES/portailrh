"use server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function getLogsAction(skip = 0, take = 50) {
  const session = await getSession();
  if (!session) throw new Error("Non autorisé");

  // La protection est déjà gérée par les layouts (admin/layout.tsx et rh/layout.tsx)
  
  const logs = await prisma.historiqueEntry.findMany({
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

  const totalCount = await prisma.historiqueEntry.count();

  return { logs, totalCount };
}
