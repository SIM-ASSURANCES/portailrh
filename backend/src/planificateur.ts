/**
 * Planificateur intégré (fiabilisation du pointage, phase 2) — LOGIQUE PURE : quelles tâches sont dues, quand est la
 * prochaine exécution, une tâche est-elle en retard. Aucun accès base ni horloge : `now` et les dernières exécutions
 * sont fournis par l'appelant (testable avec une horloge simulée).
 *
 * Cadence (heure LOCALE du serveur, qui est l'heure d'Abidjan en production, comme le reste du module) :
 * - relances de justification : toutes les 5 minutes (créneaux alignés sur les minutes multiples de 5) ;
 * - absences : du lundi au vendredi à 17:30 et 20:00 ;
 * - purge : une fois par jour à 03:00.
 *
 * Une tâche est « due » quand le créneau le plus récent déjà passé n'a pas encore été couvert par une exécution
 * (`debut` ≥ créneau). Conséquence : une exécution manquée parce que le serveur était arrêté est rattrapée au
 * redémarrage, et une exécution manuelle récente évite un doublon immédiat.
 */

export type NomTache = "RELANCES_JUSTIFICATION" | "ABSENCES" | "PURGE";

export const TOUTES_LES_TACHES: readonly NomTache[] = ["RELANCES_JUSTIFICATION", "ABSENCES", "PURGE"];

export const LIBELLE_TACHE: Record<NomTache, string> = {
  RELANCES_JUSTIFICATION: "Relances de justification",
  ABSENCES: "Absences et oublis de départ",
  PURGE: "Purge des journaux",
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

function estJourOuvre(date: Date): boolean {
  const jour = date.getDay();
  return jour !== 0 && jour !== 6;
}

function creneauxDuJour(tache: NomTache, jour: Date): Date[] {
  if (tache === "ABSENCES" && !estJourOuvre(jour)) return [];
  const liste = tache === "ABSENCES" ? CRENEAUX_ABSENCES : CRENEAUX_PURGE;
  return liste.map(([h, m]) => new Date(jour.getFullYear(), jour.getMonth(), jour.getDate(), h, m, 0, 0));
}

/** Créneau planifié le plus récent ≤ `now` (jamais plus de 8 jours en arrière pour une tâche à créneaux fixes). */
export function dernierCreneau(tache: NomTache, now: Date): Date | null {
  if (tache === "RELANCES_JUSTIFICATION") {
    const d = new Date(now);
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() - (d.getMinutes() % INTERVALLE_RELANCES_MINUTES));
    return d;
  }
  for (let retour = 0; retour <= 8; retour++) {
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
  for (let avant = 0; avant <= 8; avant++) {
    const jour = new Date(now.getFullYear(), now.getMonth(), now.getDate() + avant);
    const suivant = creneauxDuJour(tache, jour).find((c) => c > now);
    if (suivant) return suivant;
  }
  // Inatteignable (au plus un week-end à franchir) ; valeur de repli sûre.
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
 * - absences / purge : le dernier créneau est passé de plus de 30 minutes sans exécution réussie depuis.
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
  }
}
