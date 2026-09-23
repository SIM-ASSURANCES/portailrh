// Service Worker Firebase Cloud Messaging — SIM Assurances

// Import des bibliothèques compat Firebase
try {
  importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");
} catch (e) {
  console.warn("[SW] Erreur chargement scripts Firebase compat:", e);
}

// Initialisation si firebase est défini
if (typeof firebase !== "undefined") {
  // Config par défaut déduite ou injectée
  const urlParams = new URLSearchParams(self.location.search);
  const projectId = urlParams.get("projectId") || "simportailrh";

  try {
    firebase.initializeApp({
      projectId: projectId,
      apiKey: urlParams.get("apiKey") || undefined,
      messagingSenderId: urlParams.get("messagingSenderId") || undefined,
      appId: urlParams.get("appId") || undefined,
    });

    const messaging = firebase.messaging();

    messaging.onBackgroundMessage((payload) => {
      const data = payload.data || {};
      const titre = data.titre || payload.notification?.title || "SIM Assurances";
      const message = data.message || payload.notification?.body || "";
      const lien = data.lien || "/";
      const priority = data.priority || "INFO";

      const notificationOptions = {
        body: message,
        icon: "/logo-sim-couleur.svg",
        badge: "/logo-sim-couleur.svg",
        tag: data.id || `notif-${Date.now()}`,
        data: { url: lien, id: data.id },
        vibrate: priority === "CRITIQUE" ? [300, 100, 300, 100, 300] : [200, 100, 200],
        requireInteraction: priority === "CRITIQUE",
      };

      return self.registration.showNotification(titre, notificationOptions);
    });
  } catch (err) {
    console.warn("[SW] Erreur initialisation messaging compat:", err);
  }
}

// Fallback natif push au cas où compat n'est pas utilisé ou payload brut
self.addEventListener("push", (event) => {
  if (!event.data) return;

  try {
    const payload = event.data.json();
    const data = payload.data || payload;
    const titre = data.titre || payload.notification?.title || "SIM Assurances";
    const message = data.message || payload.notification?.body || "";
    const lien = data.lien || "/";
    const priority = data.priority || "INFO";

    event.waitUntil(
      self.registration.showNotification(titre, {
        body: message,
        icon: "/logo-sim-couleur.svg",
        badge: "/logo-sim-couleur.svg",
        tag: data.id || `push-${Date.now()}`,
        data: { url: lien, id: data.id },
        vibrate: priority === "CRITIQUE" ? [300, 100, 300, 100, 300] : [200, 100, 200],
        requireInteraction: priority === "CRITIQUE",
      })
    );
  } catch (err) {
    console.error("[SW] Erreur parsing push natif:", err);
  }
});

// Clic sur une notification OS -> navigation vers le lien
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // 1. Si un onglet du portail est déjà ouvert, lui donner le focus et naviguer
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.focus();
          return client.navigate(targetUrl);
        }
      }
      // 2. Sinon, ouvrir une nouvelle fenêtre vers le lien cible
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
