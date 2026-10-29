import type { Prisma } from "./generated/prisma/client";
import { PERMISSIONS_DECISION_NON_DELEGABLES } from "./circuitDemande";

/**
 * Règle UNIQUE de validité d'une délégation (lot N, 2026-10-30) — avant, elle n'existait que dans `getSession()` ; les
 * notifications par permission (`notifyByPermission`) ne lisaient que le rôle et oubliaient les délégués.
 *
 * Une délégation ACTIVE (`estActive`) ne compte que si :
 * - la permission n'est pas une permission de décision du circuit (`PERMISSIONS_DECISION_NON_DELEGABLES`, jamais délégable) ;
 * - le donneur est ACTIF ;
 * - le donneur possède ENCORE la permission par son rôle (la délégation est dynamique, jamais figée).
 * Le bénéficiaire doit lui aussi être actif (vérifié par l'appelant qui lit les comptes).
 */
export interface DonneurDelegation {
  isActive: boolean;
  /** Clés des permissions du RÔLE actuel du donneur. */
  permissionsRole: readonly string[];
}

export function delegationCompte(permissionKey: string, donneur: DonneurDelegation): boolean {
  if (PERMISSIONS_DECISION_NON_DELEGABLES.includes(permissionKey)) return false;
  return donneur.isActive && donneur.permissionsRole.includes(permissionKey);
}

type Db = Pick<Prisma.TransactionClient, "user" | "permissionDelegation">;

/**
 * Comptes actifs qui détiennent la permission : titulaires par leur rôle + délégués actifs dont la délégation est valide
 * (`delegationCompte`). `inclureDelegues: false` pour les notifications de DÉCISION qui se lisent sur le rôle seul (ex. la
 * justification de pointage : un délégué de `pointage.corriger_pointage` ne la décide pas). Sans doublon, `excludeUserId` retiré.
 */
export async function utilisateursAvecPermission(
  db: Db,
  permissionKey: string,
  options: { excludeUserId?: string; inclureDelegues?: boolean } = {}
): Promise<string[]> {
  const { excludeUserId, inclureDelegues = true } = options;
  const titulaires = await db.user.findMany({
    where: {
      isActive: true,
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      role: { permissions: { some: { permission: { key: permissionKey } } } },
    },
    select: { id: true },
  });
  const ids = new Set(titulaires.map((u) => u.id));
  if (inclureDelegues && !PERMISSIONS_DECISION_NON_DELEGABLES.includes(permissionKey)) {
    const delegations = await db.permissionDelegation.findMany({
      where: {
        estActive: true,
        permission: { key: permissionKey },
        beneficiaire: { isActive: true, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
        donneur: { isActive: true },
      },
      select: {
        beneficiaireId: true,
        donneur: { select: { isActive: true, role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } } },
      },
    });
    for (const d of delegations) {
      const permissionsRole = d.donneur.role.permissions.map((rp) => rp.permission.key);
      if (delegationCompte(permissionKey, { isActive: d.donneur.isActive, permissionsRole })) ids.add(d.beneficiaireId);
    }
  }
  return [...ids];
}
