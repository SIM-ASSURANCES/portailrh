// Régularisation PAR ARTICLE (autonomie des articles, lot E, 2026-10-17). Module PUR : aucune base, aucun import de
// valeur Prisma (sûr pour un Client Component).
//
// Un article réglé a son propre retour de caisse, ses propres dépenses et son propre solde à régulariser, via
// `Reglement.ligneDemandeId` (lot D). La formule est celle de la demande (`getEcart`), appliquée à un périmètre plus petit :
//   solde = fonds remis − dépenses (justifiées + sans pièce formelle + reste non détaillé) − retours reçus.
// Les retours reçus incluent les retours exceptionnels post-clôture VALIDÉS rattachés à l'article, moins les remboursements
// validés de ses retours. Invariant : la somme des soldes des articles et de la part « non rattachée » (règlements
// antérieurs ambigus, retours exceptionnels sans article) est TOUJOURS égale au solde de la demande.
//
// Rien n'est jamais deviné : ce qui n'est rattaché à aucun article reste dans la part « non rattachée ».

import { LIBELLE_DEPENSES_NON_DETAILLEES } from "./regularisationDepenses";

/** Les cinq chiffres de la régularisation d'un périmètre (un article, la part non rattachée, ou la demande entière). */
export interface AgregatsRegularisation {
  /** Règlements confirmés et non annulés (Caisse + Banque). */
  fondsRemis: number;
  /** Dépenses avec pièce (toute justification autre que « sans pièce »). */
  depensesJustifiees: number;
  /** Dépenses sans pièce formelle : « sans pièce » AVEC un motif Finance. */
  depensesSansPieceFormelle: number;
  /** Reste non détaillé : « sans pièce » sans motif Finance (ligne « Dépenses non détaillées »). */
  resteNonDetaille: number;
  /** Retours réceptionnés + retours exceptionnels validés − remboursements validés. */
  retoursRecus: number;
  /**
   * Retours déclarés par le collaborateur et pas encore réceptionnés (argent annoncé, en route vers la caisse). Sert
   * uniquement à ne pas compter cet argent dans le « reste non détaillé » (`resteNonDetailleTotal`) ; jamais dans le solde.
   */
  retoursEnAttente: number;
}

export const AGREGATS_VIDES: Readonly<AgregatsRegularisation> = Object.freeze({
  fondsRemis: 0,
  depensesJustifiees: 0,
  depensesSansPieceFormelle: 0,
  resteNonDetaille: 0,
  retoursRecus: 0,
  retoursEnAttente: 0,
});

const c = (n: number) => Math.round(n * 100);

/** Total des dépenses déclarées d'un périmètre (les trois catégories). */
export function depensesDeclareesLigne(a: AgregatsRegularisation): number {
  return (c(a.depensesJustifiees) + c(a.depensesSansPieceFormelle) + c(a.resteNonDetaille)) / 100;
}

/**
 * Écart (solde à régulariser) d'un périmètre : fonds remis − dépenses déclarées − retours reçus. Jamais plafonné à 0 :
 * un résultat négatif signale une anomalie réelle. Centimes exacts. Fonction UNIQUE : tout écran ou calcul qui donne
 * l'écart d'un article ou d'une demande passe par elle.
 */
export function getEcartLigne(a: AgregatsRegularisation): number {
  return (c(a.fondsRemis) - c(a.depensesJustifiees) - c(a.depensesSansPieceFormelle) - c(a.resteNonDetaille) - c(a.retoursRecus)) / 100;
}

/**
 * « Reste non détaillé » d'un périmètre, SOURCE UNIQUE de tous les affichages (régularisation, récapitulatif du collaborateur,
 * parcours, reçus) : ce qui n'est ni justifié, ni sans pièce formelle, ni retourné, ni annoncé en retour en attente de
 * réception = fonds remis (Caisse + Banque) − retours − dépenses détaillées. Il se compose de la ligne « Dépenses non
 * détaillées » déjà enregistrée (`resteNonDetaille`, déclaration simplifiée du collaborateur) et de l'argent remis dont rien
 * n'a encore été déclaré (fonds par banque jamais détaillés ni retournés, règlement sans retour) : `max(0, solde − retours en
 * attente)`. Il ne change jamais le solde à régulariser (`getEcartLigne`), qui garde sa formule ; il retombe à 0 dès que
 * l'argent est détaillé ou retourné. Centimes exacts, jamais négatif.
 */
export function resteNonDetailleTotal(a: AgregatsRegularisation): number {
  const nonDeclare = Math.max(0, c(getEcartLigne(a)) - c(a.retoursEnAttente));
  return (c(a.resteNonDetaille) + nonDeclare) / 100;
}

/** Somme de plusieurs périmètres (centimes exacts). */
export function additionnerAgregats(liste: readonly AgregatsRegularisation[]): AgregatsRegularisation {
  const somme = (cle: keyof AgregatsRegularisation) => liste.reduce((s, a) => s + c(a[cle]), 0) / 100;
  return {
    fondsRemis: somme("fondsRemis"),
    depensesJustifiees: somme("depensesJustifiees"),
    depensesSansPieceFormelle: somme("depensesSansPieceFormelle"),
    resteNonDetaille: somme("resteNonDetaille"),
    retoursRecus: somme("retoursRecus"),
    retoursEnAttente: somme("retoursEnAttente"),
  };
}

export type CategorieDepense = "JUSTIFIEE" | "SANS_PIECE_FORMELLE" | "RESTE_NON_DETAILLE";

/**
 * Catégorie d'une ligne de dépense — mêmes définitions que l'écran du retour (`estLigneReste`) : sans pièce SANS motif
 * Finance et libellée « Dépenses non détaillées » = reste ; sans pièce avec motif = sans pièce formelle ; le reste =
 * justifiée. (Une ligne « sans pièce » sans motif et d'un autre libellé est une dépense sans pièce formelle déclarée par le
 * collaborateur : elle n'est pas du reste calculé.)
 */
export function categorieDepense(l: { justification: string; objet: string; motifNonJustifie: string | null }): CategorieDepense {
  if (l.justification !== "SANS_PIECE") return "JUSTIFIEE";
  if (l.objet === LIBELLE_DEPENSES_NON_DETAILLEES && !l.motifNonJustifie) return "RESTE_NON_DETAILLE";
  return "SANS_PIECE_FORMELLE";
}

export type EtatRegularisationArticle =
  | "REJETE_OU_EN_ATTENTE" // article non validé : pas de régularisation à suivre
  | "ATTENTE_REGLEMENT" // validé, aucun règlement confirmé
  | "A_REGULARISER" // réglé (en tout ou en partie), solde ≠ 0
  | "REGULARISE" // réglé, solde = 0
  | "ANOMALIE"; // solde < 0 (trop justifié ou trop rendu)

export const LIBELLE_ETAT_REGULARISATION: Record<EtatRegularisationArticle, string> = {
  REJETE_OU_EN_ATTENTE: "Non validé",
  ATTENTE_REGLEMENT: "En attente de règlement",
  A_REGULARISER: "À régulariser",
  REGULARISE: "Régularisé",
  ANOMALIE: "Anomalie : solde négatif",
};

/** État de régularisation d'un article, d'après son statut de validation et ses agrégats. */
export function etatRegularisationArticle(p: { valide: boolean; agregats: AgregatsRegularisation }): EtatRegularisationArticle {
  if (!p.valide) return "REJETE_OU_EN_ATTENTE";
  if (c(p.agregats.fondsRemis) <= 0) return "ATTENTE_REGLEMENT";
  const ecart = c(getEcartLigne(p.agregats));
  if (ecart === 0) return "REGULARISE";
  return ecart < 0 ? "ANOMALIE" : "A_REGULARISER";
}

/**
 * Un article est « terminé » pour le suivi (décision 5) quand il est rejeté (jamais d'argent), ou validé, réglé, et à solde
 * nul. Information d'affichage : la clôture elle-même (`peutEtreCloturee`) n'est pas modifiée par le lot E.
 */
export function articleTermine(p: { statut: "EN_ATTENTE" | "VALIDEE" | "REJETEE"; agregats: AgregatsRegularisation }): boolean {
  if (p.statut === "REJETEE") return true;
  if (p.statut === "EN_ATTENTE") return false;
  return etatRegularisationArticle({ valide: true, agregats: p.agregats }) === "REGULARISE";
}

/** Texte « 3 articles sur 5 régularisés » du bloc de synthèse. */
export function resumeArticlesTermines(etats: readonly { termine: boolean; rejete: boolean }[]): string {
  const concernes = etats.filter((e) => !e.rejete);
  const faits = concernes.filter((e) => e.termine).length;
  return `${faits} article${faits > 1 ? "s" : ""} régularisé${faits > 1 ? "s" : ""} sur ${concernes.length}`;
}

// --- Agrégation brute → périmètres (pure, testée sans base) -------------------------------------------------------

export interface EntreeReglement {
  id: string;
  ligneDemandeId: string | null;
  montant: number;
  estConfirme: boolean;
  estAnnule: boolean;
}
export interface EntreeDepense {
  montant: number;
  justification: string;
  objet: string;
  motifNonJustifie: string | null;
}
export interface EntreeRetour {
  reglementId: string;
  estReceptionne: boolean;
  /**
   * Retour réellement attendu en caisse (déclaré, pas encore réceptionné) : faux pour une fiche de détail des dépenses
   * (son montant « à rendre » n'est que calculé) et pour la fiche d'un fonds versé par banque (jamais réceptionnée).
   * Absent = vrai si le retour n'est pas réceptionné.
   */
  attendu?: boolean;
  montantARetourner: number;
  depenses: EntreeDepense[];
}
export interface EntreeRemboursement {
  /** Règlement du retour remboursé. */
  reglementId: string;
  montant: number;
}
export interface EntreeExceptionnel {
  ligneDemandeId: string | null;
  montant: number;
}

export interface RegularisationDemande {
  /** Agrégats de chaque article qui a au moins un règlement, un retour ou un retour exceptionnel rattaché. */
  parArticle: Map<string, AgregatsRegularisation>;
  /**
   * Part non rattachée à un article : règlements sans article (dépense directe, ou antérieurs au lot D sur une demande
   * ambiguë), leurs retours et dépenses, retours exceptionnels sans article.
   */
  nonRattache: AgregatsRegularisation;
  /** Demande entière : somme exacte des articles et de la part non rattachée (égale à `getEcart`). */
  total: AgregatsRegularisation;
}

/**
 * Répartit règlements, retours, dépenses, remboursements et retours exceptionnels entre les articles. Mêmes périmètres que
 * `getTotalRegle` (règlements confirmés non annulés), `getDepensesDeclarees` (toutes les dépenses des retours de la
 * demande) et `getRetoursRecus` (retours réceptionnés + exceptionnels validés − remboursements validés) : la somme est donc
 * celle de `getEcart`. L'appelant ne fournit que des exceptionnels VALIDÉS et des remboursements VALIDÉS.
 */
export function agregerRegularisation(p: {
  reglements: readonly EntreeReglement[];
  retours: readonly EntreeRetour[];
  remboursements: readonly EntreeRemboursement[];
  exceptionnels: readonly EntreeExceptionnel[];
}): RegularisationDemande {
  const ligneDuReglement = new Map(p.reglements.map((r) => [r.id, r.ligneDemandeId]));
  const cumuls = new Map<string | null, { [K in keyof AgregatsRegularisation]: number }>();
  const de = (ligneId: string | null) => {
    let a = cumuls.get(ligneId);
    if (!a) {
      a = { fondsRemis: 0, depensesJustifiees: 0, depensesSansPieceFormelle: 0, resteNonDetaille: 0, retoursRecus: 0, retoursEnAttente: 0 };
      cumuls.set(ligneId, a);
    }
    return a;
  };

  for (const r of p.reglements) {
    if (r.estConfirme && !r.estAnnule) de(r.ligneDemandeId).fondsRemis += c(r.montant);
  }
  for (const retour of p.retours) {
    const ligneId = ligneDuReglement.get(retour.reglementId) ?? null;
    const a = de(ligneId);
    if (retour.estReceptionne) a.retoursRecus += c(retour.montantARetourner);
    else if (retour.attendu !== false) a.retoursEnAttente += c(retour.montantARetourner);
    for (const d of retour.depenses) {
      const cat = categorieDepense(d);
      if (cat === "JUSTIFIEE") a.depensesJustifiees += c(d.montant);
      else if (cat === "SANS_PIECE_FORMELLE") a.depensesSansPieceFormelle += c(d.montant);
      else a.resteNonDetaille += c(d.montant);
    }
  }
  for (const rb of p.remboursements) de(ligneDuReglement.get(rb.reglementId) ?? null).retoursRecus -= c(rb.montant);
  for (const e of p.exceptionnels) de(e.ligneDemandeId).retoursRecus += c(e.montant);

  const enFcfa = (a: { [K in keyof AgregatsRegularisation]: number }): AgregatsRegularisation => ({
    fondsRemis: a.fondsRemis / 100,
    depensesJustifiees: a.depensesJustifiees / 100,
    depensesSansPieceFormelle: a.depensesSansPieceFormelle / 100,
    resteNonDetaille: a.resteNonDetaille / 100,
    retoursRecus: a.retoursRecus / 100,
    retoursEnAttente: a.retoursEnAttente / 100,
  });
  const parArticle = new Map<string, AgregatsRegularisation>();
  let nonRattache: AgregatsRegularisation = { ...AGREGATS_VIDES };
  for (const [ligneId, a] of cumuls) {
    if (ligneId === null) nonRattache = enFcfa(a);
    else parArticle.set(ligneId, enFcfa(a));
  }
  return { parArticle, nonRattache, total: additionnerAgregats([...parArticle.values(), nonRattache]) };
}

/**
 * Date de régularisation d'un article : la plus récente des dates qui ont fait évoluer ses chiffres (confirmation d'un
 * règlement, réception d'un retour, déclaration d'une dépense, validation d'un retour exceptionnel), quand son solde est nul.
 * `null` sinon, ou quand aucune date n'est connue.
 */
export function dateRegularisation(p: { agregats: AgregatsRegularisation; dates: readonly (Date | null | undefined)[] }): Date | null {
  if (c(p.agregats.fondsRemis) <= 0 || c(getEcartLigne(p.agregats)) !== 0) return null;
  const connues = p.dates.filter((d): d is Date => d instanceof Date);
  if (connues.length === 0) return null;
  return new Date(Math.max(...connues.map((d) => d.getTime())));
}

export interface TotauxBandeArticle {
  remis: number;
  detaille: number;
  reste: number;
  sansPiece: number;
  retourne: number;
}

/**
 * Bande « Total de l'article » (lot G quater) : additionne TOUS les règlements de l'article (Caisse + Banque) avec les mêmes
 * définitions que la bande de chaque règlement (`totauxDetailRetour`) — Remis = fonds remis, Détaillé = dépenses justifiées +
 * sans pièce formelle, Sans pièce = dépenses sans pièce formelle, Retourné = retours reçus ; le reste est CELUI de
 * `resteNonDetailleTotal` (jamais un second calcul). Aucun accès base, aucune écriture.
 */
export function totauxBandeArticle(a: AgregatsRegularisation): TotauxBandeArticle {
  return {
    remis: a.fondsRemis,
    detaille: (c(a.depensesJustifiees) + c(a.depensesSansPieceFormelle)) / 100,
    reste: resteNonDetailleTotal(a),
    sansPiece: a.depensesSansPieceFormelle,
    retourne: a.retoursRecus,
  };
}
