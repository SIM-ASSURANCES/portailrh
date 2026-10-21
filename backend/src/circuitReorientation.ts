// Lot K (2026-10-26) — réorientation de l'étape Service vers un autre responsable disponible. Règles PURES : aucune base,
// aucun import de valeur Prisma (sûr pour un Client Component). Le moteur du circuit (`transition`, action `REORIENTER`)
// décide QUI peut réorienter et QUAND ; ce fichier décide VERS QUI (candidats éligibles) et pose les libellés.
//
// Principe : le service du demandeur ne change jamais. Seul le décideur de CETTE étape Service change, pour CETTE demande
// (colonne `Demande.responsableEtapeServiceId`). Sans surcharge, c'est le responsable ACTUEL du service (règle d'origine).

/** Motif obligatoire d'une réorientation ou d'une reprise (« Pourquoi réorienter ? »). */
export const MOTIF_REORIENTATION_MIN = 10;

/** Permission de réorienter une demande qui n'est pas la sienne (rôle Finance). N'est PAS une permission de décision. */
export const PERMISSION_REORIENTER_DEMANDE = "treso.reorienter_demande";

/** Action d'historique d'une réorientation (visible du demandeur : c'est l'histoire de SA demande). */
export const ACTION_HISTORIQUE_REORIENTATION = "reorientation_service";

/**
 * Décideur effectif de l'étape Service : la surcharge posée par une réorientation, sinon le responsable actuel du service du
 * demandeur. Une SEULE définition, lue par la file du Service, la garde des pages, le moteur, les notifications et les rappels.
 */
export function responsableServiceEffectif(
  demande: { responsableEtapeServiceId?: string | null },
  serviceResponsableId: string | null | undefined
): string | null {
  return demande.responsableEtapeServiceId ?? serviceResponsableId ?? null;
}

export function refusMotifReorientation(motif: string | null | undefined): string | null {
  return (motif ?? "").trim().length >= MOTIF_REORIENTATION_MIN
    ? null
    : `Le motif est obligatoire (${MOTIF_REORIENTATION_MIN} caractères minimum).`;
}

/** Compte qui est responsable d'au moins un service. */
export interface CandidatResponsable {
  id: string;
  fullName: string;
  actif: boolean;
  /** Noms des services dont il est responsable (affichés à côté de son nom). */
  services: string[];
}

export type RaisonExclusionCandidat = "ACTUEL" | "INACTIF" | "ABSENT" | "DEMANDEUR" | "BENEFICIAIRE";

export interface ContexteReorientation {
  /** Décideur effectif actuel de l'étape (à écarter). */
  actuelId: string | null;
  createurId: string;
  /** Comptes concernés par la demande au sens de la garde 8 (créateur + bénéficiaire de la demande ou d'un article). */
  concernesIds: readonly string[];
  /** Comptes dont la journée est entièrement couverte par une absence autorisée (congé, permission) aujourd'hui. */
  absentsIds: readonly string[];
}

/** Pourquoi ce compte ne peut pas devenir le décideur de l'étape ; `null` s'il le peut. Ordre = priorité du message. */
export function raisonExclusionCandidat(c: CandidatResponsable, ctx: ContexteReorientation): RaisonExclusionCandidat | null {
  if (c.id === ctx.actuelId) return "ACTUEL";
  if (!c.actif) return "INACTIF";
  if (c.id === ctx.createurId) return "DEMANDEUR";
  // Garde 8 : ni le demandeur ni le bénéficiaire (de la demande ou de l'un de ses articles) ne valide l'étape.
  if (ctx.concernesIds.includes(c.id)) return "BENEFICIAIRE";
  if (ctx.absentsIds.includes(c.id)) return "ABSENT";
  return null;
}

const MESSAGE_EXCLUSION: Record<RaisonExclusionCandidat, string> = {
  ACTUEL: "Cette demande est déjà chez ce responsable : choisissez-en un autre.",
  INACTIF: "Ce compte est désactivé : choisissez un responsable actif.",
  ABSENT: "Ce responsable est déclaré absent aujourd'hui : choisissez-en un autre.",
  DEMANDEUR: "Le demandeur ne peut pas valider sa propre demande : choisissez un autre responsable.",
  BENEFICIAIRE: "Ce compte est bénéficiaire de la demande ou de l'un de ses articles : il ne peut pas la valider.",
};

/** Responsables proposables dans la liste déroulante, triés par nom. */
export function responsablesEligibles(candidats: readonly CandidatResponsable[], ctx: ContexteReorientation): CandidatResponsable[] {
  return candidats
    .filter((c) => raisonExclusionCandidat(c, ctx) === null)
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "fr"));
}

/** Refus de la cible choisie (serveur : jamais fiable à la liste affichée) ; `null` si elle est éligible. */
export function refusCibleReorientation(
  cibleId: string | null | undefined,
  candidats: readonly CandidatResponsable[],
  ctx: ContexteReorientation
): string | null {
  if (!cibleId) return "Choisissez le responsable vers lequel réorienter la demande.";
  const c = candidats.find((x) => x.id === cibleId);
  if (!c) return "Ce compte n'est responsable d'aucun service : il ne peut pas valider cette étape.";
  const raison = raisonExclusionCandidat(c, ctx);
  return raison ? MESSAGE_EXCLUSION[raison] : null;
}

/** Délai écoulé à l'étape, en clair (« 3 j 4 h », « 5 h 12 min », « moins d'une minute »). */
export function libelleDelaiEcoule(depuis: Date, maintenant: Date): string {
  const minutes = Math.max(0, Math.floor((maintenant.getTime() - depuis.getTime()) / 60000));
  if (minutes < 1) return "moins d'une minute";
  const jours = Math.floor(minutes / 1440);
  const heures = Math.floor((minutes % 1440) / 60);
  const min = minutes % 60;
  if (jours > 0) return heures > 0 ? `${jours} j ${heures} h` : `${jours} j`;
  if (heures > 0) return min > 0 ? `${heures} h ${min} min` : `${heures} h`;
  return `${min} min`;
}

/** Détail de la ligne d'historique : qui → qui, motif, délai écoulé chez l'ancien décideur. */
export function detailReorientation(p: {
  de: string;
  vers: string;
  motif: string;
  delai: string;
  parDemandeur: boolean;
}): string {
  return (
    `Réorientation de l'étape Service : ${p.de} → ${p.vers}${p.parDemandeur ? " (à la demande du demandeur)" : " (par la Finance)"}` +
    ` — motif : ${p.motif.trim()} — délai écoulé chez ${p.de} : ${p.delai} (chronomètre remis à zéro)`
  );
}
