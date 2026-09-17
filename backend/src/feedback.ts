import { prisma } from "./prisma";
import type { FeedbackSource, Prisma } from "./generated/prisma/client";

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

let feedbackPermissionsSyncPromise: Promise<void> | null = null;

/**
 * Synchronisation idempotente automatique des permissions FeedbackApp.
 * Garantit que le Module `feedback`, la Permission `feedback.moderer`
 * et leur attribution aux rôles RH, DG (et Admin) existent en base
 * même si `seed.ts` n'a pas été rejoué après le git pull.
 */
export async function ensureFeedbackPermissions(): Promise<void> {
  if (!feedbackPermissionsSyncPromise) {
    feedbackPermissionsSyncPromise = (async () => {
      try {
        // 1. Module Feedback
        const moduleFeedback = await prisma.module.upsert({
          where: { key: "feedback" },
          update: { label: "FeedbackApp", isActive: true },
          create: { key: "feedback", label: "FeedbackApp", isActive: true },
        });

        // 2. Permission feedback.moderer
        const perm = await prisma.permission.upsert({
          where: { key: "feedback.moderer" },
          update: { label: "Modérer les messages FeedbackApp", moduleId: moduleFeedback.id },
          create: {
            key: "feedback.moderer",
            label: "Modérer les messages FeedbackApp",
            moduleId: moduleFeedback.id,
          },
        });

        // 3. Attribution automatique aux rôles RH, DG et Admin
        const roles = await prisma.role.findMany({
          where: { name: { in: ["RH", "DG", "Admin"] } },
        });

        for (const role of roles) {
          await prisma.rolePermission.upsert({
            where: {
              roleId_permissionId: {
                roleId: role.id,
                permissionId: perm.id,
              },
            },
            update: {},
            create: {
              roleId: role.id,
              permissionId: perm.id,
            },
          });
        }
      } catch (err) {
        console.error("[FeedbackApp] Erreur synchronisation permissions:", err);
      }
    })();
  }
  return feedbackPermissionsSyncPromise;
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

export interface UserFeedbackEntry {
  id: string;
  content: string;
  submittedAt: Date;
  source: FeedbackSource;
}

export type FeedbackPeriodFilter = "semaine" | "mois" | "tout";

/**
 * Critiques / retours reçus par un employé connecté (Tranche B).
 * Strictement filtré sur `recipientId = userId` et `isModerated = false`.
 * RÈGLE ABSOLUE : ne renvoie AUCUNE information d'auteur.
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
  search?: string;
}

export interface AdminFeedbackEntry {
  id: string;
  content: string;
  submittedAt: Date;
  source: FeedbackSource;
  isModerated: boolean;
  motifModeration: string | null;
  moderatedAt: Date | null;
  moderatedByNom: string | null;
  /** Identifiant pseudonymisé / anonyme du destinataire, respectant le CDC */
  recipientPseudo: string;
}

/**
 * Vue d'ensemble de tous les messages de la plateforme pour la modération RH/Direction (Tranche B).
 * Respecte le CDC : ne divulgue jamais l'identité nominative du destinataire dans la liste globale.
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
    // Pseudonymisation déterministe basée sur l'id du destinataire (ex: "Collaborateur #A1B2")
    const shortHash = f.recipientId.replace(/[^a-zA-Z0-9]/g, "").slice(-4).toUpperCase();
    return {
      id: f.id,
      content: f.content,
      submittedAt: f.submittedAt,
      source: f.source,
      isModerated: f.isModerated,
      motifModeration: f.motifModeration,
      moderatedAt: f.moderatedAt,
      moderatedByNom: f.moderatedBy?.fullName ?? null,
      recipientPseudo: `Collaborateur #${shortHash || "ANON"}`,
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
