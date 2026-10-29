import { createHash } from "node:crypto";

import type { Prisma } from "./generated/prisma/client";
import { prisma } from "./prisma";
import { CONFIRMATION_REINITIALISATION_CONSTANTE } from "./reinitialisationConstantes";
import { messageVerrouActif } from "./reinitialisationEtapes";
import {
  ENTITES_HISTORIQUE_CONGES,
  ENTITES_HISTORIQUE_POINTAGE,
  ENTITES_HISTORIQUE_PURGEES,
  ENTITES_HISTORIQUE_TRESORERIE,
} from "./reinitialisationClassification";

/**
 * Réinitialisation avant mise en production (voir CLAUDE.md "Réinitialisation avant mise en production" et "Lot N + O") :
 * purge de TOUTES les données de test, jamais de la configuration. La liste table par table (purgée / partielle / conservée)
 * est `CLASSIFICATION_TABLES` (`reinitialisationClassification.ts`), vérifiée contre `schema.prisma` par un test.
 *
 * Verrou DÉFINITIF (lot S) : une ligne `ReinitialisationSysteme` de `verrou = VERROU_REINITIALISATION` interdit toute simulation,
 * sauvegarde et purge, côté serveur (`exigerVerrouLibre`). Il n'existe aucune action applicative pour le lever : pour une
 * purge ultérieure VOLONTAIRE, le verrou se lève par une commande SQL qui garde la ligne d'audit (voir
 * `docs/mise-en-production.md`, § 10) : `UPDATE "ReinitialisationSysteme" SET verrou = 'LEVE-' || id WHERE verrou = 'REINITIALISATION'`.
 *
 * Ordre de suppression : enfants avant parents, d'après les clés étrangères du schéma. Une seule transaction sérialisable.
 * Le module Encaissements n'est purgé QUE s'il n'est pas encore mis en service (`EncMiseEnService` absente) : ses triggers
 * d'immuabilité l'interdisent ensuite, et ses données sont alors réelles.
 */

/** Valeur du verrou actif ; une valeur différente (levée par SQL) ne bloque plus. */
export const VERROU_REINITIALISATION = "REINITIALISATION";

/** Tables réécrites en continu (planificateur, journal) : sauvegardées et purgées, mais EXCLUES de l'empreinte. */
export const TABLES_HORS_EMPREINTE_REINITIALISATION = ["executionTache", "journalTechnique"] as const;

type Db = Prisma.TransactionClient;

export const CONFIRMATION_REINITIALISATION = CONFIRMATION_REINITIALISATION_CONSTANTE;

export const CATEGORIES_NOTIFICATION_POINTAGE = ["RH", "POINTAGE"] as const;

export class ReinitialisationError extends Error {}

const parId = { orderBy: { id: "asc" as const } };

/**
 * Lit EXACTEMENT les lignes qui seront supprimées. Sert à la fois à la sauvegarde JSON et à la purge (qui relit
 * dans sa propre transaction et refuse si l'empreinte diffère de celle de la sauvegarde).
 * Les tables du module Encaissements sont vides ici si le module est déjà en service (`encEnService`) : il n'est alors pas purgé.
 */
export async function chargerJeuxReinitialisation(db: Db) {
  const encEnService = (await db.encMiseEnService.count()) > 0;

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
  const budgetDepassement = await db.budgetDepassement.findMany(parId);
  const ligneDemande = await db.ligneDemande.findMany(parId);
  const demande = await db.demande.findMany(parId);
  const historiqueTresorerie = await db.historiqueEntry.findMany({
    where: { entity: { in: ENTITES_HISTORIQUE_TRESORERIE } },
    ...parId,
  });
  const notificationTresorerie = await db.notification.findMany({ where: { category: "TRESORERIE" }, ...parId });
  // Pointage RH / FeedbackApp (ordre de suppression validé par Thierry)
  const correctionPointage = await db.correctionPointage.findMany(parId);
  const justificationPointage = await db.justificationPointage.findMany(parId);
  const pointage = await db.pointage.findMany(parId);
  const absence = await db.absence.findMany(parId);
  const plageAbsenceAutorisee = await db.plageAbsenceAutorisee.findMany(parId);
  // Congés (lot Q) : demandes de test + leur historique ; leurs notifications sont de catégorie RH (déjà dans `notificationPointage`).
  const demandeConge = await db.demandeConge.findMany(parId);
  const historiqueConge = await db.historiqueEntry.findMany({ where: { entity: { in: ENTITES_HISTORIQUE_CONGES } }, ...parId });
  const feedback = await db.feedback.findMany(parId);
  const notificationPointage = await db.notification.findMany({
    where: { category: { in: [...CATEGORIES_NOTIFICATION_POINTAGE] } },
    ...parId,
  });
  const historiquePointage = await db.historiqueEntry.findMany({
    where: { entity: { in: ENTITES_HISTORIQUE_POINTAGE } },
    ...parId,
  });
  // Signatures d'ACTION : celles dont une ligne d'historique CONSERVÉE dépend (budgets) restent, pour que cet historique ne passe
  // pas en « Signature non rattachée » ; toutes les autres sont supprimées.
  const actionSignee = await db.actionSignee.findMany({
    where: { historique: { none: { entity: { notIn: ENTITES_HISTORIQUE_PURGEES } } } },
    ...parId,
  });
  // Techniques (hors empreinte : réécrites en continu)
  const executionTache = await db.executionTache.findMany(parId);
  const journalTechnique = await db.journalTechnique.findMany(parId);
  // Encaissements : seulement avant la mise en service du module
  const encSignalement = encEnService ? [] : await db.encSignalement.findMany(parId);
  const encEncaissement = encEnService ? [] : await db.encEncaissement.findMany(parId);
  const encContrat = encEnService ? [] : await db.encContrat.findMany(parId);
  const encImport = encEnService ? [] : await db.encImport.findMany(parId);
  const encPieceJointe = encEnService ? [] : await db.encPieceJointe.findMany(parId);
  const encAudit = encEnService ? [] : await db.encAudit.findMany(parId);
  const encSequence = encEnService ? [] : await db.encSequence.findMany({ orderBy: { cle: "asc" } });

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
    budgetDepassement,
    ligneDemande,
    demande,
    historiqueTresorerie,
    notificationTresorerie,
    correctionPointage,
    justificationPointage,
    pointage,
    absence,
    plageAbsenceAutorisee,
    demandeConge,
    historiqueConge,
    feedback,
    notificationPointage,
    historiquePointage,
    actionSignee,
    executionTache,
    journalTechnique,
    encSignalement,
    encEncaissement,
    encContrat,
    encImport,
    encPieceJointe,
    encAudit,
    encSequence,
  };
}

export type JeuxReinitialisation = Awaited<ReturnType<typeof chargerJeuxReinitialisation>>;

/** JSON stable : les BigInt (ex. `EncAudit.id`) ne se sérialisent pas nativement, ils sont écrits en texte. */
const enTexteLesBigInt = (_cle: string, valeur: unknown) => (typeof valeur === "bigint" ? valeur.toString() : valeur);

/** Empreinte SHA-256 des seuls jeux « métier » (voir `TABLES_HORS_EMPREINTE_REINITIALISATION`). */
export function calculerEmpreinte(jeux: JeuxReinitialisation): string {
  const metier = Object.fromEntries(
    Object.entries(jeux).filter(([table]) => !(TABLES_HORS_EMPREINTE_REINITIALISATION as readonly string[]).includes(table))
  );
  return createHash("sha256").update(JSON.stringify(metier, enTexteLesBigInt)).digest("hex");
}

export function decompterJeux(jeux: JeuxReinitialisation): Record<string, number> {
  return Object.fromEntries(Object.entries(jeux).map(([table, lignes]) => [table, lignes.length]));
}

/** `true` si le verrou est ACTIF (une purge a eu lieu et le verrou n'a pas été levé par SQL). */
export async function reinitialisationEffectuee(db: Pick<Prisma.TransactionClient, "reinitialisationSysteme"> = prisma): Promise<boolean> {
  return (await db.reinitialisationSysteme.count({ where: { verrou: VERROU_REINITIALISATION } })) > 0;
}

/** La purge active (verrou posé) ; `null` si aucune ou si le verrou a été levé. */
export async function getReinitialisationInfo(db: Pick<Prisma.TransactionClient, "reinitialisationSysteme"> = prisma) {
  return db.reinitialisationSysteme.findFirst({
    where: { verrou: VERROU_REINITIALISATION },
    include: { effectueePar: { select: { fullName: true } } },
  });
}

/**
 * VERROU DÉFINITIF (lot S) : lève `ReinitialisationError` (message clair, avec la date et l'auteur de la remise à zéro) si le
 * verrou est actif. Appelée en TÊTE de la simulation, de la sauvegarde et de la purge, côté serveur : masquer le bouton ne
 * suffit pas, et aucune permission (`systeme.reinitialiser` comprise) n'y change rien. Ne se lève que par UPDATE SQL.
 */
export async function exigerVerrouLibre(db: Pick<Prisma.TransactionClient, "reinitialisationSysteme"> = prisma): Promise<void> {
  const info = await getReinitialisationInfo(db);
  if (info) throw new ReinitialisationError(messageVerrouActif({ effectueeAt: info.effectueeAt, par: info.effectueePar.fullName }));
}

/** Fichiers de `uploads/` référencés par les pièces jointes qui seront supprimées (Trésorerie et Encaissements). */
export function urlsFichiersAPurger(jeux: JeuxReinitialisation): string[] {
  return [...jeux.pieceJointe.map((p) => p.url), ...jeux.encPieceJointe.map((p) => p.url)];
}

/** Sauvegarde : jeux complets + méta, et empreinte (calculée sur les seuls jeux métier, pas sur la méta horodatée). */
export async function genererSauvegardeReinitialisation(userId: string) {
  await exigerVerrouLibre();
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
        fichiersReferences: urlsFichiersAPurger(jeux).length,
        note: "Contient les lignes des tables purgées. Les fichiers de uploads/ ne sont PAS inclus (seules leurs références le sont) : copier le volume uploads avant la purge. ExecutionTache et JournalTechnique y figurent mais sont hors empreinte (réécrites en continu).",
      },
      tables: jeux,
    },
    enTexteLesBigInt,
    2
  );
  return { contenu, empreinte, decompte: decompterJeux(jeux) };
}

/** Compte, SANS rien écrire, ce qu'une purge supprimerait (simulation). */
export async function simulerReinitialisation() {
  await exigerVerrouLibre();
  const jeux = await chargerJeuxReinitialisation(prisma);
  return {
    decompte: decompterJeux(jeux),
    fichiers: urlsFichiersAPurger(jeux).length,
    encEnService: (await prisma.encMiseEnService.count()) > 0,
    verrouActif: false, // le verrou actif a été refusé plus haut
    empreinte: calculerEmpreinte(jeux),
    jeux,
  };
}

/**
 * Purge en UNE SEULE transaction (tout ou rien, isolation sérialisable). Refuse si le verrou est actif (`exigerVerrouLibre`), ou si les données
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
      await exigerVerrouLibre(tx);
      const jeux = await chargerJeuxReinitialisation(tx);
      if (calculerEmpreinte(jeux) !== sauvegardeSha256) {
        throw new ReinitialisationError(
          "Les données ont changé depuis la sauvegarde (ou la sauvegarde est invalide) : générez une nouvelle sauvegarde."
        );
      }
      const urlsFichiers = urlsFichiersAPurger(jeux);
      const encEnService = (await tx.encMiseEnService.count()) > 0;
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
      d.budgetDepassement = (await tx.budgetDepassement.deleteMany()).count;
      d.ligneDemande = (await tx.ligneDemande.deleteMany()).count;
      d.demande = (await tx.demande.deleteMany()).count;
      d.historiqueTresorerie = (
        await tx.historiqueEntry.deleteMany({ where: { entity: { in: ENTITES_HISTORIQUE_TRESORERIE } } })
      ).count;
      d.notificationTresorerie = (await tx.notification.deleteMany({ where: { category: "TRESORERIE" } })).count;

      // ---- Pointage RH / FeedbackApp (ordre validé par Thierry)
      d.correctionPointage = (await tx.correctionPointage.deleteMany()).count;
      d.justificationPointage = (await tx.justificationPointage.deleteMany()).count;
      d.pointage = (await tx.pointage.deleteMany()).count;
      d.absence = (await tx.absence.deleteMany()).count;
      d.plageAbsenceAutorisee = (await tx.plageAbsenceAutorisee.deleteMany()).count;
      // Congés : après les plages (qui référencent la demande) ; l'historique et les notifications (catégorie RH, ci-dessous) avec elles.
      d.demandeConge = (await tx.demandeConge.deleteMany()).count;
      d.historiqueConge = (await tx.historiqueEntry.deleteMany({ where: { entity: { in: ENTITES_HISTORIQUE_CONGES } } })).count;
      d.feedback = (await tx.feedback.deleteMany()).count;
      d.notificationPointage = (
        await tx.notification.deleteMany({ where: { category: { in: [...CATEGORIES_NOTIFICATION_POINTAGE] } } })
      ).count;
      d.historiquePointage = (
        await tx.historiqueEntry.deleteMany({ where: { entity: { in: ENTITES_HISTORIQUE_POINTAGE } } })
      ).count;

      // ---- Signatures d'action : seulement celles qu'aucune ligne d'historique restante ne référence
      d.actionSignee = (await tx.actionSignee.deleteMany({ where: { historique: { none: {} } } })).count;

      // ---- Techniques
      d.executionTache = (await tx.executionTache.deleteMany()).count;
      d.journalTechnique = (await tx.journalTechnique.deleteMany()).count;

      // ---- Encaissements : jamais une fois le module en service (triggers d'immuabilité, données réelles)
      if (!encEnService) {
        d.encSignalement = (await tx.encSignalement.deleteMany()).count;
        // Contre-passation (clé étrangère sur soi-même, RESTRICT) : détachée avant la suppression de masse.
        await tx.encEncaissement.updateMany({ data: { contrePasseId: null } });
        d.encEncaissement = (await tx.encEncaissement.deleteMany()).count;
        d.encContrat = (await tx.encContrat.deleteMany()).count; // EncContratMot en cascade
        d.encImport = (await tx.encImport.deleteMany()).count;
        d.encPieceJointe = (await tx.encPieceJointe.deleteMany()).count;
        d.encAudit = (await tx.encAudit.deleteMany()).count;
        d.encSequence = (await tx.encSequence.deleteMany()).count;
      }

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
    { timeout: 300_000, maxWait: 10_000, isolationLevel: "Serializable" }
  );
}

export async function enregistrerNettoyageFichiers(id: string, supprimes: number, echecs: number) {
  await prisma.reinitialisationSysteme.update({ where: { id }, data: { fichiersSupprimes: supprimes, fichiersEchecs: echecs } });
}
