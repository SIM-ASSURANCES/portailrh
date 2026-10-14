// Reprise des règlements antérieurs au lot D (rattachement à un article). Logique PURE, sans base, utilisée par le script
// manuel `prisma/recalculer-reglements-articles.ts` et testée à part.
//
// Règle : un règlement ne se rattache automatiquement que si AUCUN doute n'est possible — la demande n'a qu'UN article
// validé. Dès que deux articles validés ou plus existent, on ne devine pas lequel un règlement a payé : le cas est
// listé (« ambigu ») et le rattachement se fait à la main, règlement par règlement. Aucune écriture de caisse
// (JournalCaisse, JournalBanque) n'est jamais touchée.

import { montantValideArticle, totalRegleArticle, type ArticleReglable, type ReglementArticle } from "./reglementArticle";

export interface ReglementARattacher extends ReglementArticle {
  id: string;
  mode: "CAISSE" | "BANQUE";
}

export interface DemandeARattacher {
  id: string;
  reference: string;
  articles: ArticleReglable[];
  reglements: ReglementARattacher[];
}

export type ClasseDemande =
  | { classe: "RIEN" }
  /** Un seul article validé : tous les règlements sans article lui sont rattachés. */
  | { classe: "AUTOMATIQUE"; ligneId: string; reglementIds: string[] }
  /** Deux articles validés ou plus et au moins un règlement non annulé sans article : rattachement manuel. */
  | { classe: "AMBIGU"; reglementIds: string[] };

export function classerDemande(d: DemandeARattacher): ClasseDemande {
  if (d.articles.length === 0) return { classe: "RIEN" };
  const sansArticle = d.reglements.filter((r) => r.ligneDemandeId == null);
  if (sansArticle.length === 0) return { classe: "RIEN" };
  const validees = d.articles.filter((a) => a.statutValidation === "VALIDEE");
  if (validees.length === 1) return { classe: "AUTOMATIQUE", ligneId: validees[0].id, reglementIds: sansArticle.map((r) => r.id) };
  const ouverts = sansArticle.filter((r) => !r.estAnnule);
  if (ouverts.length === 0) return { classe: "RIEN" };
  return { classe: "AMBIGU", reglementIds: ouverts.map((r) => r.id) };
}

/**
 * Contrôle d'un rattachement manuel `règlement → article` : le règlement n'a pas d'article, l'article est de la même
 * demande et validé, et — pour un règlement confirmé — le total confirmé de l'article ne dépasse pas son montant validé
 * une fois le règlement rattaché. `null` si le rattachement est permis.
 */
export function refusRattachement(d: DemandeARattacher, reglementId: string, ligneId: string): string | null {
  const reglement = d.reglements.find((r) => r.id === reglementId);
  if (!reglement) return "Règlement introuvable sur cette demande.";
  if (reglement.ligneDemandeId != null) return "Ce règlement est déjà rattaché à un article.";
  if (reglement.estAnnule) return "Ce règlement est annulé : rien à rattacher.";
  const ligne = d.articles.find((a) => a.id === ligneId);
  if (!ligne) return "Cet article n'appartient pas à cette demande.";
  if (ligne.statutValidation !== "VALIDEE") return "Cet article n'est pas validé.";
  if (reglement.estConfirme) {
    const apres = Math.round(totalRegleArticle(d.reglements, ligneId) * 100) + Math.round(Number(reglement.montant) * 100);
    if (apres > Math.round(montantValideArticle(ligne) * 100)) {
      return `Le total réglé de l'article dépasserait son montant validé (${montantValideArticle(ligne).toLocaleString("fr-FR")} FCFA).`;
    }
  }
  return null;
}
