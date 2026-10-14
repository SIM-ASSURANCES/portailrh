import { getResumeArticle } from "backend";

/**
 * Suffixe de notification qui nomme l'article concerné (lot E) : « , article « Taxi » » — vide sans article.
 * `vueDemandeur` : le demandeur reçoit la version d'origine du libellé.
 */
export async function suffixeArticle(ligneDemandeId: string | null | undefined, vueDemandeur = false): Promise<string> {
  if (!ligneDemandeId) return "";
  const a = await getResumeArticle(ligneDemandeId);
  return a ? `, article « ${vueDemandeur ? a.libelleDemandeur : a.libelle} »` : "";
}
