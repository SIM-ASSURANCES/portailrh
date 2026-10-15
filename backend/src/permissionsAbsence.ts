// Permissions d'absence — règles pures (Lot 4, 2026-10-15).
//
// Portage des helpers de portailRHv2 (`permissions-rh.ts`) SANS leur accès base : durée, plafond mensuel, chevauchement
// horaire, écart de retour. Les jours sont des chaînes civiles `AAAA-MM-JJ` (comme les congés), les heures `HH:MM`.
// L'application en base (verrous, plafond sous verrou, plage d'absence autorisée) est dans `permissionsDb.ts`.

import { comparerJours, parseJourCivil, formatJourCivil, type JourCivil } from "./congesCalcul";

export const HEURE_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Minutes depuis minuit pour « HH:MM », `null` si le format est invalide. */
export function heureEnMinutes(heure: string): number | null {
  if (!HEURE_REGEX.test(heure)) return null;
  const [h, m] = heure.split(":").map(Number);
  return h * 60 + m;
}

/** Durée en minutes entre deux heures « HH:MM » (jamais négative). Heure invalide : 0. */
export function calculerDureeMinutes(heureDepart: string, heureRetour: string): number {
  const depart = heureEnMinutes(heureDepart);
  const retour = heureEnMinutes(heureRetour);
  if (depart === null || retour === null) return 0;
  return Math.max(0, retour - depart);
}

/** 150 → « 2h30 », 45 → « 45 min », 120 → « 2h », 0 → « 0 min ». */
export function formatMinutesEnHeures(minutes: number): string {
  if (!(minutes > 0)) return "0 min";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

/** Au-delà de 4 h, un congé était plus adapté (simple avertissement, jamais un refus). */
export const SEUIL_CONGE_RECOMMANDE_MINUTES = 240;

export function verifierDureeAutorisee(
  dureeMinutes: number,
  dureeMaxHeures: number
): { valide: boolean; depasseMax: boolean; alerteCongeRecommande: boolean } {
  const depasseMax = dureeMinutes > dureeMaxHeures * 60;
  return {
    valide: dureeMinutes > 0 && !depasseMax,
    depasseMax,
    alerteCongeRecommande: dureeMinutes > SEUIL_CONGE_RECOMMANDE_MINUTES,
  };
}

export interface PlageHorairePermission {
  heureDepart: string;
  heureRetour: string;
}

/** Deux plages [début, fin[ du même jour se chevauchent si Max(débuts) < Min(fins) ; se toucher n'est pas se chevaucher. */
export function plagesHorairesSeChevauchent(a: PlageHorairePermission, b: PlageHorairePermission): boolean {
  const a0 = heureEnMinutes(a.heureDepart);
  const a1 = heureEnMinutes(a.heureRetour);
  const b0 = heureEnMinutes(b.heureDepart);
  const b1 = heureEnMinutes(b.heureRetour);
  if (a0 === null || a1 === null || b0 === null || b1 === null) return false;
  return Math.max(a0, b0) < Math.min(a1, b1);
}

export function premierChevauchementHoraire<T extends PlageHorairePermission>(plage: PlageHorairePermission, existantes: readonly T[]): T | null {
  return existantes.find((e) => plagesHorairesSeChevauchent(plage, e)) ?? null;
}

/** Écart entre le retour prévu et le retour réel : positif = retour en retard. */
export function calculerEcartRetour(heureRetourPrevue: string, heureRetourReelle: string): { depassement: boolean; minutesEcart: number } {
  const prevu = heureEnMinutes(heureRetourPrevue);
  const reel = heureEnMinutes(heureRetourReelle);
  if (prevu === null || reel === null) return { depassement: false, minutesEcart: 0 };
  const diff = reel - prevu;
  return { depassement: diff > 0, minutesEcart: diff };
}

/** Premier et dernier jour du mois civil qui contient `jour`. */
export function bornesMois(jour: JourCivil): { debut: JourCivil; fin: JourCivil } | null {
  const d = parseJourCivil(jour);
  if (!d) return null;
  return {
    debut: formatJourCivil(new Date(d.getFullYear(), d.getMonth(), 1)),
    fin: formatJourCivil(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
  };
}

export function evaluerPlafond(p: { utilise: number; plafond: number }): { atteint: boolean; restant: number } {
  return { atteint: p.utilise >= p.plafond, restant: Math.max(0, p.plafond - p.utilise) };
}

export const MOTIF_PERMISSION_MIN = 5;
export const MOTIF_PERMISSION_MAX = 500;
/** Motif obligatoire quand la RH accorde au-delà du plafond mensuel. */
export const MOTIF_EXCEPTION_MIN = 5;

export type SaisiePermissionControlee =
  | { ok: true; dureeMinutes: number; motif: string }
  | { ok: false; erreur: string; champ: "date" | "heureDepart" | "heureRetourPrevue" | "motif" };

/**
 * Contrôles de forme d'une demande de permission : date valide et pas dans le passé, heures valides, retour après le
 * départ, motif de 5 à 500 caractères. `aujourdhui` : jour civil local, fourni par l'appelant.
 */
export function controlerSaisiePermission(p: {
  date: string;
  heureDepart: string;
  heureRetourPrevue: string;
  motif: string;
  aujourdhui: JourCivil;
}): SaisiePermissionControlee {
  if (!parseJourCivil(p.date)) return { ok: false, erreur: "Date invalide.", champ: "date" };
  if (comparerJours(p.date, p.aujourdhui) < 0) {
    return { ok: false, erreur: "La date de la permission ne peut pas être dans le passé.", champ: "date" };
  }
  if (heureEnMinutes(p.heureDepart) === null) return { ok: false, erreur: "Heure de départ invalide (HH:MM).", champ: "heureDepart" };
  if (heureEnMinutes(p.heureRetourPrevue) === null) {
    return { ok: false, erreur: "Heure de retour invalide (HH:MM).", champ: "heureRetourPrevue" };
  }
  const dureeMinutes = calculerDureeMinutes(p.heureDepart, p.heureRetourPrevue);
  if (dureeMinutes <= 0) {
    return { ok: false, erreur: "L'heure de retour prévue doit être postérieure à l'heure de départ.", champ: "heureRetourPrevue" };
  }
  const motif = p.motif.replace(/\s+/g, " ").trim();
  if (motif.length < MOTIF_PERMISSION_MIN) {
    return { ok: false, erreur: `Le motif doit contenir au moins ${MOTIF_PERMISSION_MIN} caractères.`, champ: "motif" };
  }
  if (motif.length > MOTIF_PERMISSION_MAX) {
    return { ok: false, erreur: `Le motif ne doit pas dépasser ${MOTIF_PERMISSION_MAX} caractères.`, champ: "motif" };
  }
  return { ok: true, dureeMinutes, motif };
}

export type RetourControle = { ok: true; dureeReelleMinutes: number } | { ok: false; erreur: string };

/** Le retour réel est une heure valide, postérieure (ou égale) au départ. */
export function controlerRetourReel(p: { heureDepart: string; heureRetourReelle: string }): RetourControle {
  if (heureEnMinutes(p.heureRetourReelle) === null) return { ok: false, erreur: "Heure de retour invalide (HH:MM)." };
  const depart = heureEnMinutes(p.heureDepart);
  if (depart === null) return { ok: false, erreur: "Heure de départ de la permission invalide." };
  const duree = heureEnMinutes(p.heureRetourReelle)! - depart;
  if (duree < 0) return { ok: false, erreur: "L'heure de retour ne peut pas précéder l'heure de départ." };
  return { ok: true, dureeReelleMinutes: duree };
}

export const MESSAGE_PLAFOND_ATTEINT_APPROBATION = (utilise: number, plafond: number) =>
  `Le plafond mensuel de ce type est atteint pour ce collaborateur (${utilise}/${plafond} déjà accordées ce mois-ci) : accordez avec une dérogation motivée (au moins ${MOTIF_EXCEPTION_MIN} caractères).`;
