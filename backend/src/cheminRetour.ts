/**
 * Page où revenir après la connexion (2026-10-08, Pointage V2 lot 4 : lien de justification reçu par email). Le
 * middleware d'Auth.js pose une URL ABSOLUE (`http://hôte/chemin`) quand il renvoie un visiteur non connecté vers
 * /login : on n'en garde le chemin que si elle vise ce même hôte. Tout le reste (autre hôte, `//…`, /login, URL
 * illisible) revient à « / » — aucune redirection ouverte.
 */
export function cheminRetourConnexion(brut: string, hote: string | null): string {
  let chemin = brut;
  if (!brut.startsWith("/")) {
    try {
      const url = new URL(brut);
      chemin = hote && url.host === hote ? `${url.pathname}${url.search}` : "/";
    } catch {
      chemin = "/";
    }
  }
  return chemin.startsWith("/") && !chemin.startsWith("//") && !chemin.startsWith("/login") ? chemin : "/";
}
