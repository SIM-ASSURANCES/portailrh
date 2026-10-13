// Soumission au DG : phrases affichées à l'écran quand un bouton est grisé (lot 2, 2026-10-13).
// AUCUNE règle métier ici : chaque phrase vient du moteur (`transition`, `raisonLigneNonSoumettable`) ou en est une
// reformulation lisible. Le contrôle serveur (`soumettreLignesAuDG`) reste la seule autorité.

import {
  attendValidationPourExecution,
  estExecutantFinance,
  etatLigneDG,
  MESSAGE_ATTENTE_VALIDATION_FINALE,
  raisonLigneNonSoumettable,
  transition,
  type ActeurCircuit,
  type DemandeCircuit,
  type LigneCircuit,
} from "./circuitDemande";

export const PERMISSION_SOUMETTRE_DG = "treso.soumettre_dg";

export const MESSAGE_PERMISSION_SOUMETTRE_DG =
  "Votre rôle n'a pas la permission de soumettre au DG. Contactez un administrateur.";

export const MESSAGE_ARTICLE_SANS_CATEGORIE_DG = "Catégorisez cet article avant de le soumettre au DG.";

/** Demande émise par la Finance : le DG la décide d'office (étape DG obligatoire). */
export const MESSAGE_DG_DECIDE_D_OFFICE =
  "Cette demande a été émise par la Finance : le DG la décide d'office, aucune soumission n'est nécessaire.";

/** Demande émise par le DG : pas d'étape DG, la Finance décide. */
export const MESSAGE_SOUMISSION_DG_NON_REQUISE =
  "Cette demande a été émise par le DG : la soumission au DG n'est pas requise, la Finance la décide.";

export const MESSAGE_BANDEAU_ETAPE_DG =
  "Des articles de cette demande attendent la décision du DG. Les autres articles ne sont pas bloqués : " +
  "vous pouvez les décider, ou en soumettre d'autres au DG.";

export const MESSAGE_COCHER_UN_ARTICLE = "Cochez au moins un article.";

export const MESSAGE_AUCUN_ARTICLE_SOUMETTABLE =
  "Aucun article ne peut être soumis pour l'instant : catégorisez-les, ou ils sont déjà soumis ou décidés.";

/** Portée du bouton : un ou plusieurs articles d'une demande à lignes, ou la demande entière. */
export type PorteeSoumissionDG = "LIGNES" | "DEMANDE";

/**
 * Pourquoi la Finance ne peut pas soumettre au DG, pour la DEMANDE (indépendamment de l'article choisi) ; `null` si
 * elle le peut. Ordre : assistant en attente → mode imposé par le demandeur → permission absente → phrase du moteur.
 */
export function raisonSoumissionDemande(
  demande: DemandeCircuit,
  acteur: ActeurCircuit,
  portee: PorteeSoumissionDG
): string | null {
  const aLaPermission = acteur.permissions.includes(PERMISSION_SOUMETTRE_DG);
  if (!aLaPermission && estExecutantFinance(acteur.permissions) && attendValidationPourExecution(demande)) {
    return MESSAGE_ATTENTE_VALIDATION_FINALE;
  }
  if (demande.modeEtapeDG === "OBLIGATOIRE") return MESSAGE_DG_DECIDE_D_OFFICE;
  if (demande.modeEtapeDG === "NON_REQUISE") return MESSAGE_SOUMISSION_DG_NON_REQUISE;
  if (!aLaPermission) return MESSAGE_PERMISSION_SOUMETTRE_DG;

  const r =
    portee === "DEMANDE"
      ? transition(demande, acteur, { type: "SOUMETTRE_DG" })
      : // Un article fictif soumettable : seules les raisons propres à la demande (étape, auteur…) subsistent.
        transition(
          { ...demande, lignes: [...(demande.lignes ?? []), ARTICLE_SONDE] },
          acteur,
          { type: "SOUMETTRE_LIGNES_DG", ligneIds: [ARTICLE_SONDE.id] }
        );
  return r.ok ? null : r.message;
}

const ARTICLE_SONDE: LigneCircuit = {
  id: "__sonde__",
  libelle: "",
  categorisee: true,
  statut: "EN_ATTENTE",
  soumiseAuDG: false,
  decisionDG: null,
  decisionDGParId: null,
};

/** Pourquoi CET article ne peut pas être soumis (la raison de la demande l'emporte) ; `null` s'il le peut. */
export function raisonSoumissionArticle(ligne: LigneCircuit, raisonDemande: string | null): string | null {
  if (raisonDemande) return raisonDemande;
  const raison = raisonLigneNonSoumettable(ligne);
  if (!raison) return null;
  const etat = etatLigneDG(ligne);
  if (!ligne.categorisee && ligne.statut === "EN_ATTENTE" && (etat === "NON_SOUMISE" || etat === "REFUSEE_DG")) {
    return MESSAGE_ARTICLE_SANS_CATEGORIE_DG;
  }
  return raison;
}

/** Phrase sous le bouton global « Soumettre au DG » quand il est grisé ; `null` s'il est actif. */
export function raisonBoutonGlobalSoumission(
  raisonDemande: string | null,
  lignes: readonly LigneCircuit[],
  nombreCochees: number
): string | null {
  if (raisonDemande) return raisonDemande;
  if (!lignes.some((l) => raisonLigneNonSoumettable(l) === null)) return MESSAGE_AUCUN_ARTICLE_SOUMETTABLE;
  if (nombreCochees === 0) return MESSAGE_COCHER_UN_ARTICLE;
  return null;
}

/**
 * Bandeau en tête de la liste quand des articles attendent le DG ; sinon `null`. Lot B : la demande n'est plus bloquée
 * pendant ce temps (la Finance décide les autres articles) — l'étape n'entre plus dans la règle, seul compte l'état des
 * articles ; `etape` est conservé pour les appelants, sauf Service / correction / abandon où rien ne se passe.
 */
export function bandeauEtapeDG(etape: string, lignes: readonly LigneCircuit[]): string | null {
  if (etape === "SERVICE" || etape === "A_CORRIGER" || etape === "ABANDONNEE") return null;
  return lignes.some((l) => etatLigneDG(l) === "EN_ATTENTE_DG") ? MESSAGE_BANDEAU_ETAPE_DG : null;
}
