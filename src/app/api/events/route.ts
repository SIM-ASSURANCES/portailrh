import { getSession } from "@/lib/auth";
import { subscribeDataChanged } from "@/lib/eventBus";

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
 * Flux d'évènements en temps réel (Server-Sent Events) — remplace le
 * polling à intervalle fixe (voir CLAUDE.md "Rafraîchissement en temps
 * réel") : chaque onglet ouvert sur l'AppShell garde une connexion HTTP
 * longue ouverte sur cette route, et reçoit un évènement `data-changed`
 * dès qu'une Server Action pertinente publie sur `src/lib/eventBus.ts`.
 *
 * Réservé aux sessions authentifiées (401 sinon) — un utilisateur non
 * connecté est sur `/login`, sans AppShell à rafraîchir.
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
          // Le contrôleur a pu être fermé entre-temps par une déconnexion
          // client (race avec `cancel()` ci-dessous) — rien à faire de plus,
          // `cancel()` se charge du nettoyage (désabonnement, heartbeat).
        }
      };

      unsubscribe = subscribeDataChanged(() => send("data-changed", "1"));
      heartbeat = setInterval(() => send("ping", "1"), HEARTBEAT_INTERVAL_MS);

      // Confirme immédiatement l'ouverture de la connexion, avant même le
      // premier heartbeat périodique.
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
