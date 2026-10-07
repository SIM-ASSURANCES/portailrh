// Circuit de validation, commit 5 (2026-10-09) : à qui notifier à chaque étape, avec quel message, et quand relancer.
//
// Logique PURE (aucun envoi) : la couche d'envoi (`frontend/src/lib/notificationsCircuit.ts`) charge la demande et les
// comptes candidats, puis envoie par le service de notifications existant (`notify`). Règle unique : on ne notifie
// que ceux qui peuvent agir à l'étape courante — mêmes règles que le moteur (`transition`), jamais un nom de rôle.
// Les rappels sont calculés à la volée (aucune tâche planifiée) : une demande à la même étape depuis plus de 48 h
// relance ceux qui doivent agir, au plus une fois par 24 h et par demande (`Demande.dernierRappelAt`).

import type { Prisma } from "./generated/prisma/client";
import type { EtapeCircuit, ModeEtapeDG, NiveauRejet } from "./generated/prisma/enums";
import { LIBELLE_ETAPE_CIRCUIT, refusApprobationCloture, type TypeDemandeCircuit } from "./circuitDemande";

/** Délai avant le premier rappel. */
export const DELAI_RAPPEL_MS = 48 * 60 * 60 * 1000;
/** Écart minimal entre deux rappels d'une même demande. */
export const INTERVALLE_RAPPEL_MS = 24 * 60 * 60 * 1000;

/** Étapes où quelqu'un doit agir pour que la demande avance (rappels). */
export const ETAPES_EN_ATTENTE: readonly EtapeCircuit[] = ["SERVICE", "FINANCE", "DG", "REJET_DG", "DECISION_FINALE", "A_CORRIGER"];

/** Permissions du RÔLE lues pour choisir les destinataires (les permissions de décision ne sont jamais déléguées). */
export const PERMISSIONS_NOTIFICATION_CIRCUIT: readonly string[] = [
  "treso.decider_finance",
  "treso.soumettre_dg",
  "treso.decider_dg",
  "treso.effectuer_reglement",
  "treso.approuver_validation_complete",
];

/** Compte actif pouvant recevoir une notification, avec les permissions de son rôle. */
export interface CandidatNotification {
  id: string;
  permissions: readonly string[];
}

/** Demande telle que relue APRÈS la transition (étape courante, motif du dernier rejet, décideurs). */
export interface ContexteNotificationCircuit {
  demandeId: string;
  reference: string;
  etape: EtapeCircuit;
  typeDemande: TypeDemandeCircuit;
  createurId: string;
  createurNom: string;
  beneficiaireUserId: string | null;
  modeEtapeDG: ModeEtapeDG;
  decideurFinanceId: string | null;
  dgApprobateurId: string | null;
  /** Responsable ACTUEL du service du demandeur. */
  responsableServiceId: string | null;
  niveauRejet: NiveauRejet | null;
  motifRejet: string | null;
  montant: number;
  montantValide: number | null;
  approbationClotureNonRequise: boolean;
  validationCompleteParDG: boolean;
}

export type PrioriteNotification = "INFO" | "IMPORTANT" | "CRITIQUE";

export interface NotificationCircuit {
  destinataires: string[];
  titre: string;
  message: string;
  lien: string;
  priority: PrioriteNotification;
}

const NIVEAU: Record<NiveauRejet, string> = { SERVICE: "Service", FINANCE: "Finance", DG: "DG" };

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

function avec(candidats: readonly CandidatNotification[], ...cles: string[]): string[] {
  return candidats.filter((c) => cles.some((k) => c.permissions.includes(k))).map((c) => c.id);
}

function sans(ids: string[], ...exclus: (string | null | undefined)[]): string[] {
  const e = new Set(exclus.filter(Boolean));
  return [...new Set(ids)].filter((id) => !e.has(id));
}

/**
 * Comptes qui doivent agir à l'étape courante (mêmes règles que `transition`) :
 * - Service : le responsable actuel du service du demandeur (actif), jamais le demandeur ;
 * - Finance, retour après rejet DG : décision Finance ou soumission au DG ; décision finale : décision Finance, jamais
 *   le DG qui a validé (deux personnes). Le demandeur en est exclu, sauf l'auteur d'une dépense directe ;
 * - DG : `treso.decider_dg`, jamais le demandeur ni le décideur Finance ;
 * - À corriger : le demandeur. Terminée et abandonnée : personne ici (voir `notificationsEtape`).
 */
export function destinatairesEtape(ctx: ContexteNotificationCircuit, candidats: readonly CandidatNotification[]): string[] {
  const auteurExclu = ctx.typeDemande === "DEPENSE_DIRECTE" ? null : ctx.createurId;
  switch (ctx.etape) {
    case "SERVICE":
      return ctx.responsableServiceId && candidats.some((c) => c.id === ctx.responsableServiceId)
        ? sans([ctx.responsableServiceId], ctx.createurId)
        : [];
    case "FINANCE":
    case "REJET_DG":
      return sans(avec(candidats, "treso.decider_finance", "treso.soumettre_dg"), auteurExclu);
    case "DECISION_FINALE":
      return sans(avec(candidats, "treso.decider_finance"), auteurExclu, ctx.dgApprobateurId);
    case "DG":
      return sans(avec(candidats, "treso.decider_dg"), ctx.createurId, ctx.decideurFinanceId);
    case "A_CORRIGER":
      return [ctx.createurId];
    case "TERMINEE":
    case "ABANDONNEE":
      return [];
  }
}

/**
 * Approbation de clôture, après la décision finale : seulement si elle est requise et pas encore obtenue (une
 * validation à l'étape DG la vaut déjà) ; destinataires = `treso.approuver_validation_complete` que
 * `refusApprobationCloture` n'écarte pas (ni le demandeur, ni le décideur Finance).
 */
export function destinatairesApprobationCloture(
  ctx: ContexteNotificationCircuit,
  candidats: readonly CandidatNotification[]
): string[] {
  if (ctx.approbationClotureNonRequise || ctx.validationCompleteParDG) return [];
  return avec(candidats, "treso.approuver_validation_complete").filter(
    (id) =>
      refusApprobationCloture(
        { createurId: ctx.createurId, decideurFinanceId: ctx.decideurFinanceId, approbationClotureNonRequise: false },
        id
      ) === null
  );
}

const lienFinance = (id: string) => `/treso/finance/demandes/${id}`;
const lienDemandeur = (id: string) => `/treso/demandes/${id}`;

/** Ce qu'on demande à ceux qui doivent agir à l'étape courante (titre, message, lien). `null` : rien à demander. */
function demandeAction(ctx: ContexteNotificationCircuit): Omit<NotificationCircuit, "destinataires"> | null {
  const ref = ctx.reference;
  switch (ctx.etape) {
    case "SERVICE":
      return {
        titre: "Demande à valider (service)",
        message: `La demande ${ref} de ${ctx.createurNom} (${fcfa(ctx.montant)}) attend votre validation de responsable de service.`,
        lien: `/treso/service/${ctx.demandeId}`,
        priority: "IMPORTANT",
      };
    case "FINANCE":
      return {
        titre: "Demande à décider (Finance)",
        message: `La demande ${ref} de ${ctx.createurNom} (${fcfa(ctx.montant)}) attend la décision de la Finance.`,
        lien: lienFinance(ctx.demandeId),
        priority: "IMPORTANT",
      };
    case "DG":
      return {
        titre: "Demande à décider (étape DG)",
        message:
          ctx.modeEtapeDG === "OBLIGATOIRE"
            ? `La demande ${ref} de ${ctx.createurNom} (${fcfa(ctx.montant)}) attend votre décision à l'étape DG, ligne par ligne.`
            : `La demande ${ref} de ${ctx.createurNom} (${fcfa(ctx.montant)}) vous est soumise par la Finance : elle attend votre décision à l'étape DG.`,
        lien: `/treso/dg/${ctx.demandeId}`,
        priority: "IMPORTANT",
      };
    case "REJET_DG":
      return {
        titre: "Demande rejetée par le DG",
        message: `Le DG a rejeté la demande ${ref}. Motif : ${ctx.motifRejet ?? "non précisé"}. Resoumettez-la au DG ou renvoyez-la au demandeur.`,
        lien: lienFinance(ctx.demandeId),
        priority: "IMPORTANT",
      };
    case "DECISION_FINALE":
      return {
        titre: "Demande validée par le DG : décision finale",
        message: `Le DG a validé la demande ${ref} : la décision finale revient à la Finance.`,
        lien: lienFinance(ctx.demandeId),
        priority: "IMPORTANT",
      };
    case "A_CORRIGER":
      return {
        titre: "Demande à corriger",
        message: `Votre demande ${ref} a été rejetée${ctx.niveauRejet ? ` (niveau ${NIVEAU[ctx.niveauRejet]})` : ""}. Motif : ${ctx.motifRejet ?? "non précisé"}. Corrigez-la et resoumettez-la, ou abandonnez-la.`,
        lien: lienDemandeur(ctx.demandeId),
        priority: "CRITIQUE",
      };
    case "TERMINEE":
    case "ABANDONNEE":
      return null;
  }
}

/**
 * Notifications à envoyer juste après un passage d'étape (création comprise). L'auteur de l'action n'est jamais
 * notifié de sa propre action. Décision finale : le demandeur (montant validé) et l'Assistant Finance (règlement, ni
 * demandeur ni bénéficiaire), plus l'approbation de clôture si elle reste due.
 */
export function notificationsEtape(
  ctx: ContexteNotificationCircuit,
  candidats: readonly CandidatNotification[],
  acteurId: string | null
): NotificationCircuit[] {
  const resultat: NotificationCircuit[] = [];
  const pousser = (n: Omit<NotificationCircuit, "destinataires">, ids: string[]) => {
    const destinataires = sans(ids, acteurId);
    if (destinataires.length > 0) resultat.push({ ...n, destinataires });
  };

  if (ctx.etape === "TERMINEE") {
    const valide = ctx.montantValide ?? 0;
    const totale = Math.round(valide * 100) >= Math.round(ctx.montant * 100);
    pousser(
      {
        titre: totale ? "Demande validée" : "Demande validée partiellement",
        message: totale
          ? `Votre demande ${ctx.reference} a été validée (${fcfa(valide)}).`
          : `Votre demande ${ctx.reference} a été validée partiellement (${fcfa(valide)} sur ${fcfa(ctx.montant)} demandés) — certaines lignes ont été rejetées.`,
        lien: lienDemandeur(ctx.demandeId),
        priority: "IMPORTANT",
      },
      [ctx.createurId]
    );
    pousser(
      {
        titre: "Demande à régler",
        message: `La demande ${ctx.reference} de ${ctx.createurNom} est validée (${fcfa(valide)}) : le règlement peut être effectué.`,
        lien: lienFinance(ctx.demandeId),
        priority: "IMPORTANT",
      },
      sans(avec(candidats, "treso.effectuer_reglement"), ctx.createurId, ctx.beneficiaireUserId)
    );
    const cloture = notificationApprobationCloture(ctx, candidats);
    if (cloture) pousser(cloture, cloture.destinataires);
    return resultat;
  }

  const action = demandeAction(ctx);
  if (action) pousser(action, destinatairesEtape(ctx, candidats));
  return resultat;
}

/** « À approuver avant clôture » : seulement si l'approbation de clôture reste due (voir `destinatairesApprobationCloture`). */
export function notificationApprobationCloture(
  ctx: ContexteNotificationCircuit,
  candidats: readonly CandidatNotification[]
): NotificationCircuit | null {
  const destinataires = destinatairesApprobationCloture(ctx, candidats);
  if (destinataires.length === 0) return null;
  return {
    destinataires,
    titre: "Demande à approuver avant clôture",
    message: `La demande ${ctx.reference} est validée : votre approbation est nécessaire pour qu'elle puisse être clôturée.`,
    lien: "/treso/finance/validations-attente",
    priority: "IMPORTANT",
  };
}

/** Une demande appelle un rappel : à une étape d'attente depuis 48 h au moins, sans rappel depuis 24 h. */
export function rappelDu(
  d: { etape: EtapeCircuit; etapeCircuitDepuis: Date; dernierRappelAt: Date | null },
  maintenant: Date
): boolean {
  if (!ETAPES_EN_ATTENTE.includes(d.etape)) return false;
  if (maintenant.getTime() - d.etapeCircuitDepuis.getTime() < DELAI_RAPPEL_MS) return false;
  return d.dernierRappelAt === null || maintenant.getTime() - d.dernierRappelAt.getTime() >= INTERVALLE_RAPPEL_MS;
}

/** Rappel aux mêmes destinataires que la notification de l'étape, avec la durée d'attente. */
export function notificationRappel(
  ctx: ContexteNotificationCircuit,
  candidats: readonly CandidatNotification[],
  etapeCircuitDepuis: Date,
  maintenant: Date
): NotificationCircuit | null {
  const action = demandeAction(ctx);
  const destinataires = destinatairesEtape(ctx, candidats);
  if (!action || destinataires.length === 0) return null;
  const jours = Math.floor((maintenant.getTime() - etapeCircuitDepuis.getTime()) / (24 * 60 * 60 * 1000));
  return {
    ...action,
    destinataires,
    titre: `Rappel : ${action.titre.charAt(0).toLowerCase()}${action.titre.slice(1)}`,
    message: `En attente depuis ${jours} jour${jours > 1 ? "s" : ""} à l'étape ${LIBELLE_ETAPE_CIRCUIT[ctx.etape]}. ${action.message}`,
  };
}

type DbRappels = Pick<Prisma.TransactionClient, "demande">;

/**
 * Réserve les rappels dus (au plus `limite`) : chaque demande n'est réservée que par une mise à jour conditionnée à
 * son `dernierRappelAt` lu — deux affichages simultanés ne relancent qu'une fois. Renvoie les demandes réservées,
 * avec la date d'entrée dans leur étape.
 */
export async function reserverRappelsDus(
  db: DbRappels,
  maintenant: Date,
  limite = 50
): Promise<{ id: string; etapeCircuitDepuis: Date }[]> {
  const seuilEtape = new Date(maintenant.getTime() - DELAI_RAPPEL_MS);
  const seuilRappel = new Date(maintenant.getTime() - INTERVALLE_RAPPEL_MS);
  const dus = await db.demande.findMany({
    where: {
      etapeCircuit: { in: [...ETAPES_EN_ATTENTE] },
      etapeCircuitDepuis: { lte: seuilEtape },
      OR: [{ dernierRappelAt: null }, { dernierRappelAt: { lte: seuilRappel } }],
    },
    select: { id: true, etapeCircuit: true, etapeCircuitDepuis: true, dernierRappelAt: true },
    orderBy: { etapeCircuitDepuis: "asc" },
    take: limite,
  });
  const reserves: { id: string; etapeCircuitDepuis: Date }[] = [];
  for (const d of dus) {
    if (!rappelDu({ etape: d.etapeCircuit, etapeCircuitDepuis: d.etapeCircuitDepuis, dernierRappelAt: d.dernierRappelAt }, maintenant)) {
      continue;
    }
    const maj = await db.demande.updateMany({
      where: {
        id: d.id,
        etapeCircuit: d.etapeCircuit,
        etapeCircuitDepuis: d.etapeCircuitDepuis,
        OR: [{ dernierRappelAt: null }, { dernierRappelAt: { lte: seuilRappel } }],
      },
      data: { dernierRappelAt: maintenant },
    });
    if (maj.count === 1) reserves.push({ id: d.id, etapeCircuitDepuis: d.etapeCircuitDepuis });
  }
  return reserves;
}
