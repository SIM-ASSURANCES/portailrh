"use server";

import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { getSession, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fieldErrorsFromZod, type ActionState } from "@/lib/validation";

const SALT_ROUNDS = 10;
const INVITATION_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * URL publique de base pour construire un lien d'invitation. Préfère
 * `AUTH_URL` quand elle est explicitement définie (comportement documenté
 * pour Docker/production, voir .env.example) ; sinon la déduit de la
 * requête entrante (`host`/`x-forwarded-proto`) — fonctionne sans
 * configuration en dev local, comme le reste d'Auth.js.
 */
async function getBaseUrl(): Promise<string> {
  if (process.env.AUTH_URL) {
    return process.env.AUTH_URL.replace(/\/$/, "");
  }
  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const proto = headersList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

const createUserSchema = z.object({
  fullName: z.string().min(2, "Le nom doit contenir au moins 2 caractères"),
  email: z.string().email("Email invalide"),
  password: z.string().min(8, "8 caractères minimum"),
  roleId: z.string().min(1, "Rôle requis"),
});

/**
 * Crée un utilisateur. Réservé aux administrateurs (isAdmin()) — jamais de
 * suppression d'utilisateur dans le portail : seule la désactivation
 * (toggleUserActiveAction) est possible.
 */
export async function createUserAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = createUserSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    roleId: formData.get("roleId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: { email: "Cet email est déjà utilisé." },
    };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      fullName: parsed.data.fullName,
      email: parsed.data.email,
      passwordHash,
      roleId: parsed.data.roleId,
    },
  });

  await prisma.historiqueEntry.create({
    data: {
      entity: "User",
      entityId: user.id,
      action: "CREATE",
      detail: `Création de l'utilisateur ${user.email}`,
      userId: session.user.id,
    },
  });

  revalidatePath("/admin/users");

  return { status: "success", message: `Utilisateur ${user.email} créé.` };
}

const createInvitationSchema = z.object({
  fullName: z.string().min(2, "Le nom doit contenir au moins 2 caractères"),
  email: z.string().email("Email invalide"),
  roleId: z.string().min(1, "Rôle requis"),
});

/**
 * Crée un compte "en attente d'activation" (pas de mot de passe) et génère
 * un lien d'invitation à usage unique — deuxième méthode de création de
 * compte, complémentaire à `createUserAction` (jamais un remplacement :
 * les deux restent disponibles). Réservée aux administrateurs, même
 * garde qu'ailleurs dans cet écran.
 *
 * Aucun système d'envoi d'email automatique n'existe dans le projet et
 * n'est tenté ici : le lien est simplement retourné dans `data`, à
 * l'Admin de le transmettre lui-même (email personnel, WhatsApp...).
 *
 * `isActive: false` à la création (et non `true`) — c'est
 * `activerInvitationAction` qui le fixe à `true`, seulement une fois le
 * mot de passe défini. Un compte en attente ne doit jamais pouvoir se
 * connecter entre-temps (`authorize()`, `lib/auth.ts`, refuse déjà tout
 * compte `!isActive` — et, défense en profondeur, tout `passwordHash`
 * nul).
 */
export async function creerInvitationAction(
  _prevState: ActionState<{ invitationUrl: string }>,
  formData: FormData
): Promise<ActionState<{ invitationUrl: string }>> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = createInvitationSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    roleId: formData.get("roleId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: { email: "Cet email est déjà utilisé." },
    };
  }

  const invitationToken = randomBytes(32).toString("hex");
  const invitationExpiresAt = new Date(Date.now() + INVITATION_VALIDITY_MS);

  const user = await prisma.user.create({
    data: {
      fullName: parsed.data.fullName,
      email: parsed.data.email,
      passwordHash: null,
      isActive: false,
      roleId: parsed.data.roleId,
      invitationToken,
      invitationExpiresAt,
    },
  });

  await prisma.historiqueEntry.create({
    data: {
      entity: "User",
      entityId: user.id,
      action: "INVITE",
      detail: `Invitation par lien créée pour ${user.email} (expire le ${invitationExpiresAt.toLocaleDateString("fr-FR")})`,
      userId: session.user.id,
    },
  });

  revalidatePath("/admin/users");

  const invitationUrl = `${await getBaseUrl()}/invitation/${invitationToken}`;

  return {
    status: "success",
    message: `Invitation créée pour ${user.email}.`,
    data: { invitationUrl },
  };
}

/**
 * Régénère le lien d'invitation d'un compte encore en attente d'activation
 * (ex: l'ancien lien a expiré, ou a été perdu avant transmission) — nouveau
 * token, nouvelle expiration à 7 jours, aucune donnée du compte modifiée
 * par ailleurs (nom/email/rôle inchangés). Réservée aux administrateurs.
 *
 * Refusée sur un compte déjà activé (`passwordHash` non nul) : régénérer un
 * lien n'a de sens que pour un compte qui n'a encore jamais de mot de
 * passe — jamais un moyen détourné de forcer la réinitialisation du mot de
 * passe d'un compte actif (hors périmètre de cette fonctionnalité).
 *
 * Appelée directement depuis un composant client (pas via `<form>`, comme
 * `toggleUserActiveAction`) — type de retour simple à deux branches
 * (`data` toujours présent au succès), pas le `ActionState` générique de
 * `creerInvitationAction` (pensé pour `useActionState`, dont la branche
 * `idle` n'a pas de sens pour un appel direct).
 */
export async function regenererInvitationAction(
  userId: string
): Promise<
  | { status: "success"; message: string; data: { invitationUrl: string } }
  | { status: "error"; message: string }
> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return { status: "error", message: "Utilisateur introuvable." };
  }
  if (user.passwordHash) {
    return { status: "error", message: "Ce compte est déjà activé, aucun lien à régénérer." };
  }

  const invitationToken = randomBytes(32).toString("hex");
  const invitationExpiresAt = new Date(Date.now() + INVITATION_VALIDITY_MS);

  await prisma.user.update({
    where: { id: userId },
    data: { invitationToken, invitationExpiresAt },
  });

  await prisma.historiqueEntry.create({
    data: {
      entity: "User",
      entityId: user.id,
      action: "REINVITE",
      detail: `Lien d'invitation régénéré pour ${user.email} (expire le ${invitationExpiresAt.toLocaleDateString("fr-FR")})`,
      userId: session.user.id,
    },
  });

  revalidatePath("/admin/users");

  const invitationUrl = `${await getBaseUrl()}/invitation/${invitationToken}`;

  return {
    status: "success",
    message: `Nouveau lien généré pour ${user.email}.`,
    data: { invitationUrl },
  };
}

/**
 * Active ou désactive un compte. Appelée directement depuis un composant
 * client (pas via <form>) : une Server Action est un simple point d'entrée
 * serveur, elle peut être invoquée comme une fonction async normale.
 */
export async function toggleUserActiveAction(
  userId: string,
  active: boolean
): Promise<{ status: "success" | "error"; message: string }> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const user = await prisma.user.update({ where: { id: userId }, data: { isActive: active } });

  await prisma.historiqueEntry.create({
    data: {
      entity: "User",
      entityId: user.id,
      action: active ? "ACTIVATE" : "DEACTIVATE",
      detail: `Compte ${active ? "réactivé" : "désactivé"} : ${user.email}`,
      userId: session.user.id,
    },
  });

  revalidatePath("/admin/users");

  return { status: "success", message: active ? "Compte réactivé." : "Compte désactivé." };
}

/**
 * Modifie le rôle d'un utilisateur existant — jusqu'ici figé à la création
 * (seule la désactivation était possible). Appelée directement depuis un
 * composant client (pas via <form>), comme toggleUserActiveAction.
 *
 * Aucun garde-fou contre l'auto-modification (un Admin changeant son propre
 * rôle perdrait son accès à `/admin`, `isAdmin()` étant un bypass sur
 * `role.name === "Admin"`) : cohérent avec `toggleUserActiveAction`, qui ne
 * protège pas non plus contre l'auto-désactivation. Point à surveiller si
 * ce cas se présente en pratique — voir CLAUDE.md.
 */
export async function modifierRoleUtilisateurAction(
  userId: string,
  nouveauRoleId: string
): Promise<{ status: "success" | "error"; message: string }> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const [user, nouveauRole] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, include: { role: true } }),
    prisma.role.findUnique({ where: { id: nouveauRoleId } }),
  ]);

  if (!user) {
    return { status: "error", message: "Utilisateur introuvable." };
  }
  if (!nouveauRole) {
    return { status: "error", message: "Rôle introuvable." };
  }

  if (nouveauRole.id === user.roleId) {
    return { status: "success", message: "Rôle inchangé." };
  }

  const ancienRoleNom = user.role.name;

  await prisma.user.update({ where: { id: userId }, data: { roleId: nouveauRoleId } });

  await prisma.historiqueEntry.create({
    data: {
      entity: "User",
      entityId: user.id,
      action: "CHANGE_ROLE",
      detail: `Rôle modifié pour ${user.email} : "${ancienRoleNom}" → "${nouveauRole.name}"`,
      userId: session.user.id,
    },
  });

  revalidatePath("/admin/users");
  // Un changement de rôle peut affecter tout ce que voit l'utilisateur
  // concerné (sidebar, dashboard, accès aux modules) — même principe que
  // toggleRolePermissionAction, qui revalide aussi "/" en plus de sa propre
  // page admin.
  revalidatePath("/");

  return { status: "success", message: `Rôle de ${user.fullName} mis à jour : ${nouveauRole.name}.` };
}
