import { FEEDBACK_CONTENT_MAX, FEEDBACK_CONTENT_MIN } from "./feedback-constants";
import type { FeedbackType } from "./generated/prisma/enums";

/**
 * FeedbackApp — notation structurée (voir CLAUDE.md "FeedbackApp —
 * notation structurée"). Fichier PUR, sans dépendance Prisma (même règle
 * que `feedback-constants.ts` — voir ce fichier pour le piège de bundle
 * déjà rencontré) : `import type { FeedbackType } from
 * "./generated/prisma/enums"` est sûr, ce fichier généré n'a aucun import
 * ni effet de bord (voir `client-safe.ts`, qui le réexporte déjà en
 * intégralité).
 *
 * RÈGLE ABSOLUE INCHANGÉE : plus aucun champ texte libre côté utilisateur
 * — uniquement des notes/choix sur des questions FIXES, jamais un
 * identifiant, une IP, un texte saisi par l'auteur. `generateFeedbackComment`
 * ci-dessous est la SEULE source du `content` final, calculée côté
 * SERVEUR à partir de `ratings` (jamais un `content` envoyé tel quel par
 * le client — voir `frontend/.../feedback/nouveau/actions.ts`, qui
 * n'accepte d'ailleurs plus aucun champ `content` dans son schéma zod).
 *
 * ⚠️ CONTENU PROVISOIRE : les libellés de questions reproduisent au mot
 * près les captures d'écran fournies (à ne pas reformuler sans nouvelle
 * validation). Les PHRASES GÉNÉRÉES ci-dessous (`*_PHRASES`) sont un
 * premier jet à faire approuver par le maître de stage avant mise en
 * production — voir CLAUDE.md pour le rappel explicite.
 */

export type FeedbackQuestionType = "stars" | "scale10" | "slider" | "choice";

export interface FeedbackChoiceOption {
  value: string;
  label: string;
}

export interface FeedbackQuestionDef {
  key: string;
  label: string;
  questionType: FeedbackQuestionType;
  /** Uniquement pour `questionType: "choice"`, dans l'ordre d'affichage —
   * le premier et le dernier sont traités comme les réponses les plus
   * "significatives" pour le choix des phrases assemblées (voir
   * `generateFeedbackComment`). */
  options?: FeedbackChoiceOption[];
}

export interface FeedbackStepDef {
  title: string;
  questions: FeedbackQuestionDef[];
}

// ============================================================
// Onglet "Collaboration entre collègues" — recipientId obligatoire
// ============================================================

export const COLLABORATION_QUESTIONS: readonly FeedbackQuestionDef[] = [
  {
    key: "collab_qualite_travail",
    label: "Comment évaluez-vous la qualité de votre travail avec ce collaborateur ?",
    questionType: "stars",
  },
  {
    key: "collab_communication",
    label: "Cette personne communique-t-elle efficacement ?",
    questionType: "stars",
  },
  {
    key: "collab_esprit_equipe",
    label: "Cette personne favorise-t-elle un bon esprit d'équipe ?",
    questionType: "stars",
  },
  {
    key: "collab_ambiance",
    label: "Cette personne contribue-t-elle à une bonne ambiance au travail ?",
    questionType: "stars",
  },
  {
    key: "collab_disponibilite",
    label: "Cette personne est-elle disponible et coopérative ?",
    questionType: "stars",
  },
  {
    key: "collab_delais",
    label: "Cette personne respecte-t-elle les délais d'engagements ?",
    questionType: "stars",
  },
  {
    key: "collab_note_globale",
    label: "Globalement, comment évaluez-vous ce collaborateur ?",
    questionType: "scale10",
  },
];

// ============================================================
// Onglet "Conditions de travail" — recipientId toujours null, 4 étapes
// ============================================================

export const CONDITIONS_TRAVAIL_STEPS: readonly FeedbackStepDef[] = [
  {
    title: "Environnement de travail",
    questions: [
      {
        key: "ct_outils",
        label: "Tu disposes des outils nécessaires pour bien travailler ?",
        questionType: "choice",
        options: [
          { value: "OUI_TOTALEMENT", label: "Oui totalement" },
          { value: "PARTIELLEMENT", label: "Partiellement" },
          { value: "NON", label: "Non" },
        ],
      },
      {
        key: "ct_charge_travail",
        label: "Ta charge de travail est raisonnable ?",
        questionType: "choice",
        options: [
          { value: "OUI", label: "Oui" },
          { value: "PARFOIS", label: "Parfois" },
          { value: "NON", label: "Non" },
        ],
      },
      {
        key: "ct_environnement",
        label: "Ton environnement de travail est satisfaisant ?",
        questionType: "slider",
      },
    ],
  },
  {
    title: "Management",
    questions: [
      {
        key: "ct_objectifs_clairs",
        label: "Les objectifs et consignes sont clairement communiqués ?",
        questionType: "choice",
        options: [
          { value: "TOUJOURS", label: "Toujours" },
          { value: "SOUVENT", label: "Souvent" },
          { value: "RAREMENT", label: "Rarement" },
          { value: "JAMAIS", label: "Jamais" },
        ],
      },
      {
        key: "ct_ecoute",
        label: "Tu te sens écouté(e) lorsque tu exprimes une préoccupation ?",
        questionType: "choice",
        options: [
          { value: "OUI", label: "Oui" },
          { value: "PARFOIS", label: "Parfois" },
          { value: "NON", label: "Non" },
        ],
      },
      {
        key: "ct_communication_interne",
        label: "La communication interne est efficace ?",
        questionType: "slider",
      },
    ],
  },
  {
    title: "Motivation & ambiance",
    questions: [
      {
        key: "ct_motivation",
        label: "Tu te sens motivé(e) et reconnu(e) dans ton travail ?",
        questionType: "slider",
      },
      {
        key: "ct_ambiance_equipe",
        label: "L'ambiance au sein de l'équipe est ?",
        questionType: "choice",
        options: [
          { value: "EXCELLENTE", label: "Excellente" },
          { value: "BONNE", label: "Bonne" },
          { value: "MOYENNE", label: "Moyenne" },
          { value: "MAUVAISE", label: "Mauvaise" },
        ],
      },
      {
        key: "ct_perspectives",
        label: "Tu vois des perspectives d'évolution pour toi ici ?",
        questionType: "choice",
        options: [
          { value: "OUI", label: "Oui" },
          { value: "PEUT_ETRE", label: "Peut-être" },
          { value: "NON", label: "Non" },
        ],
      },
    ],
  },
  {
    title: "Satisfaction globale",
    questions: [
      {
        key: "ct_satisfaction_globale",
        label: "Globalement tu es satisfait(e) de travailler ici ?",
        questionType: "slider",
      },
      {
        key: "ct_recommandation",
        label: "Tu recommanderais SIM Assurances comme lieu de travail ?",
        questionType: "choice",
        options: [
          { value: "OUI", label: "Oui" },
          { value: "PEUT_ETRE", label: "Peut-être" },
          { value: "NON", label: "Non" },
        ],
      },
    ],
  },
];

export const CONDITIONS_TRAVAIL_QUESTIONS: readonly FeedbackQuestionDef[] =
  CONDITIONS_TRAVAIL_STEPS.flatMap((step) => step.questions);

export function questionsForType(type: FeedbackType): readonly FeedbackQuestionDef[] {
  return type === "COLLABORATION" ? COLLABORATION_QUESTIONS : CONDITIONS_TRAVAIL_QUESTIONS;
}

/**
 * Valide un objet de réponses structurées pour un `type` donné — TOUTES
 * les questions du type sont obligatoires (formulaire fermé, jamais de
 * soumission partielle). Retourne un message d'erreur explicite, ou
 * `null` si valide. Utilisée côté serveur (`soumettreFeedbackAction`)
 * pour revalider ce que le client prétend avoir envoyé, jamais une
 * confiance aveugle dans le JSON reçu.
 */
export function validateFeedbackRatings(type: FeedbackType, ratings: unknown): string | null {
  if (typeof ratings !== "object" || ratings === null || Array.isArray(ratings)) {
    return "Réponses invalides.";
  }
  const record = ratings as Record<string, unknown>;
  const questions = questionsForType(type);

  for (const question of questions) {
    const value = record[question.key];
    if (value === undefined || value === null || value === "") {
      return `Réponse manquante : "${question.label}".`;
    }
    if (question.questionType === "stars" || question.questionType === "slider") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        return `Réponse invalide pour : "${question.label}".`;
      }
    } else if (question.questionType === "scale10") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 10) {
        return `Réponse invalide pour : "${question.label}".`;
      }
    } else {
      const validValues = new Set((question.options ?? []).map((o) => o.value));
      if (typeof value !== "string" || !validValues.has(value)) {
        return `Réponse invalide pour : "${question.label}".`;
      }
    }
  }

  // Aucune clé inconnue tolérée — un champ de plus que prévu est rejeté
  // plutôt qu'ignoré silencieusement (défense en profondeur : la ligne
  // `ratings` stockée en base ne doit jamais contenir autre chose que les
  // questions réellement posées).
  const knownKeys = new Set(questions.map((q) => q.key));
  for (const key of Object.keys(record)) {
    if (!knownKeys.has(key)) {
      return "Réponses invalides.";
    }
  }

  return null;
}

/** Valeur brute d'une réponse : note (stars/scale10/slider) ou code de choix. */
export type FeedbackRatingValue = number | string;
export type FeedbackRatings = Record<string, FeedbackRatingValue>;

// ============================================================
// Génération du commentaire final — ⚠️ PHRASES PROVISOIRES, À VALIDER
// PAR LE MAÎTRE DE STAGE AVANT MISE EN PRODUCTION (voir CLAUDE.md).
// Ton neutre et professionnel, jamais agressif même pour les notes
// basses — objectif constructif, jamais punitif.
// ============================================================

interface ScalePhrases {
  positive: string;
  neutral: string;
  constructive: string;
}

const SCALE5_PHRASES: Readonly<Record<string, ScalePhrases>> = {
  collab_qualite_travail: {
    positive: "La qualité du travail réalisé avec ce collaborateur est jugée très satisfaisante.",
    neutral: "La qualité du travail avec ce collaborateur est jugée correcte, sans particularité notable.",
    constructive: "La qualité du travail avec ce collaborateur pourrait être améliorée.",
  },
  collab_communication: {
    positive: "Cette personne communique de manière claire et efficace.",
    neutral: "La communication avec cette personne est globalement satisfaisante.",
    constructive: "La communication avec cette personne gagnerait à être plus claire.",
  },
  collab_esprit_equipe: {
    positive: "Cette personne contribue activement à un bon esprit d'équipe.",
    neutral: "Cette personne participe correctement à la dynamique d'équipe.",
    constructive: "Cette personne pourrait davantage favoriser l'esprit d'équipe.",
  },
  collab_ambiance: {
    positive: "Cette personne contribue positivement à l'ambiance de travail.",
    neutral: "Cette personne a un impact neutre sur l'ambiance de travail.",
    constructive: "Cette personne pourrait avoir un impact plus positif sur l'ambiance de travail.",
  },
  collab_disponibilite: {
    positive: "Cette personne se montre disponible et coopérative.",
    neutral: "La disponibilité de cette personne est jugée correcte.",
    constructive: "Cette personne pourrait se montrer plus disponible et coopérative.",
  },
  collab_delais: {
    positive: "Cette personne respecte bien les délais fixés.",
    neutral: "Le respect des délais par cette personne est globalement correct.",
    constructive: "Le respect des délais par cette personne pourrait être amélioré.",
  },
  ct_environnement: {
    positive: "L'environnement de travail est jugé satisfaisant.",
    neutral: "L'environnement de travail est jugé correct.",
    constructive: "L'environnement de travail pourrait être amélioré.",
  },
  ct_communication_interne: {
    positive: "La communication interne est perçue comme efficace.",
    neutral: "La communication interne est jugée correcte.",
    constructive: "La communication interne pourrait être renforcée.",
  },
  ct_motivation: {
    positive: "Un bon niveau de motivation et de reconnaissance est ressenti au travail.",
    neutral: "Le niveau de motivation et de reconnaissance ressenti est correct.",
    constructive: "Le niveau de motivation et de reconnaissance ressenti pourrait être renforcé.",
  },
  ct_satisfaction_globale: {
    positive: "La satisfaction globale de travailler ici est élevée.",
    neutral: "La satisfaction globale de travailler ici est correcte.",
    constructive: "La satisfaction globale de travailler ici mérite un point d'attention.",
  },
};

const SCALE10_PHRASES: Readonly<Record<string, ScalePhrases>> = {
  collab_note_globale: {
    positive: "Globalement, la collaboration avec cette personne est très positive.",
    neutral: "Globalement, la collaboration avec cette personne est correcte.",
    constructive: "Globalement, cette collaboration mérite un point d'attention.",
  },
};

const CHOICE_PHRASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  ct_outils: {
    OUI_TOTALEMENT: "Les outils nécessaires au travail sont jugés pleinement disponibles.",
    PARTIELLEMENT: "Les outils disponibles pour travailler ne couvrent que partiellement les besoins.",
    NON: "Les outils nécessaires pour bien travailler font défaut.",
  },
  ct_charge_travail: {
    OUI: "La charge de travail est jugée raisonnable.",
    PARFOIS: "La charge de travail est jugée raisonnable seulement par moments.",
    NON: "La charge de travail est jugée excessive.",
  },
  ct_objectifs_clairs: {
    TOUJOURS: "Les objectifs et consignes sont toujours communiqués clairement.",
    SOUVENT: "Les objectifs et consignes sont le plus souvent communiqués clairement.",
    RAREMENT: "Les objectifs et consignes sont rarement communiqués clairement.",
    JAMAIS: "Les objectifs et consignes manquent de clarté.",
  },
  ct_ecoute: {
    OUI: "Un sentiment d'écoute est ressenti lors de l'expression d'une préoccupation.",
    PARFOIS: "Le sentiment d'être écouté n'est présent que par moments.",
    NON: "Un manque d'écoute est ressenti lors de l'expression d'une préoccupation.",
  },
  ct_ambiance_equipe: {
    EXCELLENTE: "L'ambiance au sein de l'équipe est jugée excellente.",
    BONNE: "L'ambiance au sein de l'équipe est jugée bonne.",
    MOYENNE: "L'ambiance au sein de l'équipe est jugée moyenne.",
    MAUVAISE: "L'ambiance au sein de l'équipe mérite une attention particulière.",
  },
  ct_perspectives: {
    OUI: "Des perspectives d'évolution sont perçues au sein de l'entreprise.",
    PEUT_ETRE: "Les perspectives d'évolution restent incertaines.",
    NON: "Peu de perspectives d'évolution sont perçues au sein de l'entreprise.",
  },
  ct_recommandation: {
    OUI: "SIM Assurances serait recommandée comme lieu de travail.",
    PEUT_ETRE: "La recommandation de SIM Assurances comme lieu de travail reste mitigée.",
    NON: "SIM Assurances ne serait pas recommandée comme lieu de travail en l'état.",
  },
};

const questionByKey: Readonly<Record<string, FeedbackQuestionDef>> = Object.fromEntries(
  [...COLLABORATION_QUESTIONS, ...CONDITIONS_TRAVAIL_QUESTIONS].map((q) => [q.key, q])
);

function phraseFor(question: FeedbackQuestionDef, value: FeedbackRatingValue): string | null {
  if (question.questionType === "stars" || question.questionType === "slider") {
    const p = SCALE5_PHRASES[question.key];
    const v = Number(value);
    if (!p || !Number.isFinite(v)) return null;
    return v >= 4 ? p.positive : v === 3 ? p.neutral : p.constructive;
  }
  if (question.questionType === "scale10") {
    const p = SCALE10_PHRASES[question.key];
    const v = Number(value);
    if (!p || !Number.isFinite(v)) return null;
    return v >= 8 ? p.positive : v >= 5 ? p.neutral : p.constructive;
  }
  // choice
  const p = CHOICE_PHRASES[question.key];
  if (!p) return null;
  return p[String(value)] ?? null;
}

/**
 * Poids de significativité d'une réponse — détermine quelles phrases sont
 * prioritaires lors de l'assemblage (les réponses les plus tranchées
 * d'abord, jamais un ordre arbitraire). Échelle volontairement grossière
 * (0/1/2) : seul l'ORDRE relatif compte, jamais la valeur absolue.
 */
function weightFor(question: FeedbackQuestionDef, value: FeedbackRatingValue): number {
  if (question.questionType === "stars" || question.questionType === "slider") {
    const v = Number(value);
    return Number.isFinite(v) ? Math.abs(v - 3) : 0;
  }
  if (question.questionType === "scale10") {
    const v = Number(value);
    if (!Number.isFinite(v)) return 0;
    return v >= 8 || v <= 4 ? 2 : 1;
  }
  const opts = question.options ?? [];
  const idx = opts.findIndex((o) => o.value === String(value));
  if (idx === -1) return 0;
  return idx === 0 || idx === opts.length - 1 ? 2 : 1;
}

/**
 * Assemble 2 à 4 phrases pré-écrites en un paragraphe naturel à partir des
 * réponses structurées — jamais une liste à puces, jamais de texte tapé
 * par l'utilisateur (voir règle absolue en tête de fichier). Résultat
 * TOUJOURS compris entre `FEEDBACK_CONTENT_MIN` et `FEEDBACK_CONTENT_MAX`
 * caractères (garanti par construction avec les phrases actuelles ; les
 * filets de sécurité en fin de fonction ne sont là que par défense en
 * profondeur, ne devraient jamais se déclencher en pratique).
 *
 * ⚠️ Phrases provisoires — voir l'avertissement en tête de fichier.
 */
export function generateFeedbackComment(type: FeedbackType, ratings: FeedbackRatings): string {
  const questions = questionsForType(type);

  const items = questions
    .map((question, order) => {
      const value = ratings[question.key];
      if (value === undefined || value === null || value === "") return null;
      const phrase = phraseFor(question, value);
      if (!phrase) return null;
      return { phrase, weight: weightFor(question, value), order };
    })
    .filter((item): item is { phrase: string; weight: number; order: number } => item !== null);

  const sorted = [...items].sort((a, b) => b.weight - a.weight || a.order - b.order);

  const assemble = (n: number) => sorted.slice(0, n).map((i) => i.phrase).join(" ");

  let count = Math.min(3, sorted.length);
  let text = assemble(count);

  while (text.length > FEEDBACK_CONTENT_MAX && count > 2) {
    count -= 1;
    text = assemble(count);
  }
  while (text.length < FEEDBACK_CONTENT_MIN && count < Math.min(4, sorted.length)) {
    count += 1;
    text = assemble(count);
  }

  text = text.trim();
  if (text.length > FEEDBACK_CONTENT_MAX) {
    text = text.slice(0, FEEDBACK_CONTENT_MAX - 1).trimEnd() + "…";
  }
  if (text.length < FEEDBACK_CONTENT_MIN) {
    text = `${text} Merci pour ce retour constructif.`.trim().slice(0, FEEDBACK_CONTENT_MAX);
  }

  return text;
}

export function isKnownFeedbackQuestionKey(key: string): boolean {
  return key in questionByKey;
}
