// Saisie d'un encaissement depuis la fiche police (F3, commit 6c). L'encaissement est créé puis confirmé dans la même
// transaction par `confirmerEncaissement` (D26) — jamais d'autre calcul des montants figés ici.
//
// Contrôles (CDC §8.1) : date, mode, référence et montant obligatoires ; date de paiement jamais dans le futur ;
// montant > 0 ; Wave : référence = identifiant de transaction (T_ suivi d'au moins 10 lettres ou chiffres). Alertes à
// confirmer explicitement, rien n'est écrit avant : référence déjà utilisée dans un autre paiement, trop-perçu (D30).

import type { PrismaClient } from "./generated/prisma/client";
import { ecrireAudit, type EncAuditDb } from "./encAudit";
import { montant, type Montant } from "./encCalcul";
import { confirmerEncaissement, EncConfirmationError, jourDe, type EncConfirmationDb } from "./encConfirmation";
import { estIdentifiantWave } from "./encImportRegles";
import { ajouterMotsContrat, type EncIndexMotsDb } from "./encRecherche";
import { cleSequenceAnnuelle, prochainNumero, type EncSequenceDb } from "./encSequence";

/** Modes proposés à la saisie : mêmes codes que `normaliserMode` (import) et que les libellés de l'écran. */
export const MODES_SAISIE = ["WAVE", "OM", "MTN", "MOB", "CHQ", "VIR", "CB"] as const;
export type ModeSaisie = (typeof MODES_SAISIE)[number];

export interface SaisieEncaissement {
  /** `AAAA-MM-JJ`. */
  datePaiement: string;
  mode: string;
  reference: string;
  /** Montant en texte (ex. « 1000 » ou « 1000.50 »), jamais un flottant. */
  montant: string;
}

export type ErreursSaisie = Partial<Record<keyof SaisieEncaissement, string>>;

/** Contrôles §8.1 (purs) : renvoie les erreurs par champ, vide si la saisie est valide. */
export function controlerSaisie(s: SaisieEncaissement, maintenant: Date): ErreursSaisie {
  const e: ErreursSaisie = {};
  const d = s.datePaiement?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) e.datePaiement = "Date de paiement obligatoire.";
  else if (new Date(`${d}T00:00:00Z`) > jourDe(maintenant)) e.datePaiement = "La date de paiement ne peut pas être dans le futur.";

  if (!MODES_SAISIE.includes(s.mode as ModeSaisie)) e.mode = "Mode de paiement obligatoire.";

  const ref = s.reference?.trim() ?? "";
  if (!ref) e.reference = "Référence obligatoire.";
  else if (s.mode === "WAVE" && !estIdentifiantWave(ref)) {
    e.reference = "Paiement Wave : la référence doit être l'identifiant de transaction (T_ suivi d'au moins 10 lettres ou chiffres).";
  }

  const m = s.montant?.trim().replace(",", ".") ?? "";
  if (!/^\d+(\.\d{1,2})?$/.test(m)) e.montant = "Montant obligatoire (nombre, deux décimales au plus).";
  else if (montant(m).lte(0)) e.montant = "Le montant doit être supérieur à 0.";
  return e;
}

export type EncSaisieDb = EncConfirmationDb & EncSequenceDb & EncIndexMotsDb & EncAuditDb & Pick<PrismaClient, "encContrat">;

export interface EntreeSaisie extends SaisieEncaissement {
  contratId: string;
  userId: string;
  maintenant: Date;
  /** L'utilisateur a confirmé l'alerte « référence déjà utilisée ». */
  accepterReferenceDejaUtilisee?: boolean;
  /** L'utilisateur a confirmé le trop-perçu (D30). */
  accepterTropPercu?: boolean;
  ip?: string | null;
}

export type ResultatSaisie =
  | { statut: "ERREURS"; erreurs: ErreursSaisie }
  | { statut: "REFERENCE_DEJA_UTILISEE"; paiements: { paiementId: string; numPolice: string }[] }
  | { statut: "TROP_PERCU_A_CONFIRMER"; tropPercu: Montant; restantDu: Montant }
  | { statut: "CONFIRME"; encaissementId: string; paiementId: string; rang: number };

/**
 * Enregistre et confirme un versement saisi sur une police (F3). Toujours dans la transaction de l'appelant. Les
 * alertes (référence déjà utilisée, trop-perçu) sont renvoyées SANS RIEN ÉCRIRE tant qu'elles ne sont pas acceptées.
 */
export async function saisirEncaissement(db: EncSaisieDb, entree: EntreeSaisie): Promise<ResultatSaisie> {
  const erreurs = controlerSaisie(entree, entree.maintenant);
  if (Object.keys(erreurs).length > 0) return { statut: "ERREURS", erreurs };

  const contrat = await db.encContrat.findUnique({ where: { id: entree.contratId }, select: { id: true, numPolice: true, brancheId: true, S: true } });
  if (!contrat) throw new EncConfirmationError("Contrat introuvable.");
  // Même verrou que l'import et la confirmation (réentrant dans la transaction : la confirmation le reprend).
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"police:" + contrat.numPolice})::bigint)`;

  const reference = entree.reference.trim();
  const Z = montant(entree.montant.trim().replace(",", "."));

  if (!entree.accepterReferenceDejaUtilisee) {
    const memes = await db.encEncaissement.findMany({
      where: { reference: { equals: reference, mode: "insensitive" } },
      select: { paiementId: true, contrat: { select: { numPolice: true } } },
      take: 10,
    });
    if (memes.length > 0) {
      return { statut: "REFERENCE_DEJA_UTILISEE", paiements: memes.map((m) => ({ paiementId: m.paiementId, numPolice: m.contrat.numPolice })) };
    }
  }

  // Trop-perçu calculé AVANT toute écriture (le paiement n'est pas créé tant qu'il n'est pas accepté).
  const encaisse = await db.encEncaissement.aggregate({ where: { contratId: contrat.id, statut: "CONFIRME" }, _sum: { Z: true } });
  const restantDu = montant(contrat.S).minus(montant(encaisse._sum.Z ?? "0"));
  const tropPercu = Z.minus(restantDu.gt(0) ? restantDu : montant("0"));
  if (tropPercu.gt(0) && !entree.accepterTropPercu) return { statut: "TROP_PERCU_A_CONFIRMER", tropPercu, restantDu };

  const paiementId = await prochainNumero(db, cleSequenceAnnuelle("PAI", entree.maintenant.getUTCFullYear()));
  const cree = await db.encEncaissement.create({
    data: {
      paiementId,
      contratId: contrat.id,
      brancheId: contrat.brancheId,
      source: "SAISIE",
      statut: "A_CONFIRMER",
      datePaiement: new Date(`${entree.datePaiement.trim()}T00:00:00.000Z`),
      mode: entree.mode,
      reference,
      Z: Z.toFixed(2),
      dateSaisie: entree.maintenant,
      saisiParId: entree.userId,
    },
  });
  await ecrireAudit(db, {
    entite: "EncEncaissement",
    entiteId: cree.id,
    action: "saisie",
    apres: { paiementId, datePaiement: entree.datePaiement.trim(), mode: entree.mode, reference, Z: Z.toFixed(2) },
    motif: entree.accepterReferenceDejaUtilisee ? "Référence déjà utilisée dans un autre paiement, confirmée par l'utilisateur" : null,
    mois: entree.maintenant,
    userId: entree.userId,
    ip: entree.ip ?? null,
  });

  const r = await confirmerEncaissement(db, {
    encaissementId: cree.id,
    userId: entree.userId,
    maintenant: entree.maintenant,
    accepterTropPercu: entree.accepterTropPercu === true,
    ip: entree.ip,
  });
  // Ne peut pas arriver (trop-perçu déjà contrôlé sous le même verrou) : on annule toute la transaction plutôt que de
  // laisser un paiement saisi non confirmé.
  if (r.statut !== "CONFIRME") throw new EncConfirmationError("Trop-perçu non confirmé : saisie annulée.");

  // D22 : la référence devient cherchable.
  await ajouterMotsContrat(db, contrat.id, [reference]);
  return { statut: "CONFIRME", encaissementId: cree.id, paiementId, rang: r.rang };
}
