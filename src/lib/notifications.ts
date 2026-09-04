import { prisma } from "@/lib/prisma";
import { publishDataChanged } from "@/lib/eventBus";

export interface CreateNotificationParams {
  userId: string;
  titre: string;
  message: string;
  lien?: string;
}

/**
 * Crée une notification pour un utilisateur en base de données.
 */
export async function createNotification({ userId, titre, message, lien }: CreateNotificationParams) {
  try {
    const notif = await prisma.notification.create({
      data: {
        userId,
        titre,
        message,
        lien,
      },
    });
    
    // Déclenche l'événement SSE pour que la Topbar du client s'actualise
    publishDataChanged();
    
    return notif;
  } catch (error) {
    console.error("Erreur lors de la création de la notification:", error);
    return null;
  }
}
