import { dateLimiteTcaCpt } from "./cptTaxe";

// Aucun import d'`enc*` ou de `treso*` (règle d'indépendance du module).

/**
 * Rappels de la taxe (lot GC-8f, tâche `COMPTA_RAPPEL_TCA`) : les 10 et 17 de chaque mois, on rappelle de déclarer puis de payer le mois précédent
 * avant le jour limite (paramètre, 20). PUR : aucune lecture de base, aucune horloge ; la réservation et l'envoi sont dans `cptRappelTcaDb.ts`
 * et `frontend/src/lib/taches/compta.ts`.
 */

export const JOURS_RAPPEL_TCA_CPT = [10, 17] as const;

export type TypeRappelTcaCpt = "DECLARER" | "PAYER";

export const PERMISSION_RAPPEL_TCA_CPT: Record<TypeRappelTcaCpt, string> = {
  DECLARER: "cpt.declarer_tca",
  PAYER: "cpt.payer_tca",
};

/** Mois (AAAA-MM-01) dont la taxe se déclare ce mois-ci : le mois précédent. */
export function moisConcerneRappelCpt(jour: string): string {
  const annee = Number(jour.slice(0, 4));
  const m = Number(jour.slice(5, 7));
  return m === 1 ? `${annee - 1}-12-01` : `${annee}-${String(m - 1).padStart(2, "0")}-01`;
}

/**
 * Créneau de rappel couvert par ce jour : le plus grand des jours de rappel inférieur ou égal au jour du mois (une tâche rattrapée le 12 vaut
 * celle du 10), `null` avant le 10.
 */
export function creneauRappelTcaCpt(jour: string): number | null {
  const j = Number(jour.slice(8, 10));
  const dus = JOURS_RAPPEL_TCA_CPT.filter((c) => c <= j);
  return dus.length > 0 ? dus[dus.length - 1] : null;
}

export interface EtatMoisRappelCpt {
  /** Le mois porte des lignes de taxe (ou un montant à payer) : sinon rien à déclarer, aucun rappel. */
  aDeLaTaxe: boolean;
  declare: boolean;
  paye: boolean;
}

/** Quel rappel ce mois appelle : déclarer s'il ne l'est pas, payer s'il est déclaré mais pas payé, rien sinon. */
export function rappelAttenduCpt(e: EtatMoisRappelCpt): TypeRappelTcaCpt | null {
  if (e.paye) return null;
  if (e.declare) return "PAYER";
  return e.aDeLaTaxe ? "DECLARER" : null;
}

/** Clé de réservation d'un rappel : un seul par mois, créneau et type (insérée AVANT l'envoi). */
export function cleRappelTcaCpt(mois: string, creneau: number, type: TypeRappelTcaCpt): string {
  return `compta.rappel_tca.${mois.slice(0, 7)}.${String(creneau).padStart(2, "0")}.${type}`;
}

export const CLE_RAPPELS_TCA_INITIAUX_CPT = "compta.rappels_tca_initiaux";

const joursEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export interface EntreeMessageRappelCpt {
  type: TypeRappelTcaCpt;
  mois: string;
  jour: string;
  jourLimite: number;
}

export interface MessageRappelCpt {
  titre: string;
  message: string;
  dateLimite: string;
  joursRestants: number;
}

export function messageRappelTcaCpt(e: EntreeMessageRappelCpt): MessageRappelCpt {
  const dateLimite = dateLimiteTcaCpt(e.mois, e.jourLimite);
  const joursRestants = joursEntre(e.jour, dateLimite);
  const libelleMois = e.mois.slice(0, 7);
  const delai = joursRestants > 1 ? `il reste ${joursRestants} jours` : joursRestants === 1 ? "il reste 1 jour" : joursRestants === 0 ? "dernier jour" : `le délai est dépassé de ${-joursRestants} jour(s)`;
  const [d, m, a] = [dateLimite.slice(8, 10), dateLimite.slice(5, 7), dateLimite.slice(0, 4)];
  if (e.type === "DECLARER") {
    return {
      titre: `Taxe sur les contrats : déclarer le mois ${libelleMois}`,
      message: `La taxe du mois ${libelleMois} n'est pas encore déclarée. À déclarer et à payer avant le ${d}/${m}/${a} (${delai}).`,
      dateLimite,
      joursRestants,
    };
  }
  return {
    titre: `Taxe sur les contrats : payer le mois ${libelleMois}`,
    message: `La taxe du mois ${libelleMois} est déclarée mais pas encore payée. À payer et à justifier par la quittance avant le ${d}/${m}/${a} (${delai}).`,
    dateLimite,
    joursRestants,
  };
}

