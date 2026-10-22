/**
 * Étapes de la remise à zéro de mise en production depuis l'application (lot R) — LOGIQUE PURE, testée.
 *
 * Quatre étapes, dans cet ordre, chacune possible seulement quand la précédente est faite (par le MÊME compte, dans une
 * fenêtre de `VALIDITE_ETAPES_MS`) :
 *   a) SIMULATION   : décompte de ce qui sera supprimé / conservé (rien n'est écrit, hormis une trace d'audit) ;
 *   b) SAUVEGARDE   : JSON de ce qui sera supprimé, avec son empreinte SHA-256 ;
 *   c) LEVEE_VERROU : seulement si un verrou de réinitialisation est actif (une purge a déjà eu lieu) ;
 *   d) PURGE        : phrase REINITIALISER, même code que la ligne de commande, une seule transaction, verrou reposé.
 * L'état (faite ou non) est LU DANS L'HISTORIQUE D'AUDIT par le serveur : un appel direct d'une action sans passer par les
 * étapes précédentes est refusé, quoi que l'interface affiche.
 */
import { CONFIRMATION_REINITIALISATION_CONSTANTE } from "./reinitialisationConstantes";

export { CONFIRMATION_REINITIALISATION_CONSTANTE as PHRASE_PURGE } from "./reinitialisationConstantes";

/** Phrase à taper pour lever le verrou. */
export const PHRASE_LEVEE_VERROU = "LEVER LE VERROU";
/** Motif de levée : trace durable, assez explicite pour être relue. */
export const MOTIF_LEVEE_MIN = 10;
export const MOTIF_LEVEE_MAX = 300;
/** Une étape faite reste valable ce temps (une simulation ou une sauvegarde ancienne ne décrit plus les données). */
export const VALIDITE_ETAPES_MS = 4 * 60 * 60 * 1000;

export type IdEtape = "SIMULATION" | "SAUVEGARDE" | "LEVEE_VERROU" | "PURGE";
export type StatutEtape = "FAITE" | "ACTIVE" | "BLOQUEE" | "NON_APPLICABLE";

export interface EtatEtapes {
  /** Un verrou de réinitialisation est actif maintenant. */
  verrouActif: boolean;
  /** Simulation faite par ce compte dans la fenêtre. */
  simulationFaite: boolean;
  /** Sauvegarde générée par ce compte dans la fenêtre (empreinte connue du serveur). */
  sauvegardeFaite: boolean;
  /** Le verrou a été levé par ce compte dans la fenêtre (et n'est plus actif). */
  verrouLeveDansLeFlux: boolean;
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
  LEVEE_VERROU: "Étape 3 — Levée du verrou",
  PURGE: "Étape 4 — Remise à zéro",
};

const RAISON_SIMULATION = "Faites d'abord la simulation (étape 1).";
const RAISON_SAUVEGARDE = "Téléchargez d'abord la sauvegarde (étape 2).";
const RAISON_LEVEE = "Le verrou de réinitialisation est actif : levez-le d'abord (étape 3).";

/** Statut de chaque étape, dans l'ordre. */
export function lignesEtapes(etat: EtatEtapes): LigneEtape[] {
  const sim = etat.simulationFaite;
  const sauv = sim && etat.sauvegardeFaite;
  const ligne = (id: IdEtape, statut: StatutEtape, raison: string | null = null): LigneEtape => ({
    id,
    titre: TITRE_ETAPE[id],
    statut,
    raison,
  });

  const lignes: LigneEtape[] = [];
  lignes.push(ligne("SIMULATION", sim ? "FAITE" : "ACTIVE"));
  lignes.push(ligne("SAUVEGARDE", !sim ? "BLOQUEE" : etat.sauvegardeFaite ? "FAITE" : "ACTIVE", !sim ? RAISON_SIMULATION : null));

  if (etat.verrouActif) {
    lignes.push(ligne("LEVEE_VERROU", sauv ? "ACTIVE" : "BLOQUEE", sauv ? null : !sim ? RAISON_SIMULATION : RAISON_SAUVEGARDE));
  } else if (etat.verrouLeveDansLeFlux) {
    lignes.push(ligne("LEVEE_VERROU", "FAITE"));
  } else {
    lignes.push(ligne("LEVEE_VERROU", "NON_APPLICABLE", "Aucun verrou de réinitialisation : cette étape ne s'applique pas."));
  }

  const peutPurger = sauv && !etat.verrouActif;
  lignes.push(
    ligne("PURGE", peutPurger ? "ACTIVE" : "BLOQUEE", peutPurger ? null : !sim ? RAISON_SIMULATION : !etat.sauvegardeFaite ? RAISON_SAUVEGARDE : RAISON_LEVEE)
  );
  return lignes;
}

/** Motif de levée nettoyé (espaces réduits), ou `null` s'il est trop court ou trop long. */
export function motifLeveeValide(brut: string | null | undefined): string | null {
  const m = (brut ?? "").replace(/\s+/g, " ").trim();
  return m.length >= MOTIF_LEVEE_MIN && m.length <= MOTIF_LEVEE_MAX ? m : null;
}

export function sauvegardeValide(empreinte: string | null | undefined): empreinte is string {
  return typeof empreinte === "string" && /^[0-9a-f]{64}$/.test(empreinte);
}

/** Refus de télécharger la sauvegarde (étape 2) : la simulation doit précéder. */
export function refusSauvegarde(etat: EtatEtapes): string | null {
  return etat.simulationFaite ? null : RAISON_SIMULATION;
}

/** Refus de lever le verrou (étape 3), ou `null`. L'ordre des tests est celui des étapes. */
export function refusLeveeVerrou(
  etat: EtatEtapes,
  saisie: { phrase: string | null | undefined; motif: string | null | undefined }
): string | null {
  if (!etat.verrouActif) return "Aucun verrou de réinitialisation n'est actif : rien à lever.";
  if (!etat.simulationFaite) return RAISON_SIMULATION;
  if (!etat.sauvegardeFaite) return RAISON_SAUVEGARDE;
  if (saisie.phrase !== PHRASE_LEVEE_VERROU) return `Tapez exactement « ${PHRASE_LEVEE_VERROU} » pour confirmer.`;
  if (!motifLeveeValide(saisie.motif)) return `Le motif est obligatoire (${MOTIF_LEVEE_MIN} à ${MOTIF_LEVEE_MAX} caractères).`;
  return null;
}

/**
 * Refus de la purge (étape 4), ou `null`.
 * `empreinteSauvegardee` : empreinte de la dernière sauvegarde tracée pour ce compte ; la purge exige que l'empreinte
 * transmise soit exactement celle-là (le fichier a donc bien été généré par le serveur pour ce compte).
 */
export function refusPurge(
  etat: EtatEtapes,
  saisie: { phrase: string | null | undefined; empreinte: string | null | undefined; empreinteSauvegardee: string | null | undefined }
): string | null {
  if (!etat.simulationFaite) return RAISON_SIMULATION;
  if (!etat.sauvegardeFaite || !sauvegardeValide(saisie.empreinteSauvegardee)) return RAISON_SAUVEGARDE;
  if (!sauvegardeValide(saisie.empreinte) || saisie.empreinte !== saisie.empreinteSauvegardee) {
    return "La sauvegarde transmise ne correspond pas à celle que vous avez téléchargée dans cette session : téléchargez-la de nouveau (étape 2).";
  }
  if (etat.verrouActif) return RAISON_LEVEE;
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
