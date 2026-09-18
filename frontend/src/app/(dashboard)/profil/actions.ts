"use server";

import { getSession } from "@/lib/auth";
import { prisma } from "backend";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { logAuditAction } from "@/lib/auditLog";
import { publishDataChanged } from "@/lib/eventBus";
import { sendEmail, generatePasswordChangedEmail } from "@/lib/email";

/**
 * Permet à un utilisateur de renseigner/modifier LIBREMENT son propre
 * service (`User.serviceId`), sans validation d'un tiers — distinct
 * d'`updateUserServiceAction` (`admin/users/actions.ts`, réservée à
 * `isAdmin()`, `userId` arbitraire passé en paramètre). Ici, **aucun
 * `userId` n'est accepté en paramètre** : la cible est toujours
 * `session.user.id`, jamais un id fourni par l'appelant — élimine par
 * construction tout risque de modifier le service d'un autre compte par ce
 * chemin (contrairement à une simple vérification `userId ===
 * session.user.id`, qui resterait correcte mais laisserait la possibilité
 * structurelle d'un paramètre erroné). Même logique d'audit que la version
 * Admin (`logAuditAction`, fichier `services.log`), pas dupliquée à
 * l'identique mais délibérément proche pour que les entrées d'historique
 * des deux chemins restent cohérentes à la lecture.
 */
export async function updateMyServiceAction(
  serviceId: string | null
): Promise<{ status: "success" | "error"; message: string }> {
  const session = await getSession();
  if (!session) {
    return { status: "error", message: "Action non autorisée." };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { service: true },
  });
  if (!user) {
    return { status: "error", message: "Utilisateur introuvable." };
  }

  if (user.serviceId === serviceId) {
    return { status: "success", message: "Service inchangé." };
  }

  let nouveauService = null;
  if (serviceId) {
    nouveauService = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!nouveauService) {
      return { status: "error", message: "Service sélectionné introuvable." };
    }
  }

  const ancienServiceNom = user.service?.name ?? null;
  const nouveauServiceNom = nouveauService?.name ?? null;

  await prisma.user.update({
    where: { id: session.user.id },
    data: { serviceId },
  });

  let detail = "";
  if (ancienServiceNom && nouveauServiceNom) {
    detail = `${user.fullName} (${user.email}) a changé son propre service : « ${ancienServiceNom} » → « ${nouveauServiceNom} »`;
  } else if (nouveauServiceNom) {
    detail = `${user.fullName} (${user.email}) a renseigné son propre service : « ${nouveauServiceNom} »`;
  } else {
    detail = `${user.fullName} (${user.email}) a retiré son propre service (anciennement « ${ancienServiceNom} »)`;
  }

  await logAuditAction({
    entity: "Service",
    entityId: serviceId ?? user.serviceId ?? user.id,
    action: "CHANGE_SERVICE",
    detail,
    userId: session.user.id,
    userFullName: session.user.fullName,
    userEmail: session.user.email,
    logFileName: "services.log",
  });

  revalidatePath("/profil");
  revalidatePath("/admin/users");
  publishDataChanged();

  return { status: "success", message: nouveauServiceNom ? `Service mis à jour : ${nouveauServiceNom}.` : "Service retiré." };
}

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

  // Notification de sécurité par courriel
  try {
    const baseUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
    const emailPayload = generatePasswordChangedEmail({
      fullName: user.fullName,
      email: user.email,
      changedAt: new Date(),
      actionUrl: `${baseUrl}/login`,
      resetUrl: `${baseUrl}/forgot-password`,
    });
    await sendEmail({
      to: user.email,
      subject: emailPayload.subject,
      html: emailPayload.html,
      text: emailPayload.text,
      userId: user.id,
    });
  } catch (err) {
    console.error("Erreur lors de l'envoi de l'email de sécurité (changement mdp):", err);
  }

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
