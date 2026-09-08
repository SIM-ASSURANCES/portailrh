"use server";

import { getSession } from "@/lib/auth";
import { prisma } from "backend";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";

export async function updateProfilePhoto(photoUrl: string) {
  const session = await getSession();
  if (!session) throw new Error("Non autorisé");

  await prisma.user.update({
    where: { id: session.user.id },
    data: { photoUrl },
  });

  revalidatePath("/", "layout"); // Revalidate all pages to update topbar
  return { success: true };
}

import { z } from "zod";

const passwordSchema = z.string()
  .min(8, "8 caractères minimum")
  .regex(/[A-Z]/, "Au moins une majuscule requise")
  .regex(/[a-z]/, "Au moins une minuscule requise")
  .regex(/[0-9]/, "Au moins un chiffre requis")
  .regex(/[^A-Za-z0-9]/, "Au moins un caractère spécial requis");

export async function updatePassword(currentPass: string, newPass: string) {
  const session = await getSession();
  if (!session) throw new Error("Non autorisé");

  const parsed = passwordSchema.safeParse(newPass);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });

  if (!user || !user.passwordHash) {
    throw new Error("Utilisateur introuvable ou compte non finalisé");
  }

  const isMatch = await bcrypt.compare(currentPass, user.passwordHash);
  if (!isMatch) {
    throw new Error("L'ancien mot de passe est incorrect");
  }

  const newHash = await bcrypt.hash(newPass, 12);

  await prisma.user.update({
    where: { id: session.user.id },
    data: { passwordHash: newHash },
  });

  return { success: true };
}

export async function getNotifications() {
  const session = await getSession();
  if (!session) return [];

  return prisma.notification.findMany({
    where: { userId: session.user.id, estLue: false },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function getUnreadNotificationsCount() {
  const session = await getSession();
  if (!session) return 0;

  return prisma.notification.count({
    where: { 
      userId: session.user.id,
      estLue: false
    },
  });
}

export async function markNotificationAsRead(id: string) {
  const session = await getSession();
  if (!session) throw new Error("Non autorisé");

  await prisma.notification.updateMany({
    where: { 
      id,
      userId: session.user.id 
    },
    data: { estLue: true },
  });

  revalidatePath("/", "layout");
  return { success: true };
}

export async function markAllNotificationsAsRead() {
  const session = await getSession();
  if (!session) throw new Error("Non autorisé");

  await prisma.notification.updateMany({
    where: { 
      userId: session.user.id,
      estLue: false
    },
    data: { estLue: true },
  });

  revalidatePath("/", "layout");
  return { success: true };
}
