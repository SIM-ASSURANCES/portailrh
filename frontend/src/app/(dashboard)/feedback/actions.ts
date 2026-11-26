"use server";

import { z } from "zod";

import { getSession } from "@/lib/auth";
import {
  cibleQuotaFeedback,
  createFeedback,
  empreinteQuotaFeedback,
  jourCourant,
  messageQuotaFeedback,
  prisma,
  validateFeedbackRatings,
  type ActionState,
  type FeedbackRatings,
} from "backend";

/**
 * Soumission d'un avis FeedbackApp — comptes CONNECTÉS seulement (voir CLAUDE.md « Module FeedbackApp »).
 *
 * RÈGLE ABSOLUE DE CE FICHIER : l'auteur reste anonyme. Son identifiant ne sert ici qu'à (1) refuser qu'il s'évalue
 * lui-même et (2) calculer l'empreinte HMAC de la limite d'un avis par jour. Il n'est jamais stocké avec l'avis, jamais
 * transmis à `createFeedback`, jamais renvoyé, jamais journalisé. L'empreinte non plus : aucun `console.log`,
 * `logAuditAction`, `HistoriqueEntry` ni journal technique ici, et les erreurs d'écriture sont avalées sans être
 * journalisées (un message d'erreur Prisma peut citer les valeurs écrites). L'IP n'est pas lue.
 *
 * Aucun champ texte libre : `content` est calculé côté serveur par `createFeedback` à partir de `ratings`.
 */

const ERREUR_ENVOI = "Votre avis n'a pas pu être enregistré. Réessayez plus tard.";

const honeypotSchema = z.string().optional();

const submissionSchema = z.object({
  type: z.enum(["COLLABORATION", "CONDITIONS_TRAVAIL"], { message: "Type d'avis invalide." }),
  recipientId: z.string().optional(),
  ratingsJson: z.string().min(1, "Réponses manquantes."),
});

export async function soumettreFeedbackAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  // La session est revérifiée ICI, jamais seulement par le middleware.
  const session = await getSession();
  if (!session) {
    return { status: "error", message: "Connectez-vous pour donner un avis." };
  }

  // Honeypot anti-bot — vérifié avant toute autre validation du formulaire.
  const honeypot = honeypotSchema.parse(formData.get("site_web") ?? undefined);
  if (honeypot && honeypot.trim() !== "") {
    return { status: "success", message: "Merci, votre avis a bien été envoyé." };
  }

  const parsed = submissionSchema.safeParse({
    type: formData.get("type"),
    recipientId: formData.get("recipientId") || undefined,
    ratingsJson: formData.get("ratingsJson"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Le formulaire contient des erreurs." };
  }
  const { type } = parsed.data;

  let ratings: FeedbackRatings;
  try {
    const decoded = JSON.parse(parsed.data.ratingsJson);
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
      throw new Error("format invalide");
    }
    ratings = decoded as FeedbackRatings;
  } catch {
    return { status: "error", message: "Réponses invalides." };
  }

  const ratingsError = validateFeedbackRatings(type, ratings);
  if (ratingsError) {
    return { status: "error", message: ratingsError };
  }

  let recipientId: string | null = null;
  if (type === "COLLABORATION") {
    recipientId = parsed.data.recipientId ?? null;
    if (!recipientId) {
      return {
        status: "error",
        message: "Sélectionnez un destinataire.",
        fieldErrors: { recipientId: "Sélectionnez un destinataire." },
      };
    }

    const recipient = await prisma.user.findUnique({
      where: { id: recipientId },
      select: { isActive: true, role: { select: { peutRecevoirFeedback: true } } },
    });
    // Même règle que la liste proposée : compte actif ET rôle éligible (un rejeu réseau ne vise pas un compte technique).
    if (!recipient || !recipient.isActive || !recipient.role.peutRecevoirFeedback) {
      return {
        status: "error",
        message: "Destinataire introuvable.",
        fieldErrors: { recipientId: "Choisissez un destinataire valide." },
      };
    }

    if (session.user.id === recipientId) {
      return {
        status: "error",
        message: "Vous ne pouvez pas vous envoyer un avis à vous-même.",
        fieldErrors: { recipientId: "Vous ne pouvez pas vous choisir comme destinataire." },
      };
    }
  }

  const jour = jourCourant();
  try {
    // Sans AUTH_SECRET, l'empreinte lève et l'envoi est refusé : jamais « pas de limite ».
    const cle = empreinteQuotaFeedback({
      secret: process.env.AUTH_SECRET,
      auteurId: session.user.id,
      cible: cibleQuotaFeedback(type, recipientId),
      jour,
    });
    // Trace de quota et avis dans la MÊME transaction : un échec ne consomme pas la limite.
    const result = await prisma.$transaction((tx) =>
      createFeedback(tx, { type, recipientId, ratings, source: "INTERNAL", quota: { cle, jour } })
    );
    if (!result.success) {
      return { status: "error", message: result.quotaAtteint ? messageQuotaFeedback(type) : result.message };
    }
  } catch {
    return { status: "error", message: ERREUR_ENVOI };
  }

  return { status: "success", message: "Merci, votre avis a bien été envoyé." };
}
