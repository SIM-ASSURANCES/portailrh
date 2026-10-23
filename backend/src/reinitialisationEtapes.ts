/**
 * Étapes de la remise à zéro de mise en production depuis l'application (lots R et S) — LOGIQUE PURE, testée.
 *
 * Trois étapes, dans cet ordre, chacune possible seulement quand la précédente est faite (par le MÊME compte, dans une
 * fenêtre de `VALIDITE_ETAPES_MS`) :
 *   a) SIMULATION : décompte de ce qui sera supprimé / conservé (rien n'est écrit, hormis une trace d'audit) ;
 *   b) SAUVEGARDE : JSON de ce qui sera supprimé, avec son empreinte SHA-256 ;
 *   c) PURGE      : phrase REINITIALISER, même code que la ligne de commande, une seule transaction, verrou posé.
 * L'état (faite ou non) est LU DANS L'HISTORIQUE D'AUDIT par le serveur : un appel direct d'une action sans passer par les
 * étapes précédentes est refusé, quoi que l'interface affiche.
 *
 * VERROU DÉFINITIF (lot S) : une fois la purge faite, le verrou (ligne `ReinitialisationSysteme`) interdit côté serveur TOUTE
 * simulation, sauvegarde et purge, quelle que soit la permission. Il n'existe AUCUNE action pour le lever dans l'application :
 * seul un UPDATE SQL le lève (docs/mise-en-production.md, § 10).
 */
import { CONFIRMATION_REINITIALISATION_CONSTANTE } from "./reinitialisationConstantes";

export { CONFIRMATION_REINITIALISATION_CONSTANTE as PHRASE_PURGE } from "./reinitialisationConstantes";

/** Une étape faite reste valable ce temps (une simulation ou une sauvegarde ancienne ne décrit plus les données). */
export const VALIDITE_ETAPES_MS = 4 * 60 * 60 * 1000;

/** La remise à zéro enregistrée qui porte le verrou : de quoi écrire le message d'état. */
export interface InfoVerrou {
  effectueeAt: Date;
  /** Nom complet du compte qui a purgé. */
  par: string;
}

const dateVerrou = (d: Date) => d.toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" });

/** Phrase affichée à la place du bouton quand le verrou est actif. */
export function phraseVerrouEcran(info: InfoVerrou): string {
  return `Remise à zéro effectuée le ${dateVerrou(info.effectueeAt)} par ${info.par}. Fonction verrouillée.`;
}

/** Message de REFUS renvoyé par le serveur (simulation, sauvegarde, purge) tant que le verrou est actif. */
export function messageVerrouActif(info: InfoVerrou | null): string {
  const qui = info ? ` le ${dateVerrou(info.effectueeAt)} par ${info.par}` : "";
  return `Remise à zéro déjà effectuée${qui} : la fonction est verrouillée. Elle ne peut plus être simulée, sauvegardée ni exécutée depuis l'application, quelle que soit la permission. Seul un UPDATE SQL peut lever le verrou (docs/mise-en-production.md, § 10).`;
}

export type IdEtape = "SIMULATION" | "SAUVEGARDE" | "PURGE";
export type StatutEtape = "FAITE" | "ACTIVE" | "BLOQUEE" | "NON_APPLICABLE";

export interface EtatEtapes {
  /** Le verrou de réinitialisation est actif maintenant : toutes les étapes sont refusées. */
  verrouActif: boolean;
  /** Simulation faite par ce compte dans la fenêtre. */
  simulationFaite: boolean;
  /** Sauvegarde générée par ce compte dans la fenêtre (empreinte connue du serveur). */
  sauvegardeFaite: boolean;
}

export interface LigneEtape {
  id: IdEtape;
  titre: string;
  statut: StatutEtape;
  /** Raison affichée quand l'étape est bloquée ou sans objet. */
  raison: string | null;
}

export const TITRE_ETAPE: Record<IdEtape, string> = {
  SIMULATION: "Étape 1 — Simulation",
  SAUVEGARDE: "Étape 2 — Sauvegarde",
  PURGE: "Étape 3 — Remise à zéro",
};

const RAISON_SIMULATION = "Faites d'abord la simulation (étape 1).";
const RAISON_SAUVEGARDE = "Téléchargez d'abord la sauvegarde (étape 2).";
const RAISON_VERROU = messageVerrouActif(null);

/** Statut de chaque étape, dans l'ordre. Verrou actif : tout est bloqué, avec la raison du verrou. */
export function lignesEtapes(etat: EtatEtapes): LigneEtape[] {
  const ligne = (id: IdEtape, statut: StatutEtape, raison: string | null = null): LigneEtape => ({
    id,
    titre: TITRE_ETAPE[id],
    statut,
    raison,
  });
  if (etat.verrouActif) {
    return [
      ligne("SIMULATION", "BLOQUEE", RAISON_VERROU),
      ligne("SAUVEGARDE", "BLOQUEE", RAISON_VERROU),
      ligne("PURGE", "BLOQUEE", RAISON_VERROU),
    ];
  }
  const sim = etat.simulationFaite;
  const sauv = sim && etat.sauvegardeFaite;
  return [
    ligne("SIMULATION", sim ? "FAITE" : "ACTIVE"),
    ligne("SAUVEGARDE", !sim ? "BLOQUEE" : etat.sauvegardeFaite ? "FAITE" : "ACTIVE", !sim ? RAISON_SIMULATION : null),
    ligne("PURGE", sauv ? "ACTIVE" : "BLOQUEE", sauv ? null : !sim ? RAISON_SIMULATION : RAISON_SAUVEGARDE),
  ];
}

export function sauvegardeValide(empreinte: string | null | undefined): empreinte is string {
  return typeof empreinte === "string" && /^[0-9a-f]{64}$/.test(empreinte);
}

/** Refus de simuler (étape 1) : le verrou, s'il est actif, l'interdit. */
export function refusSimulation(etat: EtatEtapes, info: InfoVerrou | null = null): string | null {
  return etat.verrouActif ? messageVerrouActif(info) : null;
}

/** Refus de télécharger la sauvegarde (étape 2) : le verrou d'abord, puis la simulation doit précéder. */
export function refusSauvegarde(etat: EtatEtapes, info: InfoVerrou | null = null): string | null {
  if (etat.verrouActif) return messageVerrouActif(info);
  return etat.simulationFaite ? null : RAISON_SIMULATION;
}

/**
 * Refus de la purge (étape 3), ou `null`.
 * `empreinteSauvegardee` : empreinte de la dernière sauvegarde tracée pour ce compte ; la purge exige que l'empreinte
 * transmise soit exactement celle-là (le fichier a donc bien été généré par le serveur pour ce compte).
 */
export function refusPurge(
  etat: EtatEtapes,
  saisie: { phrase: string | null | undefined; empreinte: string | null | undefined; empreinteSauvegardee: string | null | undefined },
  info: InfoVerrou | null = null
): string | null {
  if (etat.verrouActif) return messageVerrouActif(info);
  if (!etat.simulationFaite) return RAISON_SIMULATION;
  if (!etat.sauvegardeFaite || !sauvegardeValide(saisie.empreinteSauvegardee)) return RAISON_SAUVEGARDE;
  if (!sauvegardeValide(saisie.empreinte) || saisie.empreinte !== saisie.empreinteSauvegardee) {
    return "La sauvegarde transmise ne correspond pas à celle que vous avez téléchargée dans cette session : téléchargez-la de nouveau (étape 2).";
  }
  if (saisie.phrase !== CONFIRMATION_REINITIALISATION_CONSTANTE) {
    return `Tapez exactement « ${CONFIRMATION_REINITIALISATION_CONSTANTE} » pour confirmer.`;
  }
  return null;
}

/** Début de la fenêtre de validité des étapes : la plus récente entre `maintenant − VALIDITE` et la dernière purge. */
export function debutFenetre(maintenant: Date, dernierePurgeAt: Date | null): Date {
  const base = new Date(maintenant.getTime() - VALIDITE_ETAPES_MS);
  return dernierePurgeAt && dernierePurgeAt > base ? dernierePurgeAt : base;
}
