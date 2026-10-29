import { hasPermission, isAdmin } from "@/lib/auth";

/**
 * Qui peut télécharger les justificatifs d'un retour externe (chèque initial et retour) : Admin ou `treso.creer_retour_externe`,
 * la permission de l'action elle-même. UNE seule règle, lue par la route de téléchargement (`/api/treso/pieces-jointes/[id]`) ET par
 * le reporting, qui ne produit un lien que pour qui peut l'ouvrir (jamais un lien mort, jamais un droit élargi).
 */
export function peutTelechargerJustificatifsRetourExterne(session: Parameters<typeof isAdmin>[0] & Parameters<typeof hasPermission>[0]): boolean {
  return isAdmin(session) || hasPermission(session, "treso.creer_retour_externe");
}
