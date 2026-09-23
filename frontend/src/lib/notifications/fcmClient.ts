import { getToken, onMessage, deleteToken } from "firebase/messaging";
import { getFirebaseMessaging } from "@/lib/firebase/firebaseClient";

/**
 * Enregistre le navigateur pour les notifications push FCM et sauvegarde le token en DB.
 */
export async function registerFcmToken(): Promise<string | null> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return null;
  }

  const messaging = await getFirebaseMessaging();
  if (!messaging) return null;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return null;
    }

    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
    if (!vapidKey) {
      console.warn("[FCM] NEXT_PUBLIC_FIREBASE_VAPID_KEY manquant dans l'environnement.");
      return null;
    }

    // Enregistrement du service worker
    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    });

    if (token) {
      await fetch("/api/push/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      return token;
    }
  } catch (error) {
    console.error("[FCM] Erreur lors de l'enregistrement du token FCM:", error);
  }

  return null;
}

/**
 * Supprime l'enregistrement FCM pour cet appareil.
 */
export async function unregisterFcmToken(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  try {
    const messaging = await getFirebaseMessaging();
    if (messaging) {
      await deleteToken(messaging);
    }
    await fetch("/api/push/unregister", { method: "POST" });
    return true;
  } catch (error) {
    console.error("[FCM] Erreur lors de la suppression du token FCM:", error);
    return false;
  }
}

/**
 * Écoute les notifications arrivant lorsque l'application est au premier plan.
 */
export function onForegroundMessage(
  callback: (payload: { titre: string; message: string; lien?: string; priority?: string; category?: string; id?: string }) => void
): () => void {
  if (typeof window === "undefined") return () => {};

  let unsubscribe: (() => void) | null = null;

  getFirebaseMessaging().then((messaging) => {
    if (!messaging) return;
    unsubscribe = onMessage(messaging, (payload) => {
      const data = payload.data || {};
      const titre = data.titre || payload.notification?.title || "SIM Assurances";
      const message = data.message || payload.notification?.body || "";
      const lien = data.lien || "/";
      const priority = data.priority || "INFO";
      const category = data.category || "SYSTEME";
      const id = data.id;

      callback({ titre, message, lien, priority, category, id });
    });
  });

  return () => {
    if (unsubscribe) unsubscribe();
  };
}
