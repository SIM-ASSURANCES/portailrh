"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { checkRateLimit } from "@/lib/rate-limit";
import {
  containsBannedContent,
  containsUrl,
  fieldErrorsFromZod,
  FEEDBACK_CONTENT_MAX,
  FEEDBACK_CONTENT_MIN,
  getClientIp,
  prisma,
  type ActionState,
} from "backend";

/**
 * Soumission d'un message FeedbackApp depuis la page PUBLIQUE (sans
 * compte, sans session) — voir CLAUDE.md "FeedbackApp : anonymat total".
 *
 * RÈGLE ABSOLUE DE CE FICHIER : aucune donnée permettant d'identifier
 * l'auteur n'est jamais lue au-delà de la portée de cette fonction, jamais
 * stockée, jamais journalisée. L'IP (`getClientIp`) n'est utilisée QUE
 * comme CLÉ d'un compteur en mémoire (`checkRateLimit`, `@/lib/rate-limit`
 * — un simple `Map` du process, jamais écrit en base ni sur disque, jamais
 * renvoyé au client) — elle ne sort jamais de cette fonction sous aucune
 * autre forme. Aucun `console.log`/`logAuditAction`/écriture de fichier
 * n'est appelé ici, contrairement à la quasi-totalité des autres Server
 * Actions du portail (voir CLAUDE.md pour la vérification exhaustive de
 * non-traçabilité faite sur ce module).
 */

const honeypotSchema = z.string().optional();

const feedbackSchema = z.object({
  recipientId: z.string().min(1, "Sélectionnez un destinataire."),
  content: z
    .string()
    .trim()
    .min(FEEDBACK_CONTENT_MIN, `Le message doit contenir au moins ${FEEDBACK_CONTENT_MIN} caractères.`)
    .max(FEEDBACK_CONTENT_MAX, `Le message ne peut pas dépasser ${FEEDBACK_CONTENT_MAX} caractères.`),
});

export async function soumettreFeedbackAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  // Honeypot anti-bot (voir CLAUDE.md "FeedbackApp") : champ caché,
  // invisible pour un humain — un bot qui le remplit est rejeté
  // SILENCIEUSEMENT (faux succès), jamais un message qui lui révélerait la
  // détection. Vérifié EN PREMIER, avant toute autre validation : jamais
  // besoin de dépenser un cycle de rate-limit sur une soumission de bot.
  const honeypot = honeypotSchema.parse(formData.get("site_web") ?? undefined);
  if (honeypot && honeypot.trim() !== "") {
    return { status: "success", message: "Merci, votre message a bien été envoyé." };
  }

  const parsed = feedbackSchema.safeParse({
    recipientId: formData.get("recipientId"),
    content: formData.get("content"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  if (containsUrl(parsed.data.content)) {
    return {
      status: "error",
      message: "Le message ne peut pas contenir de lien ni d'URL.",
      fieldErrors: { content: "Retirez tout lien ou adresse web du message." },
    };
  }

  if (containsBannedContent(parsed.data.content)) {
    return {
      status: "error",
      message: "Votre message contient des termes inappropriés. Merci de le reformuler.",
      fieldErrors: { content: "Reformulez votre message de façon constructive." },
    };
  }

  // Anti-spam SANS aucune donnée traçable stockée (voir CLAUDE.md
  // "FeedbackApp") : l'IP ne sert QUE de clé à un compteur en mémoire,
  // jamais écrite en base ni journalisée. Fenêtre volontairement courte
  // (5 minutes) : ce n'est pas une protection anti-abus définitive, juste
  // un frein basique contre un envoi automatisé répété.
  const headersList = await headers();
  const ip = getClientIp(headersList);
  if (!checkRateLimit(`feedback_${ip}`, 3, 5 * 60 * 1000)) {
    return {
      status: "error",
      message: "Trop de messages envoyés récemment depuis cette connexion. Merci de réessayer plus tard.",
    };
  }

  const recipient = await prisma.user.findUnique({
    where: { id: parsed.data.recipientId },
    select: { id: true, isActive: true },
  });
  if (!recipient || !recipient.isActive) {
    return { status: "error", message: "Destinataire introuvable.", fieldErrors: { recipientId: "Choisissez un destinataire valide." } };
  }

  // `submittedAt` n'est jamais renseigné explicitement ici : la colonne
  // (`@db.Date`, schema.prisma) applique `DEFAULT CURRENT_TIMESTAMP` et le
  // type SQL `DATE` tronque lui-même toute composante horaire — garanti au
  // niveau du SCHÉMA, jamais une simple convention applicative.
  await prisma.feedback.create({
    data: {
      content: parsed.data.content,
      recipientId: parsed.data.recipientId,
      source: "PUBLIC",
    },
  });

  return { status: "success", message: "Merci, votre message a bien été envoyé." };
}
