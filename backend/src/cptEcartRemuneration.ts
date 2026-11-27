import type { NatureRemunerationCpt } from "./cptReferentiels";
import { lignesContratCpt, type ContratRemunerationCpt, type ConventionRemunerationCpt, type LigneEnregistreeCpt } from "./cptRemuneration";

// Aucun import d'`enc*` ou de `treso*` (règle d'indépendance du module).

/**
 * Écart entre le bordereau de production et les conventions (Q19, règle C-39). PUR. Le fichier contient des MONTANTS (« Commission
 * déclarée », « Frais de gestion déclarés »), pas des taux : chacun est comparé au dû TOTAL du contrat que le moteur calcule avec la
 * convention qu'il retient (C-31 : lignes figées d'abord, sinon convention en vigueur à la date d'effet). Aucune convention retenue,
 * un conflit ou aucune échéance : aucune alerte ; une valeur absente du bordereau : aucune alerte.
 */

const ZERO = BigInt(0);

/** Colonnes du bordereau comparées, et la nature de rémunération à laquelle chacune correspond. */
export const NATURES_BORDEREAU_CPT = ["COMMISSION", "HONORAIRES"] as const satisfies readonly NatureRemunerationCpt[];
export type NatureBordereauCpt = (typeof NATURES_BORDEREAU_CPT)[number];

export interface EcartRemunerationCpt {
  nature: NatureBordereauCpt;
  declare: bigint;
  /** Somme des dus calculés pour cette nature sur le contrat (un ou plusieurs bénéficiaires). */
  attendu: bigint;
  /** declare − attendu, signé. */
  ecart: bigint;
  conventionIds: string[];
}

export function detecterEcartsRemunerationCpt(entree: {
  contrat: ContratRemunerationCpt;
  declares: Record<NatureBordereauCpt, bigint | null>;
  conventions: readonly ConventionRemunerationCpt[];
  enregistrees?: readonly LigneEnregistreeCpt[];
  toleranceCentimes: bigint;
}): EcartRemunerationCpt[] {
  const { lignes, conflits } = lignesContratCpt({ contrat: entree.contrat, conventions: entree.conventions, enregistrees: entree.enregistrees });
  const ecarts: EcartRemunerationCpt[] = [];
  for (const nature of NATURES_BORDEREAU_CPT) {
    const declare = entree.declares[nature];
    if (declare === null || conflits.some((c) => c.nature === nature)) continue;
    const siennes = lignes.filter((l) => l.nature === nature);
    if (siennes.length === 0) continue;
    const attendu = siennes.reduce((s, l) => s + l.duInitial, ZERO);
    const ecart = declare - attendu;
    if ((ecart < ZERO ? -ecart : ecart) <= entree.toleranceCentimes) continue;
    ecarts.push({ nature, declare, attendu, ecart, conventionIds: [...new Set(siennes.map((l) => l.conventionId))].sort() });
  }
  return ecarts;
}

/** Une seule alerte par contrat, nature et écart : cette clé est unique en base (`CptAlerteControle`). */
export const cleEcartRemunerationCpt = (contratId: string, nature: NatureBordereauCpt, ecart: bigint): string => `${contratId}|${nature}|${ecart}`;
