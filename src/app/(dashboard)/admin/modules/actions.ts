"use server";

import { revalidatePath } from "next/cache";

import { getSession, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Active ou désactive un module. Un module désactivé disparaît
 * immédiatement du dashboard de tous les utilisateurs (voir
 * getAccessibleModules() dans src/lib/auth.ts, qui filtre sur isActive).
 */
export async function toggleModuleActiveAction(
  moduleId: string,
  active: boolean
): Promise<{ status: "success" | "error"; message: string }> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const module_ = await prisma.module.update({
    where: { id: moduleId },
    data: { isActive: active },
  });

  await prisma.historiqueEntry.create({
    data: {
      entity: "Module",
      entityId: module_.id,
      action: active ? "ACTIVATE" : "DEACTIVATE",
      detail: `Module ${active ? "activé" : "désactivé"} : ${module_.label}`,
      userId: session.user.id,
    },
  });

  revalidatePath("/admin/modules");
  revalidatePath("/");

  return { status: "success", message: active ? "Module activé." : "Module désactivé." };
}
