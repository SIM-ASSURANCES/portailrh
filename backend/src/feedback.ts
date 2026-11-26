import { prisma } from "./prisma";
import type { FeedbackSource, FeedbackType, Prisma } from "./generated/prisma/client";
import { FEEDBACK_CONTENT_MAX, FEEDBACK_CONTENT_MIN } from "./feedback-constants";
import { codeErreurPrisma, ErreurEnregistrementFeedback, type EtapeEnregistrementFeedback } from "./feedbackErreur";
import { detailNotesFeedback, generateFeedbackComment, type FeedbackRatings, type NoteDetailleeFeedback } from "./feedback-questions";

/**
 * FeedbackApp — avis structurés sur un collègue ou sur les conditions de travail (voir CLAUDE.md « Module FeedbackApp »).
 * Module PRIVÉ : seuls des comptes connectés déposent un avis.
 *
 * RÈGLE ABSOLUE : aucune fonction de ce fichier ne reçoit ni ne journalise une donnée qui identifie l'AUTEUR d'un avis
 * (identifiant de compte, IP, session, empreinte navigateur), même à titre transitoire. Pour la limite d'un avis par
 * jour, ce fichier ne reçoit que l'EMPREINTE HMAC déjà calculée (`./feedbackQuota.ts`) et le jour, jamais l'identifiant
 * de l'auteur. L'empreinte n'est jamais journalisée.
 *
 * Les constantes/validations sans dépendance Prisma (compteur de caractères, filtre anti-haine, détection d'URL) vivent
 * dans `./feedback-constants.ts`, réexportées ci-dessous pour tout code backend qui importe depuis `"backend"` — ne
 * jamais les rapatrier ici : ce fichier importe `./prisma`, ce qui casserait `client-safe.ts` si ces constantes y
 * étaient réexportées depuis ce module-ci plutôt que directement depuis `feedback-constants.ts`.
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
 * Employés proposables comme destinataire sur la page de soumission —
 * voir CLAUDE.md "FeedbackApp" pour la décision retenue
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
 * Crée un `Feedback` à partir de réponses structurées — **seul point d'écriture** du module. `content` n'est jamais reçu
 * en paramètre : il est TOUJOURS calculé ici par `generateFeedbackComment(type, ratings)`, si bien qu'aucun texte
 * fabriqué par un client (rejeu réseau direct) n'est persisté.
 *
 * `db` DOIT être le client d'une transaction : la trace de quota et l'avis sont écrits ensemble (si l'avis échoue, la
 * limite n'est pas consommée). `quota` porte l'empreinte déjà calculée et le jour — jamais l'identifiant de l'auteur.
 *
 * La contrainte d'unicité sur `cle` décide seule (deux envois simultanés : un seul réussit). L'insertion se fait en
 * `ON CONFLICT DO NOTHING` (`skipDuplicates`) et non en laissant lever `P2002` : une violation d'unicité ferait écrire
 * par PostgreSQL « Key (cle)=(…) already exists » dans ses journaux, horodaté, qui survivrait à la purge.
 *
 * `recipientId` : obligatoire pour `COLLABORATION`, forcé à `null` pour `CONDITIONS_TRAVAIL`.
 */
export async function createFeedback(
  db: Prisma.TransactionClient,
  params: {
    type: FeedbackType;
    recipientId: string | null;
    ratings: FeedbackRatings;
    source: FeedbackSource;
    quota: { cle: string; jour: string };
  }
): Promise<{ success: true; id: string } | { success: false; quotaAtteint: boolean; message: string }> {
  const content = generateFeedbackComment(params.type, params.ratings);
  if (content.length < FEEDBACK_CONTENT_MIN || content.length > FEEDBACK_CONTENT_MAX) {
    // Filet de sécurité : ne devrait jamais se produire avec les phrases actuelles.
    return {
      success: false,
      quotaAtteint: false,
      message: "Impossible de générer un commentaire valide à partir de ces réponses.",
    };
  }

  if (params.type === "COLLABORATION" && !params.recipientId) {
    return { success: false, quotaAtteint: false, message: "Destinataire requis pour ce type d'avis." };
  }

  const jour = new Date(`${params.quota.jour}T00:00:00.000Z`);
  // L'erreur d'origine est abandonnée (son message peut citer les valeurs) : seuls l'étape et le code Prisma remontent.
  const etape = async <T>(nom: EtapeEnregistrementFeedback, ecriture: () => Promise<T>): Promise<T> => {
    try {
      return await ecriture();
    } catch (e) {
      throw new ErreurEnregistrementFeedback(nom, codeErreurPrisma(e));
    }
  };

  const reserve = await etape("quota", () =>
    db.feedbackQuota.createMany({ data: [{ cle: params.quota.cle, jour }], skipDuplicates: true })
  );
  if (reserve.count === 0) {
    return { success: false, quotaAtteint: true, message: "Limite d'un avis par jour atteinte." };
  }

  const feedback = await etape("avis", () =>
    db.feedback.create({
      data: {
        content,
        recipientId: params.type === "COLLABORATION" ? params.recipientId : null,
        type: params.type,
        source: params.source,
        ratings: params.ratings as Prisma.InputJsonValue,
        submittedAt: jour,
      },
    })
  );

  return { success: true, id: feedback.id };
}

/** Parmi ces empreintes, celles déjà consommées (affichage anticipé du formulaire ; `createFeedback` reste l'autorité). */
export async function clesQuotaDejaUtilisees(cles: string[], jour: string): Promise<Set<string>> {
  if (cles.length === 0) return new Set();
  const lignes = await prisma.feedbackQuota.findMany({
    where: { cle: { in: cles }, jour: new Date(`${jour}T00:00:00.000Z`) },
    select: { cle: true },
  });
  return new Set(lignes.map((l) => l.cle));
}

/** Efface les traces de quota des jours antérieurs à `jour` (purge quotidienne). Renvoie le nombre de lignes effacées. */
export async function purgerQuotasFeedback(jour: string): Promise<number> {
  const r = await prisma.feedbackQuota.deleteMany({ where: { jour: { lt: new Date(`${jour}T00:00:00.000Z`) } } });
  return r.count;
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
  /** Ignoré sans `voirDetails` (seuls les avis « Collaboration » sont alors lus). */
  type?: "tous" | "COLLABORATION" | "CONDITIONS_TRAVAIL";
  /** Identifiant du destinataire ou « tous ». Ignoré sans `voirDetails`. */
  destinataire?: string;
  search?: string;
}

/**
 * Droit de lecture, décidé par l'appelant d'après la permission `feedback.voir_details` (RH et DG) : noms réels des
 * destinataires et avis « Conditions de travail ». Paramètre OBLIGATOIRE des lectures de modération : aucun appelant ne
 * peut l'oublier.
 */
export interface AccesFeedback {
  voirDetails: boolean;
}

export const PERMISSION_FEEDBACK_VOIR_DETAILS = "feedback.voir_details";

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
  /** Nom réel avec `voirDetails`, pseudonyme sinon ; `null` pour `CONDITIONS_TRAVAIL`. L'identifiant du
   * destinataire n'est jamais renvoyé. */
  destinataire: string | null;
  /** Réponses question par question, reconstruites à partir des seules questions connues (jamais le JSON brut) ;
   * vide pour un avis antérieur à la notation structurée. */
  notes: NoteDetailleeFeedback[];
}

/** Pseudonyme déterministe d'un destinataire (ex : « Collaborateur #A1B2 »). */
function pseudonymeDestinataire(recipientId: string): string {
  return `Collaborateur #${recipientId.replace(/[^a-zA-Z0-9]/g, "").slice(-4).toUpperCase() || "ANON"}`;
}

/**
 * Messages de la modération. Le filtrage de visibilité se fait ICI, côté serveur : sans `voirDetails`, la requête se
 * limite aux avis « Collaboration » et aucun nom de destinataire n'est lu en base.
 */
export async function getAdminFeedbacks(
  filters: AdminFeedbackFilters,
  acces: AccesFeedback
): Promise<AdminFeedbackEntry[]> {
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

  if (!acces.voirDetails) {
    whereClause.type = "COLLABORATION";
  } else {
    if (filters.type === "COLLABORATION" || filters.type === "CONDITIONS_TRAVAIL") {
      whereClause.type = filters.type;
    }
    if (filters.destinataire && filters.destinataire !== "tous") {
      whereClause.recipientId = filters.destinataire;
    }
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

  const noms = new Map<string, string>();
  if (acces.voirDetails) {
    const ids = [...new Set(feedbacks.map((f) => f.recipientId).filter((id): id is string => id !== null))];
    const comptes = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
    for (const c of comptes) noms.set(c.id, c.fullName);
  }

  return feedbacks.map((f) => ({
    id: f.id,
    content: f.content,
    submittedAt: f.submittedAt,
    source: f.source,
    type: f.type,
    isModerated: f.isModerated,
    // Les colonnes gardent le dernier masquage après un rétablissement : elles ne sont montrées que sur un avis masqué.
    motifModeration: f.isModerated ? f.motifModeration : null,
    moderatedAt: f.isModerated ? f.moderatedAt : null,
    moderatedByNom: f.isModerated ? (f.moderatedBy?.fullName ?? null) : null,
    destinataire: !f.recipientId
      ? null
      : acces.voirDetails
        ? (noms.get(f.recipientId) ?? "Compte introuvable")
        : pseudonymeDestinataire(f.recipientId),
    notes: detailNotesFeedback(f.type, f.ratings),
  }));
}

/** Personnes ayant reçu au moins un avis, triées par nom — vide sans `voirDetails`. */
export async function getDestinatairesAyantRecuUnFeedback(acces: AccesFeedback): Promise<FeedbackRecipientOption[]> {
  if (!acces.voirDetails) return [];
  const comptes = await prisma.user.findMany({
    where: { feedbacksRecus: { some: {} } },
    select: { id: true, fullName: true },
  });
  return comptes.sort((a, b) => a.fullName.localeCompare(b.fullName, "fr"));
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
 * Statistiques du tableau de bord de modération. Sans `voirDetails`, les avis « Conditions de travail » ne sont comptés
 * nulle part.
 */
export async function getFeedbackStats(acces: AccesFeedback): Promise<FeedbackStats> {
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const perimetre: Prisma.FeedbackWhereInput = acces.voirDetails ? {} : { type: "COLLABORATION" };

  const [total, ceMois, moderes, nbPublic, nbInterne] = await Promise.all([
    prisma.feedback.count({ where: perimetre }),
    prisma.feedback.count({ where: { ...perimetre, submittedAt: { gte: firstDayOfMonth } } }),
    prisma.feedback.count({ where: { ...perimetre, isModerated: true } }),
    prisma.feedback.count({ where: { ...perimetre, source: "PUBLIC" } }),
    prisma.feedback.count({ where: { ...perimetre, source: "INTERNAL" } }),
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
 * Entités d'historique de la modération. Celle des avis « Conditions de travail » est DISTINCTE pour que le journal
 * d'audit la cache à un compte sans `feedback.voir_details` (même après suppression de l'avis).
 */
export const ENTITE_FEEDBACK = "Feedback";
export const ENTITE_FEEDBACK_CONDITIONS_TRAVAIL = "FeedbackConditionsTravail";

export const ACTION_MASQUAGE_FEEDBACK = "moderation_masquage";
export const ACTION_RETABLISSEMENT_FEEDBACK = "moderation_retablissement";

/** Le même pour un avis inexistant et pour un avis que ce compte n'a pas le droit de lire : on ne confirme rien. */
export const MESSAGE_FEEDBACK_INTROUVABLE = "Message introuvable.";

type ResultatModeration = { success: boolean; message: string };

const entiteHistorique = (type: FeedbackType) =>
  type === "CONDITIONS_TRAVAIL" ? ENTITE_FEEDBACK_CONDITIONS_TRAVAIL : ENTITE_FEEDBACK;

/** L'avis visé, ou `null` s'il n'existe pas OU si ce compte ne peut pas le lire (« Conditions de travail » sans droit). */
async function chargerFeedbackModerable(id: string, acces: AccesFeedback) {
  const feedback = await prisma.feedback.findUnique({ where: { id } });
  if (!feedback || (feedback.type === "CONDITIONS_TRAVAIL" && !acces.voirDetails)) return null;
  return feedback;
}

/**
 * Masquage d'un message inapproprié. Motif obligatoire (3 caractères minimum). L'état et la ligne d'historique (qui a
 * modéré, motif — jamais rien sur l'auteur de l'avis) sont écrits ensemble.
 */
export async function modererFeedback(
  id: string,
  moderatorId: string,
  motif: string,
  acces: AccesFeedback
): Promise<ResultatModeration> {
  // Contrôle de l'argument AVANT tout accès à la base : un motif trop court est refusé sans requête.
  const cleanMotif = motif.trim();
  if (cleanMotif.length < 3) {
    return { success: false, message: "Le motif de modération doit contenir au moins 3 caractères." };
  }

  const feedback = await chargerFeedbackModerable(id, acces);
  if (!feedback) {
    return { success: false, message: MESSAGE_FEEDBACK_INTROUVABLE };
  }
  if (feedback.isModerated) {
    return { success: false, message: "Ce message a déjà été modéré." };
  }

  const fait = await prisma.$transaction(async (tx) => {
    // Conditionné à l'état lu : deux modérations simultanées, une seule passe.
    const r = await tx.feedback.updateMany({
      where: { id, isModerated: false },
      data: { isModerated: true, motifModeration: cleanMotif, moderatedById: moderatorId, moderatedAt: new Date() },
    });
    if (r.count === 0) return false;
    await tx.historiqueEntry.create({
      data: {
        entity: entiteHistorique(feedback.type),
        entityId: id,
        action: ACTION_MASQUAGE_FEEDBACK,
        detail: `Avis masqué. Motif : ${cleanMotif}`,
        userId: moderatorId,
      },
    });
    return true;
  });
  if (!fait) {
    return { success: false, message: "Ce message a déjà été modéré." };
  }

  return { success: true, message: "Le message a été modéré et retiré de la plateforme." };
}

/**
 * Rétablissement d'un message masqué (même droit de lecture que le masquage). Seul `isModerated` change : les colonnes
 * `motifModeration`/`moderatedById`/`moderatedAt` gardent le dernier masquage, et la ligne d'historique du
 * rétablissement rappelle le masquage levé (utile aussi pour les masquages antérieurs à l'historique).
 */
export async function retablirFeedback(
  id: string,
  moderatorId: string,
  motif: string,
  acces: AccesFeedback
): Promise<ResultatModeration> {
  const cleanMotif = motif.trim();
  if (cleanMotif.length < 3) {
    return { success: false, message: "Le motif du rétablissement doit contenir au moins 3 caractères." };
  }

  const feedback = await chargerFeedbackModerable(id, acces);
  if (!feedback) {
    return { success: false, message: MESSAGE_FEEDBACK_INTROUVABLE };
  }
  if (!feedback.isModerated) {
    return { success: false, message: "Ce message n'est pas masqué." };
  }

  const masquageLeve = [
    feedback.moderatedAt ? ` du ${feedback.moderatedAt.toISOString().slice(0, 10).split("-").reverse().join("/")}` : "",
    feedback.motifModeration ? ` (motif : ${feedback.motifModeration})` : "",
  ].join("");

  const fait = await prisma.$transaction(async (tx) => {
    const r = await tx.feedback.updateMany({ where: { id, isModerated: true }, data: { isModerated: false } });
    if (r.count === 0) return false;
    await tx.historiqueEntry.create({
      data: {
        entity: entiteHistorique(feedback.type),
        entityId: id,
        action: ACTION_RETABLISSEMENT_FEEDBACK,
        detail: `Avis rétabli. Motif : ${cleanMotif}. Masquage levé${masquageLeve}.`,
        userId: moderatorId,
      },
    });
    return true;
  });
  if (!fait) {
    return { success: false, message: "Ce message n'est pas masqué." };
  }

  return { success: true, message: "Le message a été rétabli." };
}
