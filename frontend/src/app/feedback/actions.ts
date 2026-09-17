"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { checkRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/auth";
import {
  createFeedback,
  getClientIp,
  prisma,
  validateFeedbackRatings,
  type ActionState,
  type FeedbackRatings,
} from "backend";

/**
 * Soumission d'un avis FeedbackApp — page PUBLIQUE (sans compte possible)
 * ou par un employé connecté (voir CLAUDE.md "FeedbackApp : anonymat
 * total" / "FeedbackApp — notation structurée").
 *
 * RÈGLE ABSOLUE DE CE FICHIER : aucune donnée permettant d'identifier
 * l'auteur n'est jamais lue au-delà de la portée de cette fonction, jamais
 * stockée, jamais journalisée. L'IP (`getClientIp`) n'est utilisée QUE
 * comme CLÉ d'un compteur en mémoire (`checkRateLimit`), jamais écrite en
 * base ni journalisée. Aucun `console.log`/`logAuditAction` n'est appelé
 * ici, contrairement à la quasi-totalité des autres Server Actions.
 *
 * DEPUIS LA NOTATION STRUCTURÉE : ce formulaire n'accepte plus AUCUN champ
 * texte libre — `content` n'est jamais lu depuis `formData`, uniquement
 * calculé côté serveur par `createFeedback` à partir de `ratings` (notes/
 * choix sur des questions fixes). Élimine tout risque d'identification par
 * style d'écriture, et empêche structurellement qu'un client malveillant
 * (rejeu réseau direct) n'injecte un texte arbitraire : il n'existe
 * littéralement aucun chemin de code qui persiste un texte reçu tel quel.
 */

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
  // Honeypot anti-bot — vérifié EN PREMIER, avant toute autre validation.
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

  // Anti-spam SANS aucune donnée traçable stockée : l'IP ne sert QUE de
  // clé à un compteur en mémoire, jamais écrite en base ni journalisée.
  const headersList = await headers();
  const ip = getClientIp(headersList);
  if (!checkRateLimit(`feedback_${ip}`, 3, 5 * 60 * 1000)) {
    return {
      status: "error",
      message: "Trop d'avis envoyés récemment depuis cette connexion. Merci de réessayer plus tard.",
    };
  }

  // Détection de la session : "INTERNAL" si l'employé est connecté,
  // "PUBLIC" sinon. RÈGLE ABSOLUE : l'identité de l'auteur n'est JAMAIS
  // stockée ni enregistrée en base, quelle que soit la valeur de `source`.
  const session = await getSession();

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
      select: { id: true, isActive: true },
    });
    if (!recipient || !recipient.isActive) {
      return {
        status: "error",
        message: "Destinataire introuvable.",
        fieldErrors: { recipientId: "Choisissez un destinataire valide." },
      };
    }

    if (session?.user && session.user.id === recipientId) {
      return {
        status: "error",
        message: "Vous ne pouvez pas vous envoyer un avis à vous-même.",
        fieldErrors: { recipientId: "Vous ne pouvez pas vous choisir comme destinataire." },
      };
    }
  }

  const source = session?.user ? "INTERNAL" : "PUBLIC";

  const result = await createFeedback({ type, recipientId, ratings, source });
  if (!result.success) {
    return { status: "error", message: result.message };
  }

  return { status: "success", message: "Merci, votre avis a bien été envoyé." };
}
