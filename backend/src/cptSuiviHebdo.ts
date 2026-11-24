import { BRANCHES_CPT, type BrancheCpt } from "./cptReferentiels";
import { ajouterJoursCpt, joursEntreCpt } from "./cptEcheancier";

/**
 * Contrôle hebdomadaire de Gestion Compta (lot GC-6, docs/PLAN_GESTION_COMPTA.md §GC-6, conception §9) : règles PURES, sans accès base.
 *
 * Deux listes de travail issues du rapprochement (GC-5) :
 *  - « encaissements sans contrat » : encaissements encore `A_RATTACHER` (aucun rattachement VALIDÉ n'a soldé l'argent, RG-01) ;
 *  - « contrats déclarés payés sans encaissement » : contrats que la production dit payés et qu'aucun rattachement en cours ou
 *    validé n'appuie.
 * Le statut vient du rapprochement : rien n'est recalculé ici, ce fichier ne fait que dater, filtrer et classer.
 *
 * ÂGE (décision GC-6, registre C-17) : jours écoulés depuis la date de valeur pour un encaissement (le jour où l'argent est arrivé :
 * la date d'import dépend du moment où le relevé est déposé, elle ferait vieillir ou rajeunir une ligne à tort) ; depuis la date de
 * paiement déclarée par la production pour un contrat, à défaut depuis la date de son import. Les jours sont ceux du calendrier
 * (fuseau du serveur = Abidjan = UTC, sans heure d'été), jamais des tranches de 24 heures.
 */

/** Les trois paliers du contrôle, dans l'ordre croissant : relance, alerte, escalade (paramètres `relance.jours`, `alerte.jours`, `escalade.jours`). */
export const PALIERS_CPT = ["RELANCE", "ALERTE", "ESCALADE"] as const;
export type PalierCpt = (typeof PALIERS_CPT)[number];

export interface SeuilsPaliersCpt {
  relanceJours: number;
  alerteJours: number;
  escaladeJours: number;
}

export const TAILLE_PAGE_SUIVI_CPT = 50;

/** Jour (AAAA-MM-JJ) d'une date, calendrier du serveur (UTC). */
export function jourTexteCpt(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Jours écoulés entre une date (AAAA-MM-JJ ou Date) et `maintenant`. Négatif = date dans le futur. */
export function ageEnJoursCpt(depuis: Date | string, maintenant: Date): number {
  const debut = typeof depuis === "string" ? depuis.slice(0, 10) : jourTexteCpt(depuis);
  return joursEntreCpt(debut, jourTexteCpt(maintenant));
}

/** Palier le plus élevé atteint par une ligne de cet âge ; nul si elle n'a pas encore atteint le premier (seuil INCLUS : 7 jours = relance). */
export function palierAtteintCpt(age: number, seuils: SeuilsPaliersCpt): PalierCpt | null {
  if (age >= seuils.escaladeJours) return "ESCALADE";
  if (age >= seuils.alerteJours) return "ALERTE";
  if (age >= seuils.relanceJours) return "RELANCE";
  return null;
}

/** Seuil, en jours, d'un palier. */
export function seuilDuPalierCpt(palier: PalierCpt, seuils: SeuilsPaliersCpt): number {
  return palier === "RELANCE" ? seuils.relanceJours : palier === "ALERTE" ? seuils.alerteJours : seuils.escaladeJours;
}

/**
 * Date (AAAA-MM-JJ) au plus tard de laquelle une ligne a AU MOINS `jours` jours : date <= limite. Sert aux requêtes (filtre par âge
 * minimum) pour qu'elles et `ageEnJoursCpt` disent exactement la même chose.
 */
export function dateLimiteAgeCpt(maintenant: Date, jours: number): string {
  return ajouterJoursCpt(jourTexteCpt(maintenant), -jours);
}

export type ObjetControleCpt = "ENCAISSEMENT" | "CONTRAT";

export interface LigneAgeeCpt {
  objet: ObjetControleCpt;
  id: string;
  age: number;
}

export interface ReservationPalierCpt {
  objet: ObjetControleCpt;
  id: string;
  palier: PalierCpt;
}

export function clePalierCpt(objet: ObjetControleCpt, id: string, palier: PalierCpt): string {
  return `${objet}|${id}|${palier}`;
}

export interface PlanPaliersCpt {
  /** Paliers à notifier : au plus un par ligne, le plus élevé atteint, jamais déjà réservé. */
  aEnvoyer: ReservationPalierCpt[];
  /** Paliers inférieurs jamais notifiés (la ligne a déjà dépassé) : réservés SANS envoi, pour ne jamais les notifier plus tard. */
  silencieux: ReservationPalierCpt[];
}

/**
 * Décide, pour chaque ligne, ce qui part et ce qui est seulement réservé. `dejaReserves` = clés des paliers déjà réservés (envoyés ou
 * silencieux). Règle : une ligne qui franchit plusieurs paliers d'un coup (relevé importé tard, tâche arrêtée) ne reçoit QU'UNE
 * notification, celle du palier le plus élevé ; les paliers inférieurs encore libres sont réservés sans envoi. Un palier déjà réservé
 * n'est jamais renvoyé. `premierPassage` : tout est réservé sans envoi (l'arriéré d'avant la mise en service ne notifie personne).
 */
export function planifierPaliersCpt(
  lignes: readonly LigneAgeeCpt[],
  dejaReserves: ReadonlySet<string>,
  seuils: SeuilsPaliersCpt,
  premierPassage: boolean
): PlanPaliersCpt {
  const aEnvoyer: ReservationPalierCpt[] = [];
  const silencieux: ReservationPalierCpt[] = [];
  for (const ligne of lignes) {
    const atteint = palierAtteintCpt(ligne.age, seuils);
    if (!atteint) continue;
    const rang = PALIERS_CPT.indexOf(atteint);
    const libres = PALIERS_CPT.slice(0, rang + 1).filter((p) => !dejaReserves.has(clePalierCpt(ligne.objet, ligne.id, p)));
    for (const palier of libres) {
      const reservation = { objet: ligne.objet, id: ligne.id, palier };
      if (!premierPassage && palier === atteint) aEnvoyer.push(reservation);
      else silencieux.push(reservation);
    }
  }
  return { aEnvoyer, silencieux };
}

// ---------- Filtres (GET) ----------

export interface FiltresSuiviCpt {
  /** Bornes de la date d'âge (date de valeur de l'encaissement ; date de paiement déclarée du contrat), AAAA-MM-JJ, incluses. */
  du: string | null;
  au: string | null;
  /** Encaissements seulement. */
  compteId: string | null;
  /** Contrats seulement. */
  partenaireId: string | null;
  branche: BrancheCpt | null;
}

export const FILTRES_SUIVI_VIDES_CPT: FiltresSuiviCpt = { du: null, au: null, compteId: null, partenaireId: null, branche: null };

const FORMAT_JOUR = /^\d{4}-\d{2}-\d{2}$/;

function jourValide(texte: string | undefined): string | null {
  if (!texte || !FORMAT_JOUR.test(texte)) return null;
  const d = new Date(`${texte}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || jourTexteCpt(d) !== texte ? null : texte;
}

export interface RechercheBruteCpt {
  du?: string;
  au?: string;
  compte?: string;
  partenaire?: string;
  branche?: string;
  page?: string;
  pageContrats?: string;
}

/**
 * Lit les paramètres GET. Une valeur absente ou invalide est ignorée (jamais une erreur de page) : un compte ou un partenaire n'est
 * retenu que s'il figure dans la liste fournie par l'appelant. Le filtre `du` > `au` est inversé en une période vide, pas corrigé.
 */
export function lireFiltresSuiviCpt(
  recherche: RechercheBruteCpt,
  connus: { comptesIds: readonly string[]; partenairesIds: readonly string[] }
): FiltresSuiviCpt {
  const branche = BRANCHES_CPT.find((b) => b === recherche.branche) ?? null;
  return {
    du: jourValide(recherche.du),
    au: jourValide(recherche.au),
    compteId: connus.comptesIds.includes(recherche.compte ?? "") ? (recherche.compte as string) : null,
    partenaireId: connus.partenairesIds.includes(recherche.partenaire ?? "") ? (recherche.partenaire as string) : null,
    branche,
  };
}

export function pageDemandeeCpt(texte: string | undefined): number {
  const n = Math.floor(Number(texte));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Libellé d'âge à l'écran (« 12 jours »). */
export function libelleAgeCpt(age: number): string {
  if (age <= 0) return "aujourd'hui";
  return `${age} jour${age > 1 ? "s" : ""}`;
}
