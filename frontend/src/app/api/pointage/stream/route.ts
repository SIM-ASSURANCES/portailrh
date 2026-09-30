import { auth } from "@/lib/auth";
import { pointageEmitter } from "@/lib/events";
import { NextRequest } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // `authorized()` (auth.config.ts) laisse passer toutes les routes /api/* :
  // chaque route se protège elle-même. Même garde que /api/events — auth()
  // lit uniquement le JWT, aucune requête base de données.
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Non authentifié.", { status: 401 });
  }

  const responseStream = new TransformStream();
  const writer = responseStream.writable.getWriter();
  const encoder = new TextEncoder();

  // Envoi initial pour valider la connexion
  writer.write(encoder.encode("event: connected\ndata: ok\n\n"));

  const onUpdate = () => {
    writer.write(encoder.encode("event: refresh\ndata: update\n\n")).catch(() => {});
  };

  pointageEmitter.on("pointage-updated", onUpdate);

  // Nettoyage de la connexion lors de la déconnexion du client
  req.signal.addEventListener("abort", () => {
    pointageEmitter.off("pointage-updated", onUpdate);
    writer.close().catch(() => {});
  });

  return new Response(responseStream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
