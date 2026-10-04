// Traitement des signalements d'import (module Encaissements, onglet « À vérifier », commit 5b).
//
// « Marquer traité » : un signalement À TRAITER passe à TRAITÉ (qui, quand, commentaire facultatif), tracé dans
// `EncAudit` dans la même transaction. Refusé si le signalement n'est plus À TRAITER (déjà traité, ou simple
// information) : la mise à jour est conditionnelle (`updateMany` sur le statut), donc deux traitements simultanés ne
// réussissent jamais tous les deux. Rien ici ne crée de contrat ni de paiement (l'index des mots, D22, n'est pas
// concerné ; « Ajouter quand même », 5c, devra, lui, le mettre à jour).

import type { PrismaClient } from "./generated/prisma/client";
import { ecrireAudit, type EncAuditDb } from "./encAudit";

export const COMMENTAIRE_TRAITEMENT_MAX = 500;

export class EncSignalementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncSignalementError";
  }
}

export type EncSignalementDb = Pick<PrismaClient, "encSignalement"> & EncAuditDb;

/** Texte enregistré dans `EncSignalement.resolution` (distingue ce traitement d'un futur « Ajouté quand même »). */
export function resolutionMarqueTraite(commentaire?: string | null): string {
  const c = commentaire?.trim();
  return c ? `Marqué traité — ${c}` : "Marqué traité";
}

export async function marquerSignalementTraite(
  db: EncSignalementDb,
  entree: { signalementId: string; userId: string; commentaire?: string | null; ip?: string | null; maintenant: Date }
): Promise<{ id: string }> {
  const commentaire = entree.commentaire?.trim() || null;
  if (commentaire && commentaire.length > COMMENTAIRE_TRAITEMENT_MAX) {
    throw new EncSignalementError(`Le commentaire ne peut pas dépasser ${COMMENTAIRE_TRAITEMENT_MAX} caractères.`);
  }

  const avant = await db.encSignalement.findUnique({
    where: { id: entree.signalementId },
    select: { id: true, statut: true, analyse: true, numPolice: true },
  });
  if (!avant) throw new EncSignalementError("Signalement introuvable.");

  const resolution = resolutionMarqueTraite(commentaire);
  const maj = await db.encSignalement.updateMany({
    where: { id: avant.id, statut: "A_TRAITER" },
    data: { statut: "TRAITE", traiteParId: entree.userId, traiteAt: entree.maintenant, resolution },
  });
  if (maj.count === 0) {
    throw new EncSignalementError("Ce signalement n'est plus à traiter (déjà traité, ou simple information).");
  }

  await ecrireAudit(db, {
    entite: "EncSignalement",
    entiteId: avant.id,
    action: "marquer_traite",
    avant: { statut: avant.statut, analyse: avant.analyse, numPolice: avant.numPolice },
    apres: { statut: "TRAITE", resolution },
    motif: commentaire,
    userId: entree.userId,
    ip: entree.ip ?? null,
    mois: entree.maintenant,
  });
  return { id: avant.id };
}
