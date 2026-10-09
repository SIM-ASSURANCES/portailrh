// Circuit de validation des demandes de Trésorerie (commit 3, 2026-10-06) — moteur PUR, sans accès base.
//
// Étapes : Service (responsable du service du demandeur) → Finance → DG (optionnelle, sur soumission de Finance) →
// décision finale Finance → Terminée (cycle de règlement inchangé). Tout rejet mène à « À corriger » : le demandeur
// corrige et resoumet (le circuit repart de la première étape applicable) ou abandonne.
//
// Règles du demandeur, par ordre de priorité (décisions du 2026-10-06, voir CLAUDE.md) :
//   (a) DG : étape DG non requise, la Finance décide ; approbation de clôture non requise.
//   (b) service Finance, rôle Finance ou rôle Assistant Finance : étapes Service et Finance non requises, le DG
//       décide ligne par ligne et sa décision est finale (elle vaut son approbation de clôture).
//   (c) responsable de service : étape Service non requise.
//   (d) tous les autres : Service puis Finance, DG si Finance soumet.
// Personne ne décide sa propre demande — seule exception : une dépense directe, saisie puis décidée par Finance
// (décision 4, exception tracée dans l'historique).
//
// Ce fichier ne décide QUE des transitions ; la couche base (`circuitDemandeDb.ts`) applique les effets.

// Types des enums Prisma (`EtapeCircuit`, `ModeEtapeDG`, `NiveauRejet`, voir schema.prisma) : import de TYPE seul,
// le moteur reste pur et sûr pour un Client Component.
import type { EtapeCircuit, ModeEtapeDG } from "./generated/prisma/enums";

/**
 * Une validation du DG à l'étape DG vaut son approbation de clôture (`validationCompleteParDG`). Règle posée À UN
 * SEUL ENDROIT pour pouvoir l'inverser : passer à `false` et l'étape DG ne débloque plus la clôture (le DG passe
 * alors par la file « Validations complètes en attente », comme pour une demande jamais soumise).
 */
export const DECISION_DG_VAUT_APPROBATION_CLOTURE = true;

/**
 * Soumission au DG ligne par ligne (2026-10-10, règle 5) : la décision finale vaut approbation de clôture du DG
 * seulement si TOUTES les lignes finalement validées l'ont été par le DG ; sinon le DG approuve la clôture à la fin
 * (file « Validations complètes en attente »). Règle posée À UN SEUL ENDROIT (`approbateurClotureParLignesDG`) :
 * passer à `false` pour qu'une seule ligne validée par le DG suffise.
 */
export const APPROBATION_CLOTURE_SI_TOUTES_LIGNES_VALIDEES_PAR_DG = true;

/**
 * Permissions de décision du circuit, JAMAIS délégables (décision 9 du 2026-10-06) : l'octroi est refusé
 * (`accorderDelegationAction`) et une délégation existante n'est jamais comptée (`getSession`). Pas de suppléant
 * pour un responsable absent : l'Admin change le responsable du service.
 */
export const PERMISSIONS_DECISION_NON_DELEGABLES: readonly string[] = [
  "treso.decider_finance",
  "treso.soumettre_dg",
  "treso.decider_dg",
  "treso.approuver_validation_complete",
];

/** Permissions du RÔLE du demandeur (jamais celles reçues par délégation) et son rattachement. */
export interface ProfilDemandeur {
  /** Rôle portant `treso.decider_dg`. */
  estDG: boolean;
  /** Service « Finance », ou rôle portant `treso.decider_finance` (Finance) ou `treso.effectuer_reglement` /
   *  `treso.receptionner_retour` (Assistant Finance). */
  estFinance: boolean;
  /** Responsable du service auquel il appartient. */
  estResponsableDeSonService: boolean;
}

export type TypeDemandeCircuit = "STANDARD" | "DEPENSE_DIRECTE";

export type CasDemandeur = "DG" | "FINANCE" | "RESPONSABLE" | "AUTRE" | "DEPENSE_DIRECTE" | "DEPENSE_DIRECTE_POUR_SOI";

/** Options du parcours : une dépense directe dont le bénéficiaire est son auteur (garde 9, 2026-10-07). */
export interface OptionsParcours {
  beneficiaireEstLeCreateur?: boolean;
}

/** Parcours figé à la soumission (recalculé à chaque resoumission). */
export interface Parcours {
  cas: CasDemandeur;
  etapeServiceRequise: boolean;
  etapeFinanceRequise: boolean;
  modeEtapeDG: ModeEtapeDG;
  /** Demande émise par le DG : l'approbation de clôture n'est pas demandée (décision 3). */
  approbationClotureNonRequise: boolean;
}

export function casDemandeur(profil: ProfilDemandeur, type: TypeDemandeCircuit, options: OptionsParcours = {}): CasDemandeur {
  // Garde 9 : la Finance qui saisit une dépense directe pour elle-même ne la décide pas — le DG, comme le cas (b).
  if (type === "DEPENSE_DIRECTE") return options.beneficiaireEstLeCreateur ? "DEPENSE_DIRECTE_POUR_SOI" : "DEPENSE_DIRECTE";
  if (profil.estDG) return "DG";
  if (profil.estFinance) return "FINANCE";
  if (profil.estResponsableDeSonService) return "RESPONSABLE";
  return "AUTRE";
}

export function determinerParcours(profil: ProfilDemandeur, type: TypeDemandeCircuit, options: OptionsParcours = {}): Parcours {
  const cas = casDemandeur(profil, type, options);
  switch (cas) {
    case "DEPENSE_DIRECTE_POUR_SOI":
      return { cas, etapeServiceRequise: false, etapeFinanceRequise: false, modeEtapeDG: "OBLIGATOIRE", approbationClotureNonRequise: false };
    case "DEPENSE_DIRECTE":
      // Décision 6 : départ à l'étape Finance, Service non requise, Finance peut soumettre au DG.
      return { cas, etapeServiceRequise: false, etapeFinanceRequise: true, modeEtapeDG: "OPTIONNELLE", approbationClotureNonRequise: false };
    case "DG":
      // (a) La Finance décide ; l'étape Service reste due si le DG n'est pas responsable de son propre service.
      return {
        cas,
        etapeServiceRequise: !profil.estResponsableDeSonService,
        etapeFinanceRequise: true,
        modeEtapeDG: "NON_REQUISE",
        approbationClotureNonRequise: true,
      };
    case "FINANCE":
      return { cas, etapeServiceRequise: false, etapeFinanceRequise: false, modeEtapeDG: "OBLIGATOIRE", approbationClotureNonRequise: false };
    case "RESPONSABLE":
      return { cas, etapeServiceRequise: false, etapeFinanceRequise: true, modeEtapeDG: "OPTIONNELLE", approbationClotureNonRequise: false };
    case "AUTRE":
      return { cas, etapeServiceRequise: true, etapeFinanceRequise: true, modeEtapeDG: "OPTIONNELLE", approbationClotureNonRequise: false };
  }
}

/** Première étape applicable (création et resoumission après correction — décision 2). */
export function etapeInitiale(p: Pick<Parcours, "etapeServiceRequise" | "etapeFinanceRequise">): EtapeCircuit {
  if (p.etapeServiceRequise) return "SERVICE";
  if (p.etapeFinanceRequise) return "FINANCE";
  return "DG";
}

/** État d'une ligne d'article vis-à-vis du DG (soumission ligne par ligne, 2026-10-10). */
export type EtatLigneDG = "NON_SOUMISE" | "EN_ATTENTE_DG" | "VALIDEE_DG" | "REFUSEE_DG";

/** Ligne d'article telle que le circuit la lit (sélection des lignes soumises au DG, décision finale). */
export interface LigneCircuit {
  id: string;
  libelle: string;
  /** La ligne porte une catégorie (obligatoire pour la soumettre au DG). */
  categorisee: boolean;
  /** Décision finale de la ligne (`statutValidation`). */
  statut: "EN_ATTENTE" | "VALIDEE" | "REJETEE";
  soumiseAuDG: boolean;
  decisionDG: "VALIDEE" | "REFUSEE" | null;
  decisionDGParId: string | null;
  decisionDGAt?: Date | null;
}

export function etatLigneDG(l: Pick<LigneCircuit, "soumiseAuDG" | "decisionDG">): EtatLigneDG {
  if (!l.soumiseAuDG) return "NON_SOUMISE";
  if (l.decisionDG === "VALIDEE") return "VALIDEE_DG";
  if (l.decisionDG === "REFUSEE") return "REFUSEE_DG";
  return "EN_ATTENTE_DG";
}

export const LIBELLE_ETAT_LIGNE_DG: Record<EtatLigneDG, string> = {
  NON_SOUMISE: "Non soumise au DG",
  EN_ATTENTE_DG: "Soumise au DG — en attente",
  VALIDEE_DG: "Validée par le DG",
  REFUSEE_DG: "Refusée par le DG",
};

/** Phrase du blocage de la décision finale (règle 4). */
export const MESSAGE_LIGNES_EN_ATTENTE_DG =
  "Des lignes soumises attendent la décision du DG : la décision finale est bloquée jusqu'à sa décision.";

/** Pourquoi une ligne ne peut pas être soumise au DG maintenant (case grisée à l'écran) ; `null` si elle le peut. */
export function raisonLigneNonSoumettable(l: LigneCircuit): string | null {
  if (l.statut !== "EN_ATTENTE") return `La ligne « ${l.libelle} » est déjà décidée.`;
  const etat = etatLigneDG(l);
  if (etat === "EN_ATTENTE_DG") return `La ligne « ${l.libelle} » attend déjà la décision du DG.`;
  if (etat === "VALIDEE_DG") return `La ligne « ${l.libelle} » a déjà été validée par le DG.`;
  if (!l.categorisee) return `Catégorisez la ligne « ${l.libelle} » avant de la soumettre au DG.`;
  return null;
}

/**
 * Lignes que la Finance peut soumettre au DG (ou lui resoumettre) : `null` si la sélection est valide, sinon le motif.
 * Une ligne doit être catégorisée, pas encore décidée, ni en attente du DG, ni déjà validée par lui.
 */
export function refusSoumissionLignes(lignes: readonly LigneCircuit[], ligneIds: readonly string[]): string | null {
  if (ligneIds.length === 0) return "Choisissez au moins une ligne à soumettre au DG.";
  if (new Set(ligneIds).size !== ligneIds.length) return "Une ligne est sélectionnée deux fois.";
  const parId = new Map(lignes.map((l) => [l.id, l]));
  for (const id of ligneIds) {
    const l = parId.get(id);
    if (!l) return "Une ligne ne fait pas partie de cette demande.";
    const raison = raisonLigneNonSoumettable(l);
    if (raison) return raison;
  }
  return null;
}

/**
 * Décisions de la décision finale de la Finance face aux décisions du DG (« DG définitif », 2026-10-10) : une ligne
 * validée par le DG reste validée ; une ligne refusée par le DG ne peut qu'être refusée définitivement (ou resoumise au
 * DG avant la décision finale) ; aucune ligne ne peut attendre le DG. `null` si les décisions sont cohérentes.
 */
export function refusDecisionsFinales(
  lignes: readonly LigneCircuit[],
  decisions: readonly { ligneId: string; statut: "VALIDEE" | "REJETEE" }[]
): string | null {
  const decisionParId = new Map(decisions.map((d) => [d.ligneId, d.statut]));
  for (const l of lignes) {
    const etat = etatLigneDG(l);
    const decision = decisionParId.get(l.id);
    if (etat === "EN_ATTENTE_DG") return MESSAGE_LIGNES_EN_ATTENTE_DG;
    if (etat === "VALIDEE_DG" && decision !== "VALIDEE") {
      return `La ligne « ${l.libelle} » a été validée par le DG : elle reste validée.`;
    }
    if (etat === "REFUSEE_DG" && decision !== "REJETEE") {
      return `La ligne « ${l.libelle} » a été refusée par le DG : resoumettez-la au DG ou refusez-la définitivement.`;
    }
  }
  return null;
}

/**
 * Règle 5 (UN SEUL ENDROIT) : à la décision finale, l'approbation de clôture est acquise par les décisions du DG si
 * toutes les lignes finalement validées l'ont été par le DG (`APPROBATION_CLOTURE_SI_TOUTES_LIGNES_VALIDEES_PAR_DG`,
 * ou au moins une si la règle est inversée). Renvoie le DG qui approuve (celui de la dernière validation), sinon `null`
 * (le DG approuvera la clôture à la fin).
 */
export function approbateurClotureParLignesDG(
  lignesFinales: readonly {
    statut: "EN_ATTENTE" | "VALIDEE" | "REJETEE";
    decisionDG: "VALIDEE" | "REFUSEE" | null;
    decisionDGParId: string | null;
    decisionDGAt?: Date | null;
  }[]
): string | null {
  if (!DECISION_DG_VAUT_APPROBATION_CLOTURE) return null;
  const validees = lignesFinales.filter((l) => l.statut === "VALIDEE");
  const parDG = validees.filter((l) => l.decisionDG === "VALIDEE" && l.decisionDGParId);
  if (parDG.length === 0) return null;
  if (APPROBATION_CLOTURE_SI_TOUTES_LIGNES_VALIDEES_PAR_DG && parDG.length !== validees.length) return null;
  const derniere = [...parDG].sort((x, y) => (x.decisionDGAt?.getTime() ?? 0) - (y.decisionDGAt?.getTime() ?? 0)).at(-1)!;
  return derniere.decisionDGParId;
}

export interface DemandeCircuit {
  etape: EtapeCircuit;
  createurId: string;
  typeDemande: TypeDemandeCircuit;
  etapeServiceRequise: boolean;
  etapeFinanceRequise: boolean;
  modeEtapeDG: ModeEtapeDG;
  /** Compte qui a validé à l'étape DG (`Demande.dgApprobateurId`), le cas échéant. */
  approbateurDGId?: string | null;
  /** Compte qui a pris la décision Finance (`Demande.decideurFinanceId`), le cas échéant. */
  decideurFinanceId?: string | null;
  /** Lignes d'articles (soumission au DG ligne par ligne). Absentes : contrôles de lignes non faits. */
  lignes?: readonly LigneCircuit[];
}

/**
 * Une validation complète exige DEUX personnes : le compte qui décide comme Finance et celui qui approuve comme DG
 * (étape DG ou approbation de clôture) sont distincts, et aucun des deux n'est le demandeur (seule exception : la
 * dépense directe, que son auteur Finance décide — décision 6 ; le DG qui l'approuve reste, lui, distinct).
 */
export const MESSAGE_DEUX_PERSONNES =
  "La décision Finance et l'approbation du DG doivent venir de deux personnes différentes.";

/**
 * Approbation de clôture (`approuverValidationCompleteAction`) : `null` si `userId` peut approuver, sinon le motif du
 * refus. Seule règle de cette approbation, avec la permission elle-même.
 */
export function refusApprobationCloture(
  d: { createurId: string; decideurFinanceId: string | null; approbationClotureNonRequise: boolean },
  userId: string
): string | null {
  if (d.approbationClotureNonRequise) return "Demande émise par le DG : son approbation de clôture n'est pas requise.";
  if (userId === d.createurId) return "Vous ne pouvez pas approuver votre propre demande.";
  if (d.decideurFinanceId && userId === d.decideurFinanceId) return MESSAGE_DEUX_PERSONNES;
  return null;
}

export interface ActeurCircuit {
  userId: string;
  /** Permissions effectives (rôle + délégations autorisées) : `treso.decider_finance`, `treso.soumettre_dg`,
   *  `treso.decider_dg`. Ces trois-là ne sont jamais délégables (voir `delegations/actions.ts`). */
  permissions: readonly string[];
  /** Responsable ACTUEL du service du demandeur (`Service.responsableId`). */
  estResponsableServiceDuDemandeur: boolean;
}

export type ActionCircuit =
  | { type: "VALIDER_SERVICE" }
  /** Rejet de la demande entière vers le demandeur (Service, Finance, retour après rejet DG, DG en cas b). */
  | { type: "REJETER"; motif: string }
  | { type: "SOUMETTRE_DG" }
  | { type: "RESOUMETTRE_DG" }
  | { type: "VALIDER_DG" }
  | { type: "REJETER_DG"; motif: string }
  /** Décision ligne par ligne (Finance à l'étape Finance ou de décision finale, DG en cas b). `approbateurClotureId` :
   *  DG dont les validations de lignes valent approbation de clôture (`approbateurClotureParLignesDG`). */
  | { type: "DECIDER_LIGNES"; auMoinsUneValidee: boolean; approbateurClotureId?: string | null }
  /** La Finance soumet des lignes au DG (ou les lui resoumet après un refus). Sans `ligneIds` : contrôle de la demande
   *  seulement (bouton). */
  | { type: "SOUMETTRE_LIGNES_DG"; ligneIds?: readonly string[] }
  /** Le DG décide une ligne soumise. Sans `ligneId` : contrôle de la demande seulement. */
  | { type: "DECIDER_LIGNE_DG"; ligneId?: string; valider: boolean; motif?: string }
  | { type: "RESOUMETTRE_CORRECTION" }
  | { type: "ABANDONNER" };

export type TypeActionCircuit = ActionCircuit["type"];

export interface EffetsTransition {
  /** Niveau du rejet (renvoi en correction ou rejet DG), avec le motif de l'action. */
  niveauRejet?: "SERVICE" | "FINANCE" | "DG";
  /** La décision du DG vaut son approbation de clôture (voir `DECISION_DG_VAUT_APPROBATION_CLOTURE`). */
  approbationClotureParDG?: boolean;
  /** La demande est soumise au DG (étape DG passée ou en cours). */
  soumiseAuDG?: boolean;
  /** Exception tracée : dépense directe décidée par son auteur (décision 4). */
  decisionParAuteurDepenseDirecte?: boolean;
  /** Le parcours doit être recalculé (resoumission après correction). */
  recalculerParcours?: boolean;
  /** L'acteur devient le décideur Finance de la demande (`decideurFinanceId`). */
  decideurFinance?: boolean;
  /** Approbation de clôture acquise par un AUTRE compte que l'acteur (le DG qui a validé les lignes, règle 5). */
  approbateurDGId?: string;
}

export type ResultatTransition =
  | { ok: true; etapeSuivante: EtapeCircuit; effets: EffetsTransition }
  | { ok: false; message: string };

const MOTIF_MIN = 3;

/** Nom d'une étape pour les écrans et l'historique. */
export const LIBELLE_ETAPE_CIRCUIT: Record<EtapeCircuit, string> = {
  SERVICE: "Service",
  FINANCE: "Finance",
  DG: "DG",
  REJET_DG: "Rejet DG",
  DECISION_FINALE: "Décision finale",
  TERMINEE: "Terminée",
  A_CORRIGER: "À corriger",
  ABANDONNEE: "Abandonnée",
};

/** Phrase affichée à qui n'a rien à faire à l'étape courante (boutons grisés, écrans du commit 4). */
export function messageAttente(etape: EtapeCircuit): string {
  switch (etape) {
    case "SERVICE":
      return "En attente de la validation du responsable de service.";
    case "FINANCE":
      return "En attente de la décision de la Finance.";
    case "DG":
      return "En attente de la décision du DG.";
    case "REJET_DG":
      return "Rejetée par le DG : en attente de la Finance (resoumission ou renvoi au demandeur).";
    case "DECISION_FINALE":
      return "En attente de la validation finale de la Finance.";
    case "TERMINEE":
      return "Décision finale prise.";
    case "A_CORRIGER":
      return "Renvoyée au demandeur pour correction.";
    case "ABANDONNEE":
      return "Demande abandonnée par le demandeur.";
  }
}

/** Phrase pour l'Assistant Finance (et toute action d'exécution) avant la décision finale. */
export const MESSAGE_ATTENTE_VALIDATION_FINALE = "En attente de la validation finale.";

/** `true` une fois la décision finale prise : règlement, retours et modification de description par l'Assistant. */
export function decisionFinalePrise(etape: EtapeCircuit): boolean {
  return etape === "TERMINEE";
}

/** Demande encore en route vers la décision finale (ni terminée ni abandonnée) : l'Assistant y attend. */
export function attendDecisionFinale(etape: EtapeCircuit): boolean {
  return !decisionFinalePrise(etape) && etape !== "ABANDONNEE";
}

const a = (acteur: ActeurCircuit, cle: string) => acteur.permissions.includes(cle);

function refus(message: string): ResultatTransition {
  return { ok: false, message };
}

/**
 * Décide si `acteur` peut effectuer `action` sur `demande`, et vers quelle étape elle mène. Aucune écriture :
 * l'appelant applique `etapeSuivante` et `effets`, puis trace l'historique.
 */
export function transition(demande: DemandeCircuit, acteur: ActeurCircuit, action: ActionCircuit): ResultatTransition {
  const estAuteur = acteur.userId === demande.createurId;
  const depenseDirecte = demande.typeDemande === "DEPENSE_DIRECTE";
  // Personne ne décide sa propre demande (sauf dépense directe, décision 4).
  const auteurInterdit = estAuteur && !depenseDirecte;
  const etape = demande.etape;

  const motifInvalide = (motif: string) => motif.trim().length < MOTIF_MIN;
  // Soumission ligne par ligne : demande standard avec lignes, étape DG optionnelle.
  const lignes = demande.lignes ?? [];
  const parLignes = !depenseDirecte && lignes.length > 0 && demande.modeEtapeDG === "OPTIONNELLE";
  const enAttenteDG = lignes.filter((l) => etatLigneDG(l) === "EN_ATTENTE_DG");

  switch (action.type) {
    case "VALIDER_SERVICE":
    case "REJETER": {
      if (action.type === "REJETER" && motifInvalide(action.motif)) {
        return refus(`Le motif du rejet est obligatoire (${MOTIF_MIN} caractères minimum).`);
      }
      if (etape === "SERVICE") {
        if (!acteur.estResponsableServiceDuDemandeur) {
          return refus("Seul le responsable du service du demandeur peut agir à cette étape.");
        }
        if (estAuteur) return refus("Vous ne pouvez pas décider votre propre demande.");
        if (action.type === "VALIDER_SERVICE") {
          return { ok: true, etapeSuivante: demande.etapeFinanceRequise ? "FINANCE" : "DG", effets: {} };
        }
        return { ok: true, etapeSuivante: "A_CORRIGER", effets: { niveauRejet: "SERVICE" } };
      }
      if (action.type === "VALIDER_SERVICE") return refus(messageAttente(etape));
      // REJETER à une autre étape.
      if (etape === "FINANCE" || etape === "REJET_DG" || etape === "DECISION_FINALE") {
        if (!a(acteur, "treso.decider_finance")) return refus("Action non autorisée.");
        if (auteurInterdit) return refus("Vous ne pouvez pas décider votre propre demande.");
        // « DG définitif » : des lignes validées par le DG ne se rejettent plus, la demande entière non plus.
        if (lignes.some((l) => etatLigneDG(l) === "VALIDEE_DG")) {
          return refus(
            "Le DG a validé des lignes de cette demande : refusez définitivement les autres lignes une par une à la décision finale."
          );
        }
        return {
          ok: true,
          etapeSuivante: "A_CORRIGER",
          effets: { niveauRejet: "FINANCE", decisionParAuteurDepenseDirecte: estAuteur && depenseDirecte },
        };
      }
      if (etape === "DG" && demande.modeEtapeDG === "OBLIGATOIRE") {
        if (!a(acteur, "treso.decider_dg")) return refus("Action non autorisée.");
        if (estAuteur) return refus("Vous ne pouvez pas décider votre propre demande.");
        return { ok: true, etapeSuivante: "A_CORRIGER", effets: { niveauRejet: "DG" } };
      }
      return refus(messageAttente(etape));
    }

    case "SOUMETTRE_DG": {
      if (!a(acteur, "treso.soumettre_dg")) return refus("Action non autorisée.");
      if (parLignes) return refus("Choisissez les lignes à soumettre au DG.");
      if (etape === "DECISION_FINALE") return refus("Le DG a déjà approuvé cette demande : reste la décision finale de la Finance.");
      if (etape !== "FINANCE") return refus(messageAttente(etape));
      if (demande.modeEtapeDG !== "OPTIONNELLE") {
        return refus("La soumission au DG n'est pas requise pour cette demande (demande émise par le DG).");
      }
      if (auteurInterdit) return refus("Vous ne pouvez pas soumettre votre propre demande.");
      return { ok: true, etapeSuivante: "DG", effets: { soumiseAuDG: true } };
    }

    case "RESOUMETTRE_DG": {
      if (!a(acteur, "treso.soumettre_dg")) return refus("Action non autorisée.");
      if (etape !== "REJET_DG") return refus("Cette demande n'a pas été rejetée par le DG — rien à resoumettre.");
      if (auteurInterdit) return refus("Vous ne pouvez pas soumettre votre propre demande.");
      return { ok: true, etapeSuivante: "DG", effets: { soumiseAuDG: true } };
    }

    case "VALIDER_DG":
    case "REJETER_DG": {
      if (!a(acteur, "treso.decider_dg")) return refus("Action non autorisée.");
      if (etape !== "DG") return refus(messageAttente(etape));
      if (parLignes) return refus("Le DG décide une par une les lignes que la Finance lui a soumises.");
      if (estAuteur) return refus("Vous ne pouvez pas décider votre propre demande.");
      if (demande.decideurFinanceId && acteur.userId === demande.decideurFinanceId) return refus(MESSAGE_DEUX_PERSONNES);
      if (demande.modeEtapeDG === "OBLIGATOIRE") {
        return refus("Pour cette demande, le DG décide ligne par ligne (sa décision est finale).");
      }
      if (action.type === "VALIDER_DG") {
        return {
          ok: true,
          etapeSuivante: "DECISION_FINALE",
          effets: { approbationClotureParDG: DECISION_DG_VAUT_APPROBATION_CLOTURE },
        };
      }
      if (motifInvalide(action.motif)) return refus(`Le motif du rejet est obligatoire (${MOTIF_MIN} caractères minimum).`);
      return { ok: true, etapeSuivante: "REJET_DG", effets: { niveauRejet: "DG" } };
    }

    case "DECIDER_LIGNES": {
      const suivante: EtapeCircuit = action.auMoinsUneValidee ? "TERMINEE" : "A_CORRIGER";
      // Règle 4 : décision finale bloquée tant qu'une ligne soumise attend le DG.
      if (parLignes && enAttenteDG.length > 0 && a(acteur, "treso.decider_finance")) return refus(MESSAGE_LIGNES_EN_ATTENTE_DG);
      if (etape === "FINANCE" || etape === "DECISION_FINALE") {
        if (!a(acteur, "treso.decider_finance")) return refus("Action non autorisée.");
        if (auteurInterdit) return refus("Vous ne pouvez pas décider votre propre demande.");
        if (demande.approbateurDGId && acteur.userId === demande.approbateurDGId) return refus(MESSAGE_DEUX_PERSONNES);
        // Deux personnes : le DG qui a décidé des lignes ne prend pas la décision Finance.
        if (lignes.some((l) => l.decisionDGParId === acteur.userId)) return refus(MESSAGE_DEUX_PERSONNES);
        const approbateur = action.auMoinsUneValidee ? (action.approbateurClotureId ?? null) : null;
        return {
          ok: true,
          etapeSuivante: suivante,
          effets: {
            ...(action.auMoinsUneValidee ? { decideurFinance: true } : { niveauRejet: "FINANCE" as const }),
            decisionParAuteurDepenseDirecte: estAuteur && depenseDirecte,
            ...(approbateur ? { approbationClotureParDG: true, approbateurDGId: approbateur } : {}),
          },
        };
      }
      if (etape === "DG" && demande.modeEtapeDG === "OBLIGATOIRE") {
        if (!a(acteur, "treso.decider_dg")) return refus("Action non autorisée.");
        if (estAuteur) return refus("Vous ne pouvez pas décider votre propre demande.");
        if (demande.decideurFinanceId && acteur.userId === demande.decideurFinanceId) return refus(MESSAGE_DEUX_PERSONNES);
        return {
          ok: true,
          etapeSuivante: suivante,
          effets: action.auMoinsUneValidee
            ? { approbationClotureParDG: DECISION_DG_VAUT_APPROBATION_CLOTURE }
            : { niveauRejet: "DG" },
        };
      }
      return refus(messageAttente(etape));
    }

    case "SOUMETTRE_LIGNES_DG": {
      if (!a(acteur, "treso.soumettre_dg")) return refus("Action non autorisée.");
      if (!parLignes) {
        return refus(
          demande.modeEtapeDG === "OBLIGATOIRE"
            ? "Pour cette demande, le DG décide toutes les lignes (soumission d'office)."
            : demande.modeEtapeDG === "NON_REQUISE"
              ? "La soumission au DG n'est pas requise pour cette demande (demande émise par le DG)."
              : "Cette demande n'a pas de ligne d'article : soumettez-la entière au DG."
        );
      }
      if (etape !== "FINANCE" && etape !== "DG" && etape !== "DECISION_FINALE") return refus(messageAttente(etape));
      if (auteurInterdit) return refus("Vous ne pouvez pas soumettre votre propre demande.");
      if (action.ligneIds) {
        const raison = refusSoumissionLignes(lignes, action.ligneIds);
        if (raison) return refus(raison);
      } else if (!lignes.some((l) => raisonLigneNonSoumettable(l) === null)) {
        return refus("Aucune ligne à soumettre au DG (lignes à catégoriser, déjà soumises ou déjà validées).");
      }
      return { ok: true, etapeSuivante: "DG", effets: { soumiseAuDG: true } };
    }

    case "DECIDER_LIGNE_DG": {
      if (!a(acteur, "treso.decider_dg")) return refus("Action non autorisée.");
      if (!parLignes) return refus("Pour cette demande, le DG décide la demande entière.");
      if (etape !== "DG") return refus(messageAttente(etape));
      if (enAttenteDG.length === 0) return refus("Aucune ligne n'attend votre décision.");
      if (estAuteur) return refus("Vous ne pouvez pas décider votre propre demande.");
      if (demande.decideurFinanceId && acteur.userId === demande.decideurFinanceId) return refus(MESSAGE_DEUX_PERSONNES);
      if (action.ligneId === undefined) return { ok: true, etapeSuivante: "DG", effets: {} };
      const ligne = lignes.find((l) => l.id === action.ligneId);
      if (!ligne) return refus("Une ligne ne fait pas partie de cette demande.");
      if (etatLigneDG(ligne) !== "EN_ATTENTE_DG") return refus(`La ligne « ${ligne.libelle} » n'attend pas votre décision.`);
      if (!action.valider && motifInvalide(action.motif ?? "")) {
        return refus(`Le motif du refus est obligatoire (${MOTIF_MIN} caractères minimum).`);
      }
      // La dernière ligne en attente décidée : la Finance reprend la main (décision finale ou nouvelle soumission).
      return { ok: true, etapeSuivante: enAttenteDG.length === 1 ? "DECISION_FINALE" : "DG", effets: {} };
    }

    case "RESOUMETTRE_CORRECTION":
    case "ABANDONNER": {
      if (etape !== "A_CORRIGER") return refus("Cette demande n'est pas en correction.");
      if (!estAuteur) return refus("Seul le demandeur peut corriger, resoumettre ou abandonner sa demande.");
      if (action.type === "ABANDONNER") return { ok: true, etapeSuivante: "ABANDONNEE", effets: {} };
      // L'étape réelle dépend du parcours recalculé : l'appelant le recalcule puis prend `etapeInitiale`.
      return { ok: true, etapeSuivante: etapeInitiale(demande), effets: { recalculerParcours: true } };
    }
  }
}

/** Actions qu'`acteur` peut effectuer maintenant (boutons actifs) ; les autres sont affichés grisés. */
export function actionsPossibles(demande: DemandeCircuit, acteur: ActeurCircuit): TypeActionCircuit[] {
  const essais: ActionCircuit[] = [
    { type: "VALIDER_SERVICE" },
    { type: "REJETER", motif: "motif" },
    { type: "SOUMETTRE_DG" },
    { type: "RESOUMETTRE_DG" },
    { type: "VALIDER_DG" },
    { type: "REJETER_DG", motif: "motif" },
    { type: "DECIDER_LIGNES", auMoinsUneValidee: true },
    { type: "SOUMETTRE_LIGNES_DG" },
    { type: "DECIDER_LIGNE_DG", valider: true },
    { type: "RESOUMETTRE_CORRECTION" },
    { type: "ABANDONNER" },
  ];
  return essais.filter((x) => transition(demande, acteur, x).ok).map((x) => x.type);
}

export type StatutEtapeFrise = "FAITE" | "EN_COURS" | "A_VENIR" | "NON_REQUISE";

/** Frise de progression : Service, Finance, DG (si soumise ou imposée), Assistant (exécution). */
export function friseProgression(
  demande: DemandeCircuit & { soumiseAuDG: boolean }
): { etape: "SERVICE" | "FINANCE" | "DG" | "ASSISTANT"; statut: StatutEtapeFrise; detail?: string }[] {
  const ordre: Record<EtapeCircuit, number> = {
    SERVICE: 0,
    FINANCE: 1,
    DG: 2,
    REJET_DG: 1,
    DECISION_FINALE: 1,
    TERMINEE: 3,
    A_CORRIGER: -1,
    ABANDONNEE: -1,
  };
  const position = ordre[demande.etape];
  const statut = (index: number, requise: boolean): StatutEtapeFrise => {
    if (!requise) return "NON_REQUISE";
    if (position < 0) return "A_VENIR";
    if (index < position) return "FAITE";
    if (index === position) return "EN_COURS";
    return "A_VENIR";
  };
  const dgRequise = demande.modeEtapeDG === "OBLIGATOIRE" || (demande.modeEtapeDG === "OPTIONNELLE" && demande.soumiseAuDG);
  const financeFaite = demande.etape === "TERMINEE" && demande.etapeFinanceRequise;
  // Étape DG déjà passée : la Finance reprend la main (décision finale ou après rejet DG).
  const dgFaite = dgRequise && (demande.etape === "DECISION_FINALE" || demande.etape === "TERMINEE");
  return [
    { etape: "SERVICE", statut: statut(0, demande.etapeServiceRequise) },
    {
      etape: "FINANCE",
      statut: !demande.etapeFinanceRequise ? "NON_REQUISE" : financeFaite ? "FAITE" : statut(1, true),
    },
    { etape: "DG", statut: !dgRequise ? "NON_REQUISE" : dgFaite ? "FAITE" : statut(2, true), detail: detailLignesDG(demande) },
    { etape: "ASSISTANT", statut: demande.etape === "TERMINEE" ? "EN_COURS" : "A_VENIR" },
  ];
}

/** État partiel de l'étape DG (soumission ligne par ligne) : « 2 lignes sur 5 soumises · 1 en attente ». */
export function detailLignesDG(demande: Pick<DemandeCircuit, "lignes" | "modeEtapeDG" | "typeDemande">): string | undefined {
  const lignes = demande.lignes ?? [];
  if (demande.typeDemande === "DEPENSE_DIRECTE" || demande.modeEtapeDG !== "OPTIONNELLE" || lignes.length === 0) return undefined;
  const soumises = lignes.filter((l) => l.soumiseAuDG);
  if (soumises.length === 0) return undefined;
  const compte = (e: EtatLigneDG) => soumises.filter((l) => etatLigneDG(l) === e).length;
  const pluriel = (n: number) => (n > 1 ? "s" : "");
  const morceaux = [`${soumises.length} ligne${pluriel(soumises.length)} sur ${lignes.length} soumise${pluriel(soumises.length)}`];
  if (compte("EN_ATTENTE_DG")) morceaux.push(`${compte("EN_ATTENTE_DG")} en attente`);
  if (compte("VALIDEE_DG")) morceaux.push(`${compte("VALIDEE_DG")} validée${pluriel(compte("VALIDEE_DG"))}`);
  if (compte("REFUSEE_DG")) morceaux.push(`${compte("REFUSEE_DG")} refusée${pluriel(compte("REFUSEE_DG"))}`);
  return morceaux.join(" · ");
}

/** Ligne Prisma (catégorie et décision DG) → `LigneCircuit`. */
export function versLigneCircuit(l: {
  id: string;
  libelle: string;
  categorieId: string | null;
  statutValidation: "EN_ATTENTE" | "VALIDEE" | "REJETEE";
  soumiseAuDG: boolean;
  decisionDG: "VALIDEE" | "REFUSEE" | null;
  decisionDGParId: string | null;
  decisionDGAt?: Date | null;
}): LigneCircuit {
  return {
    id: l.id,
    libelle: l.libelle,
    categorisee: !!l.categorieId,
    statut: l.statutValidation,
    soumiseAuDG: l.soumiseAuDG,
    decisionDG: l.decisionDG,
    decisionDGParId: l.decisionDGParId,
    decisionDGAt: l.decisionDGAt ?? null,
  };
}

/** Champs `Demande` lus par le circuit (ligne Prisma) → `DemandeCircuit`. */
export function versDemandeCircuit(d: {
  etapeCircuit: EtapeCircuit;
  createurId: string;
  typeDemande: TypeDemandeCircuit;
  etapeServiceRequise: boolean;
  etapeFinanceRequise: boolean;
  modeEtapeDG: ModeEtapeDG;
  dgApprobateurId: string | null;
  decideurFinanceId: string | null;
  lignes?: Parameters<typeof versLigneCircuit>[0][];
}): DemandeCircuit {
  return {
    lignes: d.lignes?.map(versLigneCircuit),
    etape: d.etapeCircuit,
    createurId: d.createurId,
    typeDemande: d.typeDemande,
    etapeServiceRequise: d.etapeServiceRequise,
    etapeFinanceRequise: d.etapeFinanceRequise,
    modeEtapeDG: d.modeEtapeDG,
    approbateurDGId: d.dgApprobateurId,
    decideurFinanceId: d.decideurFinanceId,
  };
}

/**
 * Pourquoi un bouton est grisé : la phrase que le serveur renverrait pour cette action, ou `null` si l'action est
 * possible maintenant. Une seule source pour l'écran et le serveur (`transition`).
 */
export function raisonIndisponible(demande: DemandeCircuit, acteur: ActeurCircuit, type: TypeActionCircuit): string | null {
  const action: ActionCircuit =
    type === "REJETER" || type === "REJETER_DG"
      ? { type, motif: "motif" }
      : type === "DECIDER_LIGNES"
        ? { type, auMoinsUneValidee: true }
        : type === "DECIDER_LIGNE_DG"
          ? { type, valider: true }
          : { type };
  const r = transition(demande, acteur, action);
  if (r.ok) return null;
  // Assistant Finance (exécution sans décision) : avant la décision finale, il attend — jamais « Action non autorisée. ».
  if (r.message === "Action non autorisée." && estExecutantFinance(acteur.permissions) && attendDecisionFinale(demande.etape)) {
    return MESSAGE_ATTENTE_VALIDATION_FINALE;
  }
  return r.message;
}

/**
 * Compte d'exécution de la Finance (règlement ou réception des retours) qui ne décide pas : l'Assistant Finance.
 * Repéré par ses permissions, jamais par le nom de son rôle.
 */
export function estExecutantFinance(permissions: readonly string[]): boolean {
  const execute = permissions.includes("treso.effectuer_reglement") || permissions.includes("treso.receptionner_retour");
  return execute && !permissions.includes("treso.decider_finance") && !permissions.includes("treso.decider_dg");
}

/** Ligne d'une version recopiée dans l'historique avant une correction (`correction_demande`). */
export interface LigneVersion {
  id: string;
  libelle: string;
  /** Motif de la ligne (absent des versions antérieures au 2026-10-09, et `null` pour une ancienne ligne). */
  motif?: string | null;
  quantite: number;
  prixUnitaire: number;
  decision: "EN_ATTENTE" | "VALIDEE" | "REJETEE";
  motifRejet: string | null;
  /** Absents des versions recopiées avant le 2026-10-07. */
  decidePar?: string | null;
  decideAt?: string | null;
  /** Décision du DG sur une ligne soumise (versions recopiées depuis le 2026-10-10). */
  decisionDG?: "VALIDEE" | "REFUSEE" | null;
  motifRefusDG?: string | null;
}

/** Version d'une demande recopiée avant une correction. */
export interface VersionDemande {
  tour: number;
  rejet: { niveau: "SERVICE" | "FINANCE" | "DG" | null; motif: string | null };
  /** Motif d'en-tête : `null` pour une demande à motifs par ligne. */
  description: string | null;
  montant: number;
  lignes: LigneVersion[];
}

const PREFIXE_VERSION = /^Version du tour \d+ avant correction : /;

/** Lit la version recopiée dans le détail d'une entrée `correction_demande` ; `null` si illisible. */
export function lireVersionCorrection(detail: string | null | undefined): VersionDemande | null {
  if (!detail || !PREFIXE_VERSION.test(detail)) return null;
  try {
    const v = JSON.parse(detail.replace(PREFIXE_VERSION, "")) as VersionDemande;
    return Array.isArray(v?.lignes) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Lignes retirées à chaque correction : une ligne d'une version absente de la version suivante (ou des lignes
 * actuelles, pour la dernière correction). Les versions sont données dans l'ordre chronologique. Clé : l'index de la
 * version dans `versions`.
 */
export function lignesRetireesParCorrection(versions: VersionDemande[], idsLignesActuelles: readonly string[]): LigneVersion[][] {
  return versions.map((v, i) => {
    const suivantes = new Set(i + 1 < versions.length ? versions[i + 1].lignes.map((l) => l.id) : idsLignesActuelles);
    return v.lignes.filter((l) => !suivantes.has(l.id));
  });
}

/**
 * Conflit d'intérêts (décision 3, 2026-10-07) : personne n'exécute l'argent de sa propre demande — règlement (création,
 * modification, confirmation = décaissement, annulation) et réception d'un retour de caisse. Le demandeur peut porter
 * ces permissions (Assistant Finance, Finance) : un AUTRE compte le fait. `null` si l'action est permise.
 */
export const MESSAGE_EXECUTION_PROPRE_DEMANDE =
  "Vous êtes le demandeur ou le bénéficiaire de cette demande : un autre compte s'en charge (règlement, décaissement, retours, description).";

/**
 * Gardes 1 à 4, 6 et 8 (2026-10-07) : le demandeur ET le bénéficiaire (compte du portail) n'exécutent jamais l'argent
 * de la demande ni ne documentent ses retours — règlements, réception, déclaration et détail des dépenses par
 * l'Assistant, remboursements, retours exceptionnels, description et libellés. Un autre compte le fait.
 */
export function refusExecutionPropreDemande(
  demande: { createurId: string; beneficiaireUserId?: string | null },
  userId: string
): string | null {
  return demande.createurId === userId || demande.beneficiaireUserId === userId ? MESSAGE_EXECUTION_PROPRE_DEMANDE : null;
}
