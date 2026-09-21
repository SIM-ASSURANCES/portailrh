import { prisma, type NotificationPriority, type NotificationCategory } from "backend";
import { publishUserNotification, publishDataChanged } from "@/lib/eventBus";
import { fcmAdmin } from "@/lib/firebase/firebaseAdmin";
import { sendEmail, generateCriticalNotificationEmail } from "@/lib/email";

export interface NotifyParams {
  userId: string;
  titre: string;
  message: string;
  lien?: string | null;
  priority?: NotificationPriority;
  category?: NotificationCategory;
}

export interface NotifyByPermissionParams {
  titre: string;
  message: string;
  lien?: string | null;
  priority?: NotificationPriority;
  category?: NotificationCategory;
  excludeUserId?: string;
}

/**
 * Service centralisé de notification pour SIM Assurances.
 * Orchestre les 4 canaux selon la priorité de l'événement :
 * 1. Base Prisma (persistance historique in-app)
 * 2. SSE ciblé par utilisateur (temps réel in-app pour sessions actives)
 * 3. FCM Push (sur le navigateur / OS, même portail fermé, pour IMPORTANT et CRITIQUE)
 * 4. Email SMTP institutionnel (pour CRITIQUE)
 */
export async function notify(params: NotifyParams) {
  const priority = params.priority || "INFO";
  const category = params.category || "SYSTEME";

  try {
    // 1. Canal DB Prisma (Toujours enregistré)
    const notification = await prisma.notification.create({
      data: {
        userId: params.userId,
        titre: params.titre,
        message: params.message,
        lien: params.lien || null,
        priority: priority,
        category: category,
      },
    });

    // 2. Canal SSE temps réel (In-app)
    publishUserNotification(params.userId, {
      id: notification.id,
      titre: notification.titre,
      message: notification.message,
      lien: notification.lien,
      priority: notification.priority,
      category: notification.category,
      createdAt: notification.createdAt.toISOString(),
    });
    // Rafraîchissement global des vues ouvertes
    publishDataChanged();

    // 3. Canal FCM Push (Pour IMPORTANT et CRITIQUE)
    if (priority !== "INFO") {
      sendFcmPush(params.userId, notification).catch((err) => {
        console.error(`[FCM] Échec envoi push pour user ${params.userId}:`, err);
      });
    }

    // 4. Canal Email SMTP (Pour CRITIQUE)
    if (priority === "CRITIQUE") {
      sendCriticalEmail(params.userId, notification).catch((err) => {
        console.error(`[Email] Échec envoi email critique pour user ${params.userId}:`, err);
      });
    }

    return notification;
  } catch (error) {
    console.error("[NotificationService] Erreur lors de l'envoi de la notification:", error);
    throw error;
  }
}

/**
 * Envoie une notification à tous les utilisateurs actifs détenteurs d'une permission donnée.
 */
export async function notifyByPermission(
  permissionKey: string,
  params: NotifyByPermissionParams
) {
  try {
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        ...(params.excludeUserId ? { id: { not: params.excludeUserId } } : {}),
        role: {
          permissions: {
            some: {
              permission: { key: permissionKey },
            },
          },
        },
      },
      select: { id: true },
    });

    if (users.length === 0) return;

    await Promise.all(
      users.map((u) =>
        notify({
          userId: u.id,
          titre: params.titre,
          message: params.message,
          lien: params.lien,
          priority: params.priority || "IMPORTANT",
          category: params.category || "SYSTEME",
        })
      )
    );
  } catch (error) {
    console.error(`[NotificationService] Erreur notifyByPermission (${permissionKey}):`, error);
  }
}

/**
 * Envoi du push FCM à tous les tokens actifs d'un utilisateur.
 */
async function sendFcmPush(
  userId: string,
  notification: {
    id: string;
    titre: string;
    message: string;
    lien: string | null;
    priority: NotificationPriority;
    category: NotificationCategory;
  }
) {
  if (!fcmAdmin) return;

  const userTokens = await prisma.fcmToken.findMany({
    where: { userId },
    select: { id: true, token: true },
  });

  if (userTokens.length === 0) return;

  const tokens = userTokens.map((t) => t.token);

  // Payload data-only pour contrôle total de l'affichage par le Service Worker
  const payload = {
    data: {
      id: notification.id,
      titre: notification.titre,
      message: notification.message,
      lien: notification.lien || "/",
      priority: notification.priority,
      category: notification.category,
    },
    tokens,
  };

  const response = await fcmAdmin.sendEachForMulticast(payload);

  let successCount = 0;
  const tokensToDelete: string[] = [];

  response.responses.forEach((resp: { success: boolean; error?: { code?: string } }, index: number) => {
    if (resp.success) {
      successCount++;
    } else {
      const errorCode = resp.error?.code;
      // Nettoyage automatique des tokens invalides ou désenregistrés
      if (
        errorCode === "messaging/registration-token-not-registered" ||
        errorCode === "messaging/invalid-registration-token"
      ) {
        tokensToDelete.push(userTokens[index].id);
      }
    }
  });

  if (tokensToDelete.length > 0) {
    await prisma.fcmToken.deleteMany({
      where: { id: { in: tokensToDelete } },
    });
  }

  if (successCount > 0) {
    await prisma.notification.update({
      where: { id: notification.id },
      data: { pushSent: true },
    });
  }
}

/**
 * Envoi de l'email critique via SMTP.
 */
async function sendCriticalEmail(
  userId: string,
  notification: {
    id: string;
    titre: string;
    message: string;
    lien: string | null;
    priority: NotificationPriority;
    category: NotificationCategory;
  }
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, fullName: true },
  });

  if (!user || !user.email) return;

  const emailContent = generateCriticalNotificationEmail({
    recipientName: user.fullName || "Collaborateur",
    titre: notification.titre,
    message: notification.message,
    lien: notification.lien,
    category: notification.category,
  });

  const result = await sendEmail({
    to: user.email,
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
  });

  if (result.success) {
    await prisma.notification.update({
      where: { id: notification.id },
      data: { emailSent: true },
    });
  }
}

// ============================================================
// Rétrocompatibilité avec l'ancien notifications.ts
// ============================================================
export const createNotification = notify;
export const notifierParPermission = notifyByPermission;
