import { contexteSignatureCourant, utilisateursAvecPermission, differerApresCommit, prisma, type NotificationPriority, type NotificationCategory } from "backend";
import { publishUserNotification, publishDataChanged } from "@/lib/eventBus";
import { fcmAdmin } from "@/lib/firebase/firebaseAdmin";
import { sendEmail, generateCriticalNotificationEmail } from "@/lib/email";
import { journaliserIncident } from "@/lib/journalTechnique";

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
  /**
   * Inclure les délégués ACTIFS de la permission (défaut : oui, lot N). À `false` pour une notification de DÉCISION dont la
   * garde se lit sur le RÔLE seul (justification de pointage : un délégué de `pointage.corriger_pointage` ne la décide pas).
   */
  inclureDelegues?: boolean;
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
    const creer = () =>
      prisma.notification.create({
        data: {
          userId: params.userId,
          titre: params.titre,
          message: params.message,
          lien: params.lien || null,
          priority: priority,
          category: category,
        },
      });
    // Dans une action signée (transaction unique), un échec ici ne doit pas abîmer la transaction de l'action : point de reprise.
    const notification = contexteSignatureCourant() ? await prisma.$transaction(() => creer()) : await creer();

    // Canaux 2 à 4 (temps réel, push, e-mail) : lot L bis — dans une action signée ils partent APRÈS la validation de la transaction
    // (une action annulée n'envoie rien) ; hors action signée, tout de suite, comme avant.
    const diffuser = () => {
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
          void journaliserIncident({
            niveau: "ERREUR",
            source: "PUSH",
            code: "FCM_ECHEC",
            message: err instanceof Error ? `${err.name}: ${err.message}` : "Échec de l'envoi du push",
            contexte: { userId: params.userId, notificationId: notification.id },
          });
        });
      }

      // 4. Canal Email SMTP (Pour CRITIQUE)
      if (priority === "CRITIQUE") {
        sendCriticalEmail(params.userId, notification).catch((err) => {
          console.error(`[Email] Échec envoi email critique pour user ${params.userId}:`, err);
          void journaliserIncident({
            niveau: "ERREUR",
            source: "EMAIL",
            code: "SMTP_ECHEC",
            message: err instanceof Error ? `${err.name}: ${err.message}` : "Échec de l'envoi de l'e-mail",
            contexte: { userId: params.userId, notificationId: notification.id },
          });
        });
      }
    };
    if (!differerApresCommit(diffuser)) diffuser();

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
    const ids = await utilisateursAvecPermission(prisma, permissionKey, {
      excludeUserId: params.excludeUserId,
      inclureDelegues: params.inclureDelegues,
    });
    const users = ids.map((id) => ({ id }));

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
    await journaliserIncident({
      niveau: "AVERTISSEMENT",
      source: "PUSH",
      code: "FCM_JETON_INVALIDE",
      message: "Jetons FCM invalides ou désenregistrés supprimés.",
      contexte: { userId, notificationId: notification.id, jetonsSupprimes: tokensToDelete.length },
    });
  }

  // Échecs autres que des jetons périmés (clé de projet erronée, service indisponible…) : visibles au journal.
  const echecsReels = response.responses.filter(
    (r: { success: boolean; error?: { code?: string } }) =>
      !r.success &&
      r.error?.code !== "messaging/registration-token-not-registered" &&
      r.error?.code !== "messaging/invalid-registration-token"
  );
  if (echecsReels.length > 0) {
    await journaliserIncident({
      niveau: "ERREUR",
      source: "PUSH",
      code: "FCM_ECHEC",
      message: "Le service FCM a refusé l'envoi de notifications push.",
      contexte: { userId, notificationId: notification.id, fcmCode: echecsReels[0].error?.code ?? "inconnu", echecs: echecsReels.length },
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
    // Un e-mail simulé (SMTP absent) n'est pas un e-mail envoyé : `emailSent` reste faux, la santé de la configuration
    // le signale (`/admin/journal-technique`).
    if (!result.simulated) {
      await prisma.notification.update({
        where: { id: notification.id },
        data: { emailSent: true },
      });
    }
  }
  // Un échec d'envoi (`result.success` faux) est déjà journalisé (SMTP_ECHEC) par `sendEmail` lui-même.
}

// ============================================================
// Rétrocompatibilité avec l'ancien notifications.ts
// ============================================================
export const createNotification = notify;
export const notifierParPermission = notifyByPermission;
