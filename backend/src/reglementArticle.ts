// Règlement PAR ARTICLE (autonomie des articles, lot D, 2026-10-16). Module PUR : aucune base, aucun import de valeur
// Prisma (sûr pour un Client Component).
//
// Un règlement concerne UN article (`Reglement.ligneDemandeId`). On règle un article validé sans toucher aux autres ;
// plusieurs règlements partiels d'un même article restent possibles, dans la limite de son montant validé. Le budget
// est consommé au règlement de l'article (allocation à 100 % vers SA catégorie). Une demande sans article (dépense
// directe) garde le règlement au niveau de la demande, inchangé.
//
// État intermédiaire sûr : un règlement antérieur au lot D, sur une demande qui a des articles, est « non rattaché »
// quand on ne sait pas quel article il a payé (deux articles validés ou plus). On ne devine jamais : tant qu'il en
// reste un, plus aucun règlement n'est créé, modifié ni confirmé sur cette demande (l'annulation reste possible).

import { totalArticle, type StatutArticle } from "./etatArticles";

export const MESSAGE_REGLEMENTS_NON_RATTACHES =
  "Cette demande a des règlements antérieurs qui ne sont rattachés à aucun article : on ne peut pas savoir quel article ils ont payé. Aucun règlement ne peut être créé, modifié ni confirmé tant qu'ils ne sont pas rattachés (script de rattachement, voir l'équipe technique). L'annulation reste possible.";

export const MESSAGE_ARTICLE_A_CHOISIR = "Choisissez l'article à régler.";
export const MESSAGE_ARTICLE_INTROUVABLE = "Cet article n'appartient pas à cette demande.";
export const MESSAGE_ARTICLE_NON_VALIDE = "Cet article n'est pas validé : seul un article validé peut être réglé.";
export const MESSAGE_ARTICLE_DEJA_REGLE = "Cet article est déjà entièrement réglé.";

/** Article vu sous l'angle du règlement. */
export interface ArticleReglable {
  id: string;
  libelle: string;
  quantite: number;
  prixUnitaire: number | { toString(): string };
  statutValidation: StatutArticle;
  categorieId?: string | null;
}

/** Règlement vu sous l'angle de l'article qu'il paie. */
export interface ReglementArticle {
  id?: string;
  ligneDemandeId: string | null;
  montant: number | { toString(): string };
  estConfirme: boolean;
  estAnnule: boolean;
}

const centimes = (n: number | { toString(): string }) => Math.round(Number(n) * 100);

/** Montant validé d'un article : son total s'il est validé, sinon 0 (rien n'est réglable). */
export function montantValideArticle(article: Pick<ArticleReglable, "quantite" | "prixUnitaire" | "statutValidation">): number {
  return article.statutValidation === "VALIDEE" ? totalArticle(article) : 0;
}

/** Total réglé d'un article : règlements confirmés et non annulés qui lui sont rattachés (centimes exacts). */
export function totalRegleArticle(reglements: readonly ReglementArticle[], ligneId: string): number {
  const c = reglements
    .filter((r) => r.ligneDemandeId === ligneId && r.estConfirme && !r.estAnnule)
    .reduce((s, r) => s + centimes(r.montant), 0);
  return c / 100;
}

/** Reste à régler d'un article : validé − réglé, jamais négatif. */
export function resteAReglerArticle(article: ArticleReglable, reglements: readonly ReglementArticle[]): number {
  const reste = centimes(montantValideArticle(article)) - Math.round(totalRegleArticle(reglements, article.id) * 100);
  return Math.max(0, reste) / 100;
}

/** Règlements non annulés qui ne paient aucun article connu (antérieurs au lot D, cas ambigu non rattaché). */
export function reglementsNonRattaches<T extends ReglementArticle>(reglements: readonly T[]): T[] {
  return reglements.filter((r) => r.ligneDemandeId == null && !r.estAnnule);
}

export type VerdictReglementArticle =
  | { ok: true; ligne: ArticleReglable | null; reste: number }
  | { ok: false; message: string; champ?: "montant" | "ligneDemandeId" };

/**
 * Contrôle d'un règlement (création, modification ou confirmation) au regard des articles de la demande.
 *  - demande SANS article (dépense directe) : `ok`, sans article visé (le contrôle reste celui de la demande) ;
 *  - sinon : article obligatoire, de cette demande, validé ; aucun règlement non rattaché sur la demande ; montant
 *    (s'il est fourni) dans la limite du reste à régler de l'article.
 * `montant` est omis à la confirmation quand le contrôle du plafond se fait avec `confirmation: true` (le total
 * confirmé + ce règlement ne dépasse pas le validé de l'article).
 */
export function verdictReglementArticle(p: {
  articles: readonly ArticleReglable[];
  reglements: readonly ReglementArticle[];
  ligneDemandeId: string | null | undefined;
  montant?: number;
}): VerdictReglementArticle {
  if (p.articles.length === 0) return { ok: true, ligne: null, reste: Number.POSITIVE_INFINITY };
  if (reglementsNonRattaches(p.reglements).length > 0) return { ok: false, message: MESSAGE_REGLEMENTS_NON_RATTACHES };
  if (!p.ligneDemandeId) return { ok: false, message: MESSAGE_ARTICLE_A_CHOISIR, champ: "ligneDemandeId" };
  const ligne = p.articles.find((a) => a.id === p.ligneDemandeId);
  if (!ligne) return { ok: false, message: MESSAGE_ARTICLE_INTROUVABLE, champ: "ligneDemandeId" };
  if (ligne.statutValidation !== "VALIDEE") return { ok: false, message: MESSAGE_ARTICLE_NON_VALIDE, champ: "ligneDemandeId" };
  const reste = resteAReglerArticle(ligne, p.reglements);
  if (reste <= 0) return { ok: false, message: MESSAGE_ARTICLE_DEJA_REGLE, champ: "ligneDemandeId" };
  if (p.montant != null && centimes(p.montant) > centimes(reste)) {
    return {
      ok: false,
      message: `Le montant dépasse le reste à régler de cet article (${reste.toLocaleString("fr-FR")} FCFA).`,
      champ: "montant",
    };
  }
  return { ok: true, ligne, reste };
}

/**
 * Contrôle à la CONFIRMATION d'un règlement déjà créé : même contrôle, avec un plafond calculé sur les règlements
 * confirmés (le brouillon n'en fait pas partie) — l'article doit rester validé et ne pas dépasser son montant validé.
 */
export function verdictConfirmationReglementArticle(p: {
  articles: readonly ArticleReglable[];
  reglements: readonly ReglementArticle[];
  reglement: { ligneDemandeId: string | null; montant: number | { toString(): string } };
}): VerdictReglementArticle {
  if (p.articles.length === 0) return { ok: true, ligne: null, reste: Number.POSITIVE_INFINITY };
  return verdictReglementArticle({
    articles: p.articles,
    reglements: p.reglements,
    ligneDemandeId: p.reglement.ligneDemandeId,
    montant: Number(p.reglement.montant),
  });
}

/** Allocation budgétaire d'un règlement d'article : 100 % vers la catégorie de l'article, aucune si non catégorisé. */
export function allocationsReglementArticle(
  article: Pick<ArticleReglable, "categorieId"> | null,
  categorieDemandeId: string | null,
  montant: number
): { categorieId: string; montant: number }[] {
  const categorieId = article ? (article.categorieId ?? null) : categorieDemandeId;
  return categorieId ? [{ categorieId, montant }] : [];
}

/**
 * Comptes écartés de la notification « Demande à régler » : ceux qui sont bénéficiaires de TOUS les articles validés
 * (sans article validé : le bénéficiaire de la demande). Un bénéficiaire d'un seul article peut régler les autres.
 * Le créateur est écarté à part (il l'est toujours).
 */
export function beneficiairesBloquesReglement(
  demande: { beneficiaireUserId: string | null },
  articles: readonly { statutValidation: StatutArticle; beneficiaireType: unknown; beneficiaireUserId: string | null }[]
): string[] {
  const validees = articles.filter((a) => a.statutValidation === "VALIDEE");
  if (validees.length === 0) return demande.beneficiaireUserId ? [demande.beneficiaireUserId] : [];
  const parArticle = validees.map((a) => (a.beneficiaireType != null ? a.beneficiaireUserId : demande.beneficiaireUserId));
  const premier = parArticle[0];
  return premier && parArticle.every((id) => id === premier) ? [premier] : [];
}
