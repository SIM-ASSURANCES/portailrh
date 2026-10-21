// Retour EXTERNE rattaché à une demande et à son article (lot G bis, 2026-10-19). Module PUR : aucune base, aucun import
// de valeur Prisma (sûr pour un Client Component).
//
// Un fonds versé par BANQUE n'a plus de circuit « déclarer / réceptionner un retour » : son retour est enregistré par le
// Responsable Finance en retour externe, qu'il rattache à la demande et à l'article concernés. Rattaché, il compte comme
// retour reçu de l'article (solde à régulariser) ; l'écriture de caisse (ENTREE) est celle du retour externe, inchangée.
// Non rattaché (cas du chèque hors système), il reste totalement autonome.

const c = (n: number) => Math.round(n * 100);

/** Ce que l'appelant lit en base pour juger un rattachement. */
export interface ContexteRattachement {
  /** La demande a des articles (sinon : dépense directe, aucun article à désigner). */
  demandeALignes: boolean;
  /** Article choisi (ou null) et son appartenance à la demande. */
  ligneDemandeId: string | null;
  ligneAppartientALaDemande: boolean;
  /** Fonds versés par BANQUE sur le périmètre (règlements Banque confirmés et non annulés). */
  fondsBanque: number;
  /** Retours externes déjà rattachés à ce périmètre. */
  dejaRetourneExterne: number;
  /** Solde à régulariser actuel du périmètre (`getEcartLigne`). */
  ecartPerimetre: number;
}

export interface ArticleRattachable {
  ligneId: string | null;
  libelle: string;
  fondsBanque: number;
  dejaRetourne: number;
  ecart: number;
}

export interface DemandeRattachable {
  demandeId: string;
  reference: string;
  /** Périmètres (articles, ou la demande seule pour une dépense directe) ayant des fonds versés par banque. */
  articles: ArticleRattachable[];
}

export const MESSAGE_RETOUR_BANQUE_PAR_RETOUR_EXTERNE =
  "Ce règlement a été fait par banque : son retour ne se déclare pas ici. La Finance l'enregistre en « Retour externe » en le rattachant à la demande et à l'article.";
export const MESSAGE_ARTICLE_REQUIS = "Indiquez l'article de la demande auquel ce retour se rattache.";
export const MESSAGE_ARTICLE_INTERDIT = "Cette demande n'a pas d'article : le retour se rattache à la demande seule.";
export const MESSAGE_ARTICLE_ETRANGER = "Cet article n'appartient pas à la demande indiquée.";
export const MESSAGE_SANS_REGLEMENT_BANQUE =
  "Aucun règlement par banque confirmé sur cet article : un retour externe ne se rattache qu'à des fonds versés par banque.";

/**
 * Montant maximum rattachable : jamais plus que les fonds versés par banque non encore retournés par un autre retour
 * externe, ni que le solde à régulariser du périmètre (on ne « rend » pas plus que ce qui reste à justifier).
 */
export function plafondRetourRattache(p: Pick<ContexteRattachement, "fondsBanque" | "dejaRetourneExterne" | "ecartPerimetre">): number {
  const banqueRestant = Math.max(0, c(p.fondsBanque) - c(p.dejaRetourneExterne));
  return Math.min(banqueRestant, Math.max(0, c(p.ecartPerimetre))) / 100;
}

/** Refus du rattachement (phrase prête à afficher), ou `null` s'il est possible pour ce montant. */
export function refusRetourRattache(ctx: ContexteRattachement, montant: number): string | null {
  if (ctx.demandeALignes) {
    if (!ctx.ligneDemandeId) return MESSAGE_ARTICLE_REQUIS;
    if (!ctx.ligneAppartientALaDemande) return MESSAGE_ARTICLE_ETRANGER;
  } else if (ctx.ligneDemandeId) {
    return MESSAGE_ARTICLE_INTERDIT;
  }
  if (c(ctx.fondsBanque) <= 0) return MESSAGE_SANS_REGLEMENT_BANQUE;
  const plafond = plafondRetourRattache(ctx);
  if (c(montant) > c(plafond)) {
    return plafond <= 0
      ? "Il n'y a plus rien à retourner sur cet article : les fonds par banque sont déjà retournés ou justifiés."
      : `Le montant retourné (${montant.toLocaleString("fr-FR")} FCFA) dépasse le maximum rattachable à cet article (${plafond.toLocaleString("fr-FR")} FCFA : fonds par banque non encore retournés, dans la limite du solde à régulariser).`;
  }
  return null;
}
