"use client";

import { useActionState, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Button, Select } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import {
  COLLABORATION_QUESTIONS,
  CONDITIONS_TRAVAIL_STEPS,
  IDLE_ACTION_STATE,
  type FeedbackQuestionDef,
} from "backend/client";

import { ChoiceButtons } from "./ChoiceButtons";
import { NumberScale } from "./NumberScale";
import { RatingSlider } from "./RatingSlider";
import { StarRating } from "./StarRating";
import { soumettreFeedbackAction } from "./actions";

type TabKey = "COLLABORATION" | "CONDITIONS_TRAVAIL";
type RatingValue = number | string;
type Answers = Record<string, RatingValue>;

const CT_QUESTIONS_FLAT = CONDITIONS_TRAVAIL_STEPS.flatMap((s) => s.questions);

/**
 * Initialise les curseurs (`slider`) d'une liste de questions à 3 (valeur
 * médiane) — seul type de question qui a un état "répondu" par défaut,
 * voir `RatingSlider.tsx`.
 */
function initialAnswersFor(questions: readonly FeedbackQuestionDef[]): Answers {
  const initial: Answers = {};
  for (const q of questions) {
    if (q.questionType === "slider") initial[q.key] = 3;
  }
  return initial;
}

function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: FeedbackQuestionDef;
  value?: RatingValue;
  onChange: (value: RatingValue) => void;
}) {
  if (question.questionType === "stars") {
    return <StarRating label={question.label} value={value as number | undefined} onChange={onChange} />;
  }
  if (question.questionType === "scale10") {
    return <NumberScale label={question.label} value={value as number | undefined} onChange={onChange} />;
  }
  if (question.questionType === "slider") {
    return <RatingSlider label={question.label} value={(value as number) ?? 3} onChange={onChange} />;
  }
  return (
    <ChoiceButtons
      label={question.label}
      options={question.options ?? []}
      value={value as string | undefined}
      onChange={onChange}
    />
  );
}

function QuestionCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/20 p-4 transition-colors duration-200 hover:border-primary/30 hover:bg-primary-bg/40">
      {children}
    </div>
  );
}

/** Cercles numérotés + ligne de connexion — état actif / complété / à venir
 * clairement distincts (voir CLAUDE.md "FeedbackApp — refonte visuelle"). */
function Stepper({ steps, currentStep }: { steps: readonly { title: string }[]; currentStep: number }) {
  return (
    <div className="flex items-center">
      {steps.map((step, index) => {
        const isCompleted = index < currentStep;
        const isActive = index === currentStep;
        return (
          <div key={step.title} className={`flex items-center ${index < steps.length - 1 ? "flex-1" : ""}`}>
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums transition-all duration-300 ease-out-strong ${
                  isCompleted
                    ? "bg-primary text-primary-foreground"
                    : isActive
                      ? "bg-primary text-primary-foreground shadow-[0_0_0_4px_var(--color-primary-bg)]"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {isCompleted ? <Icon name="circle-check" className="size-4" /> : index + 1}
              </span>
              <span
                className={`hidden text-center text-[10px] font-semibold sm:block ${
                  isActive ? "text-primary" : isCompleted ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {step.title}
              </span>
            </div>
            {index < steps.length - 1 ? (
              <div className="mx-1.5 h-0.5 flex-1 overflow-hidden rounded-full bg-muted sm:mx-2">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500 ease-out-strong"
                  style={{ width: isCompleted ? "100%" : "0%" }}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Panneau de confirmation "marquant" après soumission — un cercle de
 * validation qui s'anime, jamais juste un toast discret. Disparaît après
 * un court délai, pendant lequel `FeedbackForm` bascule d'onglet/réinitialise
 * (voir l'effet ci-dessous), pour une transition fluide sans rechargement. */
function ConfirmationPanel({ nextTabLabel }: { nextTabLabel: string | null }) {
  return (
    <div className="animate-fade-in-up flex flex-col items-center gap-4 rounded-2xl border border-success-border bg-success-bg px-6 py-12 text-center">
      <span className="animate-confirm-ring flex size-16 items-center justify-center rounded-full bg-success text-white shadow-[0_8px_24px_-6px_rgba(22,163,74,0.55)]">
        <Icon name="circle-check" className="size-9" />
      </span>
      <div>
        <p className="text-base font-bold text-success">Merci, votre avis a bien été envoyé.</p>
        {nextTabLabel ? (
          <p className="mt-1 text-sm text-success/80">
            Direction « {nextTabLabel} »...
          </p>
        ) : (
          <p className="mt-1 text-sm text-success/80">Il vient d&apos;être ajouté à la liste publique ci-dessous.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Formulaire de soumission — Client Component UNIQUEMENT pour
 * l'interactivité (onglets, étapes, sélection des notes) : ne lit ni ne
 * transmet AUCUNE information sur son visiteur. Le champ `site_web` est le
 * honeypot anti-bot (voir `actions.ts`/CLAUDE.md "FeedbackApp").
 *
 * DEPUIS LA NOTATION STRUCTURÉE : plus aucun champ texte libre — les
 * réponses sont assemblées dans `ratingsJson` (un unique champ caché,
 * jamais un `content` tapé par l'utilisateur) juste avant soumission.
 */
export function FeedbackForm({ recipients }: { recipients: { id: string; fullName: string }[] }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(soumettreFeedbackAction, IDLE_ACTION_STATE);
  useActionFeedback(state);

  const [tab, setTab] = useState<TabKey>("COLLABORATION");
  const [recipientId, setRecipientId] = useState("");
  const [collabAnswers, setCollabAnswers] = useState<Answers>(() => initialAnswersFor(COLLABORATION_QUESTIONS));
  const [ctAnswers, setCtAnswers] = useState<Answers>(() => initialAnswersFor(CT_QUESTIONS_FLAT));
  const [ctStep, setCtStep] = useState(0);
  const [confirmationTab, setConfirmationTab] = useState<TabKey | null>(null);

  // Détecte un NOUVEL état "success" pendant le rendu (pattern React
  // recommandé "adjusting state when a value changes" — jamais un
  // `setState` synchrone dans un `useEffect`, qui provoquerait des rendus
  // en cascade signalés par le linter) : `lastHandledState` mémorise le
  // dernier `state` déjà traité, comparé par référence (une nouvelle
  // valeur de retour de Server Action est toujours un nouvel objet).
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.status === "success") {
      setConfirmationTab(tab);
    }
  }

  const collabComplete = COLLABORATION_QUESTIONS.every((q) => collabAnswers[q.key] !== undefined);
  const currentCtStep = CONDITIONS_TRAVAIL_STEPS[ctStep];
  const currentCtStepComplete = currentCtStep.questions.every((q) => ctAnswers[q.key] !== undefined);
  const isLastCtStep = ctStep === CONDITIONS_TRAVAIL_STEPS.length - 1;

  const ratingsJson = useMemo(
    () => JSON.stringify(tab === "COLLABORATION" ? collabAnswers : ctAnswers),
    [tab, collabAnswers, ctAnswers]
  );

  const canSubmit =
    tab === "COLLABORATION" ? collabComplete && recipientId.length > 0 : currentCtStepComplete && isLastCtStep;

  // Bascule automatique vers "Conditions de travail" après une COLLABORATION
  // réussie (réinitialisée), ou rafraîchissement de la liste publique après
  // une CONDITIONS_TRAVAIL réussie (réinitialisée, reste sur l'onglet) —
  // jamais un rechargement brut de page. Ne réagit qu'à `confirmationTab`
  // (jamais à `state` directement) : les seuls `setState` de cet effet sont
  // dans le callback DIFFÉRÉ de `setTimeout`, jamais synchrones dans le
  // corps de l'effet.
  useEffect(() => {
    if (!confirmationTab) return;
    const timer = setTimeout(() => {
      setConfirmationTab(null);
      if (confirmationTab === "COLLABORATION") {
        setCollabAnswers(initialAnswersFor(COLLABORATION_QUESTIONS));
        setRecipientId("");
        setTab("CONDITIONS_TRAVAIL");
      } else {
        setCtAnswers(initialAnswersFor(CT_QUESTIONS_FLAT));
        setCtStep(0);
        router.refresh();
      }
    }, 2200);
    return () => clearTimeout(timer);
  }, [confirmationTab, router]);

  if (confirmationTab) {
    return (
      <ConfirmationPanel
        nextTabLabel={confirmationTab === "COLLABORATION" ? "Conditions de travail" : null}
      />
    );
  }

  return (
    <form action={formAction} className="space-y-6">
      {/* Honeypot — jamais rempli par un humain, masqué visuellement et
          hors du flux de tabulation. */}
      <div className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor="site_web">Laissez ce champ vide</label>
        <input type="text" id="site_web" name="site_web" tabIndex={-1} autoComplete="off" />
      </div>

      <input type="hidden" name="type" value={tab} />
      <input type="hidden" name="ratingsJson" value={ratingsJson} />
      {tab === "COLLABORATION" ? <input type="hidden" name="recipientId" value={recipientId} /> : null}

      {/* Onglets — segmented control */}
      <div className="grid grid-cols-1 gap-1 rounded-xl border border-border bg-muted/40 p-1 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setTab("COLLABORATION")}
          className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all duration-200 ease-out-strong ${
            tab === "COLLABORATION"
              ? "bg-surface text-primary shadow-elevated"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Icon name="star" className="size-4" fill={tab === "COLLABORATION" ? "currentColor" : "none"} />
          Collaboration entre collègues
        </button>
        <button
          type="button"
          onClick={() => setTab("CONDITIONS_TRAVAIL")}
          className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all duration-200 ease-out-strong ${
            tab === "CONDITIONS_TRAVAIL"
              ? "bg-surface text-primary shadow-elevated"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Icon name="trending-up" className="size-4" />
          Conditions de travail
        </button>
      </div>

      <div key={tab} className="animate-step-in space-y-5">
        {tab === "COLLABORATION" ? (
          <>
            <Select
              label="Destinataire"
              placeholder="Choisir un employé..."
              required
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              options={recipients.map((r) => ({ value: r.id, label: r.fullName }))}
              error={state.status === "error" ? state.fieldErrors?.recipientId : undefined}
            />

            {COLLABORATION_QUESTIONS.map((question) => (
              <QuestionCard key={question.key}>
                <p className="mb-3 text-sm font-semibold text-foreground">{question.label}</p>
                <QuestionInput
                  question={question}
                  value={collabAnswers[question.key]}
                  onChange={(value) => setCollabAnswers((prev) => ({ ...prev, [question.key]: value }))}
                />
              </QuestionCard>
            ))}

            <Button type="submit" loading={isPending} disabled={!canSubmit} className="w-full">
              Envoyer mon avis
            </Button>
          </>
        ) : (
          <>
            <Stepper steps={CONDITIONS_TRAVAIL_STEPS} currentStep={ctStep} />

            <div key={ctStep} className="animate-step-in space-y-4">
              {currentCtStep.questions.map((question) => (
                <QuestionCard key={question.key}>
                  <p className="mb-3 text-sm font-semibold text-foreground">{question.label}</p>
                  <QuestionInput
                    question={question}
                    value={ctAnswers[question.key]}
                    onChange={(value) => setCtAnswers((prev) => ({ ...prev, [question.key]: value }))}
                  />
                </QuestionCard>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <Button
                type="button"
                variant="secondary"
                disabled={ctStep === 0}
                onClick={() => setCtStep((s) => Math.max(0, s - 1))}
              >
                <Icon name="arrow-left" className="size-4" />
                Précédent
              </Button>
              {!isLastCtStep ? (
                <Button
                  type="button"
                  disabled={!currentCtStepComplete}
                  onClick={() => setCtStep((s) => Math.min(CONDITIONS_TRAVAIL_STEPS.length - 1, s + 1))}
                >
                  Suivant
                  <Icon name="arrow-right" className="size-4" />
                </Button>
              ) : (
                <Button type="submit" loading={isPending} disabled={!canSubmit}>
                  Envoyer mon avis
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </form>
  );
}
