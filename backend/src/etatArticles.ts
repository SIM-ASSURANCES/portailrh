// Autonomie des articles, lot B (2026-10-15) — état d'un article, étape et statut DÉDUITS des articles. Module PUR :
// aucune base, aucun import de valeur Prisma (sûr pour un Client Component).
//
// Un article (ligne de demande) vit sa vie propre dans le circuit :
//
//   A_DECIDER ──(Finance valide / rejette)──────────────▶ VALIDEE | REJETEE            (définitif)
//   A_DECIDER ──(Finance soumet au DG)──▶ CHEZ_DG ──(DG valide)──▶ VALIDEE_DG_A_CONFIRMER ──(Finance)──▶ VALIDEE
//                                                  └─(DG refuse)─▶ REFUSEE_DG_A_TRANCHER ──(Finance)──▶ REJETEE
//                                                                                     └──(Finance resoumet)──▶ CHEZ_DG
//
// « DG définitif » (décision du 2026-10-10, conservée) : un article validé par le DG reste validé, un article refusé par
// le DG n'est jamais validé par la Finance seule. Dans le cas (b) (`modeEtapeDG = OBLIGATOIRE`, demande émise par la
// Finance) tout article en attente est chez le DG, dont la décision est définitive.
//
// L'étape de la demande n'est plus un état propre : elle se DÉDUIT des articles (`etapeDepuisArticles`), de même que le
// statut (`statutDepuisLignes`). La colonne `Demande.etapeCircuit` est conservée et tenue à jour (les rappels, les files
// de l'étape Service et ~30 fichiers la lisent) ; les files de la Finance et du DG sont des requêtes sur les articles.

import type { EtapeCircuit, ModeEtapeDG, StatutDemande } from "./generated/prisma/enums";

export type StatutArticle = "EN_ATTENTE" | "VALIDEE" | "REJETEE";

export type EtatArticle =
  | "A_DECIDER"
  | "CHEZ_DG"
  | "VALIDEE_DG_A_CONFIRMER"
  | "REFUSEE_DG_A_TRANCHER"
  | "VALIDEE"
  | "REJETEE";

export interface LigneEtat {
  statut: StatutArticle;
  soumiseAuDG: boolean;
  decisionDG: "VALIDEE" | "REFUSEE" | null;
}

export const LIBELLE_ETAT_ARTICLE: Record<EtatArticle, string> = {
  A_DECIDER: "À décider par la Finance",
  CHEZ_DG: "Chez le DG",
  VALIDEE_DG_A_CONFIRMER: "Validé par le DG — à confirmer par la Finance",
  REFUSEE_DG_A_TRANCHER: "Refusé par le DG — à trancher par la Finance",
  VALIDEE: "Validé",
  REJETEE: "Rejeté",
};

/** État d'un article. Cas (b) : tout article en attente est chez le DG (la Finance n'a rien à décider). */
export function etatLigneCircuit(l: LigneEtat, mode: ModeEtapeDG): EtatArticle {
  if (l.statut === "VALIDEE") return "VALIDEE";
  if (l.statut === "REJETEE") return "REJETEE";
  if (mode === "OBLIGATOIRE") return "CHEZ_DG";
  if (!l.soumiseAuDG) return "A_DECIDER";
  if (l.decisionDG === "VALIDEE") return "VALIDEE_DG_A_CONFIRMER";
  if (l.decisionDG === "REFUSEE") return "REFUSEE_DG_A_TRANCHER";
  return "CHEZ_DG";
}

/** Article encore à traiter par la Finance (décider, confirmer le DG, trancher un refus du DG). */
export function attendLaFinance(e: EtatArticle): boolean {
  return e === "A_DECIDER" || e === "VALIDEE_DG_A_CONFIRMER" || e === "REFUSEE_DG_A_TRANCHER";
}

/** Article qui attend la décision du DG. */
export function attendLeDG(e: EtatArticle): boolean {
  return e === "CHEZ_DG";
}

/** Article traité : décision finale prise (validé ou rejeté, définitive). */
export function estTraite(e: EtatArticle): boolean {
  return e === "VALIDEE" || e === "REJETEE";
}

export interface ResumeArticles {
  total: number;
  traites: number;
  validees: number;
  rejetees: number;
  /** Articles pour la Finance (à décider, DG validé à confirmer, DG refusé à trancher). */
  pourFinance: number;
  /** Dont articles validés par le DG, en attente de confirmation. */
  valideesDGAConfirmer: number;
  /** Dont articles refusés par le DG, à resoumettre ou à rejeter définitivement. */
  refuseesDGATrancher: number;
  /** Articles chez le DG. */
  chezDG: number;
}

export function resumeArticles(lignes: readonly LigneEtat[], mode: ModeEtapeDG): ResumeArticles {
  const etats = lignes.map((l) => etatLigneCircuit(l, mode));
  const compte = (f: (e: EtatArticle) => boolean) => etats.filter(f).length;
  return {
    total: etats.length,
    traites: compte(estTraite),
    validees: compte((e) => e === "VALIDEE"),
    rejetees: compte((e) => e === "REJETEE"),
    pourFinance: compte(attendLaFinance),
    valideesDGAConfirmer: compte((e) => e === "VALIDEE_DG_A_CONFIRMER"),
    refuseesDGATrancher: compte((e) => e === "REFUSEE_DG_A_TRANCHER"),
    chezDG: compte(attendLeDG),
  };
}

/** Étapes qui ne se déduisent pas des articles : le circuit les pose explicitement (Service, correction, abandon). */
const ETAPES_EXPLICITES: readonly EtapeCircuit[] = ["SERVICE", "A_CORRIGER", "ABANDONNEE"];

/**
 * Étape de la demande déduite des articles. Sans article (dépense directe) ou à une étape explicite (Service, à
 * corriger, abandonnée) : l'étape stockée. Sinon, Finance dès qu'un article l'attend (priorité à la Finance quand
 * Finance et DG ont chacun des articles), DG s'il ne reste que des articles chez lui, Terminée quand tous sont traités
 * avec au moins un validé, À corriger quand tous sont rejetés.
 */
export function etapeDepuisArticles(etapeStockee: EtapeCircuit, mode: ModeEtapeDG, lignes: readonly LigneEtat[]): EtapeCircuit {
  if (lignes.length === 0 || ETAPES_EXPLICITES.includes(etapeStockee)) return etapeStockee;
  const r = resumeArticles(lignes, mode);
  if (r.pourFinance > 0) return "FINANCE";
  if (r.chezDG > 0) return "DG";
  return r.validees > 0 ? "TERMINEE" : "A_CORRIGER";
}

/** « 2/3 articles traités » : compteur affiché à côté du libellé « En cours ». */
export function compteurArticlesTraites(lignes: readonly Pick<LigneEtat, "statut">[]): { traites: number; total: number } {
  return { traites: lignes.filter((l) => l.statut !== "EN_ATTENTE").length, total: lignes.length };
}

/** Il reste au moins un article sans décision finale. */
export function demandeEnCours(lignes: readonly Pick<LigneEtat, "statut">[]): boolean {
  return lignes.some((l) => l.statut === "EN_ATTENTE");
}

export const LIBELLE_EN_COURS = "En cours";

/** Libellé « En cours (2/3 traités) » ; `null` quand la demande n'est pas en cours (le statut habituel s'affiche). */
export function libelleEnCours(lignes: readonly Pick<LigneEtat, "statut">[]): string | null {
  if (lignes.length === 0 || !demandeEnCours(lignes)) return null;
  const { traites, total } = compteurArticlesTraites(lignes);
  return `${LIBELLE_EN_COURS} (${traites}/${total} traité${traites > 1 ? "s" : ""})`;
}

export interface LigneMontant {
  quantite: number;
  prixUnitaire: number | { toString(): string };
  statut: StatutArticle;
}

/** Montant d'un article, au centime (jamais d'écart flottant sur une somme). */
export function totalArticle(l: Pick<LigneMontant, "quantite" | "prixUnitaire">): number {
  return Math.round(l.quantite * Number(l.prixUnitaire) * 100) / 100;
}

/** Montant validé d'une demande à articles = somme des articles validés. */
export function montantValideDepuisLignes(lignes: readonly LigneMontant[]): number {
  const centimes = lignes.reduce((s, l) => (l.statut === "VALIDEE" ? s + Math.round(totalArticle(l) * 100) : s), 0);
  return centimes / 100;
}

const enCentimes = (n: number) => Math.round(n * 100);

export interface EntreeStatut {
  statutActuel: StatutDemande;
  /** Montant demandé (colonne `Demande.montant`). */
  montant: number;
  /** Colonne `Demande.montantValide` — utilisée seulement SANS article (dépense directe). */
  montantValide: number;
  /** Total des règlements confirmés et non annulés. */
  totalRegle: number;
  /** Articles de la demande ; vide = demande sans article (ancienne règle). */
  lignes: readonly LigneMontant[];
}

/**
 * Statut déduit (remplace la règle de `calculerStatutDemande`, qui reste le point d'entrée en base). États terminaux
 * inchangés. Avec articles :
 *  - un article sans décision finale : EN_ATTENTE_VALIDATION (aucun validé) ou PARTIELLEMENT_VALIDEE (au moins un
 *    validé) — l'écran affiche « En cours (x/n traités) » ;
 *  - tous traités, au moins un validé : le statut suit le règlement du SEUL montant validé — « Réglée » est donc
 *    atteignable avec un article rejeté (défaut de l'ancienne règle, qui comparait à la somme demandée) ;
 *  - tous rejetés : EN_ATTENTE_VALIDATION (la demande repart en correction).
 * Sans article : règle d'origine (montant validé comparé au montant demandé). Comparaisons en centimes entiers.
 */
export function statutDepuisLignes(e: EntreeStatut): StatutDemande {
  if (e.statutActuel === "REJETEE" || e.statutActuel === "CLOTUREE" || e.statutActuel === "ABANDONNEE") return e.statutActuel;

  const regle = enCentimes(e.totalRegle);
  const suivreReglement = (valide: number): StatutDemande => {
    if (regle <= 0) return "VALIDEE_NON_REGLEE";
    if (regle < valide) return "PARTIELLEMENT_REGLEE";
    return "REGLEE";
  };

  if (e.lignes.length === 0) {
    const demande = enCentimes(e.montant);
    const valide = enCentimes(e.montantValide);
    if (valide <= 0) return "EN_ATTENTE_VALIDATION";
    if (valide < demande) return "PARTIELLEMENT_VALIDEE";
    return suivreReglement(valide);
  }

  const valide = enCentimes(montantValideDepuisLignes(e.lignes));
  if (demandeEnCours(e.lignes)) return valide > 0 ? "PARTIELLEMENT_VALIDEE" : "EN_ATTENTE_VALIDATION";
  if (valide <= 0) return "EN_ATTENTE_VALIDATION";
  return suivreReglement(valide);
}

/** Applique des décisions hypothétiques (simulation avant écriture) : renvoie les lignes avec leur nouveau statut. */
export function appliquerDecisionsSimulees<T extends { id: string; statut: StatutArticle }>(
  lignes: readonly T[],
  decisions: readonly { ligneId: string; statut: "VALIDEE" | "REJETEE" }[]
): T[] {
  const parId = new Map(decisions.map((d) => [d.ligneId, d.statut]));
  return lignes.map((l) => (parId.has(l.id) ? { ...l, statut: parId.get(l.id)! } : l));
}
