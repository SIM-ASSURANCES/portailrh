"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession, hasPermission } from "@/lib/auth";
import { modererFeedback } from "backend";

type SimpleActionResult = { status: "success" | "error"; message: string };

const modererSchema = z.object({
  feedbackId: z.string().min(1, "Identifiant du message requis."),
  motif: z
    .string()
    .trim()
    .min(3, "Le motif de modération doit contenir au moins 3 caractères.")
    .max(500, "Le motif ne peut pas dépasser 500 caractères."),
});

/**
 * Server Action de modération d'un message FeedbackApp.
 * Accessible uniquement aux détenteurs de la permission `feedback.moderer` (RH & DG).
 */
export async function modererFeedbackAction(
  feedbackId: string,
  motif: string
): Promise<SimpleActionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "feedback.moderer")) {
    return { status: "error", message: "Action non autorisée. Permission feedback.moderer requise." };
  }

  const parsed = modererSchema.safeParse({ feedbackId, motif });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  const res = await modererFeedback(parsed.data.feedbackId, session.user.id, parsed.data.motif);
  if (!res.success) {
    return { status: "error", message: res.message };
  }

  revalidatePath("/feedback/admin");
  revalidatePath("/admin/feedbacks");
  revalidatePath("/feedback");
  revalidatePath("/feedback/mes-retours");

  return { status: "success", message: res.message };
}
