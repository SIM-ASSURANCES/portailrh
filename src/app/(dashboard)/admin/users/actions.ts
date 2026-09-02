"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fieldErrorsFromZod, type ActionState } from "@/lib/validation";

const SALT_ROUNDS = 10;

const createUserSchema = z.object({
  fullName: z.string().min(2, "Le nom doit contenir au moins 2 caractères"),
  email: z.string().email("Email invalide"),
  password: z.string().min(8, "8 caractères minimum"),
  roleId: z.string().min(1, "Rôle requis"),
});

/**
 * Crée un utilisateur. Réservé aux administrateurs (isAdmin()) — jamais de
 * suppression d'utilisateur dans le portail : seule la désactivation
 * (toggleUserActiveAction) est possible.
 */
export async function createUserAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = createUserSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    roleId: formData.get("roleId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: { email: "Cet email est déjà utilisé." },
    };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      fullName: parsed.data.fullName,
      email: parsed.data.email,
      passwordHash,
      roleId: parsed.data.roleId,
    },
  });

  await prisma.historiqueEntry.create({
    data: {
      entity: "User",
      entityId: user.id,
      action: "CREATE",
      detail: `Création de l'utilisateur ${user.email}`,
      userId: session.user.id,
    },
  });

  revalidatePath("/admin/users");

  return { status: "success", message: `Utilisateur ${user.email} créé.` };
}

/**
 * Active ou désactive un compte. Appelée directement depuis un composant
 * client (pas via <form>) : une Server Action est un simple point d'entrée
 * serveur, elle peut être invoquée comme une fonction async normale.
 */
export async function toggleUserActiveAction(
  userId: string,
  active: boolean
): Promise<{ status: "success" | "error"; message: string }> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const user = await prisma.user.update({ where: { id: userId }, data: { isActive: active } });

  await prisma.historiqueEntry.create({
    data: {
      entity: "User",
      entityId: user.id,
      action: active ? "ACTIVATE" : "DEACTIVATE",
      detail: `Compte ${active ? "réactivé" : "désactivé"} : ${user.email}`,
      userId: session.user.id,
    },
  });

  revalidatePath("/admin/users");

  return { status: "success", message: active ? "Compte réactivé." : "Compte désactivé." };
}

/**
 * Modifie le rôle d'un utilisateur existant — jusqu'ici figé à la création
 * (seule la désactivation était possible). Appelée directement depuis un
 * composant client (pas via <form>), comme toggleUserActiveAction.
 *
 * Aucun garde-fou contre l'auto-modification (un Admin changeant son propre
 * rôle perdrait son accès à `/admin`, `isAdmin()` étant un bypass sur
 * `role.name === "Admin"`) : cohérent avec `toggleUserActiveAction`, qui ne
 * protège pas non plus contre l'auto-désactivation. Point à surveiller si
 * ce cas se présente en pratique — voir CLAUDE.md.
 */
export async function modifierRoleUtilisateurAction(
  userId: string,
  nouveauRoleId: string
): Promise<{ status: "success" | "error"; message: string }> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const [user, nouveauRole] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, include: { role: true } }),
    prisma.role.findUnique({ where: { id: nouveauRoleId } }),
  ]);

  if (!user) {
    return { status: "error", message: "Utilisateur introuvable." };
  }
  if (!nouveauRole) {
    return { status: "error", message: "Rôle introuvable." };
  }

  if (nouveauRole.id === user.roleId) {
    return { status: "success", message: "Rôle inchangé." };
  }

  const ancienRoleNom = user.role.name;

  await prisma.user.update({ where: { id: userId }, data: { roleId: nouveauRoleId } });

  await prisma.historiqueEntry.create({
    data: {
      entity: "User",
      entityId: user.id,
      action: "CHANGE_ROLE",
      detail: `Rôle modifié pour ${user.email} : "${ancienRoleNom}" → "${nouveauRole.name}"`,
      userId: session.user.id,
    },
  });

  revalidatePath("/admin/users");
  // Un changement de rôle peut affecter tout ce que voit l'utilisateur
  // concerné (sidebar, dashboard, accès aux modules) — même principe que
  // toggleRolePermissionAction, qui revalide aussi "/" en plus de sa propre
  // page admin.
  revalidatePath("/");

  return { status: "success", message: `Rôle de ${user.fullName} mis à jour : ${nouveauRole.name}.` };
}
