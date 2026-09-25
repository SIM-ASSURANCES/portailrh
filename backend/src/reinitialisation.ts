import { createHash } from "node:crypto";

import type { Prisma } from "./generated/prisma/client";
import { prisma } from "./prisma";

/**
 * Réinitialisation À USAGE UNIQUE avant mise en production (voir CLAUDE.md "Réinitialisation avant mise en
 * production") : purge des données de test des modules Trésorerie et Pointage RH / FeedbackApp.
 *
 * Périmètre (jamais la configuration : comptes, rôles, permissions, catégories, horaires, jours fériés, jetons
 * FCM, audit Admin/Auth) — voir `chargerJeuxReinitialisation` (lecture) et `executerReinitialisation` (suppression,
 * dans cet ordre exact : enfants avant parents, d'après les clés étrangères du schéma).
 */

type Db = Prisma.TransactionClient;

export const CONFIRMATION_REINITIALISATION = "REINITIALISER";

const ENTITES_HISTORIQUE_TRESORERIE = ["Demande", "LigneDemande", "JournalCaisse", "RetourExterne"];
const ENTITES_HISTORIQUE_POINTAGE = ["Pointage", "PointageQR", "PointageGeo"];
const CATEGORIES_NOTIFICATION_POINTAGE = ["RH", "POINTAGE"] as const;

export class ReinitialisationError extends Error {}

const parId = { orderBy: { id: "asc" as const } };

/**
 * Lit EXACTEMENT les lignes qui seront supprimées. Sert à la fois à la sauvegarde JSON et à la purge (qui relit
 * dans sa propre transaction et refuse si l'empreinte diffère de celle de la sauvegarde téléchargée).
 */
export async function chargerJeuxReinitialisation(db: Db) {
  // Trésorerie (ordre de suppression)
  const remboursementRetour = await db.remboursementRetour.findMany(parId);
  const journalBanque = await db.journalBanque.findMany(parId);
  const retourExterne = await db.retourExterne.findMany(parId);
  const pieceJointe = await db.pieceJointe.findMany(parId);
  const signalementRetour = await db.signalementRetour.findMany(parId);
  const depenseLigne = await db.depenseLigne.findMany(parId);
  const retourCaisse = await db.retourCaisse.findMany(parId);
  const reglementCategorieAllocation = await db.reglementCategorieAllocation.findMany(parId);
  const journalCaisse = await db.journalCaisse.findMany(parId);
  const retourExceptionnel = await db.retourExceptionnel.findMany(parId);
  const reglement = await db.reglement.findMany(parId);
  const ligneDemande = await db.ligneDemande.findMany(parId);
  const demande = await db.demande.findMany(parId);
  const historiqueTresorerie = await db.historiqueEntry.findMany({
    where: { entity: { in: ENTITES_HISTORIQUE_TRESORERIE } },
    ...parId,
  });
  const notificationTresorerie = await db.notification.findMany({ where: { category: "TRESORERIE" }, ...parId });
  // Pointage RH / FeedbackApp (ordre de suppression validé par Thierry)
  const correctionPointage = await db.correctionPointage.findMany(parId);
  const pointage = await db.pointage.findMany(parId);
  const absence = await db.absence.findMany(parId);
  const plageAbsenceAutorisee = await db.plageAbsenceAutorisee.findMany(parId);
  const feedback = await db.feedback.findMany(parId);
  const notificationPointage = await db.notification.findMany({
    where: { category: { in: [...CATEGORIES_NOTIFICATION_POINTAGE] } },
    ...parId,
  });
  const historiquePointage = await db.historiqueEntry.findMany({
    where: { entity: { in: ENTITES_HISTORIQUE_POINTAGE } },
    ...parId,
  });

  return {
    remboursementRetour,
    journalBanque,
    retourExterne,
    pieceJointe,
    signalementRetour,
    depenseLigne,
    retourCaisse,
    reglementCategorieAllocation,
    journalCaisse,
    retourExceptionnel,
    reglement,
    ligneDemande,
    demande,
    historiqueTresorerie,
    notificationTresorerie,
    correctionPointage,
    pointage,
    absence,
    plageAbsenceAutorisee,
    feedback,
    notificationPointage,
    historiquePointage,
  };
}

export type JeuxReinitialisation = Awaited<ReturnType<typeof chargerJeuxReinitialisation>>;

export function calculerEmpreinte(jeux: JeuxReinitialisation): string {
  return createHash("sha256").update(JSON.stringify(jeux)).digest("hex");
}

export function decompterJeux(jeux: JeuxReinitialisation): Record<string, number> {
  return Object.fromEntries(Object.entries(jeux).map(([table, lignes]) => [table, lignes.length]));
}

export async function reinitialisationEffectuee(): Promise<boolean> {
  return (await prisma.reinitialisationSysteme.count()) > 0;
}

export async function getReinitialisationInfo() {
  return prisma.reinitialisationSysteme.findFirst({ include: { effectueePar: { select: { fullName: true } } } });
}

/** Sauvegarde : jeux complets + méta, et empreinte (calculée sur les seuls jeux, pas sur la méta horodatée). */
export async function genererSauvegardeReinitialisation(userId: string) {
  const jeux = await chargerJeuxReinitialisation(prisma);
  const empreinte = calculerEmpreinte(jeux);
  const contenu = JSON.stringify(
    {
      meta: {
        type: "sauvegarde-avant-reinitialisation",
        generueeAt: new Date().toISOString(),
        generueePar: userId,
        empreinteSha256: empreinte,
        decompte: decompterJeux(jeux),
        note: "Contient les lignes des tables purgées. Les fichiers de uploads/ ne sont PAS inclus (seules leurs références le sont).",
      },
      tables: jeux,
    },
    null,
    2
  );
  return { contenu, empreinte, decompte: decompterJeux(jeux) };
}

/**
 * Purge en UNE SEULE transaction (tout ou rien, isolation sérialisable). Refuse si déjà effectuée, ou si les données
 * ont changé depuis la sauvegarde (empreinte différente). `verrou` unique : une exécution concurrente échoue.
 */
export async function executerReinitialisation({
  userId,
  sauvegardeSha256,
}: {
  userId: string;
  sauvegardeSha256: string;
}): Promise<{ id: string; decompte: Record<string, number>; urlsFichiers: string[] }> {
  return prisma.$transaction(
    async (tx) => {
      if ((await tx.reinitialisationSysteme.count()) > 0) {
        throw new ReinitialisationError("La réinitialisation a déjà été effectuée : elle ne peut être exécutée qu'une seule fois.");
      }
      const jeux = await chargerJeuxReinitialisation(tx);
      if (calculerEmpreinte(jeux) !== sauvegardeSha256) {
        throw new ReinitialisationError(
          "Les données ont changé depuis la sauvegarde téléchargée (ou la sauvegarde est invalide) : générez et téléchargez une nouvelle sauvegarde."
        );
      }
      const urlsFichiers = jeux.pieceJointe.map((p) => p.url);
      const d: Record<string, number> = {};

      // ---- Trésorerie : enfants avant parents
      d.remboursementRetour = (await tx.remboursementRetour.deleteMany()).count;
      d.journalBanque = (await tx.journalBanque.deleteMany()).count;
      d.retourExterne = (await tx.retourExterne.deleteMany()).count;
      d.pieceJointe = (await tx.pieceJointe.deleteMany()).count;
      d.signalementRetour = (await tx.signalementRetour.deleteMany()).count;
      d.depenseLigne = (await tx.depenseLigne.deleteMany()).count;
      d.retourCaisse = (await tx.retourCaisse.deleteMany()).count;
      d.reglementCategorieAllocation = (await tx.reglementCategorieAllocation.deleteMany()).count;
      d.journalCaisse = (await tx.journalCaisse.deleteMany()).count;
      d.retourExceptionnel = (await tx.retourExceptionnel.deleteMany()).count;
      d.reglement = (await tx.reglement.deleteMany()).count;
      d.ligneDemande = (await tx.ligneDemande.deleteMany()).count;
      d.demande = (await tx.demande.deleteMany()).count;
      d.historiqueTresorerie = (
        await tx.historiqueEntry.deleteMany({ where: { entity: { in: ENTITES_HISTORIQUE_TRESORERIE } } })
      ).count;
      d.notificationTresorerie = (await tx.notification.deleteMany({ where: { category: "TRESORERIE" } })).count;

      // ---- Pointage RH / FeedbackApp (ordre validé par Thierry)
      d.correctionPointage = (await tx.correctionPointage.deleteMany()).count;
      d.pointage = (await tx.pointage.deleteMany()).count;
      d.absence = (await tx.absence.deleteMany()).count;
      d.plageAbsenceAutorisee = (await tx.plageAbsenceAutorisee.deleteMany()).count;
      d.feedback = (await tx.feedback.deleteMany()).count;
      d.notificationPointage = (
        await tx.notification.deleteMany({ where: { category: { in: [...CATEGORIES_NOTIFICATION_POINTAGE] } } })
      ).count;
      d.historiquePointage = (
        await tx.historiqueEntry.deleteMany({ where: { entity: { in: ENTITES_HISTORIQUE_POINTAGE } } })
      ).count;

      // ---- Flag définitif + journal d'audit (jamais purgé) ; le verrou unique fait échouer une exécution concurrente
      const ligne = await tx.reinitialisationSysteme.create({
        data: { effectueeParId: userId, decompte: d, sauvegardeSha256 },
      });
      await tx.historiqueEntry.create({
        data: {
          entity: "ReinitialisationSysteme",
          entityId: ligne.id,
          action: "reinitialisation_systeme",
          detail: `Réinitialisation avant mise en production exécutée : ${Object.values(d).reduce((a, b) => a + b, 0)} lignes supprimées (empreinte de sauvegarde ${sauvegardeSha256.slice(0, 12)}…).`,
          userId,
        },
      });
      return { id: ligne.id, decompte: d, urlsFichiers };
    },
    { timeout: 120_000, maxWait: 10_000, isolationLevel: "Serializable" }
  );
}

export async function enregistrerNettoyageFichiers(id: string, supprimes: number, echecs: number) {
  await prisma.reinitialisationSysteme.update({ where: { id }, data: { fichiersSupprimes: supprimes, fichiersEchecs: echecs } });
}
