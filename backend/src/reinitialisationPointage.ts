import { createHash } from "node:crypto";

import type { Prisma } from "./generated/prisma/client";
import { prisma } from "./prisma";
import { CATEGORIES_NOTIFICATION_POINTAGE, ENTITES_HISTORIQUE_POINTAGE } from "./reinitialisation";

/**
 * Réinitialisation du POINTAGE SEUL, répétable jusqu'à sa mise en service (2026-10-14). Distincte de la réinitialisation
 * globale à usage unique (`reinitialisation.ts`, déjà exécutée en production, verrouillée, jamais touchée par ce module).
 *
 * Purgé (enfants avant parents) : CorrectionPointage, JustificationPointage, Pointage, Absence, PlageAbsenceAutorisee,
 * notifications des catégories POINTAGE et RH, historique des entités Pointage / PointageQR / PointageGeo /
 * JustificationPointage, ExecutionTache, JournalTechnique.
 * Gardé : comptes, rôles, permissions, services et responsables, ParametrageHoraire, JourFerie, FcmToken, la Trésorerie, les
 * Encaissements, FeedbackApp, et les tables d'audit de ce module (jamais purgées).
 *
 * Intégrité : la sauvegarde JSON contient les lignes purgées et une empreinte SHA-256 ; la purge relit les mêmes données
 * dans sa propre transaction et refuse si l'empreinte diffère. EXCEPTION assumée : `ExecutionTache` et `JournalTechnique`
 * sont sauvegardées et purgées mais EXCLUES de l'empreinte — le planificateur y écrit en continu (toutes les 5 minutes),
 * l'empreinte ne tiendrait sinon jamais le temps de télécharger la sauvegarde puis de confirmer.
 */

type Db = Prisma.TransactionClient;

export const PERMISSION_REINITIALISER_POINTAGE = "pointage.reinitialiser";
export const CONFIRMATION_REINITIALISATION_POINTAGE = "REINITIALISER-POINTAGE";
export const CONFIRMATION_MISE_EN_SERVICE_POINTAGE = "METTRE-EN-SERVICE-POINTAGE";

/** Tables techniques réécrites en continu : sauvegardées et purgées, hors empreinte. */
export const TABLES_HORS_EMPREINTE = ["executionTache", "journalTechnique"] as const;

export class ReinitialisationPointageError extends Error {}

const parId = { orderBy: { id: "asc" as const } };

/** Lit EXACTEMENT les lignes qui seront supprimées (sauvegarde et purge). */
export async function chargerJeuxPointage(db: Db) {
  const correctionPointage = await db.correctionPointage.findMany(parId);
  const justificationPointage = await db.justificationPointage.findMany(parId);
  const pointage = await db.pointage.findMany(parId);
  const absence = await db.absence.findMany(parId);
  const plageAbsenceAutorisee = await db.plageAbsenceAutorisee.findMany(parId);
  const notificationPointage = await db.notification.findMany({
    where: { category: { in: [...CATEGORIES_NOTIFICATION_POINTAGE] } },
    ...parId,
  });
  const historiquePointage = await db.historiqueEntry.findMany({
    where: { entity: { in: ENTITES_HISTORIQUE_POINTAGE } },
    ...parId,
  });
  const executionTache = await db.executionTache.findMany(parId);
  const journalTechnique = await db.journalTechnique.findMany(parId);
  return {
    correctionPointage,
    justificationPointage,
    pointage,
    absence,
    plageAbsenceAutorisee,
    notificationPointage,
    historiquePointage,
    executionTache,
    journalTechnique,
  };
}

export type JeuxPointage = Awaited<ReturnType<typeof chargerJeuxPointage>>;

/** Empreinte SHA-256 des seuls jeux « métier » (voir `TABLES_HORS_EMPREINTE`). */
export function calculerEmpreintePointage(jeux: JeuxPointage): string {
  const metier = Object.fromEntries(
    Object.entries(jeux).filter(([table]) => !(TABLES_HORS_EMPREINTE as readonly string[]).includes(table))
  );
  return createHash("sha256").update(JSON.stringify(metier)).digest("hex");
}

export function decompterJeuxPointage(jeux: JeuxPointage): Record<string, number> {
  return Object.fromEntries(Object.entries(jeux).map(([table, lignes]) => [table, lignes.length]));
}

export async function pointageEnService(): Promise<boolean> {
  return (await prisma.pointageMiseEnService.count()) > 0;
}

/** État de l'écran : marqueur de mise en service (le cas échéant) et journal d'audit permanent des purges, récentes d'abord. */
export async function getEtatReinitialisationPointage() {
  const [miseEnService, purges] = await Promise.all([
    prisma.pointageMiseEnService.findFirst({ include: { par: { select: { fullName: true } } } }),
    prisma.reinitialisationPointage.findMany({
      orderBy: { effectueeAt: "desc" },
      include: { effectueePar: { select: { fullName: true } } },
    }),
  ]);
  return { miseEnService, purges };
}

export async function genererSauvegardePointage(userId: string) {
  const jeux = await chargerJeuxPointage(prisma);
  const empreinte = calculerEmpreintePointage(jeux);
  const contenu = JSON.stringify(
    {
      meta: {
        type: "sauvegarde-avant-reinitialisation-pointage",
        generueeAt: new Date().toISOString(),
        generueePar: userId,
        empreinteSha256: empreinte,
        decompte: decompterJeuxPointage(jeux),
        note: "Contient les lignes des tables purgées. ExecutionTache et JournalTechnique y figurent mais sont hors empreinte (réécrites en continu par le planificateur).",
      },
      tables: jeux,
    },
    null,
    2
  );
  return { contenu, empreinte, decompte: decompterJeuxPointage(jeux) };
}

/**
 * Purge en UNE SEULE transaction (tout ou rien, isolation sérialisable). Refuse si le Pointage est en service, si une autre
 * purge tient le verrou consultatif, ou si les données ont changé depuis la sauvegarde. Une seule de deux exécutions
 * simultanées peut réussir (verrou + isolation sérialisable). Écrit une ligne d'audit permanente.
 */
export async function executerReinitialisationPointage({
  userId,
  sauvegardeSha256,
}: {
  userId: string;
  sauvegardeSha256: string;
}): Promise<{ id: string; decompte: Record<string, number> }> {
  return prisma.$transaction(
    async (tx) => {
      const verrou = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext('pointage:reinitialisation')) AS ok`;
      if (!verrou[0]?.ok) {
        throw new ReinitialisationPointageError("Une autre purge du Pointage est en cours : cette tentative n'a rien supprimé.");
      }
      if ((await tx.pointageMiseEnService.count()) > 0) {
        throw new ReinitialisationPointageError("Le Pointage est en service : sa purge est définitivement refusée.");
      }
      const jeux = await chargerJeuxPointage(tx);
      if (calculerEmpreintePointage(jeux) !== sauvegardeSha256) {
        throw new ReinitialisationPointageError(
          "Les données ont changé depuis la sauvegarde téléchargée (ou la sauvegarde est invalide) : générez et téléchargez une nouvelle sauvegarde."
        );
      }
      const d: Record<string, number> = {};

      // Enfants avant parents (CorrectionPointage et JustificationPointage référencent Pointage).
      d.correctionPointage = (await tx.correctionPointage.deleteMany()).count;
      d.justificationPointage = (await tx.justificationPointage.deleteMany()).count;
      d.pointage = (await tx.pointage.deleteMany()).count;
      d.absence = (await tx.absence.deleteMany()).count;
      d.plageAbsenceAutorisee = (await tx.plageAbsenceAutorisee.deleteMany()).count;
      d.notificationPointage = (
        await tx.notification.deleteMany({ where: { category: { in: [...CATEGORIES_NOTIFICATION_POINTAGE] } } })
      ).count;
      d.historiquePointage = (
        await tx.historiqueEntry.deleteMany({ where: { entity: { in: ENTITES_HISTORIQUE_POINTAGE } } })
      ).count;
      d.executionTache = (await tx.executionTache.deleteMany()).count;
      d.journalTechnique = (await tx.journalTechnique.deleteMany()).count;

      const ligne = await tx.reinitialisationPointage.create({
        data: { effectueeParId: userId, decompte: d, sauvegardeSha256 },
      });
      await tx.historiqueEntry.create({
        data: {
          entity: "ReinitialisationPointage",
          entityId: ligne.id,
          action: "reinitialisation_pointage",
          detail: `Purge du Pointage exécutée : ${Object.values(d).reduce((a, b) => a + b, 0)} lignes supprimées (empreinte de sauvegarde ${sauvegardeSha256.slice(0, 12)}…).`,
          userId,
        },
      });
      return { id: ligne.id, decompte: d };
    },
    { timeout: 120_000, maxWait: 10_000, isolationLevel: "Serializable" }
  );
}

/** Pose le marqueur DÉFINITIF de mise en service (`verrou` unique : une seule fois) ; interdit ensuite toute purge. */
export async function mettreEnServicePointage(userId: string): Promise<{ id: string }> {
  return prisma.$transaction(
    async (tx) => {
      if ((await tx.pointageMiseEnService.count()) > 0) {
        throw new ReinitialisationPointageError("Le Pointage est déjà en service.");
      }
      const ligne = await tx.pointageMiseEnService.create({ data: { parId: userId } });
      await tx.historiqueEntry.create({
        data: {
          entity: "PointageMiseEnService",
          entityId: ligne.id,
          action: "pointage_mise_en_service",
          detail: "Pointage mis en service : sa purge est désormais définitivement refusée.",
          userId,
        },
      });
      return { id: ligne.id };
    },
    { timeout: 30_000, maxWait: 10_000, isolationLevel: "Serializable" }
  );
}
