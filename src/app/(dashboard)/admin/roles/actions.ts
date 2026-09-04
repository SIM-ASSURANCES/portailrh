"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, isAdmin } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { prisma } from "@/lib/prisma";
import { fieldErrorsFromZod, type ActionState } from "@/lib/validation";

const creerRoleSchema = z.object({
  nom: z.string().min(2, "Le nom doit contenir au moins 2 caractères"),
  description: z.string().optional(),
});

/**
 * Crée un nouveau rôle, au-delà des 5 rôles posés par le seed
 * (Admin/Collaborateur/Finance/DG/RH) — ex: un rôle combiné pour un
 * utilisateur cumulant plusieurs fonctions. Réservé aux administrateurs ;
 * créé sans aucune permission accordée (RolePermission vide), à cocher
 * ensuite comme n'importe quel autre rôle sur cette même page.
 */
export async function creerRoleAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = creerRoleSchema.safeParse({
    nom: formData.get("nom"),
    description: formData.get("description") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const existing = await prisma.role.findUnique({ where: { name: parsed.data.nom } });
  if (existing) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: { nom: "Un rôle porte déjà ce nom." },
    };
  }

  const role = await prisma.role.create({
    data: { name: parsed.data.nom, description: parsed.data.description ?? null },
  });

  await prisma.historiqueEntry.create({
    data: {
      entity: "Role",
      entityId: role.id,
      action: "CREATE",
      detail: `Création du rôle "${role.name}"`,
      userId: session.user.id,
    },
  });

  revalidatePath("/admin/roles");
  publishDataChanged();

  return { status: "success", message: `Rôle "${role.name}" créé.` };
}

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
  publishDataChanged();

  return { status: "success", message: granted ? "Permission accordée." : "Permission retirée." };
}
