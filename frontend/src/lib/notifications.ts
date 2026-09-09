import { prisma } from "backend";
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

export interface NotifierParPermissionParams {
  titre: string;
  message: string;
  lien?: string;
  /**
   * Exclut l'auteur de l'action de la diffusion (ex: le DG qui rejette sa
   * propre validation complète ne doit pas se notifier lui-même, alors
   * qu'il porte la même permission `treso.valider_demande` que Finance).
   */
  excludeUserId?: string;
}

/**
 * Notifie TOUS les comptes actifs porteurs d'une permission donnée —
 * généralisation, par permission plutôt que par nom de rôle, du pattern
 * "tous les RH actifs" déjà utilisé par le Module Pointage RH
 * (`(dashboard)/pointage/actions.ts`). Une permission Trésorerie peut être
 * portée par plusieurs rôles à la fois (Finance ET DG partagent
 * `treso.valider_demande`, un rôle combiné peut cumuler plusieurs
 * permissions) : filtrer par nom de rôle littéral serait incorrect ici,
 * contrairement au cas RH où la permission coïncide avec un rôle unique.
 */
export async function notifierParPermission(
  permissionKey: string,
  { titre, message, lien, excludeUserId }: NotifierParPermissionParams
) {
  const utilisateurs = await prisma.user.findMany({
    where: {
      isActive: true,
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      role: { permissions: { some: { permission: { key: permissionKey } } } },
    },
    select: { id: true },
  });

  await Promise.all(
    utilisateurs.map((u) => createNotification({ userId: u.id, titre, message, lien }))
  );
}
