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
