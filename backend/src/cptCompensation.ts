import { texteDepuisCentimes } from "./cptEcheancier";
import { lireMontantRemunerationCpt, lireMotifRemunerationCpt, type PartAffecteeCpt } from "./cptReglementPartenaire";
import { LIBELLE_NATURE_REMUNERATION_CPT, NATURES_REMUNERATION_CPT, type NatureRemunerationCpt } from "./cptReferentiels";
import { soldeNatureCpt, trierLignesRemunerationCpt, type LigneRemunerationCalculeeCpt } from "./cptRemuneration";

// Aucun import d'`enc*` ou de `treso*` (règle d'indépendance du module).

/**
 * Compensation entre natures d'un même partenaire (lot GC-9f, règle C-34). PUR. C'est la SEULE voie de passage d'une nature à une
 * autre, toujours à la demande (`cpt.compenser`), avec motif, jamais automatique : l'AVANCE d'une nature (versée au-delà de son
 * payable) est reprise et imputée sur ce qu'il reste à verser d'une autre nature. Aucun argent ne circule ; les totaux versés ne
 * changent pas. La créance du partenaire n'est jamais compensée : seul un rattachement VALIDÉ rend une prime payée (RG-01).
 */

const ZERO = BigInt(0);
const minimum = (a: bigint, b: bigint) => (a < b ? a : b);
const max0 = (x: bigint) => (x > ZERO ? x : ZERO);
const fcfa = (c: bigint) => `${Number(texteDepuisCentimes(c)).toLocaleString("fr-FR")} FCFA`;

export interface CompensationSaisie {
  partenaireId: string;
  natureSource: NatureRemunerationCpt;
  natureCible: NatureRemunerationCpt;
  montant: bigint;
  motif: string;
}

export function validerSaisieCompensationCpt(saisie: Record<string, unknown>): { ok: true; valeur: CompensationSaisie } | { ok: false; erreurs: Record<string, string> } {
  const erreurs: Record<string, string> = {};
  const partenaireId = String(saisie.partenaireId ?? "").trim();
  if (!partenaireId) erreurs.partenaireId = "Partenaire obligatoire.";
  const natureSource = NATURES_REMUNERATION_CPT.find((n) => n === saisie.natureSource);
  if (!natureSource) erreurs.natureSource = "Nature de l'avance reprise obligatoire.";
  const natureCible = NATURES_REMUNERATION_CPT.find((n) => n === saisie.natureCible);
  if (!natureCible) erreurs.natureCible = "Nature sur laquelle imputer obligatoire.";
  if (natureSource && natureCible && natureSource === natureCible) erreurs.natureCible = "Une compensation porte sur deux natures différentes.";
  const montant = lireMontantRemunerationCpt(saisie.montant);
  if (!montant.ok) erreurs.montant = montant.message;
  const motif = lireMotifRemunerationCpt(saisie.motif);
  if (!motif.ok) erreurs.motif = motif.message;
  if (Object.keys(erreurs).length > 0 || !natureSource || !natureCible || !montant.ok || !motif.ok) return { ok: false, erreurs };
  return { ok: true, valeur: { partenaireId, natureSource, natureCible, montant: montant.centimes, motif: motif.motif } };
}

export interface CapaciteCompensationCpt {
  /** Avance nette de la nature source : le seul montant qu'on peut reprendre. */
  avanceSource: bigint;
  /** Net à verser de la nature cible : le maximum qu'on peut y imputer. */
  aVerserCible: bigint;
  disponible: bigint;
}

export function capaciteCompensationCpt(
  lignes: readonly LigneRemunerationCalculeeCpt[],
  natureSource: NatureRemunerationCpt,
  natureCible: NatureRemunerationCpt,
): CapaciteCompensationCpt {
  const avanceSource = soldeNatureCpt(natureSource, lignes).avanceNette;
  const aVerserCible = soldeNatureCpt(natureCible, lignes).montantReglable;
  return { avanceSource, aVerserCible, disponible: minimum(avanceSource, aVerserCible) };
}

export type PlanCompensationCpt =
  | { ok: true; reprises: PartAffecteeCpt[]; ajouts: PartAffecteeCpt[]; capacite: CapaciteCompensationCpt }
  | { ok: false; message: string; capacite: CapaciteCompensationCpt };

function repartir(lignes: readonly LigneRemunerationCalculeeCpt[], montant: bigint, disponible: (l: LigneRemunerationCalculeeCpt) => bigint): { parts: PartAffecteeCpt[]; restant: bigint } {
  let restant = montant;
  const parts: PartAffecteeCpt[] = [];
  for (const l of trierLignesRemunerationCpt(lignes)) {
    const part = minimum(restant, max0(disponible(l)));
    if (part === ZERO) continue;
    parts.push({ cle: l.cle, contratId: l.contratId, echeanceId: l.echeanceId, numPolice: l.numPolice, rang: l.rang, montant: part });
    restant -= part;
  }
  return { parts, restant };
}

/** Lignes d'un partenaire : reprise des avances les plus anciennes de la source, imputation sur les restes à verser les plus anciens de la cible. */
export function planifierCompensationCpt(
  lignes: readonly LigneRemunerationCalculeeCpt[],
  natureSource: NatureRemunerationCpt,
  natureCible: NatureRemunerationCpt,
  montant: bigint,
): PlanCompensationCpt {
  const capacite = capaciteCompensationCpt(lignes, natureSource, natureCible);
  const refus = (message: string): PlanCompensationCpt => ({ ok: false, message, capacite });
  if (natureSource === natureCible) return refus("Une compensation porte sur deux natures différentes.");
  if (montant <= ZERO) return refus("Le montant doit être supérieur à zéro.");
  if (montant > capacite.avanceSource) {
    return refus(`Le montant dépasse l'avance disponible en ${LIBELLE_NATURE_REMUNERATION_CPT[natureSource].toLowerCase()} (${fcfa(capacite.avanceSource)}).`);
  }
  if (montant > capacite.aVerserCible) {
    return refus(`Le montant dépasse ce qu'il reste à verser en ${LIBELLE_NATURE_REMUNERATION_CPT[natureCible].toLowerCase()} (${fcfa(capacite.aVerserCible)}).`);
  }
  const reprises = repartir(lignes.filter((l) => l.nature === natureSource), montant, (l) => l.avance);
  const ajouts = repartir(lignes.filter((l) => l.nature === natureCible), montant, (l) => l.restePayable);
  if (reprises.restant !== ZERO || ajouts.restant !== ZERO) return refus("Le montant ne peut pas être réparti en entier sur les lignes.");
  return { ok: true, reprises: reprises.parts, ajouts: ajouts.parts, capacite };
}
