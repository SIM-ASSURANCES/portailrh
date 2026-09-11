"use server";

import { revalidatePath } from "next/cache";

import { getSession, isAdmin } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { createNotification } from "@/lib/notifications";
import { prisma } from "backend";

/** Seules les branches Trésorerie et Pointage RH sont délégables — jamais
 * une permission hors de ces deux modules (il n'en existe pas d'autre à ce
 * jour, mais le filtre reste explicite par défense en profondeur plutôt que
 * de dépendre implicitement de l'absence d'un troisième module). */
const MODULES_DELEGABLES = ["tresorerie", "pointage"] as const;

type ActionResult = { status: "success" | "error"; message: string; delegationId?: string };

/**
 * Plafonnement strict, revérifié ici (jamais seulement à l'affichage du
 * formulaire) : le donneur ne peut déléguer que ce qu'il possède lui-même
 * **via son propre rôle** (`session.rolePermissions`, jamais
 * `session.permissions` qui inclurait une permission reçue par délégation —
 * voir `getSession()`) et uniquement pour une permission des deux branches
 * délégables.
 */
async function verifierEligibiliteDonneur(
  session: { rolePermissions: string[] },
  permissionId: string
): Promise<{ ok: true; permission: { id: string; key: string; label: string } } | { ok: false; message: string }> {
  const permission = await prisma.permission.findUnique({
    where: { id: permissionId },
    include: { module: true },
  });

  if (!permission) {
    return { ok: false, message: "Fonctionnalité introuvable." };
  }
  if (!MODULES_DELEGABLES.includes(permission.module.key as (typeof MODULES_DELEGABLES)[number])) {
    return { ok: false, message: "Cette fonctionnalité ne peut pas être déléguée." };
  }
  if (!session.rolePermissions.includes(permission.key)) {
    return {
      ok: false,
      message:
        "Action non autorisée : vous ne pouvez déléguer que des droits que vous possédez vous-même.",
    };
  }

  return { ok: true, permission };
}

/**
 * Accorde à un compte existant (`beneficiaireId`) une permission précise
 * (`permissionId`) que le donneur connecté possède lui-même via son rôle.
 * Voir CLAUDE.md "Délégation individuelle de permissions".
 */
export async function accorderDelegationAction(
  beneficiaireId: string,
  permissionId: string
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return { status: "error", message: "Action non autorisée." };
  }

  const eligibilite = await verifierEligibiliteDonneur(session, permissionId);
  if (!eligibilite.ok) {
    return { status: "error", message: eligibilite.message };
  }

  if (beneficiaireId === session.user.id) {
    return { status: "error", message: "Impossible de se déléguer un accès à soi-même." };
  }

  const beneficiaire = await prisma.user.findUnique({
    where: { id: beneficiaireId },
    include: { role: { select: { peutEtreBeneficiaireDelegation: true } } },
  });
  if (!beneficiaire || !beneficiaire.isActive || !beneficiaire.passwordHash) {
    return { status: "error", message: "Compte bénéficiaire invalide ou introuvable." };
  }
  // Éligibilité au bénéfice d'une délégation : champ dédié sur le rôle
  // (`Role.peutEtreBeneficiaireDelegation`), jamais une comparaison sur son
  // nom ("Collaborateur") ni sur l'absence d'`estAdmin` — voir CLAUDE.md
  // "Délégation individuelle de permissions". Revérifié ici même si la
  // liste affichée sur `/delegations` est déjà filtrée en amont : jamais
  // uniquement confiance dans ce que le formulaire a proposé.
  if (!beneficiaire.role.peutEtreBeneficiaireDelegation) {
    return {
      status: "error",
      message: "Ce compte ne peut pas être bénéficiaire d'une délégation (rôle non éligible).",
    };
  }

  const dejaActive = await prisma.permissionDelegation.findFirst({
    where: { beneficiaireId, donneurId: session.user.id, permissionId, estActive: true },
  });
  if (dejaActive) {
    return { status: "success", message: "Cet accès est déjà accordé.", delegationId: dejaActive.id };
  }

  const delegation = await prisma.permissionDelegation.create({
    data: { beneficiaireId, donneurId: session.user.id, permissionId },
  });

  await prisma.historiqueEntry.create({
    data: {
      entity: "PermissionDelegation",
      entityId: delegation.id,
      action: "GRANT",
      detail: `Accès "${eligibilite.permission.label}" délégué à ${beneficiaire.fullName} par ${session.user.fullName}`,
      userId: session.user.id,
    },
  });

  await createNotification({
    userId: beneficiaireId,
    titre: "Nouvel accès délégué",
    message: `${session.user.fullName} vous a accordé l'accès "${eligibilite.permission.label}".`,
    lien: "/",
  });

  revalidatePath("/delegations");
  revalidatePath("/admin/delegations");
  revalidatePath("/");
  publishDataChanged();

  return { status: "success", message: "Accès accordé.", delegationId: delegation.id };
}

/**
 * Révoque une délégation précise (`delegationId`) — jamais une suppression
 * ni une édition silencieuse : la ligne reste, marquée `estActive: false`
 * avec `revokedAt`/`revokedById` (voir modèle `PermissionDelegation`).
 * Utilisable par le donneur d'origine, OU par un Admin (voir CLAUDE.md,
 * point 3 des règles non négociables : l'Admin peut révoquer n'importe
 * quelle délégation, pas seulement les siennes).
 */
export async function revoquerDelegationAction(delegationId: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return { status: "error", message: "Action non autorisée." };
  }

  const delegation = await prisma.permissionDelegation.findUnique({
    where: { id: delegationId },
    include: { permission: true, beneficiaire: true, donneur: true },
  });
  if (!delegation) {
    return { status: "error", message: "Délégation introuvable." };
  }

  const estDonneurOrigine = delegation.donneurId === session.user.id;
  if (!estDonneurOrigine && !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  if (!delegation.estActive) {
    return { status: "success", message: "Cet accès est déjà révoqué." };
  }

  await prisma.permissionDelegation.update({
    where: { id: delegationId },
    data: { estActive: false, revokedAt: new Date(), revokedById: session.user.id },
  });

  await prisma.historiqueEntry.create({
    data: {
      entity: "PermissionDelegation",
      entityId: delegation.id,
      action: "REVOKE",
      detail: `Accès "${delegation.permission.label}" retiré à ${delegation.beneficiaire.fullName} (accordé par ${delegation.donneur.fullName})`,
      userId: session.user.id,
    },
  });

  await createNotification({
    userId: delegation.beneficiaireId,
    titre: "Accès délégué retiré",
    message: `L'accès "${delegation.permission.label}" vous a été retiré.`,
  });

  revalidatePath("/delegations");
  revalidatePath("/admin/delegations");
  revalidatePath("/");
  publishDataChanged();

  return { status: "success", message: "Accès révoqué." };
}
