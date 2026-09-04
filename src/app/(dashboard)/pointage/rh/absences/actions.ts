"use server";

import { revalidatePath } from "next/cache";
import { publishDataChanged } from "@/lib/eventBus";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { StatutAbsence } from "@/generated/prisma/client";

// `analyserAbsences` (déclenchement manuel, bouton "Analyser" côté
// AbsencesClient.tsx) retirée lors de la fusion du Module Pointage RH
// (Thierry Kouame) : remplacée par la détection automatique quotidienne de
// `src/app/api/cron/absences/route.ts` (job planifié, hors week-ends et
// jours fériés via le nouveau modèle `JourFerie`). Le seul appelant côté
// UI a été retiré de façon cohérente sur la même branche — aucune référence
// orpheline. Voir CLAUDE.md "Fusion Module Pointage RH".

export async function traiterAbsence(absenceId: string, statut: StatutAbsence, motif: string) {
  const session = await getSession();
  
  if (!session || !hasPermission(session, "pointage.voir_dashboard_rh")) {
    return { status: "error", message: "Non autorisé" };
  }

  try {
    if (statut === "A_CONTROLER") {
      return { status: "error", message: "Statut invalide" };
    }

    if (!motif || motif.trim() === "") {
      return { status: "error", message: "Le motif est obligatoire" };
    }

    await prisma.absence.update({
      where: { id: absenceId },
      data: {
        statut,
        motif,
        controleParId: session.user.id,
      }
    });

    revalidatePath("/pointage/rh/absences");
    publishDataChanged();
    return { status: "success", message: "Absence traitée avec succès" };
  } catch (error) {
    console.error("Erreur traiterAbsence:", error);
    return { status: "error", message: "Erreur lors du traitement de l'absence" };
  }
}
