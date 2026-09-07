import { PageHeader } from "@/components/ui";
import { ReportingFiltersForm } from "./ReportingFiltersForm";
import { ReportingSummaryTable, ReportingDetailsTable } from "./ReportingTables";
import {
  pointageReportingSchema,
  getServicesUniques,
  getCollaborateursFiltres,
  getReportingAgrégé,
  getDetailsRetards,
  getReportingPeriodConstraints
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

  const periodCheck = getReportingPeriodConstraints(filters.dateDebut, filters.dateFin);
  if (periodCheck.error) {
    // Si la période dépasse 6 mois, on limite et on redirige avec un message d'erreur ? 
    // Ou bien on affiche l'erreur sur la page
  }

  const currentPage = Number(extractString(params.page)) || 1;
  const pageSize = 50;
  const skip = (currentPage - 1) * pageSize;

  const queryParams = new URLSearchParams();
  if (filters.dateDebut) queryParams.set("dateDebut", filters.dateDebut);
  if (filters.dateFin) queryParams.set("dateFin", filters.dateFin);
  if (filters.userId) queryParams.set("userId", filters.userId);
  if (filters.service) queryParams.set("service", filters.service);
  
  const exportUrl = `/api/pointage/rh/reporting/export?${queryParams.toString()}`;

  const [services, collaborateurs, agrege, details] = await Promise.all([
    getServicesUniques(),
    getCollaborateursFiltres(),
    !periodCheck.error ? getReportingAgrégé(filters) : Promise.resolve([]),
    !periodCheck.error ? getDetailsRetards(filters, skip, pageSize) : Promise.resolve({ data: [], total: 0 }),
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

      {periodCheck.error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-md border border-red-200">
          {periodCheck.error}
        </div>
      )}

      {!periodCheck.error && (
        <div className="space-y-8">
          <section>
            <h2 className="text-xl font-bold mb-4">Résumé par collaborateur</h2>
            <ReportingSummaryTable data={agrege} />
          </section>

          <section>
            <div className="flex justify-between items-end mb-4">
              <h2 className="text-xl font-bold">Détail des retards</h2>
              <div className="text-sm text-muted-foreground">
                Total : {details.total}
              </div>
            </div>
            <ReportingDetailsTable data={details.data} />
            
            {details.total > pageSize && (
              <div className="flex items-center justify-between py-4">
                <a 
                  href={`?${new URLSearchParams({ ...Object.fromEntries(queryParams), page: String(Math.max(1, currentPage - 1)) }).toString()}`}
                  className={`px-4 py-2 border rounded-md ${currentPage <= 1 ? "opacity-50 pointer-events-none" : ""}`}
                >
                  Précédent
                </a>
                <span>Page {currentPage} / {Math.ceil(details.total / pageSize)}</span>
                <a 
                  href={`?${new URLSearchParams({ ...Object.fromEntries(queryParams), page: String(currentPage + 1) }).toString()}`}
                  className={`px-4 py-2 border rounded-md ${currentPage * pageSize >= details.total ? "opacity-50 pointer-events-none" : ""}`}
                >
                  Suivant
                </a>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
