// Gestion Compta, lot GC-7d — RELANCES ET PROMESSES DE PAIEMENT (option A de la question Q10, PROVISOIRE : AUCUN SMS ni e-mail n'est envoyé
// par l'application). Elle enregistre une relance faite HORS de l'application et suit les promesses de paiement. MOTEUR PUR : aucune base,
// aucune horloge (la date du jour est un paramètre AAAA-MM-JJ).
//
// Pour ajouter plus tard un envoi automatique (Q10, option B) sans refaire le modèle : `CptRelance.origine` distingue déjà une relance
// MANUELLE (enregistrée par une personne) d'une relance AUTOMATIQUE (écrite par un futur envoi), et `canal` couvre déjà SMS et e-mail.

import { enCentimesEcheancier } from "./cptEcheancier";
import { lireMontant } from "./montant";

export const CANAUX_RELANCE_CPT = ["TELEPHONE", "SMS", "VISITE", "EMAIL"] as const;
export type CanalRelanceCpt = (typeof CANAUX_RELANCE_CPT)[number];
export const LIBELLE_CANAL_RELANCE_CPT: Record<CanalRelanceCpt, string> = { TELEPHONE: "Téléphone", SMS: "SMS", VISITE: "Visite", EMAIL: "E-mail" };

export const STATUTS_PROMESSE_CPT = ["EN_COURS", "TENUE", "NON_TENUE"] as const;
export type StatutPromesseCpt = (typeof STATUTS_PROMESSE_CPT)[number];
export const LIBELLE_STATUT_PROMESSE_CPT: Record<StatutPromesseCpt, string> = { EN_COURS: "En cours", TENUE: "Tenue", NON_TENUE: "Non tenue" };

export const COMMENTAIRE_RELANCE_MAX_CPT = 500;

export type ErreursRelanceCpt = Record<string, string>;
export type ResultatRelanceCpt<T> = { ok: true; valeur: T } | { ok: false; erreurs: ErreursRelanceCpt };

const FORMAT_JOUR = /^\d{4}-\d{2}-\d{2}$/;
function jourValide(t: unknown): t is string {
  if (typeof t !== "string" || !FORMAT_JOUR.test(t)) return false;
  const d = new Date(`${t}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t;
}

export interface SaisieRelanceCpt {
  canal: unknown;
  faiteLe: unknown;
  commentaire: unknown;
}
export interface RelanceValideeCpt {
  canal: CanalRelanceCpt;
  faiteLe: string;
  commentaire: string | null;
}

/** Contrôles d'une relance faite hors de l'application : canal connu, date valide et jamais dans le futur, commentaire de 500 caractères au plus. */
export function validerRelanceCpt(saisie: SaisieRelanceCpt, aujourdhui: string): ResultatRelanceCpt<RelanceValideeCpt> {
  const erreurs: ErreursRelanceCpt = {};
  const canal = CANAUX_RELANCE_CPT.find((c) => c === saisie.canal);
  if (!canal) erreurs.canal = "Choisissez le canal de la relance.";
  if (!jourValide(saisie.faiteLe)) erreurs.faiteLe = "Date de la relance invalide.";
  else if (saisie.faiteLe > aujourdhui) erreurs.faiteLe = "Une relance ne peut pas être datée dans le futur.";
  const commentaire = typeof saisie.commentaire === "string" ? saisie.commentaire.replace(/\s+/g, " ").trim() : "";
  if (commentaire.length > COMMENTAIRE_RELANCE_MAX_CPT) erreurs.commentaire = `Commentaire trop long (${COMMENTAIRE_RELANCE_MAX_CPT} caractères au plus).`;
  if (Object.keys(erreurs).length > 0 || !canal) return { ok: false, erreurs };
  return { ok: true, valeur: { canal, faiteLe: saisie.faiteLe as string, commentaire: commentaire || null } };
}

export interface SaisiePromesseCpt {
  montant: unknown;
  datePromise: unknown;
}
export interface PromesseValideeCpt {
  /** Centimes entiers. */
  montant: bigint;
  datePromise: string;
}

/**
 * Contrôles d'une promesse : montant > 0 (deux décimales au plus, FCFA) qui ne dépasse pas le reste dû du périmètre (`resteDu`, en centimes :
 * on ne promet pas plus que la dette), date promise valide, jamais dans le passé (aujourd'hui accepté).
 */
export function validerPromesseCpt(saisie: SaisiePromesseCpt, aujourdhui: string, resteDu: bigint): ResultatRelanceCpt<PromesseValideeCpt> {
  const erreurs: ErreursRelanceCpt = {};
  const lu = lireMontant(saisie.montant, { devise: "XOF" });
  let montant = BigInt(0);
  if (!lu.ok) erreurs.montant = lu.message;
  else {
    const c = enCentimesEcheancier(lu.canonique);
    montant = c ?? BigInt(0);
    if (montant <= BigInt(0)) erreurs.montant = "Le montant promis doit être supérieur à zéro.";
    else if (montant > resteDu) erreurs.montant = "Le montant promis dépasse le reste dû.";
  }
  if (!jourValide(saisie.datePromise)) erreurs.datePromise = "Date promise invalide.";
  else if (saisie.datePromise < aujourdhui) erreurs.datePromise = "La date promise ne peut pas être dans le passé.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, valeur: { montant, datePromise: saisie.datePromise as string } };
}

export interface EntreeEvaluationPromesseCpt {
  /** Centimes promis. */
  montant: bigint;
  datePromise: string;
  /** Encaissé PROUVÉ (rattachements validés) sur le périmètre de la promesse, dont la date de valeur est comprise entre la création de la promesse et la date promise. */
  prouve: bigint;
}

/**
 * Règle (C-21, provisoire) : TENUE dès que l'encaissé prouvé atteint le montant promis (même avant la date) ; NON TENUE quand la date promise
 * est dépassée (strictement) sans que ce montant soit atteint ; sinon EN COURS. Jamais décidée à la main : c'est cette règle qui fait foi.
 */
export function evaluerPromesseCpt(e: EntreeEvaluationPromesseCpt, aujourdhui: string): StatutPromesseCpt {
  if (e.prouve >= e.montant) return "TENUE";
  if (aujourdhui > e.datePromise) return "NON_TENUE";
  return "EN_COURS";
}

/**
 * « Relance proposée » (jamais envoyée) : le débiteur a au moins une échéance en retard ET aucune promesse en cours (une promesse en cours
 * laisse au débiteur le temps de payer). `derniereRelance` (AAAA-MM-JJ) n'est qu'une information affichée à côté.
 */
export function relanceProposeeAvecPromessesCpt(entree: { nbEcheancesEnRetard: number; nbPromessesEnCours: number }): boolean {
  return entree.nbEcheancesEnRetard > 0 && entree.nbPromessesEnCours === 0;
}
