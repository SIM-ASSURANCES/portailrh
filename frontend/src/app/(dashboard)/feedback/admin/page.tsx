import { redirect } from "next/navigation";
import { PageHeader, StatCard, Button } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { getAdminFeedbacks, getFeedbackStats, type AdminFeedbackFilters } from "backend";
import { AdminFeedbackTable } from "./AdminFeedbackTable";
import { FeedbackFilters } from "./FeedbackFilters";

export const metadata = {
  title: "Modération FeedbackApp | SIM Assurances",
  description: "Modération RH et Direction des messages de la plateforme FeedbackApp.",
};

export default async function FeedbackAdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    du?: string;
    au?: string;
    statut?: string;
    source?: string;
    search?: string;
  }>;
}) {
  const session = await getSession();
  if (!session || !hasPermission(session, "feedback.moderer")) {
    redirect("/?error=acces_refuse_moderation");
  }

  const params = await searchParams;
  const filters: AdminFeedbackFilters = {
    du: params.du || undefined,
    au: params.au || undefined,
    statut: (params.statut as AdminFeedbackFilters["statut"]) || undefined,
    source: (params.source as AdminFeedbackFilters["source"]) || undefined,
    search: params.search || undefined,
  };

  const [feedbacks, stats] = await Promise.all([
    getAdminFeedbacks(filters),
    getFeedbackStats(),
  ]);

  // Construit l'URL d'export CSV avec les mêmes filtres
  const exportQuery = new URLSearchParams();
  if (filters.du) exportQuery.set("du", filters.du);
  if (filters.au) exportQuery.set("au", filters.au);
  if (filters.statut) exportQuery.set("statut", filters.statut);
  if (filters.source) exportQuery.set("source", filters.source);
  if (filters.search) exportQuery.set("search", filters.search);

  const exportHref = `/api/feedback/export${exportQuery.toString() ? `?${exportQuery.toString()}` : ""}`;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Modération des Feedbacks"
        description="Espace dédié RH & Direction pour superviser les avis, modérer les contenus inappropriés et analyser les tendances globales."
        actions={
          <a href={exportHref}>
            <Button type="button" variant="secondary">
              Exporter en CSV
            </Button>
          </a>
        }
      />

      {/* Cartes statistiques globales anonymisées */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total des messages"
          value={stats.total}
          hint={`${stats.nbPublic} publics / ${stats.nbInterne} internes`}
          icon="message-square"
        />
        <StatCard
          label="Reçus ce mois-ci"
          value={stats.ceMois}
          hint="Activité mensuelle en cours"
          icon="calendar"
        />
        <StatCard
          label="Messages modérés"
          value={stats.moderes}
          hint={`${stats.actifs} messages actuellement actifs`}
          icon="alert-triangle"
          tone={stats.moderes > 0 ? "warning" : "neutral"}
        />
        <StatCard
          label="Taux de modération"
          value={`${stats.tauxModeration}%`}
          hint="Cible CDC < 5%"
          icon="shield-check"
          tone={stats.tauxModeration > 5 ? "danger" : "success"}
        />
      </div>

      {/* Filtres de recherche */}
      <FeedbackFilters initial={params} />

      {/* Tableau des messages */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            Messages ({feedbacks.length})
          </h2>
          <span className="text-xs text-muted-foreground">
            Conformément au CDC, les destinataires sont pseudonymisés.
          </span>
        </div>
        <AdminFeedbackTable feedbacks={feedbacks} />
      </div>
    </div>
  );
}
