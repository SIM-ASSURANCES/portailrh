// Reporting « un seul tableau » (lot F, 2026-10-21) : de la demande jusqu'au détail de chaque article, sur UNE feuille Excel et
// UNE page. Module PUR (aucune base, aucun import de valeur Prisma) : le chargement est dans `reporting.ts`
// (`getReportingArbre`), la mise en forme Excel dans la route d'export, l'affichage dans la page de reporting.
//
// Structure : trois niveaux de lignes, dans un même jeu de colonnes (`COLONNES_ARBRE`) :
//   niveau 0  DEMANDE   le panier global (synthèse, totaux de la demande) ;
//   niveau 1  ARTICLE   un par article (ou « Non rattaché à un article », ou « Dépense directe » pour une demande sans article) ;
//   niveau 2  ÉVÉNEMENTS rattachés à l'article : règlement / fonds remis, mouvement banque, retour de caisse, dépense,
//             remboursement d'un retour, retour externe rattaché, retour exceptionnel post-clôture.
// La référence de la demande, l'article, le demandeur, le service et la devise sont répétés sur CHAQUE ligne (filtres, tris et
// tableaux croisés dynamiques).
//
// Aucun nouveau calcul comptable : les chiffres d'un article et de la demande viennent de `agregerRegularisation`,
// `getEcartLigne` et `depensesDeclareesLigne` (les fonctions des écrans). Aucun double comptage : seules les lignes DEMANDE
// portent « Compte dans les totaux = Oui » ; les lignes ARTICLE détaillent la demande, les événements détaillent l'article.

import { libelleMotifReglement } from "./motifReglement";
import { articleTermine, agregerRegularisation, categorieDepense, depensesDeclareesLigne, etatRegularisationArticle, getEcartLigne, AGREGATS_VIDES, type AgregatsRegularisation } from "./regularisationArticle";
import { detailClotureForcee, libelleArticleClotureForcee, type ArticleCloturePartiel } from "./clotureDemande";
import { derniereGestion, libelleGestionArticle, type GestionArticle } from "./parcoursArticle";
import { libelleEnCours } from "./etatArticles";

export type TypeLigneArbre =
  | "DEMANDE"
  | "ARTICLE"
  | "REGLEMENT"
  | "MOUVEMENT_BANQUE"
  | "RETOUR_CAISSE"
  | "DEPENSE"
  | "REMBOURSEMENT"
  | "RETOUR_EXTERNE"
  | "RETOUR_EXCEPTIONNEL";

export const LIBELLE_TYPE_LIGNE: Record<TypeLigneArbre, string> = {
  DEMANDE: "Demande",
  ARTICLE: "Article",
  REGLEMENT: "Règlement / fonds remis",
  MOUVEMENT_BANQUE: "Mouvement banque",
  RETOUR_CAISSE: "Retour de caisse",
  DEPENSE: "Dépense",
  REMBOURSEMENT: "Remboursement de retour",
  RETOUR_EXTERNE: "Retour externe",
  RETOUR_EXCEPTIONNEL: "Retour exceptionnel",
};

export const LIBELLE_ARTICLE_NON_RATTACHE = "Non rattaché à un article";
export const LIBELLE_ARTICLE_HORS_DEMANDE = "Hors demande";
/** Valeur de la colonne « Article » sur la ligne DEMANDE : jamais vide, pour que filtres et tableaux croisés ne perdent aucune ligne. */
export const LIBELLE_ARTICLE_DEMANDE = "(Demande entière)";

/** Une ligne du tableau unique. Texte vide / `null` = non applicable à ce type de ligne. */
export interface LigneArbre {
  /** 0 = demande, 1 = article, 2 = événement (niveau d'imbrication du regroupement Excel). */
  niveau: 0 | 1 | 2;
  type: TypeLigneArbre;
  typeLibelle: string;
  /** « Oui » uniquement pour la ligne DEMANDE : seules ces lignes entrent dans les totaux (jamais les articles ni les événements). */
  compte: "Oui" | "Non";
  reference: string;
  article: string;
  /** Libellé d'ORIGINE de l'article, tel qu'écrit par le demandeur (lignes ARTICLE seulement ; `article` porte le libellé Finance). */
  libelleOrigine: string;
  /** Lot J : reste du budget global et de la catégorie APRÈS la validation de l'article (lignes ARTICLE validées seulement). */
  budgetApres: string;
  demandeur: string;
  service: string;
  beneficiaire: string;
  devise: string;
  creeLe: Date | null;
  statut: string;
  etape: string;
  decisionService: string;
  decisionFinance: string;
  decisionDG: string;
  livraison: Date | null;
  gereLe: string;
  cloture: string;
  date: Date | null;
  mode: string;
  refOperation: string;
  auteur: string;
  /** Motif / nature du règlement (lot I), sur les lignes RÈGLEMENT seulement ; « Non renseigné » pour un ancien règlement. */
  motifReglement: string;
  motif: string;
  nbArticles: number | null;
  montantDemande: number | null;
  montantValide: number | null;
  montantRegle: number | null;
  regleCaisse: number | null;
  regleBanque: number | null;
  depense: number | null;
  retourne: number | null;
  solde: number | null;
  montantOperation: number | null;
  /** Chemins de téléchargement (`/api/treso/pieces-jointes/<id>`) des justificatifs d'un retour externe ; vides si le lecteur n'y a pas droit. */
  lienJustificatifRetour: string;
  lienJustificatifCheque: string;
}

export type GenreColonne = "texte" | "date" | "montant" | "entier" | "lien";
export interface ColonneArbre {
  cle: keyof LigneArbre;
  titre: string;
  genre: GenreColonne;
  /** Largeur Excel (en caractères). */
  largeur: number;
  /** Colonne de texte long (motif) : seule autorisée à passer à la ligne dans Excel. */
  longue?: boolean;
}

/** Colonnes dans l'ordre — partagées par la page et l'export (jamais deux listes divergentes). */
export const COLONNES_ARBRE: readonly ColonneArbre[] = [
  { cle: "typeLibelle", titre: "Type de ligne", genre: "texte", largeur: 24 },
  { cle: "compte", titre: "Compte dans les totaux", genre: "texte", largeur: 12 },
  { cle: "reference", titre: "Référence demande", genre: "texte", largeur: 20 },
  { cle: "article", titre: "Article", genre: "texte", largeur: 34 },
  { cle: "libelleOrigine", titre: "Libellé d'origine (demandeur)", genre: "texte", largeur: 34 },
  { cle: "budgetApres", titre: "Budget après validation (reste)", genre: "texte", largeur: 46 },
  { cle: "demandeur", titre: "Demandeur", genre: "texte", largeur: 22 },
  { cle: "service", titre: "Service", genre: "texte", largeur: 16 },
  { cle: "beneficiaire", titre: "Bénéficiaire", genre: "texte", largeur: 24 },
  { cle: "devise", titre: "Devise", genre: "texte", largeur: 8 },
  { cle: "creeLe", titre: "Demande créée le", genre: "date", largeur: 14 },
  { cle: "statut", titre: "Statut", genre: "texte", largeur: 30 },
  { cle: "etape", titre: "Étape du circuit", genre: "texte", largeur: 18 },
  { cle: "decisionService", titre: "Validation Service", genre: "texte", largeur: 30 },
  { cle: "decisionFinance", titre: "Décision Finance", genre: "texte", largeur: 34 },
  { cle: "decisionDG", titre: "Décision DG", genre: "texte", largeur: 34 },
  { cle: "livraison", titre: "Livraison prévue le", genre: "date", largeur: 14 },
  { cle: "gereLe", titre: "Géré le", genre: "texte", largeur: 22 },
  { cle: "cloture", titre: "Clôture sans régularisation", genre: "texte", largeur: 40 },
  { cle: "date", titre: "Date de l'opération", genre: "date", largeur: 14 },
  { cle: "mode", titre: "Mode", genre: "texte", largeur: 10 },
  { cle: "refOperation", titre: "Référence de l'opération", genre: "texte", largeur: 18 },
  { cle: "auteur", titre: "Auteur", genre: "texte", largeur: 22 },
  { cle: "motifReglement", titre: "Motif / nature du règlement", genre: "texte", largeur: 30 },
  { cle: "motif", titre: "Motif / justification / détail", genre: "texte", largeur: 60, longue: true },
  { cle: "nbArticles", titre: "Nb. articles", genre: "entier", largeur: 10 },
  { cle: "montantDemande", titre: "Demandé", genre: "montant", largeur: 15 },
  { cle: "montantValide", titre: "Validé", genre: "montant", largeur: 15 },
  { cle: "montantRegle", titre: "Réglé = fonds remis (Caisse + Banque)", genre: "montant", largeur: 20 },
  { cle: "regleCaisse", titre: "Dont Caisse", genre: "montant", largeur: 15 },
  { cle: "regleBanque", titre: "Dont Banque", genre: "montant", largeur: 15 },
  { cle: "depense", titre: "Dépensé", genre: "montant", largeur: 15 },
  { cle: "retourne", titre: "Retourné", genre: "montant", largeur: 15 },
  { cle: "solde", titre: "Solde à régulariser", genre: "montant", largeur: 15 },
  { cle: "montantOperation", titre: "Montant de l'opération", genre: "montant", largeur: 17 },
  { cle: "lienJustificatifRetour", titre: "Justificatif du retour", genre: "lien", largeur: 18 },
  { cle: "lienJustificatifCheque", titre: "Justificatif du chèque initial", genre: "lien", largeur: 22 },
];

/** Colonnes de montants sommées dans le total général (jamais « Montant de l'opération », hétérogène). */
export const COLONNES_TOTAUX: readonly (keyof LigneArbre)[] = [
  "nbArticles",
  "montantDemande",
  "montantValide",
  "montantRegle",
  "regleCaisse",
  "regleBanque",
  "depense",
  "retourne",
  "solde",
];

// --- Source (ce que le chargeur fournit) ---------------------------------------------------------------------------

export interface ArticleArbreSource {
  id: string;
  libelle: string;
  motif: string | null;
  /** Libellé écrit par le demandeur (`libelleDemandeur ?? libelleOriginal ?? libelle`). */
  libelleOrigine: string;
  /** Lot J : photo du budget après la validation de l'article, en texte (absente = aucun budget concerné). */
  budgetApres?: string;
  quantite: number;
  prixUnitaire: number;
  categorie: string | null;
  objet: string | null;
  beneficiaire: string;
  statut: "EN_ATTENTE" | "VALIDEE" | "REJETEE";
  motifRejet: string | null;
  decidePar: string | null;
  decideLe: Date | null;
  /** Compte qui a décidé l'article comme Finance (validation) ; `null` sinon. */
  decideurFinance: string | null;
  soumiseAuDG: boolean;
  decisionDG: "VALIDEE" | "REFUSEE" | null;
  decisionDGPar: string | null;
  decisionDGLe: Date | null;
  motifRefusDG: string | null;
  dateLivraison: Date | null;
}

export interface DepenseArbreSource {
  libelle: string;
  montant: number;
  /** Valeur de `TypeJustification` ; `SANS_PIECE` = sans pièce. */
  justification: string;
  motifNonJustifie: string | null;
  date: Date | null;
}

export interface RemboursementArbreSource {
  montant: number;
  statut: "EN_ATTENTE_VALIDATION" | "VALIDE" | "REJETE";
  proposePar: string;
  proposeLe: Date;
  validePar: string | null;
  valideLe: Date | null;
  motifRejet: string | null;
}

export interface RetourArbreSource {
  montantARetourner: number;
  estReceptionne: boolean;
  receptionneLe: Date | null;
  receptionnePar: string | null;
  declarant: string;
  declareLe: Date;
  /** Retour réellement attendu en caisse (voir `EntreeRetour.attendu`) : faux pour une fiche de détail des dépenses. */
  attendu: boolean;
  creeParAssistant: boolean;
  versementBancaire: boolean;
  complementSignalement: boolean;
  reouvertureExceptionnelle: boolean;
  depenses: DepenseArbreSource[];
  remboursements: RemboursementArbreSource[];
}

export interface ReglementArbreSource {
  id: string;
  ligneDemandeId: string | null;
  montant: number;
  mode: "CAISSE" | "BANQUE";
  estConfirme: boolean;
  estAnnule: boolean;
  motifAnnulation: string | null;
  /** Motif / nature du règlement (lot I) ; `null` pour un règlement antérieur. */
  motif?: string | null;
  auteur: string;
  creeLe: Date;
  confirmeLe: Date | null;
  retours: RetourArbreSource[];
}

export interface MouvementBanqueArbreSource {
  reglementId: string;
  type: "SORTIE" | "RETOUR" | "ANNULATION";
  montant: number;
  creeLe: Date;
  auteur: string;
  bordereau: boolean;
}

export interface RetourExceptionnelArbreSource {
  ligneDemandeId: string | null;
  montant: number;
  statut: "EN_ATTENTE_VALIDATION" | "VALIDE" | "REJETE";
  saisiPar: string;
  saisiLe: Date;
  validePar: string | null;
  valideLe: Date | null;
  motifRejet: string | null;
}

export interface RetourExterneArbreSource {
  ligneDemandeId: string | null;
  personne: string;
  montant: number;
  motif: string;
  creePar: string;
  creeLe: Date;
  /** Identifiants des pièces jointes ; `null` quand le lecteur n'a pas le droit de les télécharger (aucun lien n'est alors produit). */
  pieceRetourId: string | null;
  pieceChequeId: string | null;
}

export interface DemandeArbreSource {
  reference: string;
  creeLe: Date;
  /** « Géré le » de la demande (`getDatesGestionDemandes`), `null` si rien n'a été traité. */
  gere: GestionArticle | null;
  typeDemande: "STANDARD" | "DEPENSE_DIRECTE";
  /** Libellé du statut stocké (« Validée, non réglée »…) ; « En cours (x/n traités) » le remplace tant qu'un article attend. */
  statutLibelle: string;
  etapeCircuit: string | null;
  demandeur: string;
  service: string | null;
  /** « Plusieurs bénéficiaires » ou le nom commun (`nomBeneficiaireDemande`). */
  beneficiaire: string;
  devise: string;
  /** Dépense directe : description, catégorie, objet. */
  description: string | null;
  categorie: string | null;
  objet: string | null;
  montantDemande: number;
  montantValide: number;
  validationService: { par: string; le: Date } | null;
  articles: ArticleArbreSource[];
  reglements: ReglementArbreSource[];
  mouvementsBanque: MouvementBanqueArbreSource[];
  retoursExceptionnels: RetourExceptionnelArbreSource[];
  retoursExternes: RetourExterneArbreSource[];
  clotureForcee: { motif: string | null; par: string | null; le: Date | null; articles: ArticleCloturePartiel[] } | null;
}

export interface ArbreDemande {
  demande: LigneArbre;
  articles: { article: LigneArbre; evenements: LigneArbre[] }[];
}

// --- Utilitaires ---------------------------------------------------------------------------------------------------

const c = (n: number) => Math.round(n * 100);
const somme = (valeurs: readonly number[]) => valeurs.reduce((s, v) => s + c(v), 0) / 100;
const jour = (d: Date | null | undefined) => (d ? d.toLocaleDateString("fr-FR", { timeZone: "Africa/Abidjan" }) : "");
const par = (nom: string | null | undefined, d: Date | null | undefined) =>
  [nom ? `par ${nom}` : null, d ? `le ${jour(d)}` : null].filter(Boolean).join(" ");
const fcfa = (m: number) => `${Math.round(m).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;
const modeLibelle = (m: "CAISSE" | "BANQUE") => (m === "CAISSE" ? "Caisse" : "Banque");

/** Ligne vide d'un type donné : tout est « non applicable » tant que le constructeur ne le renseigne pas. */
function ligneVide(niveau: 0 | 1 | 2, type: TypeLigneArbre, contexte: { reference: string; article: string; demandeur: string; service: string; devise: string; creeLe: Date | null }): LigneArbre {
  return {
    niveau,
    type,
    typeLibelle: LIBELLE_TYPE_LIGNE[type],
    compte: type === "DEMANDE" ? "Oui" : "Non",
    reference: contexte.reference,
    article: contexte.article,
    libelleOrigine: "",
    budgetApres: "",
    demandeur: contexte.demandeur,
    service: contexte.service,
    beneficiaire: "",
    devise: contexte.devise,
    creeLe: contexte.creeLe,
    statut: "",
    etape: "",
    decisionService: "",
    decisionFinance: "",
    decisionDG: "",
    livraison: null,
    gereLe: "",
    cloture: "",
    date: null,
    mode: "",
    refOperation: "",
    auteur: "",
    motifReglement: "",
    motif: "",
    nbArticles: null,
    montantDemande: null,
    montantValide: null,
    montantRegle: null,
    regleCaisse: null,
    regleBanque: null,
    depense: null,
    retourne: null,
    solde: null,
    montantOperation: null,
    lienJustificatifRetour: "",
    lienJustificatifCheque: "",
  };
}

/** Chemin de la route de téléchargement existante (qui applique elle-même les droits d'accès). */
export const cheminPieceJointe = (id: string) => `/api/treso/pieces-jointes/${id}`;

/** Texte de la clôture forcée d'une demande (même phrase que l'ancien reporting par demande). */
export function texteClotureForcee(cf: NonNullable<DemandeArbreSource["clotureForcee"]>): string {
  return `Clôturée de force ${par(cf.par, cf.le)}${cf.motif ? ` — motif : ${cf.motif}` : ""} — articles non régularisés : ${detailClotureForcee(cf.articles)}`;
}

function libelleCategorieDepense(d: DepenseArbreSource): { statut: string; detail: string } {
  const cat = categorieDepense({ justification: d.justification, objet: d.libelle, motifNonJustifie: d.motifNonJustifie });
  if (cat === "JUSTIFIEE") return { statut: "Justifiée", detail: "" };
  if (cat === "SANS_PIECE_FORMELLE") return { statut: "Sans pièce formelle", detail: d.motifNonJustifie ? `motif Finance : ${d.motifNonJustifie}` : "" };
  return { statut: "Non détaillée", detail: "" };
}

function statutArticle(a: ArticleArbreSource, etat: ReturnType<typeof etatRegularisationArticle>): string {
  if (a.statut === "REJETEE") return "Rejeté";
  if (a.statut === "EN_ATTENTE") {
    if (a.decisionDG === "REFUSEE") return "Refusé par le DG, à trancher par la Finance";
    if (a.decisionDG === "VALIDEE") return "Validé par le DG, à confirmer par la Finance";
    if (a.soumiseAuDG) return "Chez le DG";
    return "À décider (Finance)";
  }
  switch (etat) {
    case "ATTENTE_REGLEMENT":
      return "Validé — en attente de règlement";
    case "A_REGULARISER":
      return "Validé — à régulariser";
    case "REGULARISE":
      return "Validé — régularisé";
    case "ANOMALIE":
      return "Validé — anomalie (solde négatif)";
    default:
      return "Validé";
  }
}

function decisionFinanceArticle(a: ArticleArbreSource): string {
  if (a.statut === "REJETEE") return `Rejeté ${par(a.decidePar, a.decideLe)}${a.motifRejet ? ` — motif : ${a.motifRejet}` : ""}`.trim();
  if (a.statut === "VALIDEE") return `Validé ${par(a.decideurFinance ?? a.decidePar, a.decideLe)}`.trim();
  return "";
}

function decisionDGArticle(a: ArticleArbreSource): string {
  if (a.decisionDG === "VALIDEE") return `Validé ${par(a.decisionDGPar, a.decisionDGLe)}`.trim();
  if (a.decisionDG === "REFUSEE") return `Refusé ${par(a.decisionDGPar, a.decisionDGLe)}${a.motifRefusDG ? ` — motif : ${a.motifRefusDG}` : ""}`.trim();
  if (a.soumiseAuDG) return "Soumis au DG, en attente de décision";
  return "";
}

// --- Construction --------------------------------------------------------------------------------------------------

/**
 * Construit l'arbre d'une demande : la ligne DEMANDE, une ligne par article (plus « Non rattaché à un article » ou « Dépense
 * directe » quand des règlements, retours ou dépenses ne sont rattachés à aucun article) et, sous chaque article, ses
 * événements dans l'ordre : règlements (chacun suivi de ses mouvements banque), retours de caisse (chacun suivi de ses
 * dépenses et remboursements), retours externes, retours exceptionnels.
 */
export function construireArbreDemande(d: DemandeArbreSource): ArbreDemande {
  const service = d.service ?? "";
  const contexteDemande = { reference: d.reference, article: LIBELLE_ARTICLE_DEMANDE, demandeur: d.demandeur, service, devise: d.devise, creeLe: d.creeLe };

  // --- Chiffres : la régularisation des écrans (agrégation PURE du lot E), jamais un second calcul. ---
  const regul = agregerRegularisation({
    reglements: d.reglements.map((r) => ({ id: r.id, ligneDemandeId: r.ligneDemandeId, montant: r.montant, estConfirme: r.estConfirme, estAnnule: r.estAnnule })),
    retours: d.reglements.flatMap((r) =>
      r.retours.map((t) => ({
        reglementId: r.id,
        estReceptionne: t.estReceptionne,
        attendu: t.attendu,
        montantARetourner: t.montantARetourner,
        depenses: t.depenses.map((x) => ({ montant: x.montant, justification: x.justification, objet: x.libelle, motifNonJustifie: x.motifNonJustifie })),
      }))
    ),
    remboursements: d.reglements.flatMap((r) =>
      r.retours.flatMap((t) => t.remboursements.filter((rb) => rb.statut === "VALIDE").map((rb) => ({ reglementId: r.id, montant: rb.montant })))
    ),
    exceptionnels: [
      ...d.retoursExceptionnels.filter((e) => e.statut === "VALIDE").map((e) => ({ ligneDemandeId: e.ligneDemandeId, montant: e.montant })),
      ...d.retoursExternes.map((e) => ({ ligneDemandeId: e.ligneDemandeId, montant: e.montant })),
    ],
  });

  const parMode = (ligneId: string | null) => {
    const confirmes = d.reglements.filter((r) => r.estConfirme && !r.estAnnule && r.ligneDemandeId === ligneId);
    return {
      caisse: somme(confirmes.filter((r) => r.mode === "CAISSE").map((r) => r.montant)),
      banque: somme(confirmes.filter((r) => r.mode === "BANQUE").map((r) => r.montant)),
    };
  };
  const toutesLesPortions = [...d.articles.map((a) => a.id as string | null), null];
  const caisseTotal = somme(toutesLesPortions.map((id) => parMode(id).caisse));
  const banqueTotal = somme(toutesLesPortions.map((id) => parMode(id).banque));

  const sansArticle = d.articles.length === 0;
  const ligneIdsConnus = new Set(d.articles.map((a) => a.id));
  // Un événement est « non rattaché » s'il vise aucun article connu de la demande (dépense directe, ancien règlement ambigu…).
  const cible = (ligneDemandeId: string | null): string | null => (ligneDemandeId && ligneIdsConnus.has(ligneDemandeId) ? ligneDemandeId : null);

  // Événements regroupés par article (clé `null` = non rattaché).
  const evenementsParCible = new Map<string | null, LigneArbre[]>();
  const ajouter = (cle: string | null, l: LigneArbre) => {
    const liste = evenementsParCible.get(cle) ?? [];
    liste.push(l);
    evenementsParCible.set(cle, liste);
  };
  const libelleCible = (cle: string | null) =>
    cle ? (d.articles.find((a) => a.id === cle)?.libelle ?? "") : sansArticle ? "Dépense directe" : LIBELLE_ARTICLE_NON_RATTACHE;
  const beneficiaireCible = (cle: string | null) => (cle ? (d.articles.find((a) => a.id === cle)?.beneficiaire ?? "") : d.beneficiaire);
  const evenement = (type: TypeLigneArbre, cle: string | null): LigneArbre => {
    const l = ligneVide(2, type, { ...contexteDemande, article: libelleCible(cle) });
    l.beneficiaire = beneficiaireCible(cle);
    return l;
  };

  const reglementsTries = [...d.reglements].sort((a, b) => a.creeLe.getTime() - b.creeLe.getTime());
  const rangReglement = new Map(reglementsTries.map((r, i) => [r.id, i + 1]));
  let rangRetour = 0;
  for (const r of reglementsTries) {
    const cle = cible(r.ligneDemandeId);
    const l = evenement("REGLEMENT", cle);
    l.statut = !r.estConfirme ? "Brouillon" : r.estAnnule ? "Annulé" : "Confirmé";
    l.date = r.confirmeLe ?? r.creeLe;
    l.mode = modeLibelle(r.mode);
    l.refOperation = `${d.reference}-R${rangReglement.get(r.id)}`;
    l.auteur = r.auteur;
    l.motifReglement = libelleMotifReglement(r.motif);
    l.motif = r.estAnnule && r.motifAnnulation ? `motif d'annulation : ${r.motifAnnulation}` : !r.estConfirme ? `saisi le ${jour(r.creeLe)}` : "";
    l.montantOperation = r.montant;
    ajouter(cle, l);

    for (const m of d.mouvementsBanque.filter((x) => x.reglementId === r.id).sort((a, b) => a.creeLe.getTime() - b.creeLe.getTime())) {
      const lm = evenement("MOUVEMENT_BANQUE", cle);
      lm.statut = m.type === "SORTIE" ? "Sortie" : m.type === "RETOUR" ? "Retour" : "Annulation";
      lm.date = m.creeLe;
      lm.mode = "Banque";
      lm.refOperation = `${d.reference}-R${rangReglement.get(r.id)}`;
      lm.auteur = m.auteur;
      lm.motif = m.bordereau ? "bordereau joint" : "";
      lm.montantOperation = m.montant;
      ajouter(cle, lm);
    }
  }
  for (const r of reglementsTries) {
    const cle = cible(r.ligneDemandeId);
    for (const t of [...r.retours].sort((a, b) => a.declareLe.getTime() - b.declareLe.getTime())) {
      rangRetour += 1;
      const lt = evenement("RETOUR_CAISSE", cle);
      const origine = [
        t.creeParAssistant ? "déclaré par l'Assistant Finance" : null,
        t.complementSignalement ? "complément suite à un signalement" : null,
        t.reouvertureExceptionnelle ? "réouverture exceptionnelle" : null,
        r.mode === "BANQUE" && t.versementBancaire ? "ancien versement bancaire" : null,
      ].filter(Boolean);
      // Retour nul = historique seulement : constaté sans mouvement de caisse (jamais pour un ancien versement bancaire).
      const nul = t.estReceptionne && !t.versementBancaire && c(t.montantARetourner) === 0;
      lt.statut = nul ? "Retour nul constaté" : t.estReceptionne ? "Réceptionné" : t.attendu ? "En attente de réception" : "Détail des dépenses (aucun retour attendu)";
      lt.date = t.estReceptionne ? (t.receptionneLe ?? t.declareLe) : t.declareLe;
      lt.mode = modeLibelle(r.mode);
      lt.refOperation = `${d.reference}-R${rangReglement.get(r.id)}`;
      lt.auteur = (t.estReceptionne ? t.receptionnePar : null) ?? t.declarant;
      lt.motif = [`retour ${rangRetour}`, ...origine].join(" — ");
      lt.montantOperation = t.montantARetourner;
      ajouter(cle, lt);

      for (const dep of t.depenses) {
        const ld = evenement("DEPENSE", cle);
        const cat = libelleCategorieDepense(dep);
        ld.statut = cat.statut;
        ld.date = dep.date;
        ld.mode = modeLibelle(r.mode);
        ld.refOperation = `${d.reference}-R${rangReglement.get(r.id)}`;
        ld.auteur = t.declarant;
        ld.motif = [dep.libelle, cat.detail].filter(Boolean).join(" — ");
        ld.montantOperation = dep.montant;
        ajouter(cle, ld);
      }
      for (const rb of t.remboursements) {
        const lr = evenement("REMBOURSEMENT", cle);
        lr.statut = rb.statut === "VALIDE" ? "Validé" : rb.statut === "REJETE" ? "Rejeté" : "En attente de validation";
        lr.date = rb.valideLe ?? rb.proposeLe;
        lr.mode = modeLibelle(r.mode);
        lr.refOperation = `${d.reference}-R${rangReglement.get(r.id)}`;
        lr.auteur = rb.validePar ?? rb.proposePar;
        lr.motif = [`proposé ${par(rb.proposePar, rb.proposeLe)}`, rb.motifRejet ? `motif de rejet : ${rb.motifRejet}` : null].filter(Boolean).join(" — ");
        lr.montantOperation = rb.montant;
        ajouter(cle, lr);
      }
    }
  }
  for (const x of [...d.retoursExternes].sort((a, b) => a.creeLe.getTime() - b.creeLe.getTime())) {
    const cle = cible(x.ligneDemandeId);
    const l = evenement("RETOUR_EXTERNE", cle);
    l.statut = "Enregistré";
    l.date = x.creeLe;
    l.mode = "Caisse";
    l.auteur = x.creePar;
    l.motif = [x.personne, x.motif].filter(Boolean).join(" — ");
    l.montantOperation = x.montant;
    l.lienJustificatifRetour = x.pieceRetourId ? cheminPieceJointe(x.pieceRetourId) : "";
    l.lienJustificatifCheque = x.pieceChequeId ? cheminPieceJointe(x.pieceChequeId) : "";
    ajouter(cle, l);
  }
  for (const e of [...d.retoursExceptionnels].sort((a, b) => a.saisiLe.getTime() - b.saisiLe.getTime())) {
    const cle = cible(e.ligneDemandeId);
    const l = evenement("RETOUR_EXCEPTIONNEL", cle);
    l.statut = e.statut === "VALIDE" ? "Validé" : e.statut === "REJETE" ? "Rejeté" : "En attente de validation";
    l.date = e.valideLe ?? e.saisiLe;
    l.mode = "Caisse";
    l.auteur = e.validePar ?? e.saisiPar;
    l.motif = [`saisi ${par(e.saisiPar, e.saisiLe)}`, e.motifRejet ? `motif de rejet : ${e.motifRejet}` : null].filter(Boolean).join(" — ");
    l.montantOperation = e.montant;
    ajouter(cle, l);
  }

  // --- Lignes ARTICLE ---
  const instantane = d.clotureForcee?.articles ?? [];
  const articles: ArbreDemande["articles"] = [];
  for (const a of d.articles) {
    const agregats: AgregatsRegularisation = regul.parArticle.get(a.id) ?? { ...AGREGATS_VIDES };
    const montant = Math.round(a.quantite * a.prixUnitaire * 100) / 100;
    const valide = a.statut === "VALIDEE" ? montant : 0;
    const etat = etatRegularisationArticle({ valide: a.statut === "VALIDEE", agregats });
    const solde = getEcartLigne(agregats);
    const l = ligneVide(1, "ARTICLE", { ...contexteDemande, article: a.libelle });
    l.beneficiaire = a.beneficiaire;
    l.libelleOrigine = a.libelleOrigine;
    l.budgetApres = a.budgetApres ?? "";
    l.statut = statutArticle(a, etat);
    l.decisionFinance = decisionFinanceArticle(a);
    l.decisionDG = decisionDGArticle(a);
    l.livraison = a.dateLivraison;
    const evts = evenementsParCible.get(a.id) ?? [];
    l.gereLe = libelleGestionArticle(
      derniereGestion([
        { etape: a.statut === "REJETEE" ? "Rejeté" : "Validé", date: a.statut === "EN_ATTENTE" ? null : a.decideLe },
        ...d.reglements.filter((r) => r.ligneDemandeId === a.id && r.estConfirme && !r.estAnnule).map((r) => ({ etape: "Réglé" as const, date: r.confirmeLe })),
        ...d.reglements
          .filter((r) => r.ligneDemandeId === a.id && r.estConfirme && !r.estAnnule)
          .flatMap((r) => r.retours.map((t) => ({ etape: "Retour de caisse" as const, date: t.estReceptionne ? (t.receptionneLe ?? t.declareLe) : t.declareLe }))),
        ...d.retoursExternes.filter((x) => x.ligneDemandeId === a.id).map((x) => ({ etape: "Retour enregistré par la Finance" as const, date: x.creeLe })),
      ])
    ).replace(/^Géré le /, "");
    if (l.gereLe === "—") l.gereLe = "";
    l.cloture =
      libelleArticleClotureForcee(
        { clotureForcee: d.clotureForcee !== null },
        instantane,
        a.id,
        articleTermine({ statut: a.statut, agregats, montantValide: valide }),
        solde
      ) ?? "";
    l.motif = [a.motif ? `motif : ${a.motif}` : null, `${a.quantite} × ${fcfa(a.prixUnitaire)}`, a.categorie ? `${a.categorie}${a.objet ? ` / ${a.objet}` : ""}` : "sans catégorie"]
      .filter(Boolean)
      .join(" — ");
    const modes = parMode(a.id);
    l.montantDemande = montant;
    l.montantValide = valide;
    l.montantRegle = agregats.fondsRemis;
    l.regleCaisse = modes.caisse;
    l.regleBanque = modes.banque;
    l.depense = depensesDeclareesLigne(agregats);
    l.retourne = agregats.retoursRecus;
    l.solde = solde;
    articles.push({ article: l, evenements: evts });
  }

  // Part non rattachée (ou dépense directe, sans article) : une ligne ARTICLE dédiée, seulement s'il y a quelque chose à montrer.
  const nonRattache = regul.nonRattache;
  const evtsNonRattaches = evenementsParCible.get(null) ?? [];
  const aDuNonRattache =
    evtsNonRattaches.length > 0 ||
    [nonRattache.fondsRemis, nonRattache.depensesJustifiees, nonRattache.depensesSansPieceFormelle, nonRattache.resteNonDetaille, nonRattache.retoursRecus].some((v) => c(v) !== 0);
  if (sansArticle || aDuNonRattache) {
    const l = ligneVide(1, "ARTICLE", { ...contexteDemande, article: sansArticle ? "Dépense directe" : LIBELLE_ARTICLE_NON_RATTACHE });
    l.beneficiaire = d.beneficiaire;
    const modes = parMode(null);
    if (sansArticle) {
      const etat = etatRegularisationArticle({ valide: c(d.montantValide) > 0, agregats: nonRattache });
      l.motif = [d.description, d.categorie ? `${d.categorie}${d.objet ? ` / ${d.objet}` : ""}` : "sans catégorie"].filter(Boolean).join(" — ");
      l.montantDemande = d.montantDemande;
      l.montantValide = d.montantValide;
      l.statut = c(d.montantValide) > 0 ? `${etat === "REGULARISE" ? "Validé — régularisé" : etat === "ATTENTE_REGLEMENT" ? "Validé — en attente de règlement" : "Validé — à régulariser"}` : d.statutLibelle;
    } else {
      l.statut = "Règlements ou retours rattachés à aucun article";
      l.montantDemande = 0;
      l.montantValide = 0;
    }
    l.montantRegle = nonRattache.fondsRemis;
    l.regleCaisse = modes.caisse;
    l.regleBanque = modes.banque;
    l.depense = depensesDeclareesLigne(nonRattache);
    l.retourne = nonRattache.retoursRecus;
    l.solde = getEcartLigne(nonRattache);
    articles.push({ article: l, evenements: evtsNonRattaches });
  }

  // --- Ligne DEMANDE ---
  const l = ligneVide(0, "DEMANDE", contexteDemande);
  l.beneficiaire = d.beneficiaire;
  l.statut = libelleEnCours(d.articles.map((a) => ({ statut: a.statut }))) ?? d.statutLibelle;
  l.etape = d.etapeCircuit ?? "";
  l.decisionService = d.validationService ? `Validé ${par(d.validationService.par, d.validationService.le)}` : "";
  l.gereLe = libelleGestionArticle(d.gere).replace(/^Géré le /, "");
  if (l.gereLe === "—") l.gereLe = "";
  l.cloture = d.clotureForcee ? texteClotureForcee(d.clotureForcee) : "";
  l.motif = sansArticle ? [d.description].filter(Boolean).join("") : "";
  l.nbArticles = d.articles.length;
  l.montantDemande = d.montantDemande;
  l.montantValide = d.montantValide;
  l.montantRegle = regul.total.fondsRemis;
  l.regleCaisse = caisseTotal;
  l.regleBanque = banqueTotal;
  l.depense = depensesDeclareesLigne(regul.total);
  l.retourne = regul.total.retoursRecus;
  l.solde = getEcartLigne(regul.total);
  return { demande: l, articles };
}

/** Retour externe sans demande (chèque…) : une ligne de niveau 0, hors des totaux (il n'appartient à aucune demande). */
export function ligneRetourExterneHorsDemande(x: {
  personne: string;
  montant: number;
  motif: string;
  creePar: string;
  creeLe: Date;
  estExterne: boolean;
  pieceRetourId: string | null;
  pieceChequeId: string | null;
}): LigneArbre {
  const l = ligneVide(0, "RETOUR_EXTERNE", { reference: "", article: LIBELLE_ARTICLE_HORS_DEMANDE, demandeur: "", service: "", devise: "", creeLe: null });
  l.statut = "Enregistré";
  l.beneficiaire = x.personne;
  l.date = x.creeLe;
  l.mode = "Caisse";
  l.auteur = x.creePar;
  l.motif = [x.estExterne ? "personne externe" : "collaborateur", x.motif].filter(Boolean).join(" — ");
  l.montantOperation = x.montant;
  l.lienJustificatifRetour = x.pieceRetourId ? cheminPieceJointe(x.pieceRetourId) : "";
  l.lienJustificatifCheque = x.pieceChequeId ? cheminPieceJointe(x.pieceChequeId) : "";
  return l;
}

/** Aplatit les arbres en lignes, dans l'ordre de lecture : demande, ses articles, sous chaque article ses événements. */
export function aplatirArbres(arbres: readonly ArbreDemande[]): LigneArbre[] {
  return arbres.flatMap((a) => [a.demande, ...a.articles.flatMap((x) => [x.article, ...x.evenements])]);
}

export type TotauxArbre = Record<(typeof COLONNES_TOTAUX)[number], number>;

/**
 * Totaux PAR DEVISE : somme des seules lignes qui comptent (DEMANDE), centimes exacts — les articles et événements n'y entrent jamais.
 * Une devise par demande : on n'additionne JAMAIS des devises différentes. Une seule devise présente = un seul total. Triées
 * alphabétiquement (déterministe) ; une ligne sans devise (retour externe hors demande) ne compte pas.
 */
export function totauxParDevise(lignes: readonly LigneArbre[]): { devise: string; totaux: TotauxArbre }[] {
  const comptees = lignes.filter((l) => l.compte === "Oui" && l.devise !== "");
  const devises = [...new Set(comptees.map((l) => l.devise))].sort();
  return devises.map((devise) => {
    const deLaDevise = comptees.filter((l) => l.devise === devise);
    const totaux = {} as TotauxArbre;
    for (const cle of COLONNES_TOTAUX) totaux[cle] = somme(deLaDevise.map((l) => (l[cle] as number | null) ?? 0));
    return { devise, totaux };
  });
}
