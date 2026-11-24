/**
 * Planificateur intégré (fiabilisation du pointage, phase 2) — LOGIQUE PURE : quelles tâches sont dues, quand est la
 * prochaine exécution, une tâche est-elle en retard. Aucun accès base ni horloge : `now` et les dernières exécutions
 * sont fournis par l'appelant (testable avec une horloge simulée).
 *
 * Cadence (heure LOCALE du serveur, qui est l'heure d'Abidjan en production, comme le reste du module) :
 * - relances de justification : toutes les 5 minutes (créneaux alignés sur les minutes multiples de 5) ;
 * - absences : du lundi au vendredi à 17:30 et 20:00 ;
 * - purge : une fois par jour à 03:00 ;
 * - rappels des congés en attente : du lundi au vendredi à 08:30 ;
 * - Gestion Compta (tâches vides jusqu'aux lots GC-6/8/9) : contrôle hebdomadaire le lundi à 07:30, relances du lundi
 *   au vendredi à 08:00, rappel de la taxe (TCA) les 10 et 17 de chaque mois à 08:00.
 *
 * Une tâche est « due » quand le créneau le plus récent déjà passé n'a pas encore été couvert par une exécution
 * (`debut` ≥ créneau). Conséquence : une exécution manquée parce que le serveur était arrêté est rattrapée au
 * redémarrage, et une exécution manuelle récente évite un doublon immédiat.
 */

export type NomTache =
  | "RELANCES_JUSTIFICATION"
  | "ABSENCES"
  | "PURGE"
  | "RAPPELS_CONGES"
  | "COMPTA_CONTROLE_HEBDO"
  | "COMPTA_RELANCES"
  | "COMPTA_RAPPEL_TCA";

export const TOUTES_LES_TACHES: readonly NomTache[] = [
  "RELANCES_JUSTIFICATION",
  "ABSENCES",
  "PURGE",
  "RAPPELS_CONGES",
  "COMPTA_CONTROLE_HEBDO",
  "COMPTA_RELANCES",
  "COMPTA_RAPPEL_TCA",
];

export const LIBELLE_TACHE: Record<NomTache, string> = {
  RELANCES_JUSTIFICATION: "Relances de justification",
  ABSENCES: "Absences et oublis de départ",
  PURGE: "Purge des journaux",
  RAPPELS_CONGES: "Rappels des congés en attente",
  COMPTA_CONTROLE_HEBDO: "Gestion Compta : contrôle hebdomadaire",
  COMPTA_RELANCES: "Gestion Compta : relances de créances",
  COMPTA_RAPPEL_TCA: "Gestion Compta : rappel de la taxe (TCA)",
};

/** Intervalle des relances, en minutes. */
export const INTERVALLE_RELANCES_MINUTES = 5;
/** Une tâche à intervalle est « en retard » sans exécution réussie depuis deux intervalles. */
export const RETARD_RELANCES_MINUTES = 2 * INTERVALLE_RELANCES_MINUTES;
/** Une tâche à créneaux fixes est « en retard » quand son créneau est passé de plus de 30 minutes sans succès. */
export const RETARD_CRENEAU_MINUTES = 30;
/** Durée de conservation des exécutions et des incidents. */
export const JOURS_CONSERVATION_JOURNAUX = 90;

/** Créneaux fixes (heure, minute) par jour, pour les tâches qui n'ont pas de simple intervalle. */
const CRENEAUX_ABSENCES: ReadonlyArray<[number, number]> = [
  [17, 30],
  [20, 0],
];
const CRENEAUX_PURGE: ReadonlyArray<[number, number]> = [[3, 0]];
const CRENEAUX_RAPPELS_CONGES: ReadonlyArray<[number, number]> = [[8, 30]];
// Gestion Compta (GC-1e) : cadences du plan (docs/compta-conception.md §7). L'heure du rappel TCA n'est pas précisée
// par le plan : 08:00, comme les relances.
const CRENEAUX_COMPTA_CONTROLE_HEBDO: ReadonlyArray<[number, number]> = [[7, 30]];
const CRENEAUX_COMPTA_RELANCES: ReadonlyArray<[number, number]> = [[8, 0]];
const CRENEAUX_COMPTA_RAPPEL_TCA: ReadonlyArray<[number, number]> = [[8, 0]];
/** Jours du mois du rappel TCA (déclarer et payer avant le 20). */
const JOURS_DU_MOIS_RAPPEL_TCA: readonly number[] = [10, 17];

/** Fenêtre de recherche d'un créneau, en jours. 8 suffit à franchir un week-end ou une semaine ; le rappel TCA (10 et 17) a jusqu'à 24 jours d'écart. */
const HORIZON_JOURS_DEFAUT = 8;
const HORIZON_JOURS: Partial<Record<NomTache, number>> = { COMPTA_RAPPEL_TCA: 31 };
const horizonJours = (tache: NomTache) => HORIZON_JOURS[tache] ?? HORIZON_JOURS_DEFAUT;

function estJourOuvre(date: Date): boolean {
  const jour = date.getDay();
  return jour !== 0 && jour !== 6;
}

/** La tâche a-t-elle des créneaux ce jour-là ? (la purge, tous les jours ; les relances à intervalle n'utilisent pas cette fonction) */
function jourActif(tache: NomTache, jour: Date): boolean {
  switch (tache) {
    case "ABSENCES":
    case "RAPPELS_CONGES":
    case "COMPTA_RELANCES":
      return estJourOuvre(jour);
    case "COMPTA_CONTROLE_HEBDO":
      return jour.getDay() === 1;
    case "COMPTA_RAPPEL_TCA":
      return JOURS_DU_MOIS_RAPPEL_TCA.includes(jour.getDate());
    default:
      return true;
  }
}

function creneauxHoraires(tache: NomTache): ReadonlyArray<[number, number]> {
  switch (tache) {
    case "ABSENCES":
      return CRENEAUX_ABSENCES;
    case "RAPPELS_CONGES":
      return CRENEAUX_RAPPELS_CONGES;
    case "COMPTA_CONTROLE_HEBDO":
      return CRENEAUX_COMPTA_CONTROLE_HEBDO;
    case "COMPTA_RELANCES":
      return CRENEAUX_COMPTA_RELANCES;
    case "COMPTA_RAPPEL_TCA":
      return CRENEAUX_COMPTA_RAPPEL_TCA;
    default:
      return CRENEAUX_PURGE;
  }
}

function creneauxDuJour(tache: NomTache, jour: Date): Date[] {
  if (!jourActif(tache, jour)) return [];
  return creneauxHoraires(tache).map(([h, m]) => new Date(jour.getFullYear(), jour.getMonth(), jour.getDate(), h, m, 0, 0));
}

/** Créneau planifié le plus récent ≤ `now` (dans l'horizon de la tâche : 8 jours, 31 pour le rappel TCA). */
export function dernierCreneau(tache: NomTache, now: Date): Date | null {
  if (tache === "RELANCES_JUSTIFICATION") {
    const d = new Date(now);
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() - (d.getMinutes() % INTERVALLE_RELANCES_MINUTES));
    return d;
  }
  for (let retour = 0; retour <= horizonJours(tache); retour++) {
    const jour = new Date(now.getFullYear(), now.getMonth(), now.getDate() - retour);
    const passes = creneauxDuJour(tache, jour).filter((c) => c <= now);
    if (passes.length > 0) return passes[passes.length - 1];
  }
  return null;
}

/** Premier créneau planifié strictement après `now`. */
export function prochainCreneau(tache: NomTache, now: Date): Date {
  if (tache === "RELANCES_JUSTIFICATION") {
    const d = new Date(now);
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() - (d.getMinutes() % INTERVALLE_RELANCES_MINUTES) + INTERVALLE_RELANCES_MINUTES);
    return d;
  }
  for (let avant = 0; avant <= horizonJours(tache); avant++) {
    const jour = new Date(now.getFullYear(), now.getMonth(), now.getDate() + avant);
    const suivant = creneauxDuJour(tache, jour).find((c) => c > now);
    if (suivant) return suivant;
  }
  // Inatteignable (au plus un week-end ou, pour le rappel TCA, un mois à franchir) ; valeur de repli sûre.
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

export type DernieresExecutions = Partial<Record<NomTache, Date | null>>;

/**
 * Tâches à exécuter maintenant. `dernieres[tache]` = début de la dernière exécution de cette tâche, tous statuts et
 * déclenchements confondus (une exécution ignorée parce qu'une autre instance tenait le verrou compte : la tâche est
 * déjà prise en charge pour ce créneau).
 */
export function tachesDues(now: Date, dernieres: DernieresExecutions): NomTache[] {
  const dues: NomTache[] = [];
  for (const tache of TOUTES_LES_TACHES) {
    const creneau = dernierCreneau(tache, now);
    if (!creneau) continue;
    const derniere = dernieres[tache] ?? null;
    if (derniere === null || derniere < creneau) dues.push(tache);
  }
  return dues;
}

/** Prochaine exécution attendue (affichée dans le moniteur). */
export function prochaineExecution(tache: NomTache, now: Date, derniere: Date | null): Date {
  // Un créneau déjà passé et non couvert sera exécuté au prochain passage du planificateur (≤ 1 minute).
  const creneau = dernierCreneau(tache, now);
  if (creneau && (derniere === null || derniere < creneau)) return now;
  return prochainCreneau(tache, now);
}

/**
 * Une tâche est « en retard » quand elle n'a pas réussi comme prévu :
 * - relances : aucune exécution réussie depuis deux intervalles (10 min), ou jamais ;
 * - absences / purge / rappels congés : le dernier créneau est passé de plus de 30 minutes sans exécution réussie depuis.
 */
export function tacheEnRetard(tache: NomTache, now: Date, derniereReussie: Date | null): boolean {
  if (tache === "RELANCES_JUSTIFICATION") {
    return derniereReussie === null || now.getTime() - derniereReussie.getTime() > RETARD_RELANCES_MINUTES * 60_000;
  }
  const creneau = dernierCreneau(tache, now);
  if (!creneau) return false;
  if (now.getTime() - creneau.getTime() <= RETARD_CRENEAU_MINUTES * 60_000) return false;
  return derniereReussie === null || derniereReussie < creneau;
}

/** Clé du verrou consultatif PostgreSQL d'une tâche (`hashtext` côté SQL) : une seule exécution à la fois. */
export function cleVerrouTache(tache: NomTache): string {
  return `tache:${tache}`;
}

/** Message d'erreur court et sans donnée personnelle : première ligne, 200 caractères au plus. */
export function erreurCourte(e: unknown): string {
  const brut = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return brut.split("\n")[0].slice(0, 200);
}

const pluriel = (n: number, singulier: string, plurielMot = `${singulier}s`) => `${n} ${n > 1 ? plurielMot : singulier}`;

/** Bilan lisible d'une exécution (« 3 envois, 1 clôture, 0 erreur »). */
export function libelleBilan(tache: NomTache, bilan: unknown): string {
  const b = (bilan ?? {}) as Record<string, unknown>;
  const n = (cle: string) => (typeof b[cle] === "number" ? (b[cle] as number) : 0);
  switch (tache) {
    case "RELANCES_JUSTIFICATION":
      return `${pluriel(n("envois"), "envoi")}, ${pluriel(n("clotures"), "clôture")}, ${pluriel(n("erreurs"), "erreur")}`;
    case "ABSENCES":
      return `${pluriel(n("nouvellesAbsences"), "nouvelle absence", "nouvelles absences")}, ${pluriel(n("oublisDetectes"), "oubli")} de départ`;
    case "PURGE":
      return `${pluriel(n("executionsSupprimees"), "exécution")} et ${pluriel(n("incidentsSupprimes"), "incident")} supprimés`;
    case "RAPPELS_CONGES":
      return `${pluriel(n("rappels"), "rappel")}, ${pluriel(n("erreurs"), "erreur")}`;
    case "COMPTA_CONTROLE_HEBDO":
    case "COMPTA_RELANCES":
      // GC-6b : module non mis en service = rien lu, rien envoyé ; sinon des chiffres, jamais de donnée personnelle.
      if (b.moduleNonMisEnService === true) return "Aucun traitement pour l'instant (module non mis en service)";
      if (tache === "COMPTA_RELANCES") {
        const base = `${pluriel(n("traites"), "ligne relancée", "lignes relancées")}, ${pluriel(n("notifications"), "notification")}, ${pluriel(n("silencieuses"), "palier réservé sans envoi", "paliers réservés sans envoi")}, ${pluriel(n("erreurs"), "erreur")}`;
        return b.premierPassage === true ? `Premier passage : arriéré réservé sans envoi (${base})` : base;
      }
      return `${pluriel(n("notifications"), "notification")} de résumé, ${pluriel(n("erreurs"), "erreur")}`;
    case "COMPTA_RAPPEL_TCA":
      // Tâche encore vide (GC-8) : le bilan le dit au lieu d'afficher « 0 ».
      if (b.enAttenteDuModule === true) return "Aucun traitement pour l'instant (module en construction)";
      return `${pluriel(n("traites"), "élément traité", "éléments traités")}, ${pluriel(n("erreurs"), "erreur")}`;
  }
}
