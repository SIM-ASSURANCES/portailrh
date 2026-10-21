// Lot K — réorientations et reprises d'une demande, relues de l'historique (aucune table dédiée) pour le parcours de l'article et le
// reporting. Une réorientation concerne la demande (étape Service) ; une reprise concerne la demande entière ou UN article.

import type { Prisma } from "./generated/prisma/client";
import { ACTION_HISTORIQUE_REORIENTATION } from "./circuitReorientation";
import { ACTION_HISTORIQUE_REPRISE } from "./circuitReprise";

type Db = Pick<Prisma.TransactionClient, "historiqueEntry">;

export interface EvenementCircuitLu {
  /** Article concerné ; `null` = la demande entière (réorientation ou reprise de la demande). */
  ligneId: string | null;
  at: Date;
  /** « 26/10/2026 — Aïcha K. — Reprise (article « X ») : Validé par la Finance → À décider … ». */
  texte: string;
}

const jour = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "Africa/Abidjan" });

/** Événements du circuit par demande, du plus ancien au plus récent. */
export async function chargerEvenementsCircuit(
  db: Db,
  demandes: readonly { id: string; ligneIds: readonly string[] }[]
): Promise<Map<string, EvenementCircuitLu[]>> {
  const resultat = new Map<string, EvenementCircuitLu[]>();
  if (demandes.length === 0) return resultat;
  const demandeDeLigne = new Map<string, string>();
  for (const d of demandes) for (const l of d.ligneIds) demandeDeLigne.set(l, d.id);
  const entrees = await db.historiqueEntry.findMany({
    where: {
      OR: [
        { entity: "Demande", entityId: { in: demandes.map((d) => d.id) }, action: { in: [ACTION_HISTORIQUE_REORIENTATION, ACTION_HISTORIQUE_REPRISE] } },
        { entity: "LigneDemande", entityId: { in: [...demandeDeLigne.keys()] }, action: ACTION_HISTORIQUE_REPRISE },
      ],
    },
    include: { user: { select: { fullName: true } } },
    orderBy: { createdAt: "asc" },
  });
  for (const h of entrees) {
    const estLigne = h.entity === "LigneDemande";
    const demandeId = estLigne ? demandeDeLigne.get(h.entityId) : h.entityId;
    if (!demandeId) continue;
    const liste = resultat.get(demandeId) ?? [];
    liste.push({ ligneId: estLigne ? h.entityId : null, at: h.createdAt, texte: `${jour(h.createdAt)} — ${h.user.fullName} — ${h.detail ?? ""}` });
    resultat.set(demandeId, liste);
  }
  return resultat;
}
