/**
 * « Mon équipe » (fiabilisation du pointage, phase 5) — LOGIQUE PURE : état d'un membre pour la journée. Aucun calcul de
 * retard ici : `estRetard`, `minutesRetard` et `estDepartAnticipe` viennent du pointage (règles du lot 3, jamais
 * recalculées), les absences autorisées et les absents de la même lecture que la page « Présence » de la RH.
 */

import type { EtatPlageConge } from "./circuitConge";

export type CodeEtatJour =
  | "A_L_HEURE"
  | "EN_RETARD"
  | "PARTI_EN_AVANCE"
  | "ABSENCE_AUTORISEE"
  | "EN_CONGE"
  | "CONGE_EN_ATTENTE"
  | "ABSENT"
  | "PAS_ENCORE_POINTE"
  | "NON_OUVRE";

export interface SourceEtatJour {
  /** A pointé son arrivée aujourd'hui. */
  aArrive: boolean;
  estRetard: boolean;
  minutesRetard: number | null;
  /** A pointé un départ anticipé aujourd'hui. */
  departAnticipe: boolean;
  /** Journée entièrement couverte par un congé ou une permission. */
  absenceAutorisee: boolean;
  /** État du congé qui couvre la journée (`etatCongeDuJour`, congesPointage.ts) ; absent ou `null` : pas un congé. */
  etatConge?: EtatPlageConge | null;
  /** Absence enregistrée pour ce jour (cron des absences). */
  absent: boolean;
  /** Week-end ou jour férié. */
  jourNonOuvre: boolean;
}

export interface EtatJour {
  code: CodeEtatJour;
  libelle: string;
}

/**
 * État du membre, par priorité : une arrivée pointée prime (parti en avance, puis en retard, sinon à l'heure) ; sans
 * arrivée : absence autorisée, absent, jour non ouvré, sinon « pas encore pointé ».
 */
export function etatJourMembre(s: SourceEtatJour): EtatJour {
  if (s.aArrive) {
    if (s.departAnticipe) return { code: "PARTI_EN_AVANCE", libelle: "Parti en avance" };
    if (s.estRetard) return { code: "EN_RETARD", libelle: `En retard${s.minutesRetard ? ` · ${s.minutesRetard} min` : ""}` };
    return { code: "A_L_HEURE", libelle: "À l'heure" };
  }
  if (s.absenceAutorisee) {
    // Un congé s'affiche comme tel (T08) ; un jour seulement protégé (demande non validée à temps) reste une absence autorisée.
    if (s.etatConge === "EN_CONGE") return { code: "EN_CONGE", libelle: "En congé" };
    if (s.etatConge === "EN_ATTENTE") return { code: "CONGE_EN_ATTENTE", libelle: "Congé en attente de validation" };
    return { code: "ABSENCE_AUTORISEE", libelle: "Absence autorisée" };
  }
  if (s.absent) return { code: "ABSENT", libelle: "Absent" };
  if (s.jourNonOuvre) return { code: "NON_OUVRE", libelle: "Jour non ouvré" };
  return { code: "PAS_ENCORE_POINTE", libelle: "Pas encore pointé" };
}

/** Bornes d'une période en GET (`du`/`au`, AAAA-MM-JJ) ; par défaut le mois en cours jusqu'à aujourd'hui. */
export function periodeEquipe(du: string | undefined, au: string | undefined, now: Date): { du: string; au: string } {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const valide = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v).getTime()) ? v : null);
  const debut = valide(du) ?? iso(new Date(now.getFullYear(), now.getMonth(), 1));
  const fin = valide(au) ?? iso(now);
  return debut <= fin ? { du: debut, au: fin } : { du: fin, au: debut };
}
