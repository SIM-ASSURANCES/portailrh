import { prisma } from "./prisma";
import type { FeedbackSource, FeedbackType, Prisma } from "./generated/prisma/client";
import { FEEDBACK_CONTENT_MAX, FEEDBACK_CONTENT_MIN } from "./feedback-constants";
import { generateFeedbackComment, type FeedbackRatings } from "./feedback-questions";

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
// Idem pour les définitions de questions et la génération du commentaire
// (notation structurée) — `./feedback-questions.ts` n'importe pas non plus
// `./prisma`, réexporté ici pour tout code backend, jamais rapatrié.
export * from "./feedback-questions";

let feedbackModulePermissionSyncPromise: Promise<void> | null = null;

/**
 * Garantit que le Module `feedback` et la Permission `feedback.moderer`
 * EXISTENT en base, même sur un environnement où `seed.ts` n'a jamais été
 * rejoué depuis l'ajout de FeedbackApp (utile en dev après un git pull).
 * Idempotent, sûr à appeler à chaque process serveur : ne fait
 * qu'`upsert` le Module et la Permission eux-mêmes.
 *
 * **NE TOUCHE JAMAIS À QUI POSSÈDE cette permission** — aucun
 * `RolePermission` n'est créé ni modifié ici, volontairement. Régression
 * corrigée (voir CLAUDE.md "FeedbackApp") : une version antérieure de
 * cette fonction (alors nommée `ensureFeedbackPermissions`) réattribuait
 * AUSSI `feedback.moderer` à RH/DG **et Admin** à chaque appel — donc à
 * chaque redémarrage de process serveur, puisqu'appelée sans condition
 * dans `getSession()` — écrasant silencieusement toute révocation faite
 * par un Admin via `/admin/roles`. "Admin" n'a d'ailleurs jamais été
 * autorisé à recevoir cette permission automatiquement (seuls RH et DG
 * l'ont été, décision explicite). L'attribution initiale à RH/DG est
 * désormais un choix fait UNE SEULE FOIS, via `seed.ts` (base neuve) ou
 * la migration de rattrapage dédiée
 * (`20260918000000_feedback_moderer_role_permission_rattrapage`, base déjà
 * seedée avant l'existence de FeedbackApp) — jamais recalculée au
 * runtime, donc librement modifiable ensuite par un Admin sans jamais
 * être réinitialisée, même principe que `peutEtreBeneficiaireDelegation`/
 * `peutRecevoirFeedback`.
 */
export async function ensureFeedbackModuleAndPermission(): Promise<void> {
  if (!feedbackModulePermissionSyncPromise) {
    feedbackModulePermissionSyncPromise = (async () => {
      try {
        const moduleFeedback = await prisma.module.upsert({
          where: { key: "feedback" },
          update: { label: "FeedbackApp", isActive: true },
          create: { key: "feedback", label: "FeedbackApp", isActive: true },
        });

        await prisma.permission.upsert({
          where: { key: "feedback.moderer" },
          update: { label: "Modérer les messages FeedbackApp", moduleId: moduleFeedback.id },
          create: {
            key: "feedback.moderer",
            label: "Modérer les messages FeedbackApp",
            moduleId: moduleFeedback.id,
          },
        });
      } catch (err) {
        console.error("[FeedbackApp] Erreur synchronisation module/permission:", err);
      }
    })();
  }
  return feedbackModulePermissionSyncPromise;
}

export interface FeedbackRecipientOption {
  id: string;
  fullName: string;
}

/**
 * Employés proposables comme destinataire sur la page publique de
 * soumission — voir CLAUDE.md "FeedbackApp" pour la décision retenue
 * (TOUS les comptes actifs du portail dont le RÔLE est éligible, pas
 * seulement un rôle métier précis : n'importe quel employé peut recevoir
 * un message constructif, pas seulement Finance/RH/DG). Réutilise le
 * `User` existant du portail, aucune nouvelle table "employees".
 *
 * `role.peutRecevoirFeedback` (voir schema.prisma) exclut les rôles
 * représentant un COMPTE TECHNIQUE plutôt qu'un vrai employé (ex: "Admin")
 * — jamais une comparaison sur le nom du rôle en dur, même principe que
 * `estAdmin`/`peutEtreBeneficiaireDelegation`. Un rôle combiné (ex: "Admin
 * / Collaborateur", qui porte aussi `estAdmin: true` mais représente un
 * vrai employé) reste proposable : ce champ est indépendant de `estAdmin`.
 */
export async function getFeedbackRecipients(excludeUserId?: string): Promise<FeedbackRecipientOption[]> {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { peutRecevoirFeedback: true },
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
  return users;
}

/**
 * Crée un `Feedback` à partir de réponses structurées — **seul point
 * d'écriture** du module (voir CLAUDE.md "FeedbackApp — notation
 * structurée") : `content` n'est **jamais** reçu en paramètre, il est
 * TOUJOURS calculé ici via `generateFeedbackComment(type, ratings)`.
 * Empêche structurellement qu'un `content` fabriqué par un client
 * malveillant (rejeu réseau direct, contournant le formulaire) ne soit
 * jamais persisté tel quel — la seule donnée texte jamais écrite en base
 * est celle que ce module génère lui-même à partir de notes fixes.
 *
 * `recipientId` : obligatoire pour `COLLABORATION`, ignoré (forcé à
 * `null`) pour `CONDITIONS_TRAVAIL` — revalidé ici, jamais une simple
 * convention côté appelant.
 */
export async function createFeedback(params: {
  type: FeedbackType;
  recipientId: string | null;
  ratings: FeedbackRatings;
  source: FeedbackSource;
}): Promise<{ success: true; id: string } | { success: false; message: string }> {
  const content = generateFeedbackComment(params.type, params.ratings);
  if (content.length < FEEDBACK_CONTENT_MIN || content.length > FEEDBACK_CONTENT_MAX) {
    // Filet de sécurité : ne devrait jamais se produire avec les phrases
    // actuelles (voir `generateFeedbackComment`), mais on ne persiste
    // jamais un contenu hors des bornes déjà vérifiées ailleurs (zod côté
    // action, contrainte documentée sur la colonne).
    return { success: false, message: "Impossible de générer un commentaire valide à partir de ces réponses." };
  }

  if (params.type === "COLLABORATION" && !params.recipientId) {
    return { success: false, message: "Destinataire requis pour ce type d'avis." };
  }

  const feedback = await prisma.feedback.create({
    data: {
      content,
      recipientId: params.type === "COLLABORATION" ? params.recipientId : null,
      type: params.type,
      source: params.source,
      ratings: params.ratings as Prisma.InputJsonValue,
    },
  });

  return { success: true, id: feedback.id };
}

export interface PublicFeedbackEntry {
  id: string;
  content: string;
  /** DATE seule (voir `Feedback.submittedAt`, schema.prisma) — jamais d'heure. */
  submittedAt: Date;
}

/**
 * Messages publics affichés sur la vue publique (`/feedback`) — jamais le
 * nom d'un destinataire (de toute façon inexistant pour ce type, voir
 * plus bas). Exclut les messages déjà modérés (`isModerated: true`).
 *
 * **Filtre sur `type`, jamais sur `source`** (voir CLAUDE.md "FeedbackApp
 * — notation structurée", changement de comportement important) : la
 * visibilité publique dépend désormais de la NATURE de l'avis
 * (`CONDITIONS_TRAVAIL`, toujours public), pas de qui l'a soumis
 * (`FeedbackSource` reste orthogonal — un avis `CONDITIONS_TRAVAIL`
 * soumis par un employé connecté, `source: INTERNAL`, est tout aussi
 * public qu'un avis anonyme). Les avis `COLLABORATION` (critique d'un
 * collaborateur nommé) ne sont **plus jamais** listés ici, quel que soit
 * leur `source` — ils sont désormais strictement privés (destinataire +
 * comptes `feedback.moderer`, voir `getUserFeedbacks`/`getAdminFeedbacks`).
 */
export async function getPublicFeedbacks(): Promise<PublicFeedbackEntry[]> {
  const feedbacks = await prisma.feedback.findMany({
    where: { type: "CONDITIONS_TRAVAIL" as FeedbackType, isModerated: false },
    select: { id: true, content: true, submittedAt: true },
    orderBy: { submittedAt: "desc" },
  });
  return feedbacks;
}

export interface UserFeedbackEntry {
  id: string;
  content: string;
  submittedAt: Date;
  source: FeedbackSource;
}

export type FeedbackPeriodFilter = "semaine" | "mois" | "tout";

/**
 * Critiques / retours reçus par un employé connecté (Tranche B).
 * Strictement filtré sur `recipientId = userId`, `type: COLLABORATION` et
 * `isModerated = false`. RÈGLE ABSOLUE : ne renvoie AUCUNE information
 * d'auteur.
 *
 * Le filtre `type: COLLABORATION` est explicite (voir CLAUDE.md "FeedbackApp
 * — notation structurée") même si `recipientId: userId` exclurait déjà
 * structurellement tout `CONDITIONS_TRAVAIL` (toujours `recipientId: null`
 * pour ce type) : défense en profondeur, jamais une dépendance implicite
 * à un autre invariant pour une garantie de confidentialité.
 */
export async function getUserFeedbacks(
  userId: string,
  period: FeedbackPeriodFilter = "tout"
): Promise<UserFeedbackEntry[]> {
  const now = new Date();
  let dateFilter: { gte?: Date } | undefined;

  if (period === "semaine") {
    // Début de la semaine courante (lundi)
    const day = now.getDay();
    const diff = (day === 0 ? -6 : 1) - day; // ajustement lundi = jour 1
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    dateFilter = { gte: monday };
  } else if (period === "mois") {
    // Début du mois courant
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    dateFilter = { gte: firstDayOfMonth };
  }

  const feedbacks = await prisma.feedback.findMany({
    where: {
      recipientId: userId,
      type: "COLLABORATION" as FeedbackType,
      isModerated: false,
      ...(dateFilter ? { submittedAt: dateFilter } : {}),
    },
    select: {
      id: true,
      content: true,
      submittedAt: true,
      source: true,
    },
    orderBy: { submittedAt: "desc" },
  });

  return feedbacks;
}

export interface AdminFeedbackFilters {
  du?: string;
  au?: string;
  statut?: "tous" | "actifs" | "moderes";
  source?: "tous" | "PUBLIC" | "INTERNAL";
  type?: "tous" | "COLLABORATION" | "CONDITIONS_TRAVAIL";
  search?: string;
}

export interface AdminFeedbackEntry {
  id: string;
  content: string;
  submittedAt: Date;
  source: FeedbackSource;
  type: FeedbackType;
  isModerated: boolean;
  motifModeration: string | null;
  moderatedAt: Date | null;
  moderatedByNom: string | null;
  /** Identifiant pseudonymisé du destinataire, respectant le CDC — `null`
   * pour `CONDITIONS_TRAVAIL` (jamais de destinataire pour ce type). */
  recipientPseudo: string | null;
}

/**
 * Vue d'ensemble de TOUS les messages de la plateforme (les deux
 * `type`, `COLLABORATION` et `CONDITIONS_TRAVAIL`, jamais filtré par
 * défaut — voir CLAUDE.md "FeedbackApp — notation structurée") pour la
 * modération RH/Direction/Admin (Tranche B). Respecte le CDC : ne divulgue
 * jamais l'identité nominative du destinataire dans la liste globale.
 */
export async function getAdminFeedbacks(filters: AdminFeedbackFilters = {}): Promise<AdminFeedbackEntry[]> {
  const whereClause: Prisma.FeedbackWhereInput = {};

  if (filters.du || filters.au) {
    whereClause.submittedAt = {};
    if (filters.du) {
      whereClause.submittedAt.gte = new Date(filters.du);
    }
    if (filters.au) {
      whereClause.submittedAt.lte = new Date(filters.au);
    }
  }

  if (filters.statut === "actifs") {
    whereClause.isModerated = false;
  } else if (filters.statut === "moderes") {
    whereClause.isModerated = true;
  }

  if (filters.source && filters.source !== "tous") {
    whereClause.source = filters.source as FeedbackSource;
  }

  if (filters.type && filters.type !== "tous") {
    whereClause.type = filters.type as FeedbackType;
  }

  if (filters.search && filters.search.trim()) {
    whereClause.content = {
      contains: filters.search.trim(),
      mode: "insensitive",
    };
  }

  const feedbacks = await prisma.feedback.findMany({
    where: whereClause,
    include: {
      moderatedBy: { select: { fullName: true } },
    },
    orderBy: { submittedAt: "desc" },
  });

  return feedbacks.map((f) => {
    // Pseudonymisation déterministe basée sur l'id du destinataire (ex:
    // "Collaborateur #A1B2") — `null` pour `CONDITIONS_TRAVAIL`, qui n'a
    // structurellement aucun `recipientId` (voir schema.prisma).
    const recipientPseudo = f.recipientId
      ? `Collaborateur #${f.recipientId.replace(/[^a-zA-Z0-9]/g, "").slice(-4).toUpperCase() || "ANON"}`
      : null;
    return {
      id: f.id,
      content: f.content,
      submittedAt: f.submittedAt,
      source: f.source,
      type: f.type,
      isModerated: f.isModerated,
      motifModeration: f.motifModeration,
      moderatedAt: f.moderatedAt,
      moderatedByNom: f.moderatedBy?.fullName ?? null,
      recipientPseudo,
    };
  });
}

export interface FeedbackStats {
  total: number;
  ceMois: number;
  moderes: number;
  actifs: number;
  tauxModeration: number;
  nbPublic: number;
  nbInterne: number;
}

/**
 * Statistiques globales et anonymisées pour le tableau de bord de modération.
 */
export async function getFeedbackStats(): Promise<FeedbackStats> {
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [total, ceMois, moderes, nbPublic, nbInterne] = await Promise.all([
    prisma.feedback.count(),
    prisma.feedback.count({
      where: { submittedAt: { gte: firstDayOfMonth } },
    }),
    prisma.feedback.count({
      where: { isModerated: true },
    }),
    prisma.feedback.count({
      where: { source: "PUBLIC" },
    }),
    prisma.feedback.count({
      where: { source: "INTERNAL" },
    }),
  ]);

  const actifs = total - moderes;
  const tauxModeration = total > 0 ? Math.round((moderes / total) * 1000) / 10 : 0;

  return {
    total,
    ceMois,
    moderes,
    actifs,
    tauxModeration,
    nbPublic,
    nbInterne,
  };
}

/**
 * Action de modération d'un message inapproprié (retrait).
 * Exige un motif de modération obligatoire (min 3 caractères).
 * Traçabilité : qui a modéré et quand.
 */
export async function modererFeedback(
  id: string,
  moderatorId: string,
  motif: string
): Promise<{ success: boolean; message: string }> {
  const feedback = await prisma.feedback.findUnique({
    where: { id },
  });

  if (!feedback) {
    return { success: false, message: "Message introuvable." };
  }

  if (feedback.isModerated) {
    return { success: false, message: "Ce message a déjà été modéré." };
  }

  const cleanMotif = motif.trim();
  if (cleanMotif.length < 3) {
    return { success: false, message: "Le motif de modération doit contenir au moins 3 caractères." };
  }

  await prisma.feedback.update({
    where: { id },
    data: {
      isModerated: true,
      motifModeration: cleanMotif,
      moderatedById: moderatorId,
      moderatedAt: new Date(),
    },
  });

  return { success: true, message: "Le message a été modéré et retiré de la plateforme." };
}
