// Congés — circuit de validation (module simplifié, 2026-10-19). Moteur PUR : aucun accès base, aucun envoi.
//   - Étape responsable : `Service.responsableId` désigne le décideur, SANS permission (comme « Mon équipe » et les
//     justifications de retard). Non requise quand elle n'a pas de sens (voir `resoudreParcoursConge`).
//   - Étape RH : un compte actif dont le RÔLE porte `conges.valider_rh` ; à défaut d'un autre compte RH que le demandeur,
//     le DG (`treso.decider_dg`, repli PROVISOIRE, point ouvert O1 : une seule condition, dans `resoudreEtapeRH`) ; à défaut,
//     personne (la demande ne peut pas être déposée).
//   - Personne ne décide sa propre demande, à aucune étape. Le droit de décider se lit sur le RÔLE
//     (`session.rolePermissions`), jamais par délégation (ces permissions sont dans PERMISSIONS_DECISION_NON_DELEGABLES).
//   - Le décideur est RECALCULÉ à chaque action : un changement de responsable de service prend effet immédiatement.
//   - Repli : une demande « en attente du responsable » dont l'étape responsable n'a plus de sens (responsable désactivé,
//     service sans responsable…) est décidée par l'étape RH, qui la termine directement.

import type { ServiceCollaborateur } from "./justificationPointage";

import type { NatureConge } from "./generated/prisma/enums";

export type StatutCircuitConge =
  | "EN_ATTENTE_RESPONSABLE"
  | "EN_ATTENTE_RH"
  | "VALIDEE"
  | "REJETEE"
  | "ANNULEE"
  | "MODIFICATION_DEMANDEE";

/** Permission d'étape RH (non délégable, lue sur le rôle). */
export const PERMISSION_ETAPE_RH_CONGE = "conges.valider_rh";

/** Dernier recours (O1, provisoire) : le DG, désigné par la même permission que l'étape DG de la Trésorerie. */
export const PERMISSION_DG_CONGE = "treso.decider_dg";

export const MOTIF_CONGE_MIN = 3;
export const MOTIF_CONGE_MAX = 500;
export const OBSERVATION_RH_MAX = 500;

/** Statuts en cours de circuit (une décision est attendue). */
export const STATUTS_CONGE_EN_ATTENTE: readonly StatutCircuitConge[] = ["EN_ATTENTE_RESPONSABLE", "EN_ATTENTE_RH"];

/** Statuts qui occupent la période du salarié (R5 : une autre demande ne peut pas la chevaucher). */
export const STATUTS_CONGE_OCCUPANT_LA_PERIODE: readonly StatutCircuitConge[] = [
  "EN_ATTENTE_RESPONSABLE",
  "EN_ATTENTE_RH",
  "MODIFICATION_DEMANDEE",
  "VALIDEE",
];

// ---------------------------------------------------------------------------------------------------------------------
// Parcours (fixé à la soumission)
// ---------------------------------------------------------------------------------------------------------------------

export type RaisonEtapeResponsableNonRequise = "SANS_SERVICE" | "SANS_RESPONSABLE" | "EST_RESPONSABLE" | "RESPONSABLE_INACTIF";

export type EtapeResponsable =
  | { requise: true; responsableId: string }
  | { requise: false; raison: RaisonEtapeResponsableNonRequise };

/** Qui décide à l'étape RH : la RH, à défaut le DG, à défaut personne. */
export type EtapeRH = { type: "RH" } | { type: "DG" } | { type: "AUCUN" };

export interface ContexteCircuitConge {
  demandeurId: string;
  /** Service du demandeur tel que lu maintenant (`null` : aucun service). */
  service: ServiceCollaborateur | null;
  /** Comptes ACTIFS dont le rôle porte `conges.valider_rh` (le demandeur peut y figurer). */
  comptesRH: readonly string[];
  /** Comptes ACTIFS dont le rôle porte `treso.decider_dg` (le demandeur peut y figurer). */
  comptesDG: readonly string[];
}

export function resoudreEtapeResponsable(ctx: ContexteCircuitConge): EtapeResponsable {
  const { service } = ctx;
  if (!service) return { requise: false, raison: "SANS_SERVICE" };
  if (!service.responsableId) return { requise: false, raison: "SANS_RESPONSABLE" };
  if (service.responsableId === ctx.demandeurId) return { requise: false, raison: "EST_RESPONSABLE" };
  if (!service.responsableActif) return { requise: false, raison: "RESPONSABLE_INACTIF" };
  return { requise: true, responsableId: service.responsableId };
}

export function resoudreEtapeRH(ctx: ContexteCircuitConge): EtapeRH {
  if (ctx.comptesRH.some((id) => id !== ctx.demandeurId)) return { type: "RH" };
  // O1 (provisoire) : repli sur le DG quand la RH est le demandeur et qu'aucun autre compte RH n'existe. À retirer ici seulement.
  if (ctx.comptesDG.some((id) => id !== ctx.demandeurId)) return { type: "DG" };
  return { type: "AUCUN" };
}

export const MESSAGE_AUCUN_DECIDEUR =
  "Aucun compte ne peut décider de cette demande (aucun autre compte RH, ni DG) : contactez l'administrateur.";

export type ParcoursConge =
  | {
      ok: true;
      etapeResponsable: EtapeResponsable;
      etapeRH: EtapeRH;
      premierStatut: "EN_ATTENTE_RESPONSABLE" | "EN_ATTENTE_RH";
    }
  | { ok: false; erreur: string };

/**
 * Parcours d'une demande à la soumission (ou à la resoumission après une demande de modification). Une demande qui
 * n'aurait aucun décideur à l'étape RH est refusée d'emblée : elle resterait bloquée.
 */
export function resoudreParcoursConge(ctx: ContexteCircuitConge): ParcoursConge {
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

export type DecideurConge =
  | { type: "RESPONSABLE"; responsableId: string }
  | { type: "RH"; repli: boolean }
  | { type: "DG"; repli: boolean }
  | { type: "AUCUN"; repli: boolean };

/**
 * Qui décide pour ce statut, `null` s'il n'y a rien à décider (statut final, rejeté, annulé, modification demandée).
 * `repli` : le responsable ne peut plus décider (désactivé, plus de responsable…), la RH ou le DG décide à sa place.
 */
export function decideurPourStatutConge(statut: StatutCircuitConge, ctx: ContexteCircuitConge): DecideurConge | null {
  if (!STATUTS_CONGE_EN_ATTENTE.includes(statut)) return null;
  if (statut === "EN_ATTENTE_RESPONSABLE") {
    const etape = resoudreEtapeResponsable(ctx);
    if (etape.requise) return { type: "RESPONSABLE", responsableId: etape.responsableId };
    return decideurRH(ctx, true);
  }
  return decideurRH(ctx, false);
}

function decideurRH(ctx: ContexteCircuitConge, repli: boolean): DecideurConge {
  const etape = resoudreEtapeRH(ctx);
  return etape.type === "RH" ? { type: "RH", repli } : etape.type === "DG" ? { type: "DG", repli } : { type: "AUCUN", repli };
}

/** Compte qui agit : son identifiant et les permissions de son RÔLE (jamais celles reçues par délégation). */
export interface ActeurConge {
  id: string;
  rolePermissions: readonly string[];
}

export const MESSAGE_PROPRE_DEMANDE_CONGE = "Vous ne pouvez pas décider de votre propre demande.";
export const MESSAGE_RESERVE_RESPONSABLE_CONGE = "Seul le responsable du service du demandeur peut décider de cette demande.";
export const MESSAGE_RESERVE_RH_CONGE = "Cette demande est décidée par la RH.";
export const MESSAGE_RESERVE_DG_CONGE = "Cette demande est décidée par le DG (aucun autre compte RH ne peut le faire).";

/** Raison du refus si `acteur` ne peut pas décider à cette étape, `null` s'il le peut. */
export function refusDecideurConge(decideur: DecideurConge | null, acteur: ActeurConge, demandeurId: string): string | null {
  if (!decideur) return "Cette demande n'attend plus de décision.";
  // Le décideur n'est jamais le demandeur, même s'il détient la permission RH.
  if (acteur.id === demandeurId) return MESSAGE_PROPRE_DEMANDE_CONGE;
  switch (decideur.type) {
    case "RESPONSABLE":
      return acteur.id === decideur.responsableId ? null : MESSAGE_RESERVE_RESPONSABLE_CONGE;
    case "RH":
      return acteur.rolePermissions.includes(PERMISSION_ETAPE_RH_CONGE) ? null : MESSAGE_RESERVE_RH_CONGE;
    case "DG":
      return acteur.rolePermissions.includes(PERMISSION_DG_CONGE) ? null : MESSAGE_RESERVE_DG_CONGE;
    case "AUCUN":
      return MESSAGE_AUCUN_DECIDEUR;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------------------------------------------------

export type ActionCircuitConge =
  | { type: "APPROUVER" }
  | { type: "REJETER"; motif: string }
  | { type: "DEMANDER_MODIFICATION"; motif: string }
  /** Le demandeur renvoie sa demande modifiée : le circuit repart de la première étape applicable. */
  | { type: "RESOUMETTRE"; premierStatut: "EN_ATTENTE_RESPONSABLE" | "EN_ATTENTE_RH" }
  | { type: "ANNULER"; motif: string };

export interface ParamsTransitionConge {
  statut: StatutCircuitConge;
  action: ActionCircuitConge;
  acteur: ActeurConge;
  demandeurId: string;
  /** `decideurPourStatutConge(statut, ctx)` calculé par l'appelant au moment de l'action. */
  decideur: DecideurConge | null;
  /** La date de début est atteinte (aujourd'hui >= début) : le demandeur n'annule plus (R9). */
  adebute?: boolean;
  /** L'acteur porte `conges.annuler` : il annule à tout moment (R9). */
  peutAnnulerApresDebut?: boolean;
}

/**
 * Effet sur les plages d'absence autorisée (R10) :
 *   - VALIDER : la demande est accordée, les plages deviennent définitives ;
 *   - SUPPRIMER_PLAGES : refus ou annulation (avant le début tout est supprimé, après le début à partir du lendemain : la base tranche) ;
 *   - AUCUN : les plages provisoires restent (étape suivante, modification demandée, resoumission traitée à part).
 */
export type EffetTransitionConge = "VALIDER" | "SUPPRIMER_PLAGES" | "AUCUN";

export type ResultatTransitionConge =
  | {
      ok: true;
      statut: StatutCircuitConge;
      motif?: string;
      effet: EffetTransitionConge;
      /** L'approbation a été donnée par la RH/le DG à la place d'un responsable qui ne peut plus décider. */
      viaRepli?: boolean;
      /** L'étape franchie, pour l'historique et l'horodatage (`approuveParId` / `valideParId`). */
      etape?: "RESPONSABLE" | "RH";
    }
  | { ok: false; erreur: string };

/** Espaces de début et de fin retirés, suites d'espaces réduites à un seul. */
export function nettoyerMotifConge(motif: string): string {
  return motif.replace(/\s+/g, " ").trim();
}

function controlerMotif(motif: string, libelle: string): { ok: true; motif: string } | { ok: false; erreur: string } {
  const propre = nettoyerMotifConge(motif);
  if (propre.length < MOTIF_CONGE_MIN) {
    return { ok: false, erreur: `${libelle} doit contenir au moins ${MOTIF_CONGE_MIN} caractères.` };
  }
  if (propre.length > MOTIF_CONGE_MAX) {
    return { ok: false, erreur: `${libelle} ne doit pas dépasser ${MOTIF_CONGE_MAX} caractères.` };
  }
  return { ok: true, motif: propre };
}

const MESSAGE_STATUT: Partial<Record<StatutCircuitConge, string>> = {
  REJETEE: "Cette demande a déjà été rejetée.",
  ANNULEE: "Cette demande a déjà été annulée.",
  MODIFICATION_DEMANDEE: "Cette demande attend une modification du demandeur.",
  VALIDEE: "Cette demande est déjà validée.",
};

export const MESSAGE_ANNULATION_NON_AUTORISEE = "Vous n'avez pas l'autorisation d'annuler cette demande.";
export const MESSAGE_CONGE_COMMENCE = "Ce congé a déjà commencé : seule la RH peut l'annuler.";

/**
 * Transitions permises (une seule fonction, utilisée par les écrans pour griser un bouton ET par le serveur pour
 * refuser) :
 *   - approuver : étape en cours → étape suivante ; responsable → EN_ATTENTE_RH ; RH ou DG → VALIDEE (effet VALIDER) ;
 *     la RH qui remplace un responsable empêché termine directement (`viaRepli`) ;
 *   - rejeter / demander une modification : par le décideur de l'étape en cours, motif obligatoire ;
 *   - resoumettre : le demandeur seul, depuis MODIFICATION_DEMANDEE ;
 *   - annuler (R9) : le demandeur tant que la date de début n'est pas atteinte (demande en cours, à modifier ou validée) ;
 *     un compte qui porte `conges.annuler` (`peutAnnulerApresDebut`) à tout moment ; jamais une demande rejetée ou annulée.
 */
export function transitionConge(p: ParamsTransitionConge): ResultatTransitionConge {
  const { statut, action, acteur, demandeurId, decideur } = p;
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
    if (statut === "REJETEE" || statut === "ANNULEE") return { ok: false, erreur: MESSAGE_STATUT[statut]! };
    if (!p.peutAnnulerApresDebut) {
      if (!estDemandeur) return { ok: false, erreur: MESSAGE_ANNULATION_NON_AUTORISEE };
      if (p.adebute) return { ok: false, erreur: MESSAGE_CONGE_COMMENCE };
    }
    return { ok: true, statut: "ANNULEE", motif: motif.motif, effet: "SUPPRIMER_PLAGES" };
  }

  // Approuver / rejeter / demander une modification : le décideur de l'étape en cours, et lui seul.
  if (!STATUTS_CONGE_EN_ATTENTE.includes(statut)) {
    return { ok: false, erreur: MESSAGE_STATUT[statut] ?? "Cette demande n'attend plus de décision." };
  }
  const refus = refusDecideurConge(decideur, acteur, demandeurId);
  if (refus) return { ok: false, erreur: refus };
  const viaRepli = decideur !== null && decideur.type !== "RESPONSABLE" && statut === "EN_ATTENTE_RESPONSABLE";
  const etape: "RESPONSABLE" | "RH" = decideur?.type === "RESPONSABLE" ? "RESPONSABLE" : "RH";

  if (action.type === "APPROUVER") {
    // Le responsable envoie à la RH ; la RH (ou le DG en repli) valide.
    if (decideur?.type === "RESPONSABLE") return { ok: true, statut: "EN_ATTENTE_RH", effet: "AUCUN", etape };
    return { ok: true, statut: "VALIDEE", effet: "VALIDER", etape, ...(viaRepli ? { viaRepli: true } : {}) };
  }

  const motif = controlerMotif(action.motif, action.type === "REJETER" ? "Le motif du rejet" : "Le motif de la demande de modification");
  if (!motif.ok) return motif;
  const rejet = action.type === "REJETER";
  return {
    ok: true,
    statut: rejet ? "REJETEE" : "MODIFICATION_DEMANDEE",
    motif: motif.motif,
    effet: rejet ? "SUPPRIMER_PLAGES" : "AUCUN",
    etape,
    ...(viaRepli ? { viaRepli: true } : {}),
  };
}

/**
 * Observation facultative de la RH, jointe à sa décision : réservée à l'étape RH (un responsable n'en écrit pas), 500 caractères
 * au plus, espaces nettoyés. `null` si vide.
 */
export function controlerObservationRH(brut: unknown, etape: "RESPONSABLE" | "RH" | undefined): { ok: true; texte: string | null } | { ok: false; erreur: string } {
  if (brut === undefined || brut === null) return { ok: true, texte: null };
  if (typeof brut !== "string") return { ok: false, erreur: "Observation invalide." };
  const texte = nettoyerMotifConge(brut);
  if (texte === "") return { ok: true, texte: null };
  if (etape !== "RH") return { ok: false, erreur: "L'observation est réservée à la RH, au moment de sa décision." };
  if (texte.length > OBSERVATION_RH_MAX) return { ok: false, erreur: `L'observation ne doit pas dépasser ${OBSERVATION_RH_MAX} caractères.` };
  return { ok: true, texte };
}

// ---------------------------------------------------------------------------------------------------------------------
// Ce que chaque bouton peut faire (affichage grisé + phrase)
// ---------------------------------------------------------------------------------------------------------------------

export interface ActionsPossiblesConge {
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
export function actionsPossiblesConge(p: Omit<ParamsTransitionConge, "action">): ActionsPossiblesConge {
  const essayer = (action: ActionCircuitConge): string | null => {
    const r = transitionConge({ ...p, action });
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
export function destinatairesEtapeConge(statut: StatutCircuitConge, ctx: ContexteCircuitConge): string[] {
  const decideur = decideurPourStatutConge(statut, ctx);
  if (!decideur) return [];
  if (decideur.type === "RESPONSABLE") return [decideur.responsableId];
  const source = decideur.type === "RH" ? ctx.comptesRH : decideur.type === "DG" ? ctx.comptesDG : [];
  return source.filter((id) => id !== ctx.demandeurId);
}

// ---------------------------------------------------------------------------------------------------------------------
// Libellés et frise
// ---------------------------------------------------------------------------------------------------------------------

export const LIBELLE_STATUT_CONGE: Record<StatutCircuitConge, string> = {
  EN_ATTENTE_RESPONSABLE: "En attente du responsable",
  EN_ATTENTE_RH: "En attente de la RH",
  VALIDEE: "Validée",
  REJETEE: "Rejetée",
  ANNULEE: "Annulée",
  MODIFICATION_DEMANDEE: "Modification demandée",
};

export const LIBELLE_NATURE_CONGE: Record<NatureConge, string> = {
  CONGE: "Congé",
  PERMISSION_EXCEPTIONNELLE: "Permission exceptionnelle",
};

/** Actions d'historique (`HistoriqueEntry.entity = "DemandeConge"`). */
export const ACTION_HISTORIQUE_CONGE = {
  SOUMETTRE: "soumission",
  APPROUVER_RESPONSABLE: "approbation_responsable",
  ACCORDER: "accord_rh",
  ACCORDER_PAR_REPLI: "accord_par_repli",
  REJETER: "rejet",
  DEMANDER_MODIFICATION: "demande_modification",
  RESOUMETTRE: "resoumission",
  ANNULER: "annulation",
  /** Congé enregistré par la RH pour le salarié (aucun circuit). */
  SAISIE_RH: "saisie_rh",
  /** Refus après le début : choix de compter ou non les jours déjà passés comme absences (R11). */
  JOURS_PASSES: "jours_passes",
  RAPPEL: "rappel",
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
export function friseConge(params: { statut: StatutCircuitConge; etapeResponsableRequise: boolean }): EtapeFrise[] {
  const { statut, etapeResponsableRequise } = params;
  const validee = statut === "VALIDEE";
  const interrompue = statut === "REJETEE" || statut === "ANNULEE" || statut === "MODIFICATION_DEMANDEE";
  const position = statut === "EN_ATTENTE_RESPONSABLE" ? 1 : statut === "EN_ATTENTE_RH" ? 2 : validee ? 3 : 0;

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
    { cle: "DECISION", libelle: "Congé validé", etat: validee ? "faite" : interrompue ? "interrompue" : "a_venir" },
  ];
}

// ---------------------------------------------------------------------------------------------------------------------
// Qui peut consulter une demande (page de détail)
// ---------------------------------------------------------------------------------------------------------------------

/** Permissions de consultation de toutes les demandes (RH, DG en lecture). */
export const PERMISSIONS_CONSULTATION_CONGE: readonly string[] = ["conges.valider_rh", "conges.consulter_tous"];

/**
 * Le demandeur, le responsable ACTUEL de son service, les comptes RH et ceux qui consultent tout.
 * `permissions` : celles du compte (rôle et délégations : consulter n'engage rien).
 */
export function peutConsulterConge(p: {
  acteurId: string;
  demandeurId: string;
  responsableDuServiceId: string | null;
  permissions: readonly string[];
}): boolean {
  if (p.acteurId === p.demandeurId) return true;
  if (p.responsableDuServiceId !== null && p.responsableDuServiceId === p.acteurId) return true;
  return PERMISSIONS_CONSULTATION_CONGE.some((k) => p.permissions.includes(k));
}
