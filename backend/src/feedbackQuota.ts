/**
 * FeedbackApp — limite « un avis par collègue et par jour » (et « un avis sur les conditions de travail par jour »).
 * Fichier PUR (aucun import de Prisma), testé par `feedbackQuota.test.ts`. Côté SERVEUR uniquement (`node:crypto`,
 * secret) : jamais réexporté par `client-safe.ts`.
 *
 * RÈGLE : l'identifiant de l'auteur n'entre ici QUE pour calculer l'empreinte HMAC. Il n'est jamais stocké, jamais
 * renvoyé, jamais journalisé. Seules l'empreinte et le jour sont écrits (table `FeedbackQuota`, sans aucune relation vers
 * `Feedback` ni `User`), et la purge quotidienne efface les jours passés.
 *
 * Limite assumée : quelqu'un qui aurait à la fois la base et `AUTH_SECRET` peut recalculer les empreintes de tous les
 * couples (auteur, cible) et retrouver qui a évalué un collègue donné dans la journée, tant que la trace existe.
 */
import { createHmac } from "node:crypto";

import { MESSAGE_QUOTA_COLLABORATION, MESSAGE_QUOTA_CONDITIONS_TRAVAIL } from "./feedback-constants";
import type { FeedbackType } from "./generated/prisma/enums";

const CONTEXTE_CLE_DERIVEE = "feedback-quota-v1";

/** Cible d'un avis sur les conditions de travail (il n'a pas de destinataire). */
export const CIBLE_CONDITIONS_TRAVAIL = "CONDITIONS_TRAVAIL";

export function messageQuotaFeedback(type: FeedbackType): string {
  return type === "COLLABORATION" ? MESSAGE_QUOTA_COLLABORATION : MESSAGE_QUOTA_CONDITIONS_TRAVAIL;
}

export function cibleQuotaFeedback(type: FeedbackType, recipientId: string | null): string {
  if (type === "CONDITIONS_TRAVAIL") return CIBLE_CONDITIONS_TRAVAIL;
  if (!recipientId) throw new Error("Destinataire requis pour la limite d'un avis « Collaboration ».");
  return recipientId;
}

/**
 * Empreinte HMAC-SHA256 (hexadécimal) de « auteur|cible|jour », avec une clé dérivée de `secret` (`AUTH_SECRET`).
 * Lève une erreur sans secret : on ne dégrade JAMAIS vers « pas de limite ». L'erreur ne contient aucune des entrées.
 */
export function empreinteQuotaFeedback(p: {
  secret: string | null | undefined;
  auteurId: string;
  cible: string;
  /** Jour calendaire d'Abidjan (UTC+0), `AAAA-MM-JJ` (`jourCourant`). */
  jour: string;
}): string {
  if (!p.secret || !p.secret.trim()) {
    throw new Error("AUTH_SECRET absent : la limite d'un avis par jour ne peut pas être appliquée.");
  }
  const cleDerivee = createHmac("sha256", p.secret).update(CONTEXTE_CLE_DERIVEE).digest();
  return createHmac("sha256", cleDerivee).update(`${p.auteurId}|${p.cible}|${p.jour}`).digest("hex");
}
