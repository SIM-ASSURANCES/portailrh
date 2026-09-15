import Link from "next/link";

import { Button, Card } from "@/components/ui";
import { getPublicFeedbacks } from "backend";

/**
 * Liste PUBLIQUE des messages FeedbackApp (`source: PUBLIC`, non modérés) —
 * accessible sans compte, sans session (voir `auth.config.ts`,
 * `isFeedbackPublicRoute`, et CLAUDE.md "FeedbackApp : anonymat total").
 *
 * Le DESTINATAIRE n'est jamais affiché ici (décision documentée dans
 * CLAUDE.md — à confirmer explicitement au regard du cahier des charges) :
 * seuls le contenu et la date, arrondie au jour, sont montrés.
 */
export default async function FeedbackPubliquePage() {
  const feedbacks = await getPublicFeedbacks();

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-foreground">Messages constructifs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Messages publics anonymes, affichés sans nom d&apos;auteur ni de destinataire.
          </p>
        </div>
        <Link href="/feedback/nouveau">
          <Button variant="primary">Laisser un message</Button>
        </Link>
      </div>

      {feedbacks.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun message pour le moment.</p>
      ) : (
        <ul className="space-y-3">
          {feedbacks.map((feedback) => (
            <li key={feedback.id}>
              <Card className="space-y-2 p-4">
                <p className="whitespace-pre-wrap text-sm text-foreground">{feedback.content}</p>
                <p className="text-xs text-muted-foreground">
                  {feedback.submittedAt.toLocaleDateString("fr-FR", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
