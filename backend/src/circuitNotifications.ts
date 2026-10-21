// Circuit de validation, commit 5 (2026-10-09) : à qui notifier à chaque étape, avec quel message, et quand relancer.
//
// Logique PURE (aucun envoi) : la couche d'envoi (`frontend/src/lib/notificationsCircuit.ts`) charge la demande et les
// comptes candidats, puis envoie par le service de notifications existant (`notify`). Règle unique : on ne notifie
// que ceux qui peuvent agir à l'étape courante — mêmes règles que le moteur (`transition`), jamais un nom de rôle.
// Les rappels sont calculés à la volée (aucune tâche planifiée) : une demande à la même étape depuis plus de 48 h
// relance ceux qui doivent agir, au plus une fois par 24 h et par demande (`Demande.dernierRappelAt`).

import { motifOuNonRenseigne } from "./motifEchange";
import type { Prisma } from "./generated/prisma/client";
import type { EtapeCircuit, ModeEtapeDG, NiveauRejet, StatutDemande } from "./generated/prisma/enums";
import { LIBELLE_ETAPE_CIRCUIT, refusApprobationCloture, type TypeDemandeCircuit } from "./circuitDemande";
import { phrasesManque, type ManqueArticle } from "./clotureDemande";
import type { EtatArticle, ResumeArticles, StatutArticle } from "./etatArticles";

/** Délai avant le premier rappel. */
export const DELAI_RAPPEL_MS = 48 * 60 * 60 * 1000;
/** Écart minimal entre deux rappels d'une même demande. */
export const INTERVALLE_RAPPEL_MS = 24 * 60 * 60 * 1000;

/** Étapes où quelqu'un doit agir pour que la demande avance (rappels). */
export const ETAPES_EN_ATTENTE: readonly EtapeCircuit[] = ["SERVICE", "FINANCE", "DG", "REJET_DG", "DECISION_FINALE", "A_CORRIGER"];

/**
 * Lot C : une demande à articles TERMINÉE (tous les articles décidés) et pas encore clôturée attend encore des actions par
 * article — règlement, retour de caisse, dépenses à détailler, clôture. Elle est relancée comme les autres, avec UN SEUL
 * chronomètre par demande (`Demande.etapeCircuitDepuis`, remis à zéro à chaque événement d'un article).
 */
export const STATUTS_DEMANDE_CLOS: readonly StatutDemande[] = ["CLOTUREE", "REJETEE", "ABANDONNEE"];

/** Permissions du RÔLE lues pour choisir les destinataires (les permissions de décision ne sont jamais déléguées). */
export const PERMISSIONS_NOTIFICATION_CIRCUIT: readonly string[] = [
  "treso.decider_finance",
  "treso.soumettre_dg",
  "treso.decider_dg",
  "treso.effectuer_reglement",
  "treso.receptionner_retour",
  "treso.cloturer_demande",
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
  /** Comptes qui ne peuvent régler AUCUN article validé (lot D : garde 8 par article) : bénéficiaires de TOUS les articles
   *  validés. Un bénéficiaire d'un seul article peut régler les autres et reste notifié. Absent = bénéficiaire de la demande. */
  beneficiairesBloquesReglement?: string[];
  modeEtapeDG: ModeEtapeDG;
  decideurFinanceId: string | null;
  dgApprobateurId: string | null;
  /** Responsable ACTUEL du service du demandeur. */
  responsableServiceId: string | null;
  niveauRejet: NiveauRejet | null;
  motifRejet: string | null;
  /** Lot M : motif du dernier envoi de la Finance au DG et de la dernière réponse du DG (colonnes de la demande). */
  motifSoumissionDG?: string | null;
  motifDecisionDG?: string | null;
  montant: number;
  montantValide: number | null;
  approbationClotureNonRequise: boolean;
  validationCompleteParDG: boolean;
  /** Comptes qui ont décidé comme Finance (colonne de la demande et chaque article, lot B) ; absent = `decideurFinanceId`. */
  decideursFinanceIds?: string[];
  /** Demande À ARTICLES (lot B) : état des articles, dont dépendent les destinataires (Finance et DG peuvent avoir chacun
   *  des articles à traiter en même temps). Absent : demande sans article (dépense directe), règles d'origine. */
  articles?: ResumeArticles;
  /** Lot C : service du demandeur (rappel de la demande dans chaque notification). */
  serviceNom?: string | null;
  /** Lot C : statut de la demande (une demande clôturée, rejetée ou abandonnée n'est plus relancée). */
  statutDemande?: string;
  /** Lot C : chaque article (libellé, bénéficiaire, montant, état, ce qui lui manque), pour les NOMMER dans les messages. */
  articlesDetail?: ArticleNotification[];
  /** Lot C : articles concernés par l'événement qui vient d'avoir lieu (décidés, soumis au DG…) ; absent = tous les articles pertinents. */
  articlesConcernes?: string[];
  /** Lot C : parmi les articles soumis au DG par cet événement, ceux qu'il avait refusés avant (resoumission). */
  articlesResoumis?: string[];
}

/** Un article tel que les notifications le nomment : « Formation » (bénéficiaire X, 571 000 FCFA). */
export interface ArticleNotification {
  id: string;
  libelle: string;
  beneficiaire: string;
  /** Compte du portail bénéficiaire de l'article (garde 8 : jamais notifié d'une action sur son propre article). */
  beneficiaireUserId: string | null;
  /** Total de l'article (quantité × prix). */
  montant: number;
  statut: StatutArticle;
  etat: EtatArticle;
  /** Motif du rejet, ou du rejet du DG pour un article à trancher. */
  motif: string | null;
  /** Lot M : motif d'envoi de l'article au DG par la Finance, et motif de la réponse du DG. */
  motifSoumissionDG?: string | null;
  motifDecisionDG?: string | null;
  /** Article VALIDÉ : ce qui lui manque pour être terminé (règlement, retour, dépenses, solde) ; `null` = terminé. */
  manque: ManqueArticle | null;
}

/** Ce qui vient de se passer sur la demande (lot B) : détermine qui est prévenu quand l'étape ne change pas. */
export type EvenementCircuit = "ETAPE" | "DECISION_ARTICLES" | "SOUMISSION_DG" | "DECISION_DG";

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
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

/** « Demande DEM-2026-000012 de Aïcha K. (service Commercial) » — rappel de la demande dans chaque notification d'article. */
export function rappelDemande(ctx: Pick<ContexteNotificationCircuit, "reference" | "createurNom" | "serviceNom">): string {
  return `Demande ${ctx.reference} de ${ctx.createurNom}${ctx.serviceNom ? ` (service ${ctx.serviceNom})` : ""}`;
}

/** « Formation » (bénéficiaire X, 571 000 FCFA). */
export function nommerArticle(a: Pick<ArticleNotification, "libelle" | "beneficiaire" | "montant">): string {
  return `« ${a.libelle} » (bénéficiaire ${a.beneficiaire}, ${fcfa(a.montant)})`;
}

const articlesDe = (ctx: ContexteNotificationCircuit, ids?: readonly string[]): ArticleNotification[] =>
  (ctx.articlesDetail ?? []).filter((a) => !ids || ids.includes(a.id));

/** Liste d'articles pour un message : « Articles : A ; B. » (rien si la liste est vide). */
function listeArticles(intro: string, articles: readonly ArticleNotification[], precision: (a: ArticleNotification) => string = () => ""): string {
  if (articles.length === 0) return "";
  return ` ${intro} : ${articles.map((a) => `${nommerArticle(a)}${precision(a)}`).join(" ; ")}.`;
}

/** Précision d'un article pour la Finance : ce qui est attendu d'elle. */
function precisionFinance(a: ArticleNotification): string {
  if (a.etat === "VALIDEE_DG_A_CONFIRMER") return ` — validé par le DG (motif du DG : ${motifOuNonRenseigne(a.motifDecisionDG)}), à confirmer`;
  if (a.etat === "REFUSEE_DG_A_TRANCHER") return ` — rejeté par le DG (motif du DG : ${motifOuNonRenseigne(a.motifDecisionDG ?? a.motif)}), à resoumettre ou à rejeter`;
  return " — à décider";
}

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
  return audiencesEtape(ctx, candidats).flatMap((x) => x.destinataires).filter((id, i, tous) => tous.indexOf(id) === i);
}

const decideursFinance = (ctx: ContexteNotificationCircuit) =>
  ctx.decideursFinanceIds ?? (ctx.decideurFinanceId ? [ctx.decideurFinanceId] : []);

/** Audience Finance d'une demande à articles : décision Finance ou soumission au DG, jamais le demandeur. */
const destinatairesFinanceArticles = (ctx: ContexteNotificationCircuit, candidats: readonly CandidatNotification[]) =>
  sans(avec(candidats, "treso.decider_finance", "treso.soumettre_dg"), ctx.createurId);

/** Audience DG d'une demande à articles : `treso.decider_dg`, jamais le demandeur ni un décideur Finance (deux personnes). */
const destinatairesDGArticles = (ctx: ContexteNotificationCircuit, candidats: readonly CandidatNotification[]) =>
  sans(avec(candidats, "treso.decider_dg"), ctx.createurId, ...decideursFinance(ctx));

export type AudienceEtape = { audience: "FINANCE" | "DG" | "AUTRE"; destinataires: string[] };

/**
 * Audiences à l'étape courante. Demande À ARTICLES à l'étape Finance ou DG (lot B) : la Finance si au moins un article
 * l'attend, le DG si au moins un article est chez lui — les deux peuvent attendre en même temps. Sinon, une seule
 * audience selon l'étape (règles d'origine).
 */
export function audiencesEtape(ctx: ContexteNotificationCircuit, candidats: readonly CandidatNotification[]): AudienceEtape[] {
  if (ctx.articles && (ctx.etape === "FINANCE" || ctx.etape === "DG")) {
    const resultat: AudienceEtape[] = [];
    if (ctx.articles.pourFinance > 0) resultat.push({ audience: "FINANCE", destinataires: destinatairesFinanceArticles(ctx, candidats) });
    if (ctx.articles.chezDG > 0) resultat.push({ audience: "DG", destinataires: destinatairesDGArticles(ctx, candidats) });
    return resultat;
  }
  const dest = destinatairesEtapeSimple(ctx, candidats);
  const audience = ctx.etape === "DG" ? "DG" : ctx.etape === "FINANCE" || ctx.etape === "REJET_DG" || ctx.etape === "DECISION_FINALE" ? "FINANCE" : "AUTRE";
  return [{ audience, destinataires: dest }];
}

function destinatairesEtapeSimple(ctx: ContexteNotificationCircuit, candidats: readonly CandidatNotification[]): string[] {
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
      return sans(avec(candidats, "treso.decider_dg"), ctx.createurId, ...decideursFinance(ctx));
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
        { createurId: ctx.createurId, decideursFinanceIds: decideursFinance(ctx), approbationClotureNonRequise: false },
        id
      ) === null
  );
}

const lienFinance = (id: string) => `/treso/finance/demandes/${id}`;
const lienDemandeur = (id: string) => `/treso/demandes/${id}`;

/** Ce qu'on demande à ceux qui doivent agir à l'étape courante (titre, message, lien). `null` : rien à demander. */
function demandeAction(
  ctx: ContexteNotificationCircuit,
  audience: AudienceEtape["audience"] = "AUTRE"
): Omit<NotificationCircuit, "destinataires"> | null {
  const ref = ctx.reference;
  // Demande À ARTICLES (lot B) : le message dit combien d'articles attendent CETTE audience.
  if (ctx.articles && audience === "FINANCE" && (ctx.etape === "FINANCE" || ctx.etape === "DG")) {
    const x = ctx.articles;
    const aDecider = x.pourFinance - x.valideesDGAConfirmer - x.refuseesDGATrancher;
    const morceaux: string[] = [];
    if (aDecider > 0) morceaux.push(`${pluriel(aDecider, "article")} à décider`);
    if (x.valideesDGAConfirmer > 0) morceaux.push(`${pluriel(x.valideesDGAConfirmer, "article")} validé${x.valideesDGAConfirmer > 1 ? "s" : ""} par le DG à confirmer`);
    if (x.refuseesDGATrancher > 0) morceaux.push(`${pluriel(x.refuseesDGATrancher, "article")} rejeté${x.refuseesDGATrancher > 1 ? "s" : ""} par le DG à resoumettre ou à rejeter`);
    const enAttente = articlesDe(ctx).filter((a) => a.etat === "A_DECIDER" || a.etat === "VALIDEE_DG_A_CONFIRMER" || a.etat === "REFUSEE_DG_A_TRANCHER");
    return {
      titre: "Demande à décider (Finance)",
      message:
        `La demande ${ref} de ${ctx.createurNom}${ctx.serviceNom ? ` (service ${ctx.serviceNom})` : ""} — ${fcfa(ctx.montant)} — attend la Finance : ${morceaux.join(", ")} (${x.traites}/${x.total} articles traités).` +
        listeArticles("Articles en attente", enAttente, precisionFinance),
      lien: lienFinance(ctx.demandeId),
      priority: "IMPORTANT",
    };
  }
  if (ctx.articles && audience === "DG" && (ctx.etape === "FINANCE" || ctx.etape === "DG")) {
    const n = ctx.articles.chezDG;
    const chezDG = articlesDe(ctx).filter((a) => a.etat === "CHEZ_DG");
    const resoumis = (ctx.articlesResoumis ?? []).length;
    const service = ctx.serviceNom ? ` (service ${ctx.serviceNom})` : "";
    return {
      titre: "Demande à décider (étape DG)",
      message:
        (ctx.modeEtapeDG === "OBLIGATOIRE"
          ? `La demande ${ref} de ${ctx.createurNom}${service} — ${fcfa(ctx.montant)} — attend votre décision à l'étape DG, article par article (${ctx.articles.traites}/${ctx.articles.total} articles traités).`
          : `${pluriel(n, "article")} de la demande ${ref} de ${ctx.createurNom}${service} vous ${n > 1 ? "sont soumis" : "est soumis"}${resoumis > 0 ? ` (dont ${resoumis} resoumis après rejet)` : ""} par la Finance : décidez-${n > 1 ? "les" : "le"} un par un à l'étape DG.`) +
        listeArticles("Articles à décider", chezDG, (a) => ` — motif d'envoi de la Finance : ${motifOuNonRenseigne(a.motifSoumissionDG)}`),
      lien: `/treso/dg/${ctx.demandeId}`,
      priority: "IMPORTANT",
    };
  }
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
            : `La demande ${ref} de ${ctx.createurNom} (${fcfa(ctx.montant)}) vous est soumise par la Finance : elle attend votre décision à l'étape DG. Motif de la Finance : ${motifOuNonRenseigne(ctx.motifSoumissionDG)}.`,
        lien: `/treso/dg/${ctx.demandeId}`,
        priority: "IMPORTANT",
      };
    case "REJET_DG":
      return {
        titre: "Demande rejetée par le DG",
        message: `Le DG a rejeté la demande ${ref}. Motif du DG : ${motifOuNonRenseigne(ctx.motifDecisionDG ?? ctx.motifRejet)}. Resoumettez-la au DG (avec un nouveau motif) ou renvoyez-la au demandeur.`,
        lien: lienFinance(ctx.demandeId),
        priority: "IMPORTANT",
      };
    case "DECISION_FINALE":
      return {
        titre: "Demande validée par le DG : décision finale",
        message: `Le DG a validé la demande ${ref} : la décision finale revient à la Finance. Motif du DG : ${motifOuNonRenseigne(ctx.motifDecisionDG)}.`,
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
 * Notifications à envoyer juste après un événement de la demande. L'auteur de l'action n'est jamais notifié de sa
 * propre action. Étape terminée : le demandeur (montant validé) et l'Assistant Finance (règlement, ni demandeur ni
 * bénéficiaire), plus l'approbation de clôture si elle reste due.
 *
 * Demande À ARTICLES (lot B, `ctx.articles`) : l'étape ne change plus à chaque décision, c'est donc l'`evenement` qui dit
 * qui est prévenu. Décision de la Finance qui laisse la demande en cours : le demandeur (articles décidés, montant
 * validé) et les Assistants (montant à régler) ; soumission au DG : le DG ; DG qui a terminé son examen : la Finance.
 */
export function notificationsEtape(
  ctx: ContexteNotificationCircuit,
  candidats: readonly CandidatNotification[],
  acteurId: string | null,
  evenement: EvenementCircuit = "ETAPE"
): NotificationCircuit[] {
  const resultat: NotificationCircuit[] = [];
  const pousser = (n: Omit<NotificationCircuit, "destinataires">, ids: string[]) => {
    const destinataires = sans(ids, acteurId);
    if (destinataires.length > 0) resultat.push({ ...n, destinataires });
  };
  const enCours = ctx.articles !== undefined && (ctx.etape === "FINANCE" || ctx.etape === "DG");

  if (ctx.etape === "TERMINEE" || (enCours && evenement === "DECISION_ARTICLES")) {
    const valide = ctx.montantValide ?? 0;
    const totale = Math.round(valide * 100) >= Math.round(ctx.montant * 100);
    // Lot C : les articles décidés par CET événement sont nommés (libellé, bénéficiaire, montant), une seule notification par audience.
    const decides = articlesDe(ctx, ctx.articlesConcernes).filter((a) => a.statut !== "EN_ATTENTE");
    const detailDecisions = listeArticles("Détail", decides, (a) =>
      a.statut === "VALIDEE" ? " : validé" : ` : rejeté${a.motif ? ` (motif : ${a.motif})` : ""}`
    );
    const validesConcernes = decides.filter((a) => a.statut === "VALIDEE");
    if (ctx.etape === "TERMINEE") {
      pousser(
        {
          titre: totale ? "Demande validée" : "Demande validée partiellement",
          message: (totale
            ? `Votre demande ${ctx.reference} a été validée (${fcfa(valide)}).`
            : `Votre demande ${ctx.reference} a été validée partiellement (${fcfa(valide)} sur ${fcfa(ctx.montant)} demandés) — certaines lignes ont été rejetées.`) + detailDecisions,
          lien: lienDemandeur(ctx.demandeId),
          priority: "IMPORTANT",
        },
        [ctx.createurId]
      );
    } else if (ctx.articles) {
      pousser(
        {
          titre: "Articles de votre demande décidés",
          message: `Votre demande ${ctx.reference} : ${ctx.articles.validees} article(s) validé(s), ${ctx.articles.rejetees} rejeté(s) sur ${ctx.articles.total} (${fcfa(valide)} validés pour l'instant). Les autres articles sont en cours de traitement.` + detailDecisions,
          lien: lienDemandeur(ctx.demandeId),
          priority: "IMPORTANT",
        },
        [ctx.createurId]
      );
    }
    if (valide > 0) {
      pousser(
        {
          titre: "Demande à régler",
          message:
            `${rappelDemande(ctx)} est validée${ctx.etape === "TERMINEE" ? "" : " en partie"} (${fcfa(valide)}) : le règlement peut être effectué.` +
            listeArticles("Articles à régler", validesConcernes.length > 0 ? validesConcernes : articlesDe(ctx).filter((a) => a.statut === "VALIDEE" && a.manque?.resteARegler)),
          lien: lienFinance(ctx.demandeId),
          priority: "IMPORTANT",
        },
        sans(avec(candidats, "treso.effectuer_reglement"), ctx.createurId, ...(ctx.beneficiairesBloquesReglement ?? [ctx.beneficiaireUserId]))
      );
    }
    if (ctx.etape === "TERMINEE") {
      const cloture = notificationApprobationCloture(ctx, candidats);
      if (cloture) pousser(cloture, cloture.destinataires);
    }
    // Articles restant à la Finance ou chez le DG : eux aussi sont à traiter (voir ci-dessous), sans doublon.
    if (ctx.etape === "TERMINEE") return resultat;
  }

  const audiences = audiencesEtape(ctx, candidats);
  for (const x of audiences) {
    // Demande à articles en cours : on ne relance que l'audience concernée par l'événement.
    if (enCours) {
      if (evenement === "SOUMISSION_DG" && x.audience !== "DG") continue;
      // Le DG a fini son examen (plus aucun article chez lui) : la Finance reprend la main. Avant, seuls les refus notifient.
      if (evenement === "DECISION_DG" && (x.audience !== "FINANCE" || (ctx.articles?.chezDG ?? 0) > 0)) continue;
      // Décision de la Finance : la Finance n'a pas à être re-notifiée d'avoir décidé ; le DG l'est seulement s'il a ses articles
      // depuis la dernière soumission (déjà notifié alors).
      if (evenement === "DECISION_ARTICLES") continue;
    }
    const action = demandeAction(ctx, x.audience);
    if (action) pousser(action, x.destinataires);
  }
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

/**
 * Lot C — ce qui attend encore une action sur une demande TERMINÉE (tous les articles décidés) et pas clôturée, article par
 * article et par audience :
 *  - règlement (`treso.effectuer_reglement`) : articles validés avec un reste à régler ;
 *  - retours et dépenses (`treso.receptionner_retour`) : retours de caisse à réceptionner, dépenses à détailler ;
 *  - clôture (`treso.cloturer_demande`) : tous les articles sont terminés, la demande est prête à être clôturée ;
 *  - approbation du DG (`treso.approuver_validation_complete`) si elle reste due.
 * Garde 8 PAR ARTICLE : un compte n'est jamais prévenu d'une action sur un article dont il est le demandeur ou le bénéficiaire.
 * Aucun doublon : une notification par compte et par audience, qui liste TOUS ses articles en attente.
 */
export function notificationsAttenteArticles(
  ctx: ContexteNotificationCircuit,
  candidats: readonly CandidatNotification[]
): NotificationCircuit[] {
  if (ctx.etape !== "TERMINEE" || STATUTS_DEMANDE_CLOS.includes((ctx.statutDemande ?? "") as StatutDemande)) return [];
  const validees = articlesDe(ctx).filter((a) => a.statut === "VALIDEE");
  if (validees.length === 0) return [];
  const resultat: NotificationCircuit[] = [];
  const concerne = (a: ArticleNotification, id: string) => id === ctx.createurId || a.beneficiaireUserId === id;

  const parCompte = (
    permission: string,
    selection: (a: ArticleNotification) => boolean,
    construire: (liste: ArticleNotification[]) => Omit<NotificationCircuit, "destinataires">
  ) => {
    for (const id of avec(candidats, permission)) {
      const liste = validees.filter((a) => selection(a) && !concerne(a, id));
      if (liste.length > 0) resultat.push({ ...construire(liste), destinataires: [id] });
    }
  };

  parCompte(
    "treso.effectuer_reglement",
    (a) => (a.manque?.resteARegler ?? 0) > 0,
    (liste) => ({
      titre: "Articles à régler",
      message: `${rappelDemande(ctx)} — validée (${fcfa(ctx.montantValide ?? 0)}) : ${pluriel(liste.length, "article")} à régler.${listeArticles("Articles", liste, (a) => ` — reste à régler ${fcfa(a.manque?.resteARegler ?? 0)}`)}`,
      lien: lienFinance(ctx.demandeId),
      priority: "IMPORTANT",
    })
  );
  parCompte(
    "treso.receptionner_retour",
    (a) => (a.manque ? a.manque.retoursEnAttente > 0 || a.manque.resteNonDetaille > 0 : false),
    (liste) => ({
      titre: "Retours de caisse et dépenses à traiter",
      message: `${rappelDemande(ctx)} : ${pluriel(liste.length, "article")} à régulariser.${listeArticles("Articles", liste, (a) => ` — ${phrasesManque({ ...(a.manque as ManqueArticle), resteARegler: 0 }).join(", ")}`)}`,
      lien: lienFinance(ctx.demandeId),
      priority: "IMPORTANT",
    })
  );
  // Prête à clôturer : tous les articles validés sont terminés. La Finance peut clôturer (le DG a-t-il approuvé ? sinon il est relancé).
  if (validees.every((a) => a.manque === null)) {
    for (const id of avec(candidats, "treso.cloturer_demande")) {
      if (id === ctx.createurId || validees.some((a) => a.beneficiaireUserId === id)) continue;
      resultat.push({
        destinataires: [id],
        titre: "Demande prête à être clôturée",
        message: `${rappelDemande(ctx)} : tous les articles sont réglés et régularisés (ou rejetés) — la demande peut être clôturée.`,
        lien: lienFinance(ctx.demandeId),
        priority: "IMPORTANT",
      });
    }
  }
  const approbation = notificationApprobationCloture(ctx, candidats);
  if (approbation) resultat.push(approbation);
  return resultat;
}

/** Une demande appelle un rappel : à une étape d'attente depuis 48 h au moins, sans rappel depuis 24 h. */
export function rappelDu(
  d: { etape: EtapeCircuit; etapeCircuitDepuis: Date; dernierRappelAt: Date | null; suiviArticles?: boolean },
  maintenant: Date
): boolean {
  // Lot C : une demande TERMINÉE n'est relancée que si elle a un suivi par article en cours (articles validés, pas clôturée).
  const relancable = ETAPES_EN_ATTENTE.includes(d.etape) || (d.etape === "TERMINEE" && d.suiviArticles === true);
  if (!relancable) return false;
  if (maintenant.getTime() - d.etapeCircuitDepuis.getTime() < DELAI_RAPPEL_MS) return false;
  return d.dernierRappelAt === null || maintenant.getTime() - d.dernierRappelAt.getTime() >= INTERVALLE_RAPPEL_MS;
}

/** Rappels aux mêmes destinataires que les notifications de l'étape, avec la durée d'attente (un par audience). */
export function notificationsRappel(
  ctx: ContexteNotificationCircuit,
  candidats: readonly CandidatNotification[],
  etapeCircuitDepuis: Date,
  maintenant: Date
): NotificationCircuit[] {
  const jours = Math.floor((maintenant.getTime() - etapeCircuitDepuis.getTime()) / (24 * 60 * 60 * 1000));
  const resultat: NotificationCircuit[] = [];
  const attente = `En attente depuis ${jours} jour${jours > 1 ? "s" : ""}`;
  // Lot C : demande terminée mais pas clôturée — les articles qui attendent encore une action sont nommés, par audience.
  if (ctx.etape === "TERMINEE") {
    return notificationsAttenteArticles(ctx, candidats).map((n) => ({
      ...n,
      titre: `Rappel : ${n.titre.charAt(0).toLowerCase()}${n.titre.slice(1)}`,
      message: `${attente} sans événement sur la demande. ${n.message}`,
    }));
  }
  for (const x of audiencesEtape(ctx, candidats)) {
    const action = demandeAction(ctx, x.audience);
    if (!action || x.destinataires.length === 0) continue;
    resultat.push({
      ...action,
      destinataires: x.destinataires,
      titre: `Rappel : ${action.titre.charAt(0).toLowerCase()}${action.titre.slice(1)}`,
      message: `En attente depuis ${jours} jour${jours > 1 ? "s" : ""} à l'étape ${LIBELLE_ETAPE_CIRCUIT[ctx.etape]}. ${action.message}`,
    });
  }
  return resultat;
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
      etapeCircuitDepuis: { lte: seuilEtape },
      AND: [
        {
          OR: [
            { etapeCircuit: { in: [...ETAPES_EN_ATTENTE] } },
            // Lot C : demande terminée avec des articles validés, pas encore clôturée (suivi par article).
            { etapeCircuit: "TERMINEE", statut: { notIn: [...STATUTS_DEMANDE_CLOS] }, lignes: { some: { statutValidation: "VALIDEE" } } },
          ],
        },
        { OR: [{ dernierRappelAt: null }, { dernierRappelAt: { lte: seuilRappel } }] },
      ],
    },
    select: { id: true, etapeCircuit: true, etapeCircuitDepuis: true, dernierRappelAt: true },
    orderBy: { etapeCircuitDepuis: "asc" },
    take: limite,
  });
  const reserves: { id: string; etapeCircuitDepuis: Date }[] = [];
  for (const d of dus) {
    if (
      !rappelDu(
        { etape: d.etapeCircuit, etapeCircuitDepuis: d.etapeCircuitDepuis, dernierRappelAt: d.dernierRappelAt, suiviArticles: true },
        maintenant
      )
    ) {
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

/**
 * Refus d'une ligne par le DG (2026-10-10, règle 3) : la Finance qui peut agir (décision ou soumission au DG) est
 * prévenue à chaque refus — jamais le DG auteur du refus, jamais le demandeur. Le refus de la DERNIÈRE ligne en attente
 * passe la demande à la décision finale : la notification d'étape (`notificationsEtape`) le dit déjà, celle-ci n'est
 * alors pas envoyée (une seule notification par refus).
 */
export function notificationRefusLigneDG(
  ctx: ContexteNotificationCircuit,
  candidats: readonly CandidatNotification[],
  refus: { libelle: string; motif: string; ligneId?: string },
  acteurId: string
): NotificationCircuit | null {
  const destinataires = sans(avec(candidats, "treso.decider_finance", "treso.soumettre_dg"), ctx.createurId, acteurId);
  if (destinataires.length === 0) return null;
  // Lot C : l'article refusé est nommé avec son bénéficiaire et son montant, et la demande rappelée.
  const article = refus.ligneId ? articlesDe(ctx, [refus.ligneId])[0] : undefined;
  return {
    destinataires,
    titre: "Ligne rejetée par le DG",
    message: `${rappelDemande(ctx)} — le DG a rejeté la ligne ${article ? nommerArticle(article) : `« ${refus.libelle} »`}. Motif du DG : ${refus.motif}. Resoumettez-la au DG (avec un nouveau motif) ou rejetez-la définitivement.`,
    lien: lienFinance(ctx.demandeId),
    priority: "IMPORTANT",
  };
}

// ---------- Lot K : réorientation de l'étape Service et reprise (retour à l'étape précédente) ----------

export interface EvenementReorientation {
  acteurId: string;
  ancienId: string | null;
  nouveauId: string;
  ancienNom: string;
  nouveauNom: string;
  motif: string;
  /** Délai écoulé chez l'ancien décideur (le chronomètre repart de zéro chez le nouveau). */
  delai: string;
}

/**
 * Réorientation de l'étape Service : le NOUVEAU responsable doit agir ; l'ANCIEN apprend que la demande lui est retirée (il ne
 * peut plus la décider) ; le demandeur est prévenu quand ce n'est pas lui qui l'a réorientée. Jamais l'auteur de l'action.
 */
export function notificationsReorientation(ctx: ContexteNotificationCircuit, e: EvenementReorientation): NotificationCircuit[] {
  const resultat: NotificationCircuit[] = [];
  const nouveau = sans([e.nouveauId], e.acteurId);
  if (nouveau.length > 0) {
    resultat.push({
      destinataires: nouveau,
      titre: "Demande à valider (réorientée vers vous)",
      message: `${rappelDemande(ctx)} vous a été réorientée pour l'étape du responsable de service (${fcfa(ctx.montant)}). Motif : ${e.motif.trim()}`,
      lien: `/treso/service/${ctx.demandeId}`,
      priority: "IMPORTANT",
    });
  }
  const ancien = sans(e.ancienId ? [e.ancienId] : [], e.acteurId, e.nouveauId);
  if (ancien.length > 0) {
    resultat.push({
      destinataires: ancien,
      titre: "Demande retirée de votre file",
      message: `${rappelDemande(ctx)} a été réorientée vers ${e.nouveauNom} : vous n'avez plus à la valider. Motif : ${e.motif.trim()}`,
      lien: "/treso/service",
      priority: "INFO",
    });
  }
  const demandeur = sans([ctx.createurId], e.acteurId);
  if (demandeur.length > 0) {
    resultat.push({
      destinataires: demandeur,
      titre: "Votre demande a été réorientée",
      message: `${rappelDemande(ctx)} est désormais chez ${e.nouveauNom} pour la validation du responsable de service (avant : ${e.ancienNom}). Motif : ${e.motif.trim()}`,
      lien: lienDemandeur(ctx.demandeId),
      priority: "INFO",
    });
  }
  return resultat;
}

export type TypeRepriseNotif = "FINANCE_VERS_SERVICE" | "DG_VERS_FINANCE" | "VALIDATION_VERS_FINANCE";

export interface EvenementReprise {
  acteurId: string;
  type: TypeRepriseNotif;
  motif: string;
  /** Article repris (absent pour la demande entière). */
  article?: ArticleNotification;
  libelleArticle?: string | null;
}

/**
 * Reprise : le décideur de l'étape PRÉCÉDENTE est prévenu avec le motif — le responsable du service (Finance → Service), la
 * Finance (DG → Finance, validation → Finance), et le DG quand la Finance retire un article de son étape. Le demandeur est
 * informé de tout retour en arrière de sa demande. Jamais l'auteur de l'action.
 */
export function notificationsReprise(
  ctx: ContexteNotificationCircuit,
  candidats: readonly CandidatNotification[],
  e: EvenementReprise
): NotificationCircuit[] {
  const cible = e.article ? `l'article ${nommerArticle(e.article)}` : e.libelleArticle ? `l'article « ${e.libelleArticle} »` : "la demande entière";
  const resultat: NotificationCircuit[] = [];
  if (e.type === "FINANCE_VERS_SERVICE") {
    const dest = sans(ctx.responsableServiceId ? [ctx.responsableServiceId] : [], ctx.createurId, e.acteurId);
    if (dest.length > 0) {
      resultat.push({
        destinataires: dest,
        titre: "Demande reprise par la Finance",
        message: `${rappelDemande(ctx)} vous est renvoyée par la Finance : ${cible} repasse à l'étape du responsable de service. Motif : ${e.motif.trim()}`,
        lien: `/treso/service/${ctx.demandeId}`,
        priority: "IMPORTANT",
      });
    }
  } else {
    const aLaFinance = sans(avec(candidats, "treso.decider_finance", "treso.soumettre_dg"), ctx.createurId, e.acteurId);
    if (aLaFinance.length > 0) {
      resultat.push({
        destinataires: aLaFinance,
        titre: e.type === "DG_VERS_FINANCE" ? "Article repris à l'étape DG" : "Validation reprise : article à décider",
        message:
          `${rappelDemande(ctx)} — ${cible} revient à la Finance` +
          `${e.type === "DG_VERS_FINANCE" ? " (retiré de l'étape du DG)" : " (sa validation est reprise)"}. Motif : ${e.motif.trim()}`,
        lien: lienFinance(ctx.demandeId),
        priority: "IMPORTANT",
      });
    }
    // La Finance qui retire un article de l'étape du DG : le DG n'a plus à le décider.
    if (e.type === "DG_VERS_FINANCE") {
      const auDG = sans(avec(candidats, "treso.decider_dg"), ctx.createurId, e.acteurId, ...aLaFinance);
      if (auDG.length > 0) {
        resultat.push({
          destinataires: auDG,
          titre: "Article retiré de votre étape",
          message: `${rappelDemande(ctx)} — ${cible} n'est plus à décider par le DG. Motif : ${e.motif.trim()}`,
          lien: `/treso/dg/${ctx.demandeId}`,
          priority: "INFO",
        });
      }
    }
  }
  const demandeur = sans([ctx.createurId], e.acteurId);
  if (demandeur.length > 0) {
    resultat.push({
      destinataires: demandeur,
      titre: "Votre demande est revenue à l'étape précédente",
      message: `${rappelDemande(ctx)} — ${cible} est revenue à l'étape précédente du circuit. Motif : ${e.motif.trim()}`,
      lien: lienDemandeur(ctx.demandeId),
      priority: "INFO",
    });
  }
  return resultat;
}
