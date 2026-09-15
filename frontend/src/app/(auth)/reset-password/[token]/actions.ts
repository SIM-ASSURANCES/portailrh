"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";

import { publishDataChanged } from "@/lib/eventBus";
import { prisma } from "backend";
import { fieldErrorsFromZod, type ActionState } from "backend";

const SALT_ROUNDS = 10;

const resetPasswordSchema = z
  .object({
    token: z.string().min(1, "Jeton de réinitialisation manquant"),
    password: z
      .string()
      .min(8, "8 caractères minimum")
      .regex(/[A-Z]/, "Au moins une majuscule requise")
      .regex(/[a-z]/, "Au moins une minuscule requise")
      .regex(/[0-9]/, "Au moins un chiffre requis")
      .regex(/[^A-Za-z0-9]/, "Au moins un caractère spécial requis"),
    passwordConfirmation: z.string().min(1, "Confirmation requise"),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: "Les mots de passe ne correspondent pas.",
    path: ["passwordConfirmation"],
  });

/**
 * Action publique de réinitialisation de mot de passe via jeton sécurisé.
 *
 * Règles :
 * 1. Vérification du token cryptographique et de sa date d'expiration (1 heure).
 * 2. Hachage du mot de passe avec bcrypt (10 tours de sel).
 * 3. Consommation immédiate du jeton (`resetPasswordToken` et `resetPasswordExpiresAt` -> `null`).
 * 4. Révocation des sessions actives : `tokenVersion: { increment: 1 }` déconnecte toute session en cours.
 * 5. Traçabilité dans `HistoriqueEntry` et notification temps réel via `publishDataChanged()`.
 * 6. Redirection finale vers `/login?reset=success`.
 */
export async function resetPasswordAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    passwordConfirmation: formData.get("passwordConfirmation"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const user = await prisma.user.findUnique({
    where: { resetPasswordToken: parsed.data.token },
  });

  if (!user) {
    return {
      status: "error",
      message: "Ce lien de réinitialisation est invalide ou a déjà été utilisé.",
    };
  }

  if (!user.resetPasswordExpiresAt || user.resetPasswordExpiresAt < new Date()) {
    return {
      status: "error",
      message: "Ce lien de réinitialisation a expiré. Veuillez faire une nouvelle demande.",
    };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, SALT_ROUNDS);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetPasswordToken: null,
        resetPasswordExpiresAt: null,
        tokenVersion: { increment: 1 },
      },
    }),
    prisma.historiqueEntry.create({
      data: {
        entity: "User",
        entityId: user.id,
        action: "PASSWORD_RESET_SUCCESS",
        detail: `Mot de passe réinitialisé avec succès pour : ${user.email}`,
        userId: user.id,
      },
    }),
  ]);

  publishDataChanged();

  redirect("/login?reset=success");
}
