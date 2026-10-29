/**
 * Journal technique (fiabilisation du pointage, phase 3) — LOGIQUE PURE : codes d'incident, assainissement du message
 * et du contexte. Aucun accès base : l'écriture est dans `frontend/src/lib/journalTechnique.ts`.
 *
 * Règle absolue : le contexte d'un incident ne contient JAMAIS de donnée sensible — pas de mot de passe, pas de contenu
 * d'e-mail, pas de jeton FCM entier. Seules des clés d'une liste blanche sont conservées (identifiants, nom de tâche,
 * code d'erreur, compteurs) ; les textes sont tronqués ; les adresses e-mail sont masquées dans les messages.
 */

export const CODES_JOURNAL = {
  SMTP_ECHEC: "SMTP_ECHEC",
  SMTP_NON_CONFIGURE: "SMTP_NON_CONFIGURE",
  FCM_ECHEC: "FCM_ECHEC",
  FCM_JETON_INVALIDE: "FCM_JETON_INVALIDE",
  FIREBASE_NON_CONFIGURE: "FIREBASE_NON_CONFIGURE",
  TACHE_ECHEC: "TACHE_ECHEC",
  TACHE_ERREURS_PARTIELLES: "TACHE_ERREURS_PARTIELLES",
  CLOTURE_INITIALE: "CLOTURE_INITIALE",
} as const;

export type CodeJournal = (typeof CODES_JOURNAL)[keyof typeof CODES_JOURNAL];

/** Clés de contexte admises ; toute autre clé est supprimée. */
export const CLES_CONTEXTE_AUTORISEES = [
  "userId",
  "notificationId",
  "tache",
  "declenchement",
  "fcmCode",
  "jetonsSupprimes",
  "echecs",
  "repetitions",
  "statut",
  "justificationsCloturees",
  "absencesConfirmees",
] as const;

const LONGUEUR_MAX_TEXTE = 200;

/** Masque les adresses e-mail, garde la première ligne, tronque à 300 caractères. */
export function messageAssaini(message: string): string {
  return message
    .split("\n")[0]
    .replace(/[^\s<>"'(),;:]+@[^\s<>"'(),;:]+/g, "<email>")
    .slice(0, 300);
}

/** Contexte réduit aux clés autorisées, valeurs simples (texte tronqué, nombre, booléen) uniquement. */
export function contexteAssaini(contexte: Record<string, unknown> | undefined): Record<string, string | number | boolean> | undefined {
  if (!contexte) return undefined;
  const sortie: Record<string, string | number | boolean> = {};
  for (const cle of CLES_CONTEXTE_AUTORISEES) {
    const v = contexte[cle];
    if (typeof v === "string") sortie[cle] = messageAssaini(v).slice(0, LONGUEUR_MAX_TEXTE);
    else if (typeof v === "number" || typeof v === "boolean") sortie[cle] = v;
  }
  return Object.keys(sortie).length > 0 ? sortie : undefined;
}

/** Fenêtre anti-inondation : au plus une ligne par code et par minute. */
export const FENETRE_ANTI_INONDATION_MS = 60_000;

/** Vrai quand une nouvelle ligne du même code est écrite trop tôt après la précédente (elle sera comptée, pas écrite). */
export function incidentRepete(derniereEcriture: Date | null, maintenant: Date): boolean {
  return derniereEcriture !== null && maintenant.getTime() - derniereEcriture.getTime() < FENETRE_ANTI_INONDATION_MS;
}
