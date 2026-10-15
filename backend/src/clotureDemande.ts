// Clôture d'une demande À ARTICLES (autonomie des articles, lot C, 2026-10-20). Module PUR : aucune base, aucun import de
// valeur Prisma (sûr pour un Client Component).
//
// Décision 5 : la clôture se fait au niveau de la demande, SEULEMENT quand tous ses articles sont TERMINÉS. Un article est
// terminé quand il est rejeté (définitif, jamais d'argent) ou VALIDÉ ET RÉGLÉ (fonds remis = montant validé) ET À SOLDE NUL
// (fonds remis − dépenses − retours reçus = 0). Tant qu'un article validé n'est pas réglé et régularisé, la clôture normale
// est bloquée avec un message qui liste les articles concernés et ce qui manque.
//
// Clôture FORCÉE : quand un article ne sera jamais régularisé, la Finance peut forcer la clôture avec un motif (10 caractères
// minimum). Elle ne contourne QUE la régularisation : l'approbation de clôture du DG, la décision de tous les articles et
// la garde 8 (conflit d'intérêts) restent exigées. Elle ne touche à aucune écriture de caisse.
//
// Une demande SANS article (dépense directe) garde la règle d'origine (`peutEtreCloturee`) : ce module ne la concerne pas.

import { refusExecutionPropreDemande } from "./circuitDemande";
import type { ArticleBeneficiaire, BeneficiaireStocke } from "./beneficiaireArticles";
import { getEcartLigne, resteNonDetailleTotal, type AgregatsRegularisation } from "./regularisationArticle";

const c = (n: number) => Math.round(n * 100);

/** Motif minimal d'une clôture forcée : plus strict que les 3 caractères habituels (gravité comparable à la réouverture). */
export const MOTIF_CLOTURE_FORCEE_MIN = 10;

export const LIBELLE_CLOTURE_SANS_REGULARISATION = "Clôturé sans régularisation";

/** Un article tel que la règle de clôture le lit. */
export interface ArticleCloture {
  ligneId: string;
  libelle: string;
  beneficiaire: string;
  statut: "EN_ATTENTE" | "VALIDEE" | "REJETEE";
  /** Total de l'article s'il est validé, sinon 0. */
  montantValide: number;
  agregats: AgregatsRegularisation;
  /** Retours de caisse de l'article déclarés et pas encore réceptionnés. */
  retoursEnAttente: number;
}

/** Ce qui empêche un article validé d'être terminé. */
export interface ManqueArticle {
  /** Reste à régler (montant validé − fonds remis), 0 si l'article est réglé en entier. */
  resteARegler: number;
  /** Retours de caisse à réceptionner. */
  retoursEnAttente: number;
  /** Dépenses à détailler (reste non détaillé). */
  resteNonDetaille: number;
  /** Solde à régulariser (fonds remis − dépenses − retours reçus), ≠ 0 tant que l'article n'est pas régularisé. */
  solde: number;
}

/** Article qui bloque la clôture, avec ce qui lui manque. */
export interface ArticleBloquant {
  ligneId: string | null;
  libelle: string;
  beneficiaire: string;
  montantValide: number;
  manque: ManqueArticle;
  /** Phrases lisibles (« reste à régler 20 000 FCFA », « dépenses à détailler 5 000 FCFA », …). */
  manques: string[];
}

const fcfa = (n: number) => `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;

/** Ce qui manque à un article VALIDÉ pour être terminé ; `null` s'il est réglé en entier et à solde nul. */
export function manqueArticle(a: Pick<ArticleCloture, "montantValide" | "agregats" | "retoursEnAttente">): ManqueArticle | null {
  const resteARegler = Math.max(0, c(a.montantValide) - c(a.agregats.fondsRemis)) / 100;
  const solde = getEcartLigne(a.agregats);
  if (resteARegler === 0 && c(solde) === 0) return null;
  return {
    resteARegler,
    retoursEnAttente: a.retoursEnAttente,
    resteNonDetaille: resteNonDetailleTotal(a.agregats),
    solde,
  };
}

/** Phrases lisibles de ce qui manque, dans l'ordre du parcours (règlement, retour, dépenses, solde). */
export function phrasesManque(m: ManqueArticle): string[] {
  const phrases: string[] = [];
  if (c(m.resteARegler) > 0) phrases.push(`reste à régler ${fcfa(m.resteARegler)}`);
  if (m.retoursEnAttente > 0) {
    phrases.push(`${m.retoursEnAttente} retour${m.retoursEnAttente > 1 ? "s" : ""} de caisse à réceptionner`);
  }
  if (c(m.resteNonDetaille) > 0) phrases.push(`dépenses à détailler ${fcfa(m.resteNonDetaille)}`);
  if (c(m.solde) > 0) phrases.push(`solde à régulariser ${fcfa(m.solde)}`);
  if (c(m.solde) < 0) phrases.push(`anomalie : solde négatif ${fcfa(m.solde)}`);
  return phrases;
}

/** Un article est terminé : rejeté, ou validé réglé en entier et à solde nul. Un article encore à décider ne l'est pas. */
export function articleEstTermine(a: Pick<ArticleCloture, "statut" | "montantValide" | "agregats" | "retoursEnAttente">): boolean {
  if (a.statut === "REJETEE") return true;
  if (a.statut === "EN_ATTENTE") return false;
  return manqueArticle(a) === null;
}

export interface EvaluationCloture {
  /** Tous les articles sont décidés (validés ou rejetés) et au moins un est validé. */
  decidee: boolean;
  /** Articles validés qui ne sont pas terminés (vide = clôture normale possible). */
  bloquants: ArticleBloquant[];
  /** Clôture normale (totale ou partielle) possible : décidée ET aucun article bloquant. */
  cloturable: boolean;
  /** Clôture forcée possible : décidée ET au moins un article bloquant (sinon rien à forcer). */
  forcable: boolean;
}

/**
 * Évalue la clôture d'une demande à articles. `partNonRattachee` : agrégats des règlements/retours qui ne sont rattachés à aucun
 * article (anciens règlements ambigus, retours exceptionnels sans article) : un solde non nul bloque lui aussi, sans jamais
 * être attribué à un article au hasard.
 */
export function evaluerCloture(
  articles: readonly ArticleCloture[],
  partNonRattachee?: AgregatsRegularisation | null
): EvaluationCloture {
  const tousDecides = articles.length > 0 && articles.every((a) => a.statut !== "EN_ATTENTE");
  const decidee = tousDecides && articles.some((a) => a.statut === "VALIDEE");
  const bloquants: ArticleBloquant[] = [];
  if (decidee) {
    for (const a of articles) {
      if (a.statut !== "VALIDEE") continue;
      const m = manqueArticle(a);
      if (!m) continue;
      bloquants.push({
        ligneId: a.ligneId,
        libelle: a.libelle,
        beneficiaire: a.beneficiaire,
        montantValide: a.montantValide,
        manque: m,
        manques: phrasesManque(m),
      });
    }
    if (partNonRattachee) {
      const solde = getEcartLigne(partNonRattachee);
      if (c(solde) !== 0) {
        const manque: ManqueArticle = {
          resteARegler: 0,
          retoursEnAttente: partNonRattachee.retoursEnAttente > 0 ? 1 : 0,
          resteNonDetaille: 0,
          solde,
        };
        bloquants.push({
          ligneId: null,
          libelle: "Règlements ou retours non rattachés à un article",
          beneficiaire: "—",
          montantValide: 0,
          manque,
          manques: phrasesManque(manque),
        });
      }
    }
  }
  return { decidee, bloquants, cloturable: decidee && bloquants.length === 0, forcable: decidee && bloquants.length > 0 };
}

/** Phrase d'un article bloquant : « « Formation » (bénéficiaire X) : reste à régler …, dépenses à détailler … ». */
export function phraseArticleBloquant(b: ArticleBloquant): string {
  return b.ligneId
    ? `« ${b.libelle} » (bénéficiaire ${b.beneficiaire}) : ${b.manques.join(", ")}`
    : `${b.libelle} : ${b.manques.join(", ")}`;
}

/** Message de blocage de la clôture normale : liste des articles concernés et ce qui manque à chacun. */
export function messageBlocageCloture(bloquants: readonly ArticleBloquant[]): string {
  const n = bloquants.length;
  return (
    `Clôture impossible : ${n} article${n > 1 ? "s ne sont" : " n'est"} pas terminé${n > 1 ? "s" : ""} (réglé en entier et à solde nul). ` +
    `${bloquants.map(phraseArticleBloquant).join(" ; ")}. ` +
    "Régularisez-les, ou forcez la clôture avec un motif."
  );
}

/** Refus de la clôture forcée : motif trop court, ou conflit d'intérêts (garde 8) ; `null` si elle est permise à `userId`. */
export function refusClotureForcee(
  p: {
    motif: string | null | undefined;
    demande: { createurId: string; lignes: readonly ArticleBeneficiaire[] } & BeneficiaireStocke;
    evaluation: EvaluationCloture;
  },
  userId: string
): string | null {
  if (!p.evaluation.decidee) {
    return "Cette demande ne peut pas être clôturée : des articles sont encore à décider ou chez le DG.";
  }
  if (!p.evaluation.forcable) {
    return "Tous les articles sont terminés : il n'y a rien à forcer, utilisez la clôture normale.";
  }
  if ((p.motif ?? "").trim().length < MOTIF_CLOTURE_FORCEE_MIN) {
    return `Le motif de la clôture forcée est obligatoire (${MOTIF_CLOTURE_FORCEE_MIN} caractères minimum).`;
  }
  // Garde 8 : ni le demandeur ni un bénéficiaire (de la demande ou d'un article) ne force la clôture de sa propre demande.
  return refusExecutionPropreDemande(p.demande, userId);
}

/** Instantané d'un article non régularisé à la clôture forcée (colonne `Demande.clotureForceeArticles`). */
export interface ArticleCloturePartiel {
  ligneId: string | null;
  libelle: string;
  beneficiaire: string;
  montantValide: number;
  resteARegler: number;
  solde: number;
  manques: string[];
}

export function instantaneClotureForcee(bloquants: readonly ArticleBloquant[]): ArticleCloturePartiel[] {
  return bloquants.map((b) => ({
    ligneId: b.ligneId,
    libelle: b.libelle,
    beneficiaire: b.beneficiaire,
    montantValide: b.montantValide,
    resteARegler: b.manque.resteARegler,
    solde: b.manque.solde,
    manques: b.manques,
  }));
}

/** Relit l'instantané stocké en JSON ; ignore tout élément mal formé. */
export function lireInstantaneClotureForcee(json: unknown): ArticleCloturePartiel[] {
  if (!Array.isArray(json)) return [];
  const resultat: ArticleCloturePartiel[] = [];
  for (const x of json) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (typeof o.libelle !== "string") continue;
    resultat.push({
      ligneId: typeof o.ligneId === "string" ? o.ligneId : null,
      libelle: o.libelle,
      beneficiaire: typeof o.beneficiaire === "string" ? o.beneficiaire : "—",
      montantValide: Number(o.montantValide) || 0,
      resteARegler: Number(o.resteARegler) || 0,
      solde: Number(o.solde) || 0,
      manques: Array.isArray(o.manques) ? o.manques.filter((m): m is string => typeof m === "string") : [],
    });
  }
  return resultat;
}

/**
 * Détail lisible d'une clôture forcée : « « Formation » (solde restant 5 000 FCFA — dépenses à détailler 5 000 FCFA) ; … ».
 * Un article JAMAIS réglé (solde nul puisque rien n'a été remis, mais montant validé encore dû) n'affiche pas « solde restant
 * 0 FCFA » : seulement ce qui lui manque (« reste à régler 20 000 FCFA »).
 */
export function detailClotureForcee(articles: readonly ArticleCloturePartiel[]): string {
  return articles
    .map((a) => {
      const jamaisRegle = c(a.resteARegler) > 0 && c(a.solde) === 0;
      if (jamaisRegle) return `« ${a.libelle} » (reste à régler ${fcfa(a.resteARegler)})`;
      return `« ${a.libelle} » (solde restant ${fcfa(a.solde)}${a.manques.length > 0 ? ` — ${a.manques.join(", ")}` : ""})`;
    })
    .join(" ; ");
}

/**
 * Libellé d'un article d'une demande clôturée de force : « Clôturé sans régularisation » avec son solde restant si l'article
 * figure dans l'instantané ET n'est toujours pas terminé ; `null` sinon (article terminé, ou demande non clôturée de force).
 * `termineMaintenant` : l'article est terminé au moment de la lecture (un retour exceptionnel post-clôture a pu le régulariser).
 */
export function libelleArticleClotureForcee(
  demande: { clotureForcee: boolean },
  instantane: readonly ArticleCloturePartiel[],
  ligneId: string,
  termineMaintenant: boolean,
  soldeActuel: number
): string | null {
  if (!demande.clotureForcee || termineMaintenant) return null;
  const entree = instantane.find((a) => a.ligneId === ligneId);
  if (!entree) return null;
  // Article jamais réglé : rien à régulariser (solde nul) mais encore dû — on dit « reste à régler », pas « solde restant 0 ».
  if (c(entree.resteARegler) > 0 && c(soldeActuel) === 0) {
    return `${LIBELLE_CLOTURE_SANS_REGULARISATION} — reste à régler ${fcfa(entree.resteARegler)}`;
  }
  return `${LIBELLE_CLOTURE_SANS_REGULARISATION} — solde restant ${fcfa(soldeActuel)}`;
}
