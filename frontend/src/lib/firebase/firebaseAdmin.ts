import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";
import fs from "node:fs";

/**
 * Initialisation singleton de Firebase Admin SDK côté serveur.
 * Utilise la variable d'environnement FIREBASE_SERVICE_ACCOUNT_JSON.
 * Gère automatiquement :
 * - Le contenu JSON brut (sur une ligne ou multiligne)
 * - Les guillemets englobants superflus
 * - Les chemins de fichiers directs pointant vers le .json du Service Account
 */
function getFirebaseAdminApp(): App | null {
  const apps = getApps();
  if (apps.length > 0) {
    return apps[0];
  }

  const rawInput = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!rawInput || rawInput.trim() === "") {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[FCM Admin] FIREBASE_SERVICE_ACCOUNT_JSON n'est pas configuré. Les pushs FCM réels sont désactivés."
      );
    }
    return null;
  }

  let jsonStr = rawInput.trim();

  // Si la valeur pointe vers un fichier JSON existant sur le disque
  if (fs.existsSync(jsonStr)) {
    try {
      jsonStr = fs.readFileSync(jsonStr, "utf-8");
    } catch (err) {
      console.error("[FCM Admin] Erreur lecture fichier Service Account:", err);
      return null;
    }
  }

  // Nettoyage des éventuels guillemets simples ou doubles entourant la chaîne entière
  if (
    (jsonStr.startsWith("'") && jsonStr.endsWith("'")) ||
    (jsonStr.startsWith('"') && jsonStr.endsWith('"'))
  ) {
    jsonStr = jsonStr.slice(1, -1).trim();
  }

  // Extraction précise du bloc JSON entre { et }
  const firstBrace = jsonStr.indexOf("{");
  const lastBrace = jsonStr.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
  }

  try {
    const serviceAccount = JSON.parse(jsonStr);
    return initializeApp({
      credential: cert(serviceAccount),
    });
  } catch (error) {
    console.error("[FCM Admin] Erreur lors du parsing de FIREBASE_SERVICE_ACCOUNT_JSON:", error);
    return null;
  }
}

export const fcmAdminApp: App | null = getFirebaseAdminApp();
export const fcmAdmin: Messaging | null = fcmAdminApp ? getMessaging(fcmAdminApp) : null;
