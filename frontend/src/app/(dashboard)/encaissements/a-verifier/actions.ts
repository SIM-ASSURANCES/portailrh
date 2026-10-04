"use server";

// Onglet « À vérifier » (commit 5b) : « Marquer traité » un signalement d'import. Réservé à `enc.confirmer_paiement`
// (Finance, décision du 2026-10-02), revérifié ici — Équipe technique et Consultation n'ont que la lecture.

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, hasPermission } from "@/lib/auth";
import { getClientIp } from "@/lib/auditLog";
import { publishDataChanged } from "@/lib/eventBus";
import { COMMENTAIRE_TRAITEMENT_MAX, EncSignalementError, marquerSignalementTraite, prisma } from "backend";

type SimpleActionResult = { status: "success" | "error"; message: string };

const schema = z.object({
  signalementId: z.string().min(1),
  commentaire: z.string().max(COMMENTAIRE_TRAITEMENT_MAX, `${COMMENTAIRE_TRAITEMENT_MAX} caractères maximum.`).optional(),
});

export async function marquerSignalementTraiteAction(signalementId: string, commentaire?: string): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "enc.confirmer_paiement")) {
    return { status: "error", message: "Action non autorisée." };
  }
  const parsed = schema.safeParse({ signalementId, commentaire });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Données invalides." };

  const ip = await getClientIp();
  try {
    await prisma.$transaction((tx) =>
      marquerSignalementTraite(tx, {
        signalementId: parsed.data.signalementId,
        userId: session.user.id,
        commentaire: parsed.data.commentaire,
        ip,
        maintenant: new Date(),
      })
    );
  } catch (e) {
    if (e instanceof EncSignalementError) return { status: "error", message: e.message };
    throw e;
  }

  revalidatePath("/encaissements", "layout");
  publishDataChanged();
  return { status: "success", message: "Signalement marqué traité." };
}
