"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { fieldErrorsFromZod, type ActionState } from "@/lib/validation";

const SALT_ROUNDS = 10;

const activationSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8, "8 caractères minimum"),
    passwordConfirmation: z.string().min(1, "Confirmation requise"),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: "Les mots de passe ne correspondent pas.",
    path: ["passwordConfirmation"],
  });

/**
 * Finalise un compte créé par invitation par lien (voir CLAUDE.md
 * "Invitation par lien") — route PUBLIQUE (`/invitation/[token]`, pas de
 * session requise), donc chaque contrôle est revérifié intégralement ici,
 * jamais uniquement côté page (qui ne fait que refléter le même état pour
 * l'affichage initial).
 *
 * Trois refus distincts, mêmes conditions que la page :
 * - Token introuvable OU compte déjà activé (`passwordHash` non nul) —
 *   un jeton consommé est remis à `null` à l'activation (voir plus bas),
 *   donc "déjà utilisé" et "jamais existé" ne sont plus distinguables à ce
 *   stade et partagent le même message générique.
 * - Token trouvé mais expiré (`invitationExpiresAt` dépassé).
 *
 * Succès : hash le mot de passe, active le compte (`isActive: true`),
 * consomme le jeton (`invitationToken`/`invitationExpiresAt` → `null`,
 * plus jamais réutilisable), puis redirige vers `/login` avec un message
 * de succès — jamais un simple retour d'`ActionState` affiché sur cette
 * page, la personne doit atterrir directement sur l'écran de connexion.
 */
export async function activerInvitationAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = activationSchema.safeParse({
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

  const user = await prisma.user.findUnique({ where: { invitationToken: parsed.data.token } });
  if (!user || user.passwordHash) {
    return {
      status: "error",
      message: "Ce lien d'invitation est invalide ou a déjà été utilisé.",
    };
  }
  if (!user.invitationExpiresAt || user.invitationExpiresAt < new Date()) {
    return {
      status: "error",
      message: "Ce lien d'invitation a expiré. Demandez à un administrateur de vous en générer un nouveau.",
    };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, SALT_ROUNDS);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        isActive: true,
        invitationToken: null,
        invitationExpiresAt: null,
      },
    }),
    prisma.historiqueEntry.create({
      data: {
        entity: "User",
        entityId: user.id,
        action: "ACTIVATE_INVITATION",
        detail: `Compte activé via invitation par lien : ${user.email}`,
        userId: user.id,
      },
    }),
  ]);

  redirect("/login?activated=1");
}
