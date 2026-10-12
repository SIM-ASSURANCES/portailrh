// Confirmation F5 (commit 6b) : « Non reçu » et traitement par lot. La confirmation elle-même passe TOUJOURS par
// `confirmerEncaissement` (encConfirmation.ts, D26) — ce fichier n'écrit jamais de montant figé.
//
// Lot : chaque paiement dans SA PROPRE transaction (un paiement déjà traité par un autre lot simultané est simplement
// compté « déjà traité », les autres continuent). Trop-perçu : jamais confirmé en lot (D30) — renvoyé à part pour une
// décision ligne par ligne.

import type { PrismaClient } from "./generated/prisma/client";
import { ecrireAudit, type EncAuditDb } from "./encAudit";
import { confirmerEncaissement, EncConfirmationError, type EncConfirmationDb } from "./encConfirmation";
import type { Montant } from "./encCalcul";

/** Longueur minimale du motif d'un « Non reçu » (obligatoire, CDC F5). */
export const MOTIF_NON_RECU_MIN = 3;
/** Taille maximale d'un lot (une page de liste fait 50 lignes ; marge pour « tout sélectionner » sur plusieurs pages). */
export const LOT_MAX = 200;

export type EncNonRecuDb = Pick<PrismaClient, "encEncaissement" | "$executeRaw"> & EncAuditDb;

/**
 * « Non reçu » (F5) : un paiement « à confirmer » absent des comptes. Rien ne compte (aucun montant figé, aucune taxe) ;
 * motif obligatoire ; « Finalement reçu » (confirmerEncaissement) reste possible ensuite, à sa propre date.
 */
export async function marquerNonRecu(
  db: EncNonRecuDb,
  entree: { encaissementId: string; motif: string; userId: string; maintenant: Date; ip?: string | null }
): Promise<{ paiementId: string }> {
  const motif = entree.motif.trim();
  if (motif.length < MOTIF_NON_RECU_MIN) {
    throw new EncConfirmationError(`Le motif est obligatoire (${MOTIF_NON_RECU_MIN} caractères minimum).`);
  }
  const cible = await db.encEncaissement.findUnique({
    where: { id: entree.encaissementId },
    select: { contrat: { select: { numPolice: true } } },
  });
  if (!cible) throw new EncConfirmationError("Encaissement introuvable.");
  // Même verrou que la confirmation : un « Reçu » et un « Non reçu » simultanés sur la même police sont sérialisés.
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"police:" + cible.contrat.numPolice})::bigint)`;

  const enc = await db.encEncaissement.findUnique({ where: { id: entree.encaissementId }, select: { id: true, paiementId: true, statut: true } });
  if (!enc) throw new EncConfirmationError("Encaissement introuvable.");
  if (enc.statut !== "A_CONFIRMER") {
    throw new EncConfirmationError(`Seul un paiement « à confirmer » peut être marqué non reçu (statut : ${enc.statut}).`);
  }
  const maj = await db.encEncaissement.updateMany({
    where: { id: enc.id, statut: "A_CONFIRMER" },
    data: { statut: "NON_RECU", motifNonReception: motif, nonRecuParId: entree.userId, nonRecuAt: entree.maintenant },
  });
  if (maj.count !== 1) throw new EncConfirmationError("Cet encaissement a changé entre-temps : rechargez la page.");

  await ecrireAudit(db, {
    entite: "EncEncaissement",
    entiteId: enc.id,
    action: "non_recu",
    avant: { statut: "A_CONFIRMER" },
    apres: { statut: "NON_RECU" },
    motif,
    mois: entree.maintenant,
    userId: entree.userId,
    ip: entree.ip ?? null,
  });
  return { paiementId: enc.paiementId };
}

/** Client capable d'ouvrir une transaction par paiement (le client Prisma, jamais une transaction déjà ouverte). */
export interface EncLotClient<Db> {
  $transaction<T>(fn: (tx: Db) => Promise<T>, options?: { timeout?: number; maxWait?: number }): Promise<T>;
}

export interface BilanLot {
  traites: { id: string; paiementId: string }[];
  /** Trop-perçus écartés du lot (D30) : à confirmer ligne par ligne, explicitement. */
  tropPercus: { id: string; paiementId: string; tropPercu: string }[];
  /** Déjà traités (par un autre lot, une autre personne) ou refusés, avec la raison. */
  refuses: { id: string; message: string }[];
}

function verifierLot(ids: readonly string[]): string[] {
  const uniques = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  if (uniques.length === 0) throw new EncConfirmationError("Aucun paiement sélectionné.");
  if (uniques.length > LOT_MAX) throw new EncConfirmationError(`${LOT_MAX} paiements au plus par lot.`);
  return uniques;
}

const fcfa = (m: Montant) => m.toFixed(2);

/** « Reçu » (ou « Finalement reçu ») pour une sélection : chaque paiement confirmé par `confirmerEncaissement`. */
export async function confirmerEnLot(
  client: EncLotClient<EncConfirmationDb>,
  entree: { ids: readonly string[]; userId: string; maintenant: Date; ip?: string | null }
): Promise<BilanLot> {
  const bilan: BilanLot = { traites: [], tropPercus: [], refuses: [] };
  for (const id of verifierLot(entree.ids)) {
    try {
      const r = await client.$transaction(
        (tx) => confirmerEncaissement(tx, { encaissementId: id, userId: entree.userId, maintenant: entree.maintenant, ip: entree.ip }),
        { timeout: 20000, maxWait: 10000 }
      );
      if (r.statut === "CONFIRME") bilan.traites.push({ id, paiementId: r.paiementId });
      else bilan.tropPercus.push({ id, paiementId: r.paiementId, tropPercu: fcfa(r.tropPercu) });
    } catch (e) {
      if (e instanceof EncConfirmationError) bilan.refuses.push({ id, message: e.message });
      else throw e;
    }
  }
  return bilan;
}

/** « Non reçu » pour une sélection, avec le même motif. */
export async function marquerNonRecuEnLot(
  client: EncLotClient<EncNonRecuDb>,
  entree: { ids: readonly string[]; motif: string; userId: string; maintenant: Date; ip?: string | null }
): Promise<BilanLot> {
  if (entree.motif.trim().length < MOTIF_NON_RECU_MIN) {
    throw new EncConfirmationError(`Le motif est obligatoire (${MOTIF_NON_RECU_MIN} caractères minimum).`);
  }
  const bilan: BilanLot = { traites: [], tropPercus: [], refuses: [] };
  for (const id of verifierLot(entree.ids)) {
    try {
      const r = await client.$transaction((tx) => marquerNonRecu(tx, { ...entree, encaissementId: id }), { timeout: 20000, maxWait: 10000 });
      bilan.traites.push({ id, paiementId: r.paiementId });
    } catch (e) {
      if (e instanceof EncConfirmationError) bilan.refuses.push({ id, message: e.message });
      else throw e;
    }
  }
  return bilan;
}
