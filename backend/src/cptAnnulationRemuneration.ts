import { texteDepuisCentimes } from "./cptEcheancier";
import { lireMotifRemunerationCpt } from "./cptReglementPartenaire";

// Aucun import d'`enc*` ou de `treso*` (règle d'indépendance du module).

/**
 * Annulation d'un règlement ou d'une compensation (Q22, règle C-38). PUR : le serveur (sous le verrou du partenaire) et l'écran
 * (bouton grisé avec la raison) lisent la MÊME fonction. Une erreur de saisie se corrige par cette annulation tracée, jamais par
 * modification ni suppression ; une opération annulée ne compte plus dans le payé.
 */

const ZERO = BigInt(0);
const fcfa = (c: bigint) => `${Number(texteDepuisCentimes(c)).toLocaleString("fr-FR")} FCFA`;
const dateFr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export const TYPES_OPERATION_REMUNERATION_CPT = ["REGLEMENT", "COMPENSATION"] as const;
export type TypeOperationRemunerationCpt = (typeof TYPES_OPERATION_REMUNERATION_CPT)[number];

export const CASE_AUCUN_VERSEMENT_CPT = "Aucun versement n'a eu lieu, ou il a été rejeté par la banque.";

export interface OperationRemunerationCpt {
  type: TypeOperationRemunerationCpt;
  id: string;
  /** Numéro CPR d'un règlement ; vide pour une compensation. */
  reference: string;
  montant: bigint;
  auteurId: string;
  /** Instant de la saisie (texte ISO) : ordre des opérations. */
  creeAt: string;
  annulee: boolean;
  /** Effet sur le payé de chaque ligne, signé (une reprise de compensation est négative). */
  affectations: readonly { ligneId: string; montant: bigint }[];
}

const nommer = (o: OperationRemunerationCpt) => (o.type === "REGLEMENT" ? `le règlement ${o.reference}` : `la compensation du ${dateFr(o.creeAt)} (${fcfa(o.montant)})`);

/**
 * Raison qui empêche d'annuler, ou `null`. Les permissions sont vérifiées à part (écran et action).
 *  1. déjà annulée ;
 *  2. l'auteur de l'opération ne l'annule jamais ;
 *  3. une compensation active, saisie après elle, reprend des montants sur une ligne que cette opération a payée ;
 *  4. sans elle, le payé d'une ligne deviendrait négatif ou dépasserait son dû (une opération saisie depuis s'y est ajoutée).
 */
export function raisonBlocageAnnulationCpt(entree: {
  operation: OperationRemunerationCpt;
  /** Toutes les opérations du partenaire (celle-ci comprise ou non). */
  operations: readonly OperationRemunerationCpt[];
  /** Dû figé de chaque ligne enregistrée. */
  dus: ReadonlyMap<string, bigint>;
  userId: string;
}): string | null {
  const { operation, operations, dus, userId } = entree;
  if (operation.annulee) return "Cette opération est déjà annulée.";
  if (operation.auteurId === userId) return "Vous avez saisi cette opération : une autre personne doit l'annuler.";

  const autres = operations.filter((o) => !o.annulee && !(o.type === operation.type && o.id === operation.id));
  const payees = new Set(operation.affectations.filter((a) => a.montant > ZERO).map((a) => a.ligneId));
  const dependante = autres
    .filter((o) => o.type === "COMPENSATION" && o.creeAt > operation.creeAt && o.affectations.some((a) => a.montant < ZERO && payees.has(a.ligneId)))
    .sort((a, b) => b.creeAt.localeCompare(a.creeAt))[0];
  if (dependante) return `Annulez d'abord ${nommer(dependante)} : elle reprend des montants payés par cette opération.`;

  for (const { ligneId } of operation.affectations) {
    let reste = ZERO;
    for (const o of autres) for (const a of o.affectations) if (a.ligneId === ligneId) reste += a.montant;
    const du = dus.get(ligneId) ?? ZERO;
    if (reste >= ZERO && reste <= du) continue;
    const depuis = autres
      .filter((o) => o.creeAt > operation.creeAt && o.affectations.some((a) => a.ligneId === ligneId))
      .sort((a, b) => b.creeAt.localeCompare(a.creeAt))[0];
    const motif = reste < ZERO ? "le payé d'une échéance deviendrait négatif" : "une échéance serait payée au-delà de son dû";
    return depuis ? `Annulez d'abord ${nommer(depuis)} : sinon ${motif}.` : `Annulation impossible : ${motif}.`;
  }
  return null;
}

export interface AnnulationRemunerationSaisie {
  type: TypeOperationRemunerationCpt;
  operationId: string;
  motif: string;
  /** Case cochée « aucun versement n'a eu lieu… » : exigée pour un règlement (un versement parti à tort n'est pas traité). */
  sansVersement: boolean;
  pieceOdoo: string | null;
}

export function validerSaisieAnnulationCpt(
  saisie: Record<string, unknown>,
): { ok: true; valeur: AnnulationRemunerationSaisie } | { ok: false; erreurs: Record<string, string> } {
  const erreurs: Record<string, string> = {};
  const type = TYPES_OPERATION_REMUNERATION_CPT.find((t) => t === saisie.type);
  const operationId = String(saisie.operationId ?? "").trim();
  if (!type || !operationId) erreurs.operationId = "Opération à annuler introuvable.";
  const motif = lireMotifRemunerationCpt(saisie.motif);
  if (!motif.ok) erreurs.motif = motif.message;
  const sansVersement = saisie.sansVersement === true || saisie.sansVersement === "true" || saisie.sansVersement === "on";
  if (type === "REGLEMENT" && !sansVersement) erreurs.sansVersement = `Cochez « ${CASE_AUCUN_VERSEMENT_CPT} »`;
  const pieceOdoo = String(saisie.pieceOdoo ?? "").replace(/\s+/g, " ").trim() || null;
  if (pieceOdoo && pieceOdoo.length > 60) erreurs.pieceOdoo = "Pièce Odoo : 60 caractères au plus.";
  if (Object.keys(erreurs).length > 0 || !type || !motif.ok) return { ok: false, erreurs };
  return { ok: true, valeur: { type, operationId, motif: motif.motif, sansVersement: type === "REGLEMENT" && sansVersement, pieceOdoo } };
}
