import { origineSiteConfiguree } from "./cheminRetour";
import { urlReseauDev, type InterfaceReseau } from "./reseauLocal";

/**
 * URL publique du portail, utilisée pour tous les liens ABSOLUS envoyés hors de l'application (e-mails d'invitation,
 * de réinitialisation, de notification critique…). UNE seule règle, au lieu des `NEXTAUTH_URL || "http://localhost:3000"`
 * répétés dans chaque fichier :
 *
 * - en production : l'origine configurée (`AUTH_URL`, sinon `NEXTAUTH_URL`) ; à défaut seulement, `http://localhost:3000`
 *   (mauvaise configuration, mais comportement historique) ;
 * - en développement : si l'origine configurée est une vraie adresse (IP réseau, domaine), on la garde ; si elle vaut
 *   `localhost` / `127.0.0.1` ou n'est pas définie (cas du `.env` local), on retient l'adresse réseau local de la machine
 *   (`DEV_NETWORK_IP` en priorité, sinon `choisirAdresseReseau`), pour que le lien s'ouvre depuis un téléphone du même réseau.
 */
export function urlPubliqueSite(params: {
  env: Record<string, string | undefined>;
  interfaces: Record<string, InterfaceReseau[] | undefined>;
}): string {
  const { env, interfaces } = params;
  const configuree = origineSiteConfiguree(env);
  if (env.NODE_ENV === "production") return configuree ?? "http://localhost:3000";

  const hoteConfigure = configuree ? new URL(configuree).hostname : null;
  const estLocal = hoteConfigure === null || hoteConfigure === "localhost" || hoteConfigure === "127.0.0.1";
  if (configuree && !estLocal) return configuree;

  const port = (configuree && new URL(configuree).port) || env.PORT || "3000";
  return urlReseauDev({ host: `localhost:${port}`, interfaces, ipForcee: env.DEV_NETWORK_IP }).networkUrl;
}
