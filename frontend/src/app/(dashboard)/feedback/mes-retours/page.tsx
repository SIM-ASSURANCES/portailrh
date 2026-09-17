import { redirect } from "next/navigation";
import Link from "next/link";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icons";
import { getSession } from "@/lib/auth";
import { getUserFeedbacks, type FeedbackPeriodFilter } from "backend";

export const metadata = {
  title: "Mes critiques reçues | SIM Assurances",
  description: "Consultez les retours constructifs anonymes que vous avez reçus.",
};

const PERIOD_LABELS: Record<FeedbackPeriodFilter, string> = {
  tout: "Tous les retours",
  mois: "Ce mois-ci",
  semaine: "Cette semaine",
};

export default async function MesFeedbacksPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  if (!session.peutRecevoirFeedback) {
    redirect("/?error=acces_refuse_recevoir_feedback");
  }

  const { periode } = await searchParams;
  const currentPeriod: FeedbackPeriodFilter =
    periode === "semaine" || periode === "mois" ? periode : "tout";

  const feedbacks = await getUserFeedbacks(session.user.id, currentPeriod);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Mes critiques reçues"
        description="Retours constructifs et avis anonymes que vos pairs ou des intervenants ont formulés à votre attention."
        actions={
          <Link
            href="/feedback/nouveau"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-primary/90"
          >
            <Icon name="message-square" className="h-4 w-4" />
            Laisser un feedback
          </Link>
        }
      />

      {/* Barre d'onglets / filtres par période */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-4">
        <span className="mr-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Période :
        </span>
        {(["tout", "mois", "semaine"] as FeedbackPeriodFilter[]).map((p) => {
          const isActive = currentPeriod === p;
          return (
            <Link
              key={p}
              href={p === "tout" ? "/feedback/mes-retours" : `/feedback/mes-retours?periode=${p}`}
              className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-surface text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {PERIOD_LABELS[p]}
            </Link>
          );
        })}
      </div>

      {/* RÈGLE ABSOLUE CDC : Lecture seule, texte + date uniquement, aucune donnée d'auteur */}
      {feedbacks.length === 0 ? (
        <EmptyState
          icon="inbox"
          message={
            currentPeriod === "tout"
              ? "Vous n'avez pas encore reçu de critique ou de retour d'expérience."
              : `Aucun retour reçu pour la période sélectionnée (${PERIOD_LABELS[currentPeriod].toLowerCase()}).`
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {feedbacks.map((f) => (
            <Card key={f.id} className="p-5 transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between gap-4 border-b border-border pb-3">
                <div className="flex items-center gap-2">
                  <Badge variant={f.source === "PUBLIC" ? "info" : "neutral"}>
                    {f.source === "PUBLIC" ? "Avis Public" : "Avis Interne"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Reçu le{" "}
                    {new Date(f.submittedAt).toLocaleDateString("fr-FR", {
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                </div>
              </div>
              <div className="mt-3">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {f.content}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
