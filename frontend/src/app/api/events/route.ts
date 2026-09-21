import { getSession } from "@/lib/auth";
import { subscribeDataChanged, subscribeUserNotification } from "@/lib/eventBus";

// Un flux SSE lit `headers()`/`cookies()` (via `getSession()`) et ne doit
// jamais être mis en cache — explicite plutôt que de compter sur l'opt-out
// implicite de ces appels (voir node_modules/next/dist/docs, Route Handlers).
export const dynamic = "force-dynamic";

const ENCODER = new TextEncoder();

// Purement pour garder la connexion HTTP ouverte à travers d'éventuels
// proxys/load balancers qui coupent une connexion inactive au bout de
// quelques dizaines de secondes — ne déclenche AUCUN rafraîchissement côté
// client (évènement "ping", distinct de "data-changed", ignoré par
// l'EventSource du Topbar qui n'écoute que ce dernier).
const HEARTBEAT_INTERVAL_MS = 25_000;

function sseMessage(event: string, data: string): Uint8Array {
  return ENCODER.encode(`event: ${event}\ndata: ${data}\n\n`);
}

/**
 * Flux d'évènements en temps réel (Server-Sent Events) :
 * 1. Évènement global `data-changed`
 * 2. Évènement ciblé `notification` avec payload complet pour l'utilisateur connecté
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return new Response("Non authentifié.", { status: 401 });
  }

  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: string) => {
        try {
          controller.enqueue(sseMessage(event, data));
        } catch {
          // Le contrôleur a pu être fermé entre-temps par une déconnexion client
        }
      };

      const unsubData = subscribeDataChanged(() => send("data-changed", "1"));
      const unsubNotif = subscribeUserNotification(session.user.id, (notif) => {
        send("notification", JSON.stringify(notif));
      });

      unsubscribe = () => {
        unsubData();
        unsubNotif();
      };

      heartbeat = setInterval(() => send("ping", "1"), HEARTBEAT_INTERVAL_MS);

      // Confirme immédiatement l'ouverture de la connexion
      send("ping", "1");
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Désactive le buffering d'un éventuel reverse-proxy nginx en
      // production (sans effet en dev) — sinon les évènements resteraient
      // bufferisés au lieu d'être livrés immédiatement.
      "X-Accel-Buffering": "no",
    },
  });
}
