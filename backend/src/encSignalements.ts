// Traitement des signalements d'import (module Encaissements, onglet « À vérifier », commit 5b).
//
// « Marquer traité » : un signalement À TRAITER passe à TRAITÉ (qui, quand, commentaire facultatif), tracé dans
// `EncAudit` dans la même transaction. Refusé si le signalement n'est plus À TRAITER (déjà traité, ou simple
// information) : la mise à jour est conditionnelle (`updateMany` sur le statut), donc deux traitements simultanés ne
// réussissent jamais tous les deux. « Marquer traité » ne crée ni contrat ni paiement.
//
// « Ajouter quand même » (commit 5c) : sur un « doublon possible », crée le paiement « à confirmer » tel qu'indiqué
// dans le fichier (notre numéro PAI, PaiementID du fichier s'il est connu), sous le même verrou par police que
// l'import ; le signalement passe à TRAITÉ et pointe vers le paiement créé ; index des mots mis à jour (D22).

import type { PrismaClient } from "./generated/prisma/client";
import { ecrireAudit, type EncAuditDb } from "./encAudit";
import { montant } from "./encCalcul";
import { chercherDejaPresent } from "./encImportRegles";
import { ajouterMotsContrat } from "./encRecherche";
import { cleSequenceAnnuelle, prochainNumero, type EncSequenceDb } from "./encSequence";

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

export type EncAjoutQuandMemeDb = Pick<PrismaClient, "encSignalement" | "encContrat" | "encEncaissement" | "encContratMot" | "$executeRaw"> &
  EncAuditDb &
  EncSequenceDb;

/** Paiement tel qu'enregistré dans `EncSignalement.paiementIndique` (date/montant en texte, voir encImportApplication.ts). */
function lirePaiementIndique(json: unknown) {
  const p = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const texte = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  const date = texte(p.datePaiement);
  const montantTexte = texte(p.montant);
  return {
    datePaiement: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null,
    mode: texte(p.mode),
    reference: texte(p.reference),
    Z: montantTexte && /^-?\d+(\.\d+)?$/.test(montantTexte) ? montant(montantTexte) : null,
    paiementIdFichier: texte(p.paiementIdFichier),
    numeroLigne: typeof p.numeroLigne === "number" && Number.isInteger(p.numeroLigne) ? p.numeroLigne : null,
  };
}

export async function ajouterPaiementQuandMeme(
  db: EncAjoutQuandMemeDb,
  entree: { signalementId: string; userId: string; ip?: string | null; maintenant: Date }
): Promise<{ encaissementId: string; paiementId: string }> {
  const sig = await db.encSignalement.findUnique({
    where: { id: entree.signalementId },
    select: { id: true, analyse: true, contratId: true, brancheId: true, importId: true },
  });
  if (!sig) throw new EncSignalementError("Signalement introuvable.");
  if (sig.analyse !== "DOUBLON_POSSIBLE") throw new EncSignalementError("« Ajouter quand même » ne concerne que les doublons possibles.");
  if (!sig.contratId) throw new EncSignalementError("Aucun contrat n'est rattaché à ce signalement.");

  const police = await db.encContrat.findUnique({ where: { id: sig.contratId }, select: { numPolice: true } });
  if (!police) throw new EncSignalementError("Contrat introuvable.");
  // Même verrou que l'import (encImportApplication.ts) : un import simultané de la même police attend, et deux ajouts
  // simultanés du même signalement sont sérialisés (le second voit alors le signalement déjà traité).
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"police:" + police.numPolice})::bigint)`;

  const actuel = await db.encSignalement.findUnique({ where: { id: sig.id }, select: { statut: true, paiementIndique: true } });
  if (!actuel || actuel.statut !== "A_TRAITER") {
    throw new EncSignalementError("Ce signalement n'est plus à traiter (déjà traité, ou simple information).");
  }
  const paiement = lirePaiementIndique(actuel.paiementIndique);
  if (!paiement.datePaiement || !paiement.mode || !paiement.Z) {
    throw new EncSignalementError("Paiement indiqué incomplet (date, mode ou montant manquant) : impossible de l'ajouter.");
  }

  const contrat = await db.encContrat.findUnique({
    where: { id: sig.contratId },
    select: {
      brancheId: true,
      encaissements: { select: { id: true, paiementId: true, paiementIdFichier: true, reference: true, datePaiement: true, Z: true, statut: true } },
    },
  });
  if (!contrat) throw new EncSignalementError("Contrat introuvable.");
  // Même règle « déjà présent » que l'import : la ligne a pu être ajoutée entre-temps (autre signalement du même
  // paiement, laissé par un réimport) — jamais deux fois le même paiement.
  const deja = chercherDejaPresent(
    paiement,
    contrat.encaissements.map((e) => ({ ...e, montant: montant(e.Z) }))
  );
  if (deja) throw new EncSignalementError(`Ce paiement est déjà enregistré (${deja.paiementId}) : rien à ajouter.`);

  const paiementId = await prochainNumero(db, cleSequenceAnnuelle("PAI", entree.maintenant.getUTCFullYear()));
  const cree = await db.encEncaissement.create({
    data: {
      paiementId,
      paiementIdFichier: paiement.paiementIdFichier,
      contratId: sig.contratId,
      brancheId: sig.brancheId ?? contrat.brancheId,
      source: "FICHIER",
      statut: "A_CONFIRMER",
      datePaiement: paiement.datePaiement,
      mode: paiement.mode,
      reference: paiement.reference,
      Z: paiement.Z,
      dateSaisie: entree.maintenant,
      saisiParId: entree.userId,
      importId: sig.importId,
      importLigne: paiement.numeroLigne,
    },
  });

  const resolution = `Ajouté quand même — ${paiementId}`;
  const maj = await db.encSignalement.updateMany({
    where: { id: sig.id, statut: "A_TRAITER" },
    data: { statut: "TRAITE", traiteParId: entree.userId, traiteAt: entree.maintenant, resolution, encaissementCreeId: cree.id },
  });
  if (maj.count === 0) throw new EncSignalementError("Ce signalement n'est plus à traiter (déjà traité, ou simple information).");

  // D22 : la référence du paiement créé devient cherchable.
  await ajouterMotsContrat(db, sig.contratId, [paiement.reference]);

  await ecrireAudit(db, {
    entite: "EncEncaissement",
    entiteId: cree.id,
    action: "ajout_quand_meme",
    apres: {
      paiementId,
      paiementIdFichier: paiement.paiementIdFichier,
      datePaiement: paiement.datePaiement,
      mode: paiement.mode,
      reference: paiement.reference,
      Z: paiement.Z.toFixed(2),
      signalementId: sig.id,
    },
    userId: entree.userId,
    ip: entree.ip ?? null,
    mois: entree.maintenant,
  });
  await ecrireAudit(db, {
    entite: "EncSignalement",
    entiteId: sig.id,
    action: "ajouter_quand_meme",
    avant: { statut: "A_TRAITER" },
    apres: { statut: "TRAITE", resolution, encaissementCreeId: cree.id },
    userId: entree.userId,
    ip: entree.ip ?? null,
    mois: entree.maintenant,
  });
  return { encaissementId: cree.id, paiementId };
}
