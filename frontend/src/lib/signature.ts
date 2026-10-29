// Lot L — garde et enregistrement des actions SIGNÉES (côté serveur, jamais l'interface seule).
//
//   export async function fooAction(a) { return avecSignature({ action: "foo", permission: "treso.x", cible: {type:"demande", id:a} }, () => fooInterne(a)); }
//
// 1. Le compte connecté DOIT avoir une signature enrôlée : sinon l'action est refusée (même si l'appel contourne l'écran). Ce contrôle
//    est fait AVANT d'ouvrir la transaction.
// 2. Lot L bis : l'action ET l'enregistrement de sa signature s'exécutent dans UNE SEULE transaction (`executerEnTransactionSignee`) :
//    la ligne d'action signée est écrite en premier (si elle échoue, l'action n'a pas lieu), les lignes d'historique produites par
//    l'action portent son identifiant (lien par identifiant), un résultat qui n'est pas un succès annule tout, les envois
//    (notification, push, e-mail) partent après la validation. Les contrôles de l'action (permission, statut, garde 8…) sont inchangés.
// 3. La ligne d'action signée garde : signataire (compte connecté), version de signature utilisée, titulaire si délégation, adresse
//    IP, date. Jamais d'écriture dans une écriture existante du journal de caisse.
//
// La signature prouve que l'action vient du compte connecté, avec la signature qu'il a enrôlée : elle n'est pas redessinée à chaque action.

import { headers } from "next/headers";
import { getSession } from "@/lib/auth";
import {
  executerEnTransactionSignee,
  getTrustedClientIp,
  MESSAGE_SIGNATURE_REQUISE,
  operationsActionSignee,
  prisma,
  signatureCourante,
  titulaireDelegation,
  type ClientTransactionnel,
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
  /** Modèle de l'entité CRÉÉE par l'action (`retourExterne`, `retourCaisse`…) : son identifiant relie la signature à l'événement. */
  creation?: string;
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

  const [auNomDeId, ip] = await Promise.all([
    titulaireDelegation(prisma, {
      userId: session.user.id,
      permission: ctx.permission,
      permissions: session.permissions,
      rolePermissions: session.rolePermissions,
    }),
    headers().then((h) => getTrustedClientIp(h)),
  ]);
  return executerEnTransactionSignee<T>(
    prisma as unknown as ClientTransactionnel,
    operationsActionSignee<T>({ cible: ctx.cible, cibleApres: ctx.cibleApres, entite: ctx.entite, entiteId: ctx.entiteId, creation: ctx.creation }),
    { signatureId: signature.id, signataireId: session.user.id, auNomDeId, action: ctx.action, ip, entite: ctx.entite },
    executer
  );
}
