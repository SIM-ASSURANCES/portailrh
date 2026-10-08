"use server";

import { revalidatePath } from "next/cache";
import {
  ACTION_HISTORIQUE_JUSTIFICATION,
  PERMISSION_RH_POINTAGE,
  messageSoumissionJustification,
  prisma,
  transitionJustification,
  type ActionState,
} from "backend";
import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { notify, notifyByPermission } from "@/lib/notifications";
import { SELECT_COLLABORATEUR_JUSTIFICATION, decideurDuCollaborateur } from "@/lib/justificationsPointage";

/**
 * Le collaborateur envoie le motif de son retard ou de son départ anticipé (Pointage V2, lot 4). Réservé au
 * propriétaire du pointage, avec `pointage.pointer`. Écriture conditionnée au statut lu : deux envois simultanés,
 * un seul passe. Le décideur actuel (responsable du service, sinon la RH) est prévenu.
 */
export async function soumettreJustificationAction(pointageId: string, motif: string): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Non authentifié." };
  if (!hasPermission(session, "pointage.pointer")) return { status: "error", message: "Action non autorisée." };

  const justification = await prisma.justificationPointage.findFirst({
    where: { pointageId },
    include: {
      pointage: {
        select: { id: true, type: true, heure: true, minutesRetard: true, userId: true, user: { select: SELECT_COLLABORATEUR_JUSTIFICATION } },
      },
    },
  });
  // Même réponse pour un pointage d'un autre compte : on ne révèle pas son existence.
  if (!justification || justification.pointage.userId !== session.user.id) {
    return { status: "error", message: "Aucune justification à envoyer pour ce pointage." };
  }

  const resultat = transitionJustification(justification.statut, { type: "SOUMETTRE", motif: String(motif ?? "") });
  if (!resultat.ok) return { status: "error", message: resultat.erreur, fieldErrors: { motif: resultat.erreur } };

  const maintenant = new Date();
  const ecrite = await prisma.$transaction(async (tx) => {
    const { count } = await tx.justificationPointage.updateMany({
      where: { id: justification.id, statut: justification.statut },
      data: { statut: "SOUMISE", motif: resultat.motif, soumiseAt: maintenant },
    });
    if (count === 0) return false;
    await tx.historiqueEntry.create({
      data: {
        entity: "JustificationPointage",
        entityId: justification.id,
        action: ACTION_HISTORIQUE_JUSTIFICATION.SOUMETTRE,
        detail: `Pointage ${justification.pointage.id} (${justification.statut} → SOUMISE). Motif : ${resultat.motif}`,
        userId: session.user.id,
      },
    });
    return true;
  });
  if (!ecrite) {
    return { status: "error", message: "Cette justification vient d'être mise à jour : rechargez la page." };
  }

  // Décideur recalculé maintenant, à partir du responsable actuel du service.
  const collaborateur = justification.pointage.user;
  const decideur = decideurDuCollaborateur(collaborateur);
  const { titre, message } = messageSoumissionJustification({
    collaborateurNom: collaborateur.fullName,
    serviceNom: collaborateur.service?.name ?? null,
    decideur,
    pointage: justification.pointage,
    motif: resultat.motif ?? "",
  });
  const lien = "/pointage/justifications";
  if (decideur.type === "RESPONSABLE") {
    await notify({ userId: decideur.responsableId, titre, message, lien, priority: "IMPORTANT", category: "POINTAGE" });
  } else {
    // Jamais le collaborateur lui-même, même s'il détient la permission RH.
    await notifyByPermission(PERMISSION_RH_POINTAGE, {
      titre,
      message,
      lien,
      priority: "IMPORTANT",
      category: "POINTAGE",
      excludeUserId: session.user.id,
    });
  }

  revalidatePath(`/pointage/justifier/${pointageId}`);
  revalidatePath("/pointage/historique");
  revalidatePath("/pointage/justifications");
  publishDataChanged();
  return { status: "success", message: "Justification envoyée." };
}
