/**
 * FeedbackApp — diagnostic d'un échec d'enregistrement. Module PUR (aucun accès base).
 *
 * Un message d'erreur Prisma peut citer les valeurs écrites (empreinte de quota, destinataire, réponses). On ne garde
 * donc JAMAIS le message, la cause ni les valeurs : seulement le CODE d'erreur Prisma et le nom de l'ÉTAPE.
 */

/** « cle » : calcul de l'empreinte ; « quota » et « avis » : écritures ; « transaction » : ouverture ou validation. */
export type EtapeEnregistrementFeedback = "cle" | "quota" | "avis" | "transaction";

export const CODE_PRISMA_INCONNU = "INCONNU";

/** Code Prisma (`P2003`…) d'une erreur, ou `INCONNU`. Rien d'autre n'est jamais lu de l'erreur. */
export function codeErreurPrisma(erreur: unknown): string {
  const code = (erreur as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && /^P\d{4}$/.test(code) ? code : CODE_PRISMA_INCONNU;
}

/** Erreur relancée à la place de l'originale (qui est abandonnée), pour annuler la transaction. */
export class ErreurEnregistrementFeedback extends Error {
  constructor(
    readonly etape: EtapeEnregistrementFeedback,
    readonly codePrisma: string
  ) {
    super(`FeedbackApp : étape ${etape}, code ${codePrisma}`);
    this.name = "ErreurEnregistrementFeedback";
  }
}

export function messageIncidentFeedback(etape: EtapeEnregistrementFeedback, codePrisma: string): string {
  return `Enregistrement d'un avis FeedbackApp impossible (étape ${etape}, code ${codePrisma}).`;
}
