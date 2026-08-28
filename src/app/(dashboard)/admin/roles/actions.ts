"use server";

import { revalidatePath } from "next/cache";

import { getSession, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Accorde ou retire une permission à un rôle. Appelée directement depuis un
 * composant client (pas via <form>). N'affecte jamais le rôle Admin lui
 * -même : son accès à la console d'administration est un bypass
 * (isAdmin()), indépendant de RolePermission — voir src/lib/auth.ts.
 */
export async function toggleRolePermissionAction(
  roleId: string,
  permissionId: string,
  granted: boolean
): Promise<{ status: "success" | "error"; message: string }> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  if (granted) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId } },
      create: { roleId, permissionId },
      update: {},
    });
  } else {
    await prisma.rolePermission.deleteMany({ where: { roleId, permissionId } });
  }

  const [role, permission] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { id: roleId } }),
    prisma.permission.findUniqueOrThrow({ where: { id: permissionId } }),
  ]);

  await prisma.historiqueEntry.create({
    data: {
      entity: "RolePermission",
      entityId: `${roleId}:${permissionId}`,
      action: granted ? "GRANT" : "REVOKE",
      detail: `Permission "${permission.label}" ${granted ? "accordée au" : "retirée du"} rôle ${role.name}`,
      userId: session.user.id,
    },
  });

  // Le changement peut affecter la visibilité des modules sur le dashboard
  // des utilisateurs ayant ce rôle.
  revalidatePath("/admin/roles");
  revalidatePath("/");

  return { status: "success", message: granted ? "Permission accordée." : "Permission retirée." };
}
