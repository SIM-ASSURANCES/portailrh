import { prisma } from "./prisma";
import type { FeedbackSource } from "./generated/prisma/client";

/**
 * FeedbackApp — messages constructifs anonymes sur un employé (voir
 * CLAUDE.md "FeedbackApp : anonymat total"). RÈGLE ABSOLUE : aucune
 * fonction de ce fichier ne doit jamais accepter ni journaliser une donnée
 * permettant d'identifier l'auteur d'un message (IP, id de session,
 * empreinte navigateur...) — même à titre de paramètre transitoire non
 * persisté. La seule exception tolérée dans tout le module est l'IP
 * utilisée comme CLÉ DE COMPTEUR anti-spam EN MÉMOIRE (voir
 * `soumettreFeedbackAction`, `frontend/.../feedback/nouveau/actions.ts`),
 * jamais dans ce fichier-ci, qui ne connaît que des données déjà
 * anonymisées.
 *
 * Les constantes/validations sans dépendance Prisma (compteur de
 * caractères, filtre anti-haine, détection d'URL) vivent dans
 * `./feedback-constants.ts`, réexportées ci-dessous pour tout code
 * backend qui importe depuis `"backend"` — ne jamais les rapatrier ici :
 * ce fichier importe `./prisma`, ce qui casserait `client-safe.ts` si ces
 * constantes y étaient réexportées depuis ce module-ci plutôt que
 * directement depuis `feedback-constants.ts` (voir ce fichier).
 */
export * from "./feedback-constants";

export interface FeedbackRecipientOption {
  id: string;
  fullName: string;
}

/**
 * Employés proposables comme destinataire sur la page publique de
 * soumission — voir CLAUDE.md "FeedbackApp" pour la décision retenue
 * (TOUS les comptes actifs du portail, pas seulement un rôle précis :
 * n'importe quel employé peut recevoir un message constructif, pas
 * seulement Finance/RH/DG). Réutilise le `User` existant du portail,
 * aucune nouvelle table "employees".
 */
export async function getFeedbackRecipients(): Promise<FeedbackRecipientOption[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
  return users;
}

export interface PublicFeedbackEntry {
  id: string;
  content: string;
  /** DATE seule (voir `Feedback.submittedAt`, schema.prisma) — jamais d'heure. */
  submittedAt: Date;
}

/**
 * Messages publics (`source: PUBLIC`) affichés sur la vue publique —
 * jamais le nom du destinataire (voir CLAUDE.md "FeedbackApp", décision
 * retenue par défaut faute de cahier des charges accessible précisant le
 * contraire — à confirmer). Exclut les messages déjà modérés
 * (`isModerated: true`) : un message retiré par la modération ne doit
 * plus apparaître publiquement, même si aucun écran de modération n'est
 * encore construit à ce stade (Tranche A) — le filtre reste correct dès
 * qu'un tel écran existera.
 */
export async function getPublicFeedbacks(): Promise<PublicFeedbackEntry[]> {
  const feedbacks = await prisma.feedback.findMany({
    where: { source: "PUBLIC" as FeedbackSource, isModerated: false },
    select: { id: true, content: true, submittedAt: true },
    orderBy: { submittedAt: "desc" },
  });
  return feedbacks;
}
