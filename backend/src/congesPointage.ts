// Congés dans le Pointage et le reporting (T08, 2026-10-20). Logique PURE : aucun accès base.
//
// Une plage d'absence autorisée de source CONGE couvre un jour : il n'est jamais une absence (la tâche des absences et
// « Présence du jour » l'ignorent déjà, via `journeeCouverteParAbsence`). Ce fichier ne fait que dire COMMENT ce jour s'affiche
// et COMBIEN de jours de congé compte une période ; aucun calcul de retard, d'absence ou de présence ici.
// L'état d'une plage passe toujours par `etatPlageConge` (circuitConge.ts), jamais par le seul champ `provisoire`.

import { etatPlageConge, LIBELLE_ETAT_PLAGE_CONGE, type EtatPlageConge, type StatutCircuitConge } from "./circuitConge";
import { estJourOuvre, formatJourCivil, type JourCivil } from "./congesCalcul";

/** Plage telle que lue en base (champs utiles seulement). */
export interface PlageAbsenceLue {
  date: Date;
  source: "CONGE" | "PERMISSION";
  heureDebut: string;
  heureFin: string;
  provisoire: boolean;
  demandeConge: { statut: StatutCircuitConge; reference: string } | null;
}

/**
 * État d'une plage de congé ; `null` pour une plage qui n'est pas un congé (ancienne permission de quelques heures). Une plage de
 * congé sans demande liée (antérieure au module) est un congé validé si elle est définitive, en attente sinon.
 */
export function etatCongePlage(p: Pick<PlageAbsenceLue, "source" | "provisoire" | "demandeConge">): EtatPlageConge | null {
  if (p.source !== "CONGE") return null;
  if (!p.demandeConge) return p.provisoire ? "EN_ATTENTE" : "EN_CONGE";
  return etatPlageConge({ provisoire: p.provisoire, statutDemande: p.demandeConge.statut });
}

const PRIORITE_ETAT: Record<EtatPlageConge, number> = { EN_CONGE: 3, EN_ATTENTE: 2, PROTEGE: 1 };

/** État de congé d'une journée (plusieurs plages possibles) : le plus fort l'emporte (en congé > en attente > protégé). */
export function etatCongeDuJour(plages: readonly Pick<PlageAbsenceLue, "source" | "provisoire" | "demandeConge">[]): EtatPlageConge | null {
  let meilleur: EtatPlageConge | null = null;
  for (const p of plages) {
    const e = etatCongePlage(p);
    if (e && (!meilleur || PRIORITE_ETAT[e] > PRIORITE_ETAT[meilleur])) meilleur = e;
  }
  return meilleur;
}

/**
 * Libellé de l'onglet « Absence autorisée » de « Présence du jour » : « En congé (CNG-…) », « Congé en attente de validation
 * (CNG-…) », « Non compté absent (…) (CNG-…) » ; une ancienne permission garde « Permission HH:MM–HH:MM ».
 */
export function libelleAbsenceAutorisee(plages: readonly PlageAbsenceLue[]): string {
  const morceaux = plages.map((p) => {
    const etat = etatCongePlage(p);
    if (!etat) return `Permission ${p.heureDebut}–${p.heureFin}`;
    return p.demandeConge ? `${LIBELLE_ETAT_PLAGE_CONGE[etat]} (${p.demandeConge.reference})` : LIBELLE_ETAT_PLAGE_CONGE[etat];
  });
  return [...new Set(morceaux)].join(", ");
}

export interface SyntheseCongesPeriode {
  /** Jours OUVRÉS couverts par un congé validé (« en congé »), sans doublon. */
  joursConge: number;
  /** Jours ouvrés « en congé » où une arrivée a pourtant été pointée (R13 : pointé pendant un congé). */
  joursPointesEnConge: number;
}

/**
 * Jours de congé d'un salarié sur une période, à partir de SES plages et de SES arrivées déjà filtrées sur la période. Seuls les
 * jours ouvrés (lundi à vendredi, hors `joursFeries`) comptent ; un jour « en attente » ou « protégé » n'est pas un jour de congé.
 */
export function syntheseCongesPeriode(p: {
  plages: readonly Pick<PlageAbsenceLue, "date" | "source" | "provisoire" | "demandeConge">[];
  arrivees: readonly Date[];
  joursFeries: readonly JourCivil[];
}): SyntheseCongesPeriode {
  const parJour = new Map<JourCivil, Pick<PlageAbsenceLue, "source" | "provisoire" | "demandeConge">[]>();
  for (const pl of p.plages) {
    const j = formatJourCivil(pl.date);
    parJour.set(j, [...(parJour.get(j) ?? []), pl]);
  }
  const joursEnConge = new Set<JourCivil>();
  for (const [jour, plages] of parJour) {
    if (estJourOuvre(jour, p.joursFeries) && etatCongeDuJour(plages) === "EN_CONGE") joursEnConge.add(jour);
  }
  const joursArrivee = new Set(p.arrivees.map((d) => formatJourCivil(d)));
  let joursPointesEnConge = 0;
  for (const j of joursEnConge) if (joursArrivee.has(j)) joursPointesEnConge++;
  return { joursConge: joursEnConge.size, joursPointesEnConge };
}
