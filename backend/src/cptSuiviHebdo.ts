import { BRANCHES_CPT, type BrancheCpt } from "./cptReferentiels";
import { ajouterJoursCpt, enCentimesEcheancier, joursEntreCpt, texteDepuisCentimes } from "./cptEcheancier";

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

/** Lundi (AAAA-MM-JJ) de la semaine d'un jour donné : la semaine du contrôle hebdomadaire va du lundi au dimanche. */
export function lundiDeLaSemaineCpt(jour: string): string {
  const d = new Date(`${jour}T00:00:00Z`);
  const ecart = (d.getUTCDay() + 6) % 7; // lundi = 0
  return ajouterJoursCpt(jour, -ecart);
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

// ---------- Indicateurs de la semaine (GC-6c) ----------

export interface EcartTechniqueReelCpt {
  /** Premier jour compté (1er janvier de l'année en cours), AAAA-MM-JJ. */
  depuis: string;
  nbContrats: number;
  /** Montants en FCFA au centime, texte décimal. */
  technique: string;
  reel: string;
  /** technique − réel : positif = la production déclare plus que ce que les relevés ont prouvé. */
  ecart: string;
}

/** Premier jour de l'année du jour donné (AAAA-MM-JJ). */
export function debutAnneeCpt(maintenant: Date): string {
  return `${jourTexteCpt(maintenant).slice(0, 4)}-01-01`;
}

/** Écart technique / réel à partir des deux sommes (texte décimal, nul = 0), au centime exact. */
export function ecartTechniqueReelCpt(entree: { depuis: string; nbContrats: number; technique: string | null; reel: string | null }): EcartTechniqueReelCpt {
  const technique = enCentimesEcheancier(entree.technique ?? "0") ?? BigInt(0);
  const reel = enCentimesEcheancier(entree.reel ?? "0") ?? BigInt(0);
  return {
    depuis: entree.depuis,
    nbContrats: entree.nbContrats,
    technique: texteDepuisCentimes(technique),
    reel: texteDepuisCentimes(reel),
    ecart: texteDepuisCentimes(technique - reel),
  };
}

// ---------- Destinataires et messages des paliers ----------

/**
 * Permissions dont les porteurs reçoivent un palier. Relance (7 jours) : ceux qui traitent la ligne — le commercial pour un
 * encaissement sans contrat, la production pour un contrat sans encaissement ; alerte (30 jours) : le RFCRH ; escalade (60 jours) :
 * la direction générale (superviseur, `cpt.trancher_litige`). Aucune permission nouvelle : ce sont celles du plan §6.2 (C-8).
 */
export function permissionsDestinatairesCpt(objet: ObjetControleCpt, palier: PalierCpt): string[] {
  if (palier === "ALERTE") return ["cpt.valider_rattachement"];
  if (palier === "ESCALADE") return ["cpt.trancher_litige"];
  return objet === "ENCAISSEMENT" ? ["cpt.confirmer_rattachement", "cpt.identifier_encaissement"] : ["cpt.importer_production", "cpt.saisir_contrat"];
}

const PRIORITE_PALIER: Record<PalierCpt, "INFO" | "IMPORTANT"> = { RELANCE: "INFO", ALERTE: "IMPORTANT", ESCALADE: "IMPORTANT" };
export const prioritePalierCpt = (palier: PalierCpt) => PRIORITE_PALIER[palier];

const NOM_PALIER: Record<PalierCpt, string> = { RELANCE: "Relance", ALERTE: "Alerte", ESCALADE: "Escalade" };
const REFERENCES_MAX_MESSAGE = 5;

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

export interface MessagePalierCpt {
  titre: string;
  message: string;
}

/**
 * Message groupé d'un palier : une notification par destinataire et par (objet, palier), pas une par ligne (un lundi chargé en
 * produirait des centaines). Aucun nom de personne : seulement les références (numéros CPE ou de police).
 */
export function messagePalierCpt(entree: { objet: ObjetControleCpt; palier: PalierCpt; seuils: SeuilsPaliersCpt; references: readonly string[] }): MessagePalierCpt {
  const total = entree.references.length;
  const jours = seuilDuPalierCpt(entree.palier, entree.seuils);
  const sujet = entree.objet === "ENCAISSEMENT" ? pluriel(total, "encaissement sans contrat", "encaissements sans contrat") : pluriel(total, "contrat déclaré payé sans encaissement", "contrats déclarés payés sans encaissement");
  const vues = entree.references.slice(0, REFERENCES_MAX_MESSAGE).join(", ");
  const reste = total - REFERENCES_MAX_MESSAGE;
  const liste = reste > 0 ? `${vues} et ${pluriel(reste, "autre", "autres")}` : vues;
  const nature = entree.objet === "ENCAISSEMENT" ? "Références" : "Polices";
  return {
    titre: `${NOM_PALIER[entree.palier]} : ${sujet} depuis ${jours} jours ou plus`,
    message: `${nature} : ${liste}. Ouvrez le contrôle hebdomadaire pour traiter ${total > 1 ? "ces lignes" : "cette ligne"}.`,
  };
}

/** Résumé du lundi (tâche COMPTA_CONTROLE_HEBDO) : les chiffres seulement. Nul si rien n'est à signaler. */
export function messageResumeHebdoCpt(entree: { objet: ObjetControleCpt; total: number; relance: number; alerte: number; seuils: SeuilsPaliersCpt }): MessagePalierCpt | null {
  if (entree.total === 0) return null;
  const sujet = entree.objet === "ENCAISSEMENT" ? pluriel(entree.total, "encaissement sans contrat", "encaissements sans contrat") : pluriel(entree.total, "contrat déclaré payé sans encaissement", "contrats déclarés payés sans encaissement");
  return {
    titre: `Contrôle de la semaine : ${sujet}`,
    message: `${sujet} à traiter, dont ${entree.relance} depuis ${entree.seuils.relanceJours} jours ou plus et ${entree.alerte} depuis ${entree.seuils.alerteJours} jours ou plus.`,
  };
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
