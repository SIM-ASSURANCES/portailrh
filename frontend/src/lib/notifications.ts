/**
 * Point d'entrée pour le système de notifications du portail.
 * Redirige vers le NotificationService unifié qui gère les 4 canaux
 * (DB Prisma, SSE temps réel, FCM Push externe, Email critique SMTP).
 */
export * from "./notifications/notificationService";
