/**
 * Page où revenir après la connexion (Pointage V2 lot 4 ; audit open redirect du 2026-10-10). SEUL point de validation du
 * chemin de retour : la page de connexion ET le callback `redirect` d'Auth.js passent par elle — aucune redirection après
 * connexion ne doit s'en passer.
 *
 * Règle : le résultat est TOUJOURS un chemin interne (« /… ») d'une route du portail, jamais une URL ; tout le reste
 * revient à « / ». La valeur est résolue avec `new URL(valeur, origine)` et acceptée seulement si l'origine résolue est
 * exactement celle du site ET si le chemin commence par un préfixe interne autorisé — jamais un simple `startsWith("/")`.
 * - `origine` : origine CONFIGURÉE du site (`AUTH_URL`), jamais lue d'un en-tête (Host, x-forwarded-host) que le client
 *   contrôle. Une URL absolue n'est acceptée que vers cette origine-là (le middleware d'Auth.js pose une URL absolue
 *   quand il renvoie un visiteur vers /login) ; sans origine configurée, seules les valeurs relatives passent.
 * - Refusés d'emblée : valeur non-chaîne, vide ou trop longue ; caractère de contrôle, espace ou barre oblique inverse
 *   (les navigateurs les retirent ou les lisent comme « / » : « /\evil.com », « /\t/evil.com » deviennent « //evil.com ») ;
 *   identifiants dans l'URL ; une forme décodée (jusqu'à 3 niveaux d'encodage) qui deviendrait « //… », contiendrait une
 *   barre inverse, un caractère de contrôle ou un schéma.
 * - Jamais /login (pas de boucle) ni une route hors des préfixes internes (/api, /invitation, /forgot-password…).
 */

/** Préfixes des routes internes où l'on peut revenir après connexion (pages du portail). */
export const PREFIXES_RETOUR_INTERNES: readonly string[] = [
  "/pointage",
  "/treso",
  "/encaissements",
  "/admin",
  "/delegations",
  "/feedback",
  "/logs",
  "/profil",
  "/systeme",
];

export const LONGUEUR_MAX_CHEMIN_RETOUR = 2048;

const ORIGINE_FICTIVE = "http://portail.invalid";
// Caractères de contrôle (C0, DEL, C1), tout espace (y compris insécables et séparateurs Unicode) et barre oblique inverse.
const CARACTERES_INTERDITS = /[\u0000-\u001F\u007F-\u009F\s\u00A0\u1680\u2000-\u200F\u2028-\u202F\u205F\u3000\uFEFF\\]/;
const SCHEMA = /^[a-z][a-z0-9+.-]*:/i;

function origineDe(valeur: string | null | undefined): string | null {
  if (!valeur) return null;
  try {
    return new URL(valeur).origin;
  } catch {
    return null;
  }
}

/** Les formes décodées successives d'une valeur (jusqu'à 3 niveaux) ; `null` si l'une est mal encodée. */
function formesDecodees(valeur: string): string[] | null {
  const formes = [valeur];
  let courante = valeur;
  for (let i = 0; i < 3; i++) {
    let decodee: string;
    try {
      decodee = decodeURIComponent(courante);
    } catch {
      return null;
    }
    if (decodee === courante) break;
    formes.push(decodee);
    courante = decodee;
  }
  return formes;
}

function cheminInterneAutorise(chemin: string, autoriserConnexion: boolean): boolean {
  if (chemin === "/") return true;
  if (autoriserConnexion && chemin === "/login") return true;
  return PREFIXES_RETOUR_INTERNES.some((p) => chemin === p || chemin.startsWith(`${p}/`));
}

/**
 * @param brut valeur reçue (formulaire, paramètre) — de n'importe quel type.
 * @param origineSite origine configurée du site (`AUTH_URL`), ou `null`.
 * @param options.autoriserConnexion `/login` accepté — UNIQUEMENT pour le callback `redirect` d'Auth.js, qui sert aussi
 *   à la déconnexion (`signOut({ redirectTo: "/login" })`). Le retour APRÈS connexion le refuse (pas de boucle) ; un
 *   compte déjà connecté qui arriverait sur /login est de toute façon renvoyé à l'accueil par la page elle-même.
 * @returns un chemin interne autorisé, sinon « / ».
 */
export function cheminRetourConnexion(
  brut: unknown,
  origineSite: string | null | undefined,
  options: { autoriserConnexion?: boolean } = {}
): string {
  if (typeof brut !== "string" || brut.length === 0 || brut.length > LONGUEUR_MAX_CHEMIN_RETOUR) return "/";
  if (CARACTERES_INTERDITS.test(brut)) return "/";

  const origine = origineDe(origineSite);
  const absolue = SCHEMA.test(brut);
  if (absolue) {
    if (!origine) return "/";
  } else if (!brut.startsWith("/") || brut.startsWith("//")) {
    return "/";
  }

  // Une valeur encodée ne doit jamais redevenir un chemin dangereux une fois décodée (par un navigateur, un proxy…).
  const formes = formesDecodees(absolue ? brut.slice(origine!.length) : brut);
  if (!formes) return "/";
  for (const f of formes) {
    if (f.startsWith("//") || CARACTERES_INTERDITS.test(f) || (!absolue && SCHEMA.test(f))) return "/";
  }

  const base = origine ?? ORIGINE_FICTIVE;
  let url: URL;
  try {
    url = new URL(brut, base);
  } catch {
    return "/";
  }
  if (url.origin !== base || url.username || url.password) return "/";
  // URL absolue : elle doit commencer EXACTEMENT par l'origine du site suivie d'un « / » (pas de « …@evil.com »).
  if (absolue && !brut.startsWith(`${base}/`)) return "/";

  const chemin = url.pathname;
  if (chemin.startsWith("//") || !cheminInterneAutorise(chemin, options.autoriserConnexion === true)) return "/";
  return `${chemin}${url.search}`;
}

/** Origine configurée du site (`AUTH_URL`) : référence de la validation, jamais un en-tête de la requête. */
export function origineSiteConfiguree(env: Record<string, string | undefined> = process.env): string | null {
  return origineDe(env.AUTH_URL ?? env.NEXTAUTH_URL ?? null);
}
