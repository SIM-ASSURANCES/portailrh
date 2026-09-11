"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, isAdmin } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { prisma } from "backend";
import { fieldErrorsFromZod, type ActionState } from "backend";

const creerRoleSchema = z.object({
  nom: z.string().min(2, "Le nom doit contenir au moins 2 caractères"),
  description: z.string().optional(),
  estAdmin: z.coerce.boolean().optional().default(false),
});

/**
 * Crée un nouveau rôle, au-delà des 5 rôles posés par le seed
 * (Admin/Collaborateur/Finance/DG/RH) — ex: un rôle combiné pour un
 * utilisateur cumulant plusieurs fonctions. Réservé aux administrateurs ;
 * créé sans aucune permission accordée (RolePermission vide), à cocher
 * ensuite comme n'importe quel autre rôle sur cette même page.
 *
 * **`estAdmin` se règle UNIQUEMENT ici, à la création** (voir CLAUDE.md
 * "estAdmin figé après création") — c'est le seul moment de tout le cycle
 * de vie d'un rôle où ce champ est modifiable. Une fois le rôle créé,
 * plus aucune Server Action ne permet de le changer, dans un sens comme
 * dans l'autre (voir `toggleRoleEstAdminAction` ci-dessous, qui refuse
 * désormais systématiquement).
 */
export async function creerRoleAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = creerRoleSchema.safeParse({
    nom: formData.get("nom"),
    description: formData.get("description") || undefined,
    estAdmin: formData.get("estAdmin") === "on",
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const existing = await prisma.role.findUnique({ where: { name: parsed.data.nom } });
  if (existing) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: { nom: "Un rôle porte déjà ce nom." },
    };
  }

  const role = await prisma.role.create({
    data: {
      name: parsed.data.nom,
      description: parsed.data.description ?? null,
      estAdmin: parsed.data.estAdmin,
    },
  });

  await prisma.historiqueEntry.create({
    data: {
      entity: "Role",
      entityId: role.id,
      action: "CREATE",
      detail: `Création du rôle "${role.name}"${role.estAdmin ? " (avec accès administrateur)" : ""}`,
      userId: session.user.id,
    },
  });

  revalidatePath("/admin/roles");
  publishDataChanged();

  return { status: "success", message: `Rôle "${role.name}" créé.` };
}

/**
 * **Toujours refusée depuis "estAdmin figé après création" (voir
 * CLAUDE.md)** — conservée uniquement comme point d'entrée de défense en
 * profondeur (message clair en cas de rejeu réseau direct), plutôt que
 * supprimée entièrement : sans elle, une requête directe vers cette
 * action renverrait une erreur générique "action introuvable" de Next.js
 * au lieu d'un message explicite.
 *
 * `Role.estAdmin` ne se règle plus QU'À LA CRÉATION du rôle
 * (`creerRoleAction` ci-dessus) — un choix définitif, jamais révisable
 * ensuite, dans aucun des deux sens. **L'ancienne logique "dernier rôle
 * admin"** (comptage des autres rôles `estAdmin: true` avant d'autoriser
 * un retrait, voir CLAUDE.md "Protection du dernier rôle estAdmin=true")
 * **devient sans objet et a été retirée** : plus aucune modification
 * n'étant possible sur un rôle existant, il n'y a plus jamais de
 * "dernier rôle" à protéger dynamiquement — l'invariant "au moins un rôle
 * admin existe" est désormais garanti structurellement (aucun rôle
 * existant ne peut perdre `estAdmin`), pas par un compteur à chaque appel.
 *
 * Signature conservée identique (`roleId`, `estAdmin`, tous deux ignorés)
 * plutôt que réduite à zéro argument : reste un point de rejeu réseau
 * réaliste pour la défense en profondeur, dans la même forme qu'avant ce
 * changement.
 */
export async function toggleRoleEstAdminAction(
  roleId: string,
  estAdmin: boolean
): Promise<{ status: "success" | "error"; message: string }> {
  void roleId;
  void estAdmin;

  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  return {
    status: "error",
    message:
      "L'accès administrateur (estAdmin) ne peut plus être modifié après la création d'un rôle — c'est un choix définitif fait uniquement à la création.",
  };
}

/**
 * Accorde ou retire une permission à un rôle. Appelée directement depuis un
 * composant client (pas via <form>). N'affecte jamais l'accès admin d'un
 * rôle (`Role.estAdmin`, voir `toggleRoleEstAdminAction` ci-dessus) —
 * les deux notions sont volontairement indépendantes.
 */
export async function toggleRolePermissionAction(
  roleId: string,
  permissionId: string,
  granted: boolean
): Promise<{ status: "success" | "error"; message: string }> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  if (granted) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId } },
      create: { roleId, permissionId },
      update: {},
    });
  } else {
    await prisma.rolePermission.deleteMany({ where: { roleId, permissionId } });
  }

  const [role, permission] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { id: roleId } }),
    prisma.permission.findUniqueOrThrow({ where: { id: permissionId } }),
  ]);

  await prisma.historiqueEntry.create({
    data: {
      entity: "RolePermission",
      entityId: `${roleId}:${permissionId}`,
      action: granted ? "GRANT" : "REVOKE",
      detail: `Permission "${permission.label}" ${granted ? "accordée au" : "retirée du"} rôle ${role.name}`,
      userId: session.user.id,
    },
  });

  // Le changement peut affecter la visibilité des modules sur le dashboard
  // des utilisateurs ayant ce rôle.
  revalidatePath("/admin/roles");
  revalidatePath("/");
  publishDataChanged();

  return { status: "success", message: granted ? "Permission accordée." : "Permission retirée." };
}

/**
 * Accorde ou retire l'éligibilité d'un rôle à être BÉNÉFICIAIRE d'une
 * délégation individuelle de permission (voir CLAUDE.md "Délégation
 * individuelle de permissions", `Role.peutEtreBeneficiaireDelegation`).
 *
 * **Volontairement librement modifiable à tout moment** (contrairement à
 * `estAdmin`, figé après création) : ce champ ne donne par lui-même AUCUN
 * droit, il ne fait qu'autoriser un rôle à apparaître dans la liste des
 * bénéficiaires possibles sur `/delegations` — le vrai plafonnement (ce que
 * le donneur peut réellement accorder) reste entièrement porté par
 * `accorderDelegationAction`. Aucun risque de verrouillage comparable à
 * `estAdmin` (pas d'invariant "au moins un rôle éligible" à protéger),
 * donc pas de raison de le figer : un Admin doit pouvoir étendre ou
 * resserrer cette éligibilité à tout moment, exactement comme une
 * permission de module ordinaire (`toggleRolePermissionAction` ci-dessus).
 */
export async function toggleRolePeutEtreBeneficiaireDelegationAction(
  roleId: string,
  eligible: boolean
): Promise<{ status: "success" | "error"; message: string }> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return { status: "error", message: "Action non autorisée." };
  }

  const role = await prisma.role.update({
    where: { id: roleId },
    data: { peutEtreBeneficiaireDelegation: eligible },
  });

  await prisma.historiqueEntry.create({
    data: {
      entity: "Role",
      entityId: role.id,
      action: eligible ? "GRANT_BENEFICIAIRE_DELEGATION" : "REVOKE_BENEFICIAIRE_DELEGATION",
      detail: `Rôle "${role.name}" ${eligible ? "rendu éligible" : "rendu inéligible"} comme bénéficiaire de délégation`,
      userId: session.user.id,
    },
  });

  revalidatePath("/admin/roles");
  revalidatePath("/delegations");
  publishDataChanged();

  return {
    status: "success",
    message: eligible ? "Rôle rendu éligible comme bénéficiaire." : "Rôle rendu inéligible comme bénéficiaire.",
  };
}
