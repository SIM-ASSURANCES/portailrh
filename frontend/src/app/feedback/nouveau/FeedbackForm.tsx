"use client";

import { useActionState, useState } from "react";

import { Button, Select, Textarea } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { FEEDBACK_CONTENT_MAX, FEEDBACK_CONTENT_MIN, IDLE_ACTION_STATE } from "backend/client";

import { soumettreFeedbackAction } from "./actions";

/**
 * Formulaire de soumission — Client Component UNIQUEMENT pour
 * l'interactivité du formulaire (compteur de caractères, état de
 * soumission) : ne lit ni ne transmet AUCUNE information sur son visiteur.
 * Le champ `site_web` est le honeypot anti-bot (voir
 * `actions.ts`/CLAUDE.md "FeedbackApp") : masqué visuellement et retiré de
 * l'ordre de tabulation, jamais `display:none`/`type="hidden"` seuls (trop
 * facilement ignorés par certains bots qui inspectent le CSS calculé,
 * cette combinaison reste une protection basique V1 par construction).
 */
export function FeedbackForm({ recipients }: { recipients: { id: string; fullName: string }[] }) {
  const [state, formAction, isPending] = useActionState(soumettreFeedbackAction, IDLE_ACTION_STATE);
  useActionFeedback(state);
  const [content, setContent] = useState("");

  if (state.status === "success") {
    return (
      <div className="animate-fade-in-up flex flex-col items-center gap-3 rounded-lg border border-success-border bg-success-bg px-4 py-8 text-center">
        <Icon name="check-circle" className="size-8 text-success" />
        <p className="text-sm font-medium text-success">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {/* Honeypot — jamais rempli par un humain, masqué visuellement et
          hors du flux de tabulation. Un bot qui le remplit est rejeté
          silencieusement côté serveur (voir actions.ts). */}
      <div className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor="site_web">Laissez ce champ vide</label>
        <input type="text" id="site_web" name="site_web" tabIndex={-1} autoComplete="off" />
      </div>

      <Select
        name="recipientId"
        label="Destinataire"
        placeholder="Choisir un employé..."
        required
        options={recipients.map((r) => ({ value: r.id, label: r.fullName }))}
        error={state.status === "error" ? state.fieldErrors?.recipientId : undefined}
      />

      <div>
        <Textarea
          name="content"
          label="Votre message"
          required
          rows={5}
          hint="Entre 20 et 500 caractères, sans lien ni URL."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          error={state.status === "error" ? state.fieldErrors?.content : undefined}
        />
        <p className="mt-1 text-right text-xs text-muted-foreground">
          {content.length} / {FEEDBACK_CONTENT_MAX}
          {content.length > 0 && content.length < FEEDBACK_CONTENT_MIN
            ? ` (minimum ${FEEDBACK_CONTENT_MIN})`
            : ""}
        </p>
      </div>

      <Button type="submit" loading={isPending} className="w-full">
        Envoyer anonymement
      </Button>
    </form>
  );
}
