import { NextResponse } from "next/server";
import { secretCronValide } from "backend";

/**
 * Contrôle commun des routes de tâches planifiées (`/api/cron/*`) : `null` si l'appel porte `Authorization: Bearer
 * <CRON_SECRET>` (comparé à temps constant), sinon la réponse 401 à renvoyer telle quelle. Sans `CRON_SECRET`
 * configuré, tout appel est refusé.
 */
export function refusCron(request: Request): NextResponse | null {
  return secretCronValide(request.headers.get("authorization"), process.env.CRON_SECRET)
    ? null
    : new NextResponse("Unauthorized", { status: 401 });
}
