"use server";

import crypto from "crypto";
import { headers } from "next/headers";
import { z } from "zod";

import { generateResetPasswordEmail, sendEmail } from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limit";
import { prisma } from "backend";
import { fieldErrorsFromZod, type ActionState } from "backend";

const forgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "L'adresse email est requise.")
    .email("Adresse email invalide."),
});

/**
 * Action publique de demande de réinitialisation de mot de passe.
 *
 * Règles de sécurité :
 * 1. Protection contre le brute-force / saturation : limite à 5 demandes par tranche de 10 min.
 * 2. Protection contre l'énumération des utilisateurs : que l'adresse existe ou non, le même
 *    message générique est renvoyé ("Si cette adresse est associée à un compte...").
 * 3. Jeton cryptographique à usage unique : 32 octets aléatoires en hexadécimal (64 caractères).
 * 4. Expiration stricte à 1 heure (3600 secondes).
 * 5. Traçabilité : journalisation dans `HistoriqueEntry` si l'utilisateur existe.
 */
export async function requestPasswordResetAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Veuillez vérifier l'adresse email saisie.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const { email } = parsed.data;

  // Limitation de débit par IP + email (5 essais / 10 minutes)
  const headersList = await headers();
  const rawIp = headersList.get("x-forwarded-for") || "IP_INCONNUE";
  const ip = rawIp.replace(/^::ffff:/, "");
  const rlKey = `forgot_pw_${ip}_${email}`;

  if (!checkRateLimit(rlKey, 5, 10 * 60 * 1000)) {
    return {
      status: "error",
      message: "Trop de demandes en peu de temps. Veuillez patienter quelques instants avant de réessayer.",
    };
  }

  try {
    const user = await prisma.user.findFirst({
      where: {
        email: { equals: email, mode: "insensitive" },
        isActive: true,
      },
    });

    if (user) {
      // Génération du token sécurisé (32 octets = 64 caractères hex)
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 heure

      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetPasswordToken: token,
          resetPasswordExpiresAt: expiresAt,
        },
      });

      const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
      const resetUrl = `${baseUrl}/reset-password/${token}`;

      const emailPayload = generateResetPasswordEmail({
        fullName: user.fullName,
        resetUrl,
        expiresInMinutes: 60,
      });

      await sendEmail({
        to: user.email,
        subject: emailPayload.subject,
        html: emailPayload.html,
        text: emailPayload.text,
        userId: user.id,
      });

      await prisma.historiqueEntry.create({
        data: {
          entity: "User",
          entityId: user.id,
          action: "PASSWORD_RESET_REQUEST",
          detail: `Demande de réinitialisation de mot de passe générée pour : ${user.email}`,
          userId: user.id,
        },
      });
    }

    return {
      status: "success",
      message:
        "Si cette adresse est associée à un compte actif, vous recevrez un email contenant le lien de réinitialisation d'ici quelques instants. Pensez à vérifier vos courriers indésirables.",
    };
  } catch (error) {
    console.error("[requestPasswordResetAction] Erreur :", error);
    return {
      status: "error",
      message: "Une erreur inattendue est survenue. Veuillez réessayer plus tard.",
    };
  }
}
