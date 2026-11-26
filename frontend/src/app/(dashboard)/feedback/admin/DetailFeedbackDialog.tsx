"use client";

import { Button } from "@/components/ui";
import type { AdminFeedbackEntry } from "backend";

/** Lecture complète d'un avis : texte entier et réponses question par question (même style que la fenêtre de modération). */
export function DetailFeedbackDialog({ feedback, onClose }: { feedback: AdminFeedbackEntry; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titre-detail-feedback"
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-border bg-surface p-6 text-left shadow-xl"
      >
        <h3 id="titre-detail-feedback" className="text-lg font-semibold text-foreground">
          Détail de l&apos;avis
        </h3>

        <div className="mt-4 min-h-0 space-y-4 overflow-y-auto">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Date</dt>
            <dd className="text-foreground">
              {new Date(feedback.submittedAt).toLocaleDateString("fr-FR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                timeZone: "UTC",
              })}
            </dd>
            <dt className="text-muted-foreground">Type</dt>
            <dd className="text-foreground">
              {feedback.type === "COLLABORATION" ? "Collaboration" : "Conditions de travail"}
            </dd>
            {feedback.destinataire ? (
              <>
                <dt className="text-muted-foreground">Destinataire</dt>
                <dd className="text-foreground">{feedback.destinataire}</dd>
              </>
            ) : null}
          </dl>

          <p data-texte-complet className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {feedback.content}
          </p>

          {feedback.isModerated && feedback.motifModeration ? (
            <p className="text-xs text-destructive">
              <span className="font-semibold">Motif de modération :</span> {feedback.motifModeration}
            </p>
          ) : null}

          {feedback.notes.length > 0 ? (
            <ul className="divide-y divide-border border-t border-border">
              {feedback.notes.map((note) => (
                <li key={note.question} data-note className="flex items-start justify-between gap-4 py-2 text-sm">
                  <span className="text-muted-foreground">{note.question}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-foreground">{note.reponse}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex justify-end pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </div>
  );
}
