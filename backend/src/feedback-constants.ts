/**
 * FeedbackApp — constantes et validations PURES (voir CLAUDE.md "FeedbackApp
 * : anonymat total"). Ce fichier ne doit JAMAIS importer `./prisma` (ni
 * quoi que ce soit qui en dépende) : c'est ce qui permet à
 * `client-safe.ts` de le réexporter en toute sécurité pour un Client
 * Component (compteur de caractères), sans entraîner `pg`/`tls`/`dns` dans
 * le bundle navigateur. La logique métier qui touche la base de données
 * (destinataires, liste publique) reste dans `./feedback.ts`.
 */

export const FEEDBACK_CONTENT_MIN = 20;
export const FEEDBACK_CONTENT_MAX = 500;

/**
 * Liste anti-haine V1 — basique, volontairement simple (pas de service
 * tiers ni de modèle IA pour cette première version), stockée dans une
 * constante claire et facilement extensible : ajouter un terme suffit,
 * aucune autre modification nécessaire. Comparaison insensible à la casse
 * et aux accents (voir `containsBannedContent`), sur des termes entiers
 * autant que possible pour limiter les faux positifs évidents (ex: éviter
 * qu'un terme de 2-3 lettres ne bloque des mots innocents qui le
 * contiennent).
 */
export const FEEDBACK_BANNED_WORDS: readonly string[] = [
  "connard",
  "connasse",
  "salope",
  "pute",
  "putain",
  "enculé",
  "encule",
  "batard",
  "bâtard",
  "abruti",
  "debile",
  "débile",
  "imbecile",
  "imbécile",
  "raclure",
  "ordure",
  "sale race",
  "sale juif",
  "sale arabe",
  "sale noir",
  "négro",
  "negro",
  "bougnoule",
  "pd",
  "tapette",
  "sale pute",
  "va crever",
  "je vais te tuer",
  "je vais te frapper",
];

function normaliserPourFiltre(texte: string): string {
  return texte
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // retire les accents (é -> e, etc.)
}

/**
 * Filtre anti-haine basique — vrai si le contenu contient au moins un
 * terme de `FEEDBACK_BANNED_WORDS`, comparaison insensible à la casse et
 * aux accents.
 */
export function containsBannedContent(content: string): boolean {
  const normalise = normaliserPourFiltre(content);
  return FEEDBACK_BANNED_WORDS.some((mot) => normalise.includes(normaliserPourFiltre(mot)));
}

/**
 * Détecte une URL/un lien dans le contenu — le message doit rester du
 * texte seul (voir CLAUDE.md "FeedbackApp"). Couvre les schémas explicites
 * (http/https/ftp), les adresses commençant par "www.", et les motifs
 * "mot.domaine" courants (.com/.fr/.net/...) — volontairement une
 * détection large plutôt que permissive : un faux positif occasionnel
 * (ex: "version 2.0.io" improbable dans un feedback RH) est préférable à
 * un lien qui passerait au travers.
 */
const URL_PATTERN =
  /(https?|ftp):\/\/|www\.[^\s]+|\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|io|fr|co|info|biz|ci|app|dev|xyz|me)\b/i;

export function containsUrl(content: string): boolean {
  return URL_PATTERN.test(content);
}
