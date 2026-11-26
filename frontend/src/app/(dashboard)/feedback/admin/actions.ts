"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession, hasPermission } from "@/lib/auth";
import { modererFeedback, PERMISSION_FEEDBACK_VOIR_DETAILS, retablirFeedback } from "backend";

type SimpleActionResult = { status: "success" | "error"; message: string };

const moderationSchema = z.object({
  feedbackId: z.string().min(1, "Identifiant du message requis."),
  motif: z
    .string()
    .trim()
    .min(3, "Le motif doit contenir au moins 3 caractères.")
    .max(500, "Le motif ne peut pas dépasser 500 caractères."),
});

/** Garde commune au masquage et au rétablissement : `feedback.moderer`, motif, droit de lecture transmis au métier. */
async function appliquerModeration(
  operation: typeof modererFeedback,
  feedbackId: string,
  motif: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "feedback.moderer")) {
    return { status: "error", message: "Action non autorisée. Permission feedback.moderer requise." };
  }

  const parsed = moderationSchema.safeParse({ feedbackId, motif });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  const res = await operation(parsed.data.feedbackId, session.user.id, parsed.data.motif, {
    voirDetails: hasPermission(session, PERMISSION_FEEDBACK_VOIR_DETAILS),
  });
  if (!res.success) {
    return { status: "error", message: res.message };
  }

  revalidatePath("/feedback/admin");
  revalidatePath("/admin/feedbacks");
  revalidatePath("/feedback/mes-retours");

  return { status: "success", message: res.message };
}

/** Masque un message. Un avis « Conditions de travail » exige aussi `feedback.voir_details`. */
export async function modererFeedbackAction(feedbackId: string, motif: string): Promise<SimpleActionResult> {
  return appliquerModeration(modererFeedback, feedbackId, motif);
}

/** Rétablit un message masqué, mêmes droits que le masquage. */
export async function retablirFeedbackAction(feedbackId: string, motif: string): Promise<SimpleActionResult> {
  return appliquerModeration(retablirFeedback, feedbackId, motif);
}
