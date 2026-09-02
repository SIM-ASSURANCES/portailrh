import { PageHeader } from "@/components/ui";
import { ReportingFiltersForm } from "./ReportingFiltersForm";
import { ReportingSummaryTable, ReportingDetailsTable } from "./ReportingTables";
import {
  pointageReportingSchema,
  getServicesUniques,
  getCollaborateursFiltres,
  getReportingAgrégé,
  getDetailsRetards,
} from "@/lib/pointageReporting";
import { getSession, hasPermission } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function ReportingRHPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!hasPermission(session, "pointage.voir_reporting")) {
    redirect("/?error=acces_refuse");
  }

  const params = await searchParams;
  
  // Extraire les paramètres de manière propre
  const extractString = (val: string | string[] | undefined) => 
    Array.isArray(val) ? val[0] : val;

  const filters = pointageReportingSchema.parse({
    dateDebut: extractString(params.dateDebut),
    dateFin: extractString(params.dateFin),
    userId: extractString(params.userId),
    service: extractString(params.service),
  });

  const queryParams = new URLSearchParams();
  if (filters.dateDebut) queryParams.set("dateDebut", filters.dateDebut);
  if (filters.dateFin) queryParams.set("dateFin", filters.dateFin);
  if (filters.userId) queryParams.set("userId", filters.userId);
  if (filters.service) queryParams.set("service", filters.service);
  
  const exportUrl = `/api/pointage/rh/reporting/export?${queryParams.toString()}`;

  const [services, collaborateurs, agrege, details] = await Promise.all([
    getServicesUniques(),
    getCollaborateursFiltres(),
    getReportingAgrégé(filters),
    getDetailsRetards(filters),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reporting & Export"
        description="Générez des rapports détaillés sur les présences, retards et heures effectives."
        backHref="/pointage/rh"
        backLabel="Retour à la Boîte à Outils"
        actions={
          <a
            href={exportUrl}
            className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-[background-color,color,transform] duration-150 ease-out-strong focus-visible:outline-2 focus-visible:outline-offset-2 motion-safe:active:scale-[0.97] bg-secondary text-secondary-foreground hover:bg-secondary-hover focus-visible:outline-primary border border-border"
          >
            Exporter en Excel
          </a>
        }
      />

      <ReportingFiltersForm collaborateurs={collaborateurs} services={services} />

      <div className="space-y-8">
        <section>
          <h2 className="text-xl font-bold mb-4">Résumé par collaborateur</h2>
          <ReportingSummaryTable data={agrege} />
        </section>

        <section>
          <h2 className="text-xl font-bold mb-4">Détail des retards</h2>
          <ReportingDetailsTable data={details} />
        </section>
      </div>
    </div>
  );
}
