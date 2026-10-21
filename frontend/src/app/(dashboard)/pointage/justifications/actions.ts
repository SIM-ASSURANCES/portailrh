"use server";

import { revalidatePath } from "next/cache";
import {
  ACTION_HISTORIQUE_JUSTIFICATION,
  messageDecisionJustification,
  prisma,
  refusDecideur,
  transitionJustification,
  type ActionState,
} from "backend";
import { getSession } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { notify } from "@/lib/notifications";
import { SELECT_COLLABORATEUR_JUSTIFICATION, chargerComptesRH, decideurDuCollaborateur } from "@/lib/justificationsPointage";

/**
 * Accepte ou refuse une justification envoyée (Pointage V2, lot 4). Le droit de décider est recalculé ici à partir du
 * responsable ACTUEL du service du collaborateur (ou de la permission RH du pointage quand la RH décide), jamais lu
 * d'un état figé. Écriture conditionnée au statut SOUMISE : deux décisions simultanées, une seule passe.
 */
async function deciderJustification(
  justificationId: string,
  action: { type: "ACCEPTER" } | { type: "REFUSER"; motifRefus: string }
): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié." };

  const justification = await prisma.justificationPointage.findUnique({
    where: { id: justificationId },
    include: {
      pointage: {
        select: { id: true, type: true, heure: true, minutesRetard: true, user: { select: SELECT_COLLABORATEUR_JUSTIFICATION } },
      },
    },
  });
  if (!justification) return { status: "error", message: "Justification introuvable." };

  const collaborateur = justification.pointage.user;
  const refus = refusDecideur(
    decideurDuCollaborateur(collaborateur, await chargerComptesRH()),
    // Permissions du RÔLE, jamais les délégations : un délégué de la permission RH ne décide pas (2026-10-12).
    { id: session.user.id, rolePermissions: session.rolePermissions },
    collaborateur.id
  );
  if (refus) return { status: "error", message: refus };

  const resultat = transitionJustification(justification.statut, action);
  if (!resultat.ok) return { status: "error", message: resultat.erreur, fieldErrors: { motifRefus: resultat.erreur } };
  const statut = resultat.statut as "ACCEPTEE" | "REFUSEE";

  const maintenant = new Date();
  const ecrite = await prisma.$transaction(async (tx) => {
    const { count } = await tx.justificationPointage.updateMany({
      where: { id: justification.id, statut: "SOUMISE" },
      data: {
        statut,
        decideurId: session.user.id,
        decisionAt: maintenant,
        motifRefus: statut === "REFUSEE" ? resultat.motifRefus : null,
      },
    });
    if (count === 0) return false;
    await tx.historiqueEntry.create({
      data: {
        entity: "JustificationPointage",
        entityId: justification.id,
        action: ACTION_HISTORIQUE_JUSTIFICATION[action.type],
        detail:
          statut === "ACCEPTEE"
            ? `Pointage ${justification.pointage.id} de ${collaborateur.fullName} : justification acceptée.`
            : `Pointage ${justification.pointage.id} de ${collaborateur.fullName} : justification rejetée. Motif : ${resultat.motifRefus}`,
        userId: session.user.id,
      },
    });
    return true;
  });
  if (!ecrite) return { status: "error", message: "Cette justification a déjà été traitée." };

  const { titre, message } = messageDecisionJustification({
    pointage: justification.pointage,
    statut,
    decideurNom: session.user.fullName,
    motifRefus: resultat.motifRefus,
  });
  await notify({
    userId: collaborateur.id,
    titre,
    message,
    lien: `/pointage/justifier/${justification.pointage.id}`,
    priority: "IMPORTANT",
    category: "POINTAGE",
  });

  revalidatePath("/pointage/justifications");
  revalidatePath(`/pointage/justifier/${justification.pointage.id}`);
  publishDataChanged();
  return { status: "success", message: statut === "ACCEPTEE" ? "Justification acceptée." : "Justification rejetée." };
}

export async function accepterJustificationAction(justificationId: string): Promise<ActionState> {
  return deciderJustification(justificationId, { type: "ACCEPTER" });
}

export async function refuserJustificationAction(justificationId: string, motifRefus: string): Promise<ActionState> {
  return deciderJustification(justificationId, { type: "REFUSER", motifRefus: String(motifRefus ?? "") });
}
