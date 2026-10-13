// Bénéficiaire et pièces jointes PAR ARTICLE (autonomie des articles, lot A, 2026-10-14). Fonctions PURES, sans accès
// base, partagées par le formulaire, les Server Actions, les gardes de conflit d'intérêts, les notifications, les écrans
// et les PDF. Règle de fond : `Demande.beneficiaire*` est le bénéficiaire PAR DÉFAUT de la demande ; un article qui n'a
// aucun bénéficiaire propre (`beneficiaireType` vide) en HÉRITE. Les lignes existantes en base n'ont rien de propre :
// elles héritent toutes, rien ne change pour les demandes déjà créées.

import type { BeneficiaireType } from "./generated/prisma/enums";
import { normaliserNom, type ChoixBeneficiaire } from "./beneficiaire";

/** Libellé affiché quand les articles d'une demande n'ont pas tous le même bénéficiaire. */
export const LIBELLE_PLUSIEURS_BENEFICIAIRES = "Plusieurs bénéficiaires";

/** Bénéficiaire tel que stocké (sur la demande, ou sur un article : tous les champs vides = hérite). */
export interface BeneficiaireStocke {
  beneficiaireType?: BeneficiaireType | null;
  beneficiaireUserId?: string | null;
  beneficiaireNom?: string | null;
  beneficiaireUser?: { fullName: string } | null;
}

/** Bénéficiaire effectif d'un article (propre, sinon celui de la demande). */
export interface BeneficiaireEffectif {
  type: BeneficiaireType;
  userId: string | null;
  nom: string | null;
  /** Nom affichable (compte du portail, sinon nom libre, sinon un tiret). */
  libelle: string;
  /** `true` : valeur propre à l'article ; `false` : héritée de la demande. */
  propre: boolean;
}

/** Article, vu sous l'angle du bénéficiaire. */
export interface ArticleBeneficiaire extends BeneficiaireStocke {
  statutValidation?: string;
}

/** Identité d'un bénéficiaire : le compte s'il y en a un, sinon le nom libre normalisé (casse et accents ignorés). */
export function cleBeneficiaire(b: { userId: string | null; nom: string | null }): string {
  return b.userId ? `u:${b.userId}` : `n:${normaliserNom(b.nom ?? "")}`;
}

function versEffectif(b: BeneficiaireStocke & { beneficiaireType: BeneficiaireType }, propre: boolean): BeneficiaireEffectif {
  return {
    type: b.beneficiaireType,
    userId: b.beneficiaireUserId ?? null,
    nom: b.beneficiaireNom ?? null,
    libelle: b.beneficiaireUser?.fullName ?? b.beneficiaireNom ?? "—",
    propre,
  };
}

/** Bénéficiaire par défaut de la demande. */
export function beneficiaireDemande(demande: BeneficiaireStocke): BeneficiaireEffectif {
  return versEffectif({ ...demande, beneficiaireType: demande.beneficiaireType ?? "COLLABORATEUR" }, false);
}

/** Bénéficiaire effectif d'un article : le sien, sinon celui de la demande. */
export function beneficiaireArticle(article: BeneficiaireStocke, demande: BeneficiaireStocke): BeneficiaireEffectif {
  if (article.beneficiaireType == null) return beneficiaireDemande(demande);
  return versEffectif({ ...article, beneficiaireType: article.beneficiaireType }, true);
}

/**
 * Bénéficiaires effectifs de la demande, un par article. Sans article (dépense directe, anciennes demandes) : celui de
 * la demande. `seulementValidees` : si au moins un article est VALIDÉ, ne considère que les articles validés (les
 * rejetés ne sont jamais payés) ; sans article validé, tous les articles comptent.
 */
export function beneficiairesEffectifs(
  demande: BeneficiaireStocke,
  articles: readonly ArticleBeneficiaire[],
  options: { seulementValidees?: boolean } = {}
): BeneficiaireEffectif[] {
  if (articles.length === 0) return [beneficiaireDemande(demande)];
  let retenus = articles;
  if (options.seulementValidees) {
    const validees = articles.filter((a) => a.statutValidation === "VALIDEE");
    if (validees.length > 0) retenus = validees;
  }
  return retenus.map((a) => beneficiaireArticle(a, demande));
}

/** Bénéficiaires distincts (par compte ou nom libre normalisé), dans l'ordre d'apparition. */
export function beneficiairesDistincts(effectifs: readonly BeneficiaireEffectif[]): BeneficiaireEffectif[] {
  const vus = new Map<string, BeneficiaireEffectif>();
  for (const b of effectifs) if (!vus.has(cleBeneficiaire(b))) vus.set(cleBeneficiaire(b), b);
  return [...vus.values()];
}

/** Les articles n'ont pas tous le même bénéficiaire. */
export function aPlusieursBeneficiaires(
  demande: BeneficiaireStocke,
  articles: readonly ArticleBeneficiaire[],
  options: { seulementValidees?: boolean } = {}
): boolean {
  return beneficiairesDistincts(beneficiairesEffectifs(demande, articles, options)).length > 1;
}

/**
 * Nom à afficher pour la demande (listes, reçus, bon de caisse, reporting) : le bénéficiaire unique, ou « Plusieurs
 * bénéficiaires » — jamais un seul nom à tort.
 */
export function nomBeneficiaireDemande(
  demande: BeneficiaireStocke,
  articles: readonly ArticleBeneficiaire[],
  options: { seulementValidees?: boolean } = {}
): string {
  const distincts = beneficiairesDistincts(beneficiairesEffectifs(demande, articles, options));
  return distincts.length > 1 ? LIBELLE_PLUSIEURS_BENEFICIAIRES : (distincts[0]?.libelle ?? "—");
}

/**
 * Comptes concernés par la demande au sens de la garde 8 (créateur + bénéficiaire de N'IMPORTE QUEL article), tant que
 * le circuit n'est pas par article. Sans article : le bénéficiaire par défaut de la demande.
 */
export function comptesConcernesDemande(
  demande: { createurId: string } & BeneficiaireStocke,
  articles: readonly ArticleBeneficiaire[]
): string[] {
  const ids = new Set<string>([demande.createurId]);
  for (const b of beneficiairesEffectifs(demande, articles)) if (b.userId) ids.add(b.userId);
  return [...ids];
}

/**
 * Comptes concernés par UN article au sens de la garde 8 (lot D, 2026-10-16) : le créateur de la demande et le
 * bénéficiaire effectif DE CET ARTICLE (le sien, sinon celui de la demande). Le bénéficiaire d'un autre article de la
 * même demande n'est pas concerné : il peut exécuter le règlement et les retours de cet article.
 */
export function comptesConcernesArticle(
  demande: { createurId: string } & BeneficiaireStocke,
  article: BeneficiaireStocke
): string[] {
  const ids = new Set<string>([demande.createurId]);
  const b = beneficiaireArticle(article, demande);
  if (b.userId) ids.add(b.userId);
  return [...ids];
}

// --- Formulaire de création : « Appliquer à tous les articles » --------------------------------------------------

/** Choix de bénéficiaire tel que saisi (toutes les chaînes présentes, seul le champ du mode compte). */
export interface SaisieBeneficiaire {
  mode: ChoixBeneficiaire["mode"];
  userId: string;
  nom: string;
}

export const SAISIE_BENEFICIAIRE_MOI: SaisieBeneficiaire = { mode: "MOI", userId: "", nom: "" };

/**
 * Choix de bénéficiaire correspondant à ce qui est stocké (pour recharger un formulaire ou comparer à la valeur
 * commune) : le compte du créateur = « moi-même », un autre compte, sinon le nom libre.
 */
export function choixDepuisStocke(b: BeneficiaireStocke, createurId: string): ChoixBeneficiaire {
  if (b.beneficiaireUserId) return b.beneficiaireUserId === createurId ? { mode: "MOI" } : { mode: "COMPTE", userId: b.beneficiaireUserId };
  return { mode: "NOM", nom: b.beneficiaireNom ?? "" };
}

/** Saisie de formulaire correspondant à un choix (toutes les chaînes présentes). */
export function saisieDepuisChoix(c: ChoixBeneficiaire): SaisieBeneficiaire {
  return { mode: c.mode, userId: c.mode === "COMPTE" ? c.userId : "", nom: c.mode === "NOM" ? c.nom : "" };
}

/** Choix envoyé au serveur à partir de la saisie (seul le champ du mode retenu est gardé). */
export function saisieVersChoix(s: SaisieBeneficiaire): ChoixBeneficiaire {
  if (s.mode === "COMPTE") return { mode: "COMPTE", userId: s.userId };
  if (s.mode === "NOM") return { mode: "NOM", nom: s.nom };
  return { mode: "MOI" };
}

/** Erreur de saisie d'un bénéficiaire (même règles que le serveur), `null` si valide. */
export function erreurSaisieBeneficiaire(s: SaisieBeneficiaire): string | null {
  if (s.mode === "COMPTE" && !s.userId) return "Choisissez un compte.";
  if (s.mode === "NOM" && s.nom.trim().length < 2) return "Saisissez le nom du bénéficiaire.";
  return null;
}

/** Identité d'une saisie : « moi-même » = le compte du créateur ; un nom libre se compare normalisé. */
export function cleSaisieBeneficiaire(s: SaisieBeneficiaire, createurId: string): string {
  if (s.mode === "MOI") return cleBeneficiaire({ userId: createurId, nom: null });
  if (s.mode === "COMPTE") return cleBeneficiaire({ userId: s.userId || null, nom: null });
  return cleBeneficiaire({ userId: null, nom: s.nom });
}

/** Deux saisies désignent le même bénéficiaire. */
export function memeSaisieBeneficiaire(a: SaisieBeneficiaire, b: SaisieBeneficiaire, createurId: string): boolean {
  return cleSaisieBeneficiaire(a, createurId) === cleSaisieBeneficiaire(b, createurId);
}

/** Détails d'un article dans le formulaire : `beneficiaire` null = « identique aux autres » (valeur commune). */
export interface DetailsArticleSaisis {
  beneficiaire: SaisieBeneficiaire | null;
  /** Pièces propres à l'article (déjà déposées ; seule leur présence compte ici). */
  pieces: readonly unknown[];
}

/** « Appliquer à tous les articles » : chaque article reprend la valeur commune (bénéficiaire) ; ses pièces sont gardées. */
export function appliquerATous<T extends DetailsArticleSaisis>(articles: readonly T[]): T[] {
  return articles.map((a) => ({ ...a, beneficiaire: null }));
}

/** L'article a un bénéficiaire propre, différent de la valeur commune (badge « Personnalisé »). */
export function estPersonnalise(article: DetailsArticleSaisis, commun: SaisieBeneficiaire, createurId: string): boolean {
  return article.beneficiaire !== null && !memeSaisieBeneficiaire(article.beneficiaire, commun, createurId);
}

/** Au moins un article personnalisé : ré-appliquer à tous demande alors une confirmation. */
export function ilYADesPersonnalisations(
  articles: readonly DetailsArticleSaisis[],
  commun: SaisieBeneficiaire,
  createurId: string
): boolean {
  return articles.some((a) => estPersonnalise(a, commun, createurId));
}

/**
 * Valeur à ENREGISTRER pour un article : `null` (aucune valeur propre, hérite) quand son bénéficiaire égale la valeur
 * commune ou n'a pas été personnalisé ; sinon le choix de l'article. Appliquée aussi côté serveur (défense en
 * profondeur).
 */
export function choixPropreArticle(
  article: { beneficiaire: ChoixBeneficiaire | null | undefined },
  commun: ChoixBeneficiaire,
  createurId: string
): ChoixBeneficiaire | null {
  const b = article.beneficiaire;
  if (!b) return null;
  const saisie = (c: ChoixBeneficiaire): SaisieBeneficiaire => ({
    mode: c.mode,
    userId: c.mode === "COMPTE" ? c.userId : "",
    nom: c.mode === "NOM" ? c.nom : "",
  });
  return memeSaisieBeneficiaire(saisie(b), saisie(commun), createurId) ? null : b;
}

// --- Affichage : détails d'un article ---------------------------------------------------------------------------

/**
 * Pièces d'une demande réparties entre « communes » (aucun article) et « propres à un article ». Les pièces d'une
 * ligne de dépense de retour de caisse (`depenseLigneId`) ou du solde d'ouverture ne sont pas des pièces de la demande
 * saisies à la création : elles restent dans la liste commune comme avant.
 */
export function repartirPieces<P extends { id: string; ligneDemandeId?: string | null }>(
  pieces: readonly P[]
): { communes: P[]; parArticle: Map<string, P[]> } {
  const communes: P[] = [];
  const parArticle = new Map<string, P[]>();
  for (const p of pieces) {
    if (p.ligneDemandeId) parArticle.set(p.ligneDemandeId, [...(parArticle.get(p.ligneDemandeId) ?? []), p]);
    else communes.push(p);
  }
  return { communes, parArticle };
}

/**
 * Vue d'affichage de chaque article : bénéficiaire effectif, pièces propres, et le fait que le bénéficiaire mérite
 * d'être répété sous l'article (au moins un article a un bénéficiaire différent de celui de la demande).
 */
export interface VueDetailsArticles {
  communes: Array<{ id: string }>;
  parArticle: Map<string, { beneficiaire: BeneficiaireEffectif; pieces: Array<{ id: string }> }>;
  afficherBeneficiaire: boolean;
  /** Au moins un article a un bénéficiaire ou des pièces propres : la pièce commune est alors rappelée sous chaque article. */
  detaille: boolean;
}

export function detailsArticles<A extends BeneficiaireStocke & { id: string }>(
  demande: BeneficiaireStocke,
  articles: readonly A[],
  pieces: ReadonlyArray<{ id: string; ligneDemandeId?: string | null }>
): VueDetailsArticles {
  const { communes, parArticle } = repartirPieces(pieces);
  const defaut = cleBeneficiaire(beneficiaireDemande(demande));
  const vues = new Map<string, { beneficiaire: BeneficiaireEffectif; pieces: Array<{ id: string }> }>();
  let afficherBeneficiaire = false;
  for (const a of articles) {
    const b = beneficiaireArticle(a, demande);
    if (cleBeneficiaire(b) !== defaut) afficherBeneficiaire = true;
    vues.set(a.id, { beneficiaire: b, pieces: parArticle.get(a.id) ?? [] });
  }
  const detaille = afficherBeneficiaire || [...vues.values()].some((v) => v.pieces.length > 0);
  return { communes, parArticle: vues, afficherBeneficiaire, detaille };
}
