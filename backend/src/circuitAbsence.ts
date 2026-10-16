// Congés et permissions d'absence — circuit de validation (Lot 2, 2026-10-15). Moteur PUR : aucun accès base, aucun envoi.
//
// UN SEUL circuit pour les deux natures (décision D2, option B) : le responsable du service d'abord, puis la RH.
//   - Étape responsable : `Service.responsableId` désigne le décideur, SANS permission (comme « Mon équipe » et les
//     justifications de retard). Non requise quand elle n'a pas de sens (voir `resoudreParcoursAbsence`).
//   - Étape RH : un compte actif dont le RÔLE porte `conges.valider_rh` / `absences.valider_rh` ; à défaut d'un autre
//     compte RH que le demandeur, le DG (`treso.decider_dg`) ; à défaut, personne (la demande ne peut pas être déposée).
//   - Personne ne décide sa propre demande, à aucune étape. Le droit de décider se lit sur le RÔLE
//     (`session.rolePermissions`), jamais par délégation (ces permissions sont dans PERMISSIONS_DECISION_NON_DELEGABLES).
//   - Le décideur est RECALCULÉ à chaque action : un changement de responsable de service prend effet immédiatement.
//   - Repli : une demande « en attente du responsable » dont l'étape responsable n'a plus de sens (responsable
//     désactivé, service sans responsable…) est décidée par l'étape RH, qui la termine directement.

import type { ServiceCollaborateur } from "./justificationPointage";

export type NatureAbsence = "CONGE" | "PERMISSION";

export type StatutCircuitAbsence =
  | "EN_ATTENTE_RESPONSABLE"
  | "EN_ATTENTE_RH"
  | "VALIDEE" // congé : état final accordé
  | "APPROUVEE" // permission : état final accordé
  | "CONSOMMEE" // permission : retour marqué
  | "REJETEE"
  | "ANNULEE"
  | "MODIFICATION_DEMANDEE";

/** Permission d'étape RH de chaque nature (non délégable, lue sur le rôle). */
export const PERMISSION_ETAPE_RH_ABSENCE: Record<NatureAbsence, string> = {
  CONGE: "conges.valider_rh",
  PERMISSION: "absences.valider_rh",
};

/** Dernier recours : le DG, désigné par la même permission que l'étape DG de la Trésorerie et des justifications. */
export const PERMISSION_DG_ABSENCE = "treso.decider_dg";

/**
 * Une permission d'absence se décide ou se rejette : le statut « modification demandée » n'existe pas pour elle
 * (décision du Lot 4). Le collaborateur dépose une nouvelle demande, ce qui garde la base inchangée.
 */
export const MESSAGE_PERMISSION_SANS_MODIFICATION =
  "Une permission d'absence ne peut pas être renvoyée pour modification : rejetez-la, le collaborateur déposera une nouvelle demande.";

export const MOTIF_ABSENCE_MIN = 3;
export const MOTIF_ABSENCE_MAX = 500;

export function statutFinalAbsence(nature: NatureAbsence): "VALIDEE" | "APPROUVEE" {
  return nature === "CONGE" ? "VALIDEE" : "APPROUVEE";
}

/** Statuts en cours de circuit (une décision est attendue). */
export const STATUTS_ABSENCE_EN_ATTENTE: readonly StatutCircuitAbsence[] = ["EN_ATTENTE_RESPONSABLE", "EN_ATTENTE_RH"];

export function estStatutFinalAccorde(nature: NatureAbsence, statut: StatutCircuitAbsence): boolean {
  return statut === statutFinalAbsence(nature) || (nature === "PERMISSION" && statut === "CONSOMMEE");
}

// ---------------------------------------------------------------------------------------------------------------------
// Parcours (fixé à la soumission)
// ---------------------------------------------------------------------------------------------------------------------

export type RaisonEtapeResponsableNonRequise =
  | "SANS_SERVICE"
  | "SANS_RESPONSABLE"
  | "EST_RESPONSABLE"
  | "RESPONSABLE_INACTIF"
  | "DEMANDEUR_DG";

export type EtapeResponsable =
  | { requise: true; responsableId: string }
  | { requise: false; raison: RaisonEtapeResponsableNonRequise };

/** Qui décide à l'étape RH : la RH, à défaut le DG, à défaut personne. */
export type EtapeRH = { type: "RH" } | { type: "DG" } | { type: "AUCUN" };

export interface ContexteCircuitAbsence {
  demandeurId: string;
  /** Service du demandeur tel que lu maintenant (`null` : aucun service). */
  service: ServiceCollaborateur | null;
  /** Comptes ACTIFS dont le rôle porte la permission d'étape RH de la nature (le demandeur peut y figurer). */
  comptesRH: readonly string[];
  /** Comptes ACTIFS dont le rôle porte `treso.decider_dg` (le demandeur peut y figurer). */
  comptesDG: readonly string[];
}

export function resoudreEtapeResponsable(ctx: ContexteCircuitAbsence): EtapeResponsable {
  if (ctx.comptesDG.includes(ctx.demandeurId)) return { requise: false, raison: "DEMANDEUR_DG" };
  const { service } = ctx;
  if (!service) return { requise: false, raison: "SANS_SERVICE" };
  if (!service.responsableId) return { requise: false, raison: "SANS_RESPONSABLE" };
  if (service.responsableId === ctx.demandeurId) return { requise: false, raison: "EST_RESPONSABLE" };
  if (!service.responsableActif) return { requise: false, raison: "RESPONSABLE_INACTIF" };
  return { requise: true, responsableId: service.responsableId };
}

export function resoudreEtapeRH(ctx: ContexteCircuitAbsence): EtapeRH {
  if (ctx.comptesRH.some((id) => id !== ctx.demandeurId)) return { type: "RH" };
  if (ctx.comptesDG.some((id) => id !== ctx.demandeurId)) return { type: "DG" };
  return { type: "AUCUN" };
}

export const MESSAGE_AUCUN_DECIDEUR =
  "Aucun compte ne peut décider de cette demande (aucun autre compte RH, ni DG) : contactez l'administrateur.";

export type ParcoursAbsence =
  | { ok: true; etapeResponsable: EtapeResponsable; etapeRH: EtapeRH; premierStatut: "EN_ATTENTE_RESPONSABLE" | "EN_ATTENTE_RH" }
  | { ok: false; erreur: string };

/**
 * Parcours d'une demande à la soumission (ou à la resoumission après une demande de modification). Une demande qui
 * n'aurait aucun décideur à l'étape RH est refusée d'emblée : elle resterait bloquée.
 */
export function resoudreParcoursAbsence(ctx: ContexteCircuitAbsence): ParcoursAbsence {
  const etapeResponsable = resoudreEtapeResponsable(ctx);
  const etapeRH = resoudreEtapeRH(ctx);
  if (etapeRH.type === "AUCUN") return { ok: false, erreur: MESSAGE_AUCUN_DECIDEUR };
  return {
    ok: true,
    etapeResponsable,
    etapeRH,
    premierStatut: etapeResponsable.requise ? "EN_ATTENTE_RESPONSABLE" : "EN_ATTENTE_RH",
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Décideur de l'étape en cours (recalculé à chaque action)
// ---------------------------------------------------------------------------------------------------------------------

export type DecideurAbsence =
  | { type: "RESPONSABLE"; responsableId: string }
  | { type: "RH"; repli: boolean }
  | { type: "DG"; repli: boolean }
  | { type: "AUCUN"; repli: boolean };

/**
 * Qui décide pour ce statut, `null` s'il n'y a rien à décider (statut final, rejeté, annulé, modification demandée).
 * `repli` : le responsable ne peut plus décider (désactivé, plus de responsable…), la RH ou le DG décide à sa place.
 */
export function decideurPourStatutAbsence(statut: StatutCircuitAbsence, ctx: ContexteCircuitAbsence): DecideurAbsence | null {
  if (!STATUTS_ABSENCE_EN_ATTENTE.includes(statut)) return null;
  if (statut === "EN_ATTENTE_RESPONSABLE") {
    const etape = resoudreEtapeResponsable(ctx);
    if (etape.requise) return { type: "RESPONSABLE", responsableId: etape.responsableId };
    return decideurRH(ctx, true);
  }
  return decideurRH(ctx, false);
}

function decideurRH(ctx: ContexteCircuitAbsence, repli: boolean): DecideurAbsence {
  const etape = resoudreEtapeRH(ctx);
  return etape.type === "RH" ? { type: "RH", repli } : etape.type === "DG" ? { type: "DG", repli } : { type: "AUCUN", repli };
}

/** Compte qui agit : son identifiant et les permissions de son RÔLE (jamais celles reçues par délégation). */
export interface ActeurAbsence {
  id: string;
  rolePermissions: readonly string[];
}

export const MESSAGE_PROPRE_DEMANDE_ABSENCE = "Vous ne pouvez pas décider de votre propre demande.";
export const MESSAGE_RESERVE_RESPONSABLE_ABSENCE = "Seul le responsable du service du demandeur peut décider de cette demande.";
export const MESSAGE_RESERVE_RH_ABSENCE = "Cette demande est décidée par la RH.";
export const MESSAGE_RESERVE_DG_ABSENCE = "Cette demande est décidée par le DG (aucun autre compte RH ne peut le faire).";

/** Raison du refus si `acteur` ne peut pas décider à cette étape, `null` s'il le peut. */
export function refusDecideurAbsence(
  decideur: DecideurAbsence | null,
  acteur: ActeurAbsence,
  demandeurId: string,
  nature: NatureAbsence
): string | null {
  if (!decideur) return "Cette demande n'attend plus de décision.";
  // Le décideur n'est jamais le demandeur, même s'il détient la permission RH.
  if (acteur.id === demandeurId) return MESSAGE_PROPRE_DEMANDE_ABSENCE;
  switch (decideur.type) {
    case "RESPONSABLE":
      return acteur.id === decideur.responsableId ? null : MESSAGE_RESERVE_RESPONSABLE_ABSENCE;
    case "RH":
      return acteur.rolePermissions.includes(PERMISSION_ETAPE_RH_ABSENCE[nature]) ? null : MESSAGE_RESERVE_RH_ABSENCE;
    case "DG":
      return acteur.rolePermissions.includes(PERMISSION_DG_ABSENCE) ? null : MESSAGE_RESERVE_DG_ABSENCE;
    case "AUCUN":
      return MESSAGE_AUCUN_DECIDEUR;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------------------------------------------------

export type ActionCircuitAbsence =
  | { type: "APPROUVER" }
  | { type: "REJETER"; motif: string }
  | { type: "DEMANDER_MODIFICATION"; motif: string }
  /** Le demandeur renvoie sa demande modifiée : le circuit repart de la première étape applicable. */
  | { type: "RESOUMETTRE"; premierStatut: "EN_ATTENTE_RESPONSABLE" | "EN_ATTENTE_RH" }
  | { type: "ANNULER"; motif: string };

export interface ParamsTransitionAbsence {
  nature: NatureAbsence;
  statut: StatutCircuitAbsence;
  action: ActionCircuitAbsence;
  acteur: ActeurAbsence;
  demandeurId: string;
  /** `decideurPourStatutAbsence(statut, ctx)` calculé par l'appelant au moment de l'action. */
  decideur: DecideurAbsence | null;
  /**
   * L'absence accordée a déjà commencé (congé : date de début atteinte ; permission : jour de la permission atteint).
   * Seule la RH annule alors (`peutAnnulerApresDebut`).
   */
  adebute?: boolean;
  /** L'acteur porte `conges.annuler` / `absences.annuler` (ou l'étape RH) : il annule même après le début. */
  peutAnnulerApresDebut?: boolean;
}

export type EffetTransitionAbsence =
  /** La demande est accordée : débiter le solde (congé) et créer les plages d'absence autorisée. */
  | "ACCORDER"
  /** Une absence accordée est annulée : recréditer le solde (congé) et supprimer les plages. */
  | "DEFAIRE_ACCORD"
  | "AUCUN";

export type ResultatTransitionAbsence =
  | {
      ok: true;
      statut: StatutCircuitAbsence;
      motif?: string;
      effet: EffetTransitionAbsence;
      /** L'approbation a été donnée par la RH/le DG à la place d'un responsable qui ne peut plus décider. */
      viaRepli?: boolean;
      /** L'étape franchie, pour l'historique et l'horodatage (`approuveParId` / `valideParId`). */
      etape?: "RESPONSABLE" | "RH";
    }
  | { ok: false; erreur: string };

/** Espaces de début et de fin retirés, suites d'espaces réduites à un seul. */
export function nettoyerMotifAbsence(motif: string): string {
  return motif.replace(/\s+/g, " ").trim();
}

function controlerMotif(motif: string, libelle: string): { ok: true; motif: string } | { ok: false; erreur: string } {
  const propre = nettoyerMotifAbsence(motif);
  if (propre.length < MOTIF_ABSENCE_MIN) {
    return { ok: false, erreur: `${libelle} doit contenir au moins ${MOTIF_ABSENCE_MIN} caractères.` };
  }
  if (propre.length > MOTIF_ABSENCE_MAX) {
    return { ok: false, erreur: `${libelle} ne doit pas dépasser ${MOTIF_ABSENCE_MAX} caractères.` };
  }
  return { ok: true, motif: propre };
}

const MESSAGE_STATUT: Partial<Record<StatutCircuitAbsence, string>> = {
  REJETEE: "Cette demande a déjà été rejetée.",
  ANNULEE: "Cette demande a déjà été annulée.",
  CONSOMMEE: "Cette permission est déjà consommée.",
  MODIFICATION_DEMANDEE: "Cette demande attend une modification du demandeur.",
  VALIDEE: "Cette demande est déjà validée.",
  APPROUVEE: "Cette demande est déjà approuvée.",
};

/**
 * Transitions permises (une seule fonction, utilisée par les écrans pour griser un bouton ET par le serveur pour
 * refuser) :
 *   - approuver : étape en cours → étape suivante ; responsable → EN_ATTENTE_RH ; RH ou DG → état final accordé
 *     (effet ACCORDER) ; la RH qui remplace un responsable empêché termine directement (`viaRepli`) ;
 *   - rejeter / demander une modification : par le décideur de l'étape en cours, motif obligatoire ;
 *   - resoumettre : le demandeur seul, depuis MODIFICATION_DEMANDEE ;
 *   - annuler : le demandeur tant que la demande est en cours ou accordée sans avoir commencé ; la RH
 *     (`peutAnnulerApresDebut`) aussi après le début ; jamais une demande rejetée, annulée, ou une permission consommée.
 */
export function transitionAbsence(p: ParamsTransitionAbsence): ResultatTransitionAbsence {
  const { nature, statut, action, acteur, demandeurId, decideur } = p;
  const estDemandeur = acteur.id === demandeurId;

  if (action.type === "RESOUMETTRE") {
    if (statut !== "MODIFICATION_DEMANDEE") {
      return { ok: false, erreur: "Seule une demande dont la modification a été demandée peut être renvoyée." };
    }
    if (!estDemandeur) return { ok: false, erreur: "Seul le demandeur peut renvoyer sa demande modifiée." };
    return { ok: true, statut: action.premierStatut, effet: "AUCUN" };
  }

  if (action.type === "ANNULER") {
    const motif = controlerMotif(action.motif, "Le motif d'annulation");
    if (!motif.ok) return motif;
    if (statut === "REJETEE" || statut === "ANNULEE" || statut === "CONSOMMEE") {
      return { ok: false, erreur: MESSAGE_STATUT[statut]! };
    }
    const accordee = estStatutFinalAccorde(nature, statut);
    if (!estDemandeur && !p.peutAnnulerApresDebut) {
      return { ok: false, erreur: "Vous n'avez pas l'autorisation d'annuler cette demande." };
    }
    if (estDemandeur && accordee && p.adebute && !p.peutAnnulerApresDebut) {
      return {
        ok: false,
        erreur: "Cette absence a déjà commencé : seule la RH peut l'annuler.",
      };
    }
    return { ok: true, statut: "ANNULEE", motif: motif.motif, effet: accordee ? "DEFAIRE_ACCORD" : "AUCUN" };
  }

  if (action.type === "DEMANDER_MODIFICATION" && nature === "PERMISSION") {
    return { ok: false, erreur: MESSAGE_PERMISSION_SANS_MODIFICATION };
  }

  // Approuver / rejeter / demander une modification : le décideur de l'étape en cours, et lui seul.
  if (!STATUTS_ABSENCE_EN_ATTENTE.includes(statut)) {
    return { ok: false, erreur: MESSAGE_STATUT[statut] ?? "Cette demande n'attend plus de décision." };
  }
  const refus = refusDecideurAbsence(decideur, acteur, demandeurId, nature);
  if (refus) return { ok: false, erreur: refus };
  const viaRepli = decideur !== null && decideur.type !== "RESPONSABLE" && statut === "EN_ATTENTE_RESPONSABLE";
  const etape: "RESPONSABLE" | "RH" = decideur?.type === "RESPONSABLE" ? "RESPONSABLE" : "RH";

  if (action.type === "APPROUVER") {
    if (decideur?.type === "RESPONSABLE") {
      return { ok: true, statut: "EN_ATTENTE_RH", effet: "AUCUN", etape };
    }
    return { ok: true, statut: statutFinalAbsence(nature), effet: "ACCORDER", etape, ...(viaRepli ? { viaRepli: true } : {}) };
  }

  const motif = controlerMotif(action.motif, action.type === "REJETER" ? "Le motif du rejet" : "Le motif de la demande de modification");
  if (!motif.ok) return motif;
  return {
    ok: true,
    statut: action.type === "REJETER" ? "REJETEE" : "MODIFICATION_DEMANDEE",
    motif: motif.motif,
    effet: "AUCUN",
    etape,
    ...(viaRepli ? { viaRepli: true } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Ce que chaque bouton peut faire (affichage grisé + phrase)
// ---------------------------------------------------------------------------------------------------------------------

export interface ActionsPossiblesAbsence {
  approuver: string | null;
  rejeter: string | null;
  demanderModification: string | null;
  resoumettre: string | null;
  annuler: string | null;
}

/**
 * Pour chaque action : `null` si l'acteur peut la faire maintenant, sinon la phrase du refus (la même que renverrait
 * le serveur). Les écrans grisent le bouton avec cette phrase au lieu de le masquer.
 */
export function actionsPossiblesAbsence(p: Omit<ParamsTransitionAbsence, "action">): ActionsPossiblesAbsence {
  const essayer = (action: ActionCircuitAbsence): string | null => {
    const r = transitionAbsence({ ...p, action });
    return r.ok ? null : r.erreur;
  };
  return {
    approuver: essayer({ type: "APPROUVER" }),
    rejeter: essayer({ type: "REJETER", motif: "motif de test" }),
    demanderModification: essayer({ type: "DEMANDER_MODIFICATION", motif: "motif de test" }),
    resoumettre: essayer({ type: "RESOUMETTRE", premierStatut: "EN_ATTENTE_RH" }),
    annuler: essayer({ type: "ANNULER", motif: "motif de test" }),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Destinataires des notifications (ciblés : le décideur, jamais tous les porteurs d'une permission)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Comptes à prévenir quand une demande arrive à `statut` : le responsable désigné, ou la RH (tous ses comptes,
 * sauf le demandeur), ou à défaut le DG. Jamais le demandeur.
 */
export function destinatairesEtapeAbsence(statut: StatutCircuitAbsence, ctx: ContexteCircuitAbsence): string[] {
  const decideur = decideurPourStatutAbsence(statut, ctx);
  if (!decideur) return [];
  if (decideur.type === "RESPONSABLE") return [decideur.responsableId];
  const source = decideur.type === "RH" ? ctx.comptesRH : decideur.type === "DG" ? ctx.comptesDG : [];
  return source.filter((id) => id !== ctx.demandeurId);
}

// ---------------------------------------------------------------------------------------------------------------------
// Libellés et frise
// ---------------------------------------------------------------------------------------------------------------------

export const LIBELLE_STATUT_ABSENCE: Record<StatutCircuitAbsence, string> = {
  EN_ATTENTE_RESPONSABLE: "En attente du responsable",
  EN_ATTENTE_RH: "En attente de la RH",
  VALIDEE: "Validée",
  APPROUVEE: "Approuvée",
  CONSOMMEE: "Consommée",
  REJETEE: "Rejetée",
  ANNULEE: "Annulée",
  MODIFICATION_DEMANDEE: "Modification demandée",
};

/** Actions d'historique (`HistoriqueEntry.entity = "DemandeConge" | "DemandePermission"`). */
export const ACTION_HISTORIQUE_ABSENCE = {
  SOUMETTRE: "soumission",
  APPROUVER_RESPONSABLE: "approbation_responsable",
  ACCORDER: "accord_rh",
  ACCORDER_PAR_REPLI: "accord_par_repli",
  REJETER: "rejet",
  DEMANDER_MODIFICATION: "demande_modification",
  RESOUMETTRE: "resoumission",
  ANNULER: "annulation",
  /** Congé accordé d'office par la RH (aucune demande du collaborateur, aucun circuit). */
  CONGE_OFFICE: "conge_office",
  /** Permission d'absence : retour marqué (la permission devient consommée). */
  RETOUR_MARQUE: "retour_marque",
  AJUSTER_SOLDE: "ajustement_solde",
  RAPPEL: "rappel",
  /** Observation de la RH / du responsable (à sa décision) ou du DG (à tout moment) : AJOUT SEUL, statut inchangé. */
  OBSERVATION: "observation",
} as const;

export type EtatEtapeFrise = "faite" | "en_cours" | "a_venir" | "non_requise" | "interrompue";

export interface EtapeFrise {
  cle: "DEPOT" | "RESPONSABLE" | "RH" | "DECISION";
  libelle: string;
  etat: EtatEtapeFrise;
}

/**
 * Frise d'avancement : Dépôt → Responsable (ou « non requise ») → RH → Décision. Une demande rejetée, annulée ou en
 * attente de modification interrompt l'étape où elle se trouvait.
 */
export function friseAbsence(params: { nature: NatureAbsence; statut: StatutCircuitAbsence; etapeResponsableRequise: boolean }): EtapeFrise[] {
  const { nature, statut, etapeResponsableRequise } = params;
  const accordee = estStatutFinalAccorde(nature, statut);
  const interrompue = statut === "REJETEE" || statut === "ANNULEE" || statut === "MODIFICATION_DEMANDEE";
  // Étape où la demande s'est arrêtée : sans trace d'approbation du responsable, on l'a arrêtée à la première étape applicable.
  const position = statut === "EN_ATTENTE_RESPONSABLE" ? 1 : statut === "EN_ATTENTE_RH" ? 2 : accordee ? 3 : 0;

  const etat = (index: number, requise = true): EtatEtapeFrise => {
    if (!requise) return "non_requise";
    if (position === index) return "en_cours";
    if (position > index) return "faite";
    return interrompue ? "interrompue" : "a_venir";
  };

  return [
    { cle: "DEPOT", libelle: "Dépôt", etat: "faite" },
    { cle: "RESPONSABLE", libelle: "Responsable du service", etat: etat(1, etapeResponsableRequise) },
    { cle: "RH", libelle: "RH", etat: etat(2) },
    { cle: "DECISION", libelle: nature === "CONGE" ? "Congé validé" : "Permission approuvée", etat: accordee ? "faite" : interrompue ? "interrompue" : "a_venir" },
  ];
}

// ---------------------------------------------------------------------------------------------------------------------
// Qui peut consulter une demande (page de détail, pièces jointes)
// ---------------------------------------------------------------------------------------------------------------------

/** Permissions de consultation de toutes les demandes d'une nature (RH, DG en lecture). */
export const PERMISSIONS_CONSULTATION_ABSENCE: Record<NatureAbsence, readonly string[]> = {
  // Le DG voit toutes les demandes sans `consulter_tous` (C3) : sa permission d'étape, non délégable, donc lue sur le rôle.
  CONGE: ["conges.valider_rh", "conges.consulter_tous", PERMISSION_DG_ABSENCE],
  PERMISSION: ["absences.valider_rh", "absences.consulter_tous", PERMISSION_DG_ABSENCE],
};

/**
 * Le demandeur, le responsable ACTUEL de son service, les comptes RH de la nature et ceux qui consultent tout.
 * `permissions` : celles du compte (rôle et délégations : consulter n'engage pas d'argent).
 */
export function peutConsulterAbsence(p: {
  nature: NatureAbsence;
  acteurId: string;
  demandeurId: string;
  responsableDuServiceId: string | null;
  permissions: readonly string[];
}): boolean {
  if (p.acteurId === p.demandeurId) return true;
  if (p.responsableDuServiceId !== null && p.responsableDuServiceId === p.acteurId) return true;
  return PERMISSIONS_CONSULTATION_ABSENCE[p.nature].some((k) => p.permissions.includes(k));
}
