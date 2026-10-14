import {
  beneficiaireArticle,
  montantValideArticle,
  getParcoursArticles,
  libelleDateLivraison,
  libelleGestionArticle,
  prisma,
  resteAReglerArticle,
  totalRegleArticle,
  type BeneficiaireStocke,
} from "backend";

/** Article payé par un règlement, tel qu'imprimé sur les documents (reçus, bon de caisse) — lot D (2026-10-16). */
export interface ArticleDocument {
  libelle: string;
  beneficiaireNom: string;
  /** Montant validé de l'article. */
  montantValide: number;
  /** Date de livraison de l'article, formatée (« — » pour un ancien article). */
  dateLivraison: string;
  /** Lot H : « Géré le » de l'article (dernier événement du parcours), déjà formaté ; « — » si rien n'a été traité. */
  gereLe: string;
  /** Réglé à ce jour sur l'article / reste (état le plus à jour, comme le reste du reçu). */
  regleADate: number;
  resteARegler: number;
}

/**
 * Article d'un règlement pour les documents, ou `null` (dépense directe, règlement antérieur non rattaché). Le libellé
 * est celui de la Finance ; le collaborateur qui n'a aucun droit Finance reçoit la version qu'il a écrite (le libellé
 * modifié par la Finance est de la gestion interne, jamais montré au demandeur).
 */
export async function chargerArticleDocument(
  reglement: { demandeId: string; ligneDemandeId: string | null },
  demande: BeneficiaireStocke,
  vueFinance: boolean
): Promise<ArticleDocument | null> {
  if (!reglement.ligneDemandeId) return null;
  const [parcours, ligne, reglements] = await Promise.all([
    getParcoursArticles(reglement.demandeId),
    prisma.ligneDemande.findUnique({
      where: { id: reglement.ligneDemandeId },
      include: { beneficiaireUser: { select: { fullName: true } } },
    }),
    prisma.reglement.findMany({
      where: { demandeId: reglement.demandeId, ligneDemandeId: reglement.ligneDemandeId },
      select: { ligneDemandeId: true, montant: true, estConfirme: true, estAnnule: true },
    }),
  ]);
  if (!ligne) return null;
  const article = {
    id: ligne.id,
    libelle: ligne.libelle,
    quantite: ligne.quantite,
    prixUnitaire: Number(ligne.prixUnitaire),
    statutValidation: ligne.statutValidation,
  };
  return {
    libelle: vueFinance ? ligne.libelle : (ligne.libelleDemandeur ?? ligne.libelleOriginal ?? ligne.libelle),
    beneficiaireNom: beneficiaireArticle(ligne, demande).libelle,
    montantValide: montantValideArticle(article),
    dateLivraison: libelleDateLivraison(ligne.dateLivraison),
    gereLe: libelleGestionArticle(parcours.get(ligne.id)?.gere ?? null).replace(/^Géré le /, ""),
    regleADate: totalRegleArticle(reglements, ligne.id),
    resteARegler: resteAReglerArticle(article, reglements),
  };
}
