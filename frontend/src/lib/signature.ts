// Lot L — garde et enregistrement des actions SIGNÉES (côté serveur, jamais l'interface seule).
//
//   export async function fooAction(a) { return avecSignature({ action: "foo", permission: "treso.x", cible: {type:"demande", id:a} }, () => fooInterne(a)); }
//
// 1. Le compte connecté DOIT avoir une signature enrôlée : sinon l'action est refusée (même si l'appel contourne l'écran).
// 2. L'action s'exécute normalement (ses propres contrôles de permission, de statut et de conflit d'intérêts sont inchangés).
// 3. En cas de succès, l'action signée est enregistrée : signataire (compte connecté), version de signature utilisée, titulaire si
//    délégation, adresse IP, date. Jamais d'écriture dans une écriture existante.
//
// La signature prouve que l'action vient du compte connecté, avec la signature qu'il a enrôlée : elle n'est pas redessinée à chaque action.

import { headers } from "next/headers";
import { getSession } from "@/lib/auth";
import {
  enregistrerActionSignee,
  getTrustedClientIp,
  MESSAGE_SIGNATURE_REQUISE,
  prisma,
  resoudreCible,
  signatureCourante,
  titulaireDelegation,
  type CibleSignature,
} from "backend";

export interface ContexteSignature<T> {
  /** Code de l'action signée (clé de `ACTIONS_SIGNEES`). */
  action: string;
  /** Permission métier requise : sert à repérer une action faite PAR DÉLÉGATION (« signé par X, au nom de Y »). */
  permission?: string;
  /** Cible connue avant l'exécution (demande, article, règlement, retour…). */
  cible?: CibleSignature | null;
  /** Cible connue seulement après le succès (ex. demande créée par l'action). */
  cibleApres?: (resultat: T) => CibleSignature | null;
  /** Entité hors demande (budget, caisse…). */
  entite?: string;
  entiteId?: string | ((resultat: T) => string | undefined);
}

export type RefusSignature = { status: "error"; message: string };

export async function avecSignature<T extends { status: string }>(
  ctx: ContexteSignature<T>,
  executer: () => Promise<T>
): Promise<T | RefusSignature> {
  const session = await getSession();
  // Sans session, l'action refuse d'elle-même (« Action non autorisée. »).
  if (!session) return executer();

  const signature = await signatureCourante(prisma, session.user.id);
  if (!signature) return { status: "error", message: MESSAGE_SIGNATURE_REQUISE };

  const cibleAvant = ctx.cible ? await resoudreCible(prisma, ctx.cible) : null;
  const resultat = await executer();
  if (resultat.status !== "success") return resultat;

  try {
    const ciblePosterieure = ctx.cibleApres?.(resultat);
    const cible = ciblePosterieure ? await resoudreCible(prisma, ciblePosterieure) : cibleAvant;
    const [auNomDeId, ip] = await Promise.all([
      titulaireDelegation(prisma, {
        userId: session.user.id,
        permission: ctx.permission,
        permissions: session.permissions,
        rolePermissions: session.rolePermissions,
      }),
      headers().then((h) => getTrustedClientIp(h)),
    ]);
    await enregistrerActionSignee(prisma, {
      signatureId: signature.id,
      signataireId: session.user.id,
      auNomDeId,
      action: ctx.action,
      ip,
      cible,
      entite: ctx.entite,
      entiteId: typeof ctx.entiteId === "function" ? ctx.entiteId(resultat) : ctx.entiteId,
    });
  } catch (erreur) {
    // L'action est déjà faite : on ne la fait pas échouer, mais l'incident est visible dans les journaux du serveur.
    console.error("[signature] enregistrement de l'action signée impossible", ctx.action, erreur);
  }
  return resultat;
}
