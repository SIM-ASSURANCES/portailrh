// Congés — règles PURES du rappel quotidien des demandes en attente (T10, 2026-10-20). Aucun accès base.

import { LIBELLE_NATURE_CONGE, STATUTS_CONGE_EN_ATTENTE, type StatutCircuitConge } from "./circuitConge";
import { ajouterJours, comparerJours, type JourCivil } from "./congesCalcul";
import type { NatureConge } from "./generated/prisma/enums";

export const DELAI_RAPPEL_CONGE_MS = 24 * 60 * 60 * 1000;

export type PrioriteRappelConge = "IMPORTANT" | "INFO";

export interface ParamsRappelDu {
  statut: StatutCircuitConge;
  dernierRappelAt: Date | null;
  etapeDepuis: Date;
  now: Date;
}

/**
 * Un rappel est dû seulement si la demande attend une décision (`EN_ATTENTE_RESPONSABLE` ou `EN_ATTENTE_RH`) et que le dernier
 * rappel (ou, à défaut, l'entrée dans l'étape) remonte à au moins 24 heures.
 */
export function rappelCongeDu(p: ParamsRappelDu): boolean {
  if (!STATUTS_CONGE_EN_ATTENTE.includes(p.statut)) return false;
  const repere = p.dernierRappelAt ?? p.etapeDepuis;
  return repere.getTime() <= p.now.getTime() - DELAI_RAPPEL_CONGE_MS;
}

/**
 * Priorité du rappel (jours civils `AAAA-MM-JJ`) : `"IMPORTANT"` si le congé commence dans 2 jours ou moins, ou a déjà commencé ;
 * sinon `"INFO"`.
 */
export function prioriteRappelConge(p: { dateDebut: JourCivil; aujourdhui: JourCivil }): PrioriteRappelConge {
  return comparerJours(p.dateDebut, ajouterJours(p.aujourdhui, 2)) <= 0 ? "IMPORTANT" : "INFO";
}

function dateFr(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

export interface ParamsMessageRappelConge {
  demandeurNom: string;
  reference: string;
  nature: NatureConge;
  dateDebut: string;
  dateFin: string;
  nbJoursOuvres: number;
}

/** Phrase unique résumant la demande en attente de décision. */
export function messageRappelConge(p: ParamsMessageRappelConge): string {
  const debut = dateFr(p.dateDebut);
  const fin = dateFr(p.dateFin);
  const periode = p.dateDebut === p.dateFin ? `le ${debut}` : `du ${debut} au ${fin}`;
  const jours = `${p.nbJoursOuvres} jour${p.nbJoursOuvres > 1 ? "s" : ""} ouvré${p.nbJoursOuvres > 1 ? "s" : ""}`;
  return `${LIBELLE_NATURE_CONGE[p.nature]} ${p.reference} de ${p.demandeurNom} (${periode}, ${jours}) est en attente de votre décision.`;
}

