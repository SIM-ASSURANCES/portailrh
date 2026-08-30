import { redirect } from "next/navigation";

import { Button, PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getReportingRows,
  parseReportingFilters,
  reportingFiltersToQueryString,
  type ReportingRow,
} from "@/lib/reporting";

import { ReportingFiltersForm } from "./ReportingFiltersForm";

function rawString(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/**
 * Écran de reporting Trésorerie (Ticket 10) — dernier écran du backlog
 * initial du module. Protégé par `treso.voir_reporting`, revérifié ici même
 * si le layout Finance partagé accepte déjà cette permission parmi les
 * cinq possibles.
 *
 * Filtres en GET (search params), partageables/rechargeables tels quels —
 * `parseReportingFilters`/`getReportingRows` (src/lib/reporting.ts) sont
 * exactement les mêmes fonctions que celles utilisées par l'export Excel
 * (Tâche 3) : le tableau affiché ici et les feuilles "Reporting"/"Suivi
 * budgétaire" du classeur téléchargé désignent toujours le même jeu de
 * données pour un même jeu de filtres.
 */
export default async function ReportingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.voir_reporting")) {
    redirect("/?error=acces_refuse_reporting");
  }

  const rawParams = await searchParams;
  const filters = parseReportingFilters(rawParams);

  // Ticket A.1 : les filtres ne listent que les catégories/objets actifs
  // (soft-delete) — les demandes historiques liées à une catégorie
  // désactivée depuis continuent d'apparaître normalement dans les
  // résultats, ce filtre ne porte que sur les OPTIONS du formulaire.
  const [rows, categories, objets, users, servicesRaw] = await Promise.all([
    getReportingRows(filters),
    prisma.categorie.findMany({ where: { isActive: true }, orderBy: { label: "asc" } }),
    prisma.objet.findMany({ where: { isActive: true }, orderBy: { label: "asc" } }),
    prisma.user.findMany({ orderBy: { fullName: "asc" } }),
    prisma.user.findMany({ where: { service: { not: null } }, distinct: ["service"], select: { service: true } }),
  ]);

  const services = servicesRaw.map((u) => u.service).filter((s): s is string => !!s).sort();

  const total = rows.reduce(
    (acc, r) => ({
      nombreDemandes: acc.nombreDemandes + r.nombreDemandes,
      montantDemande: acc.montantDemande + r.montantDemande,
      montantValide: acc.montantValide + r.montantValide,
      montantRegle: acc.montantRegle + r.montantRegle,
      montantRegleCaisse: acc.montantRegleCaisse + r.montantRegleCaisse,
      montantRegleBanque: acc.montantRegleBanque + r.montantRegleBanque,
    }),
    { nombreDemandes: 0, montantDemande: 0, montantValide: 0, montantRegle: 0, montantRegleCaisse: 0, montantRegleBanque: 0 }
  );
  // "Reste à régler" du total général recalculé à partir des totaux
  // agrégés (jamais négatif) — cohérent avec le calcul par ligne.
  const totalResteARegler = Math.max(0, total.montantValide - total.montantRegle);

  const rowsAvecBudget = rows.filter((r): r is ReportingRow & { budgetAlloue: number } => r.budgetAlloue != null);

  const queryString = reportingFiltersToQueryString(filters);
  const exportHref = `/api/treso/reporting/export${queryString ? `?${queryString}` : ""}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Reporting"
        description="Analyse des demandes de trésorerie par catégorie et objet."
        actions={
          <a href={exportHref}>
            <Button type="button">Exporter en Excel</Button>
          </a>
        }
      />

      <ReportingFiltersForm
        categories={categories.map((c) => ({ id: c.id, label: c.label }))}
        objets={objets.map((o) => ({ id: o.id, label: o.label, categorieId: o.categorieId }))}
        users={users.map((u) => ({ id: u.id, label: u.fullName }))}
        services={services}
        initial={{
          du: rawString(rawParams.du),
          au: rawString(rawParams.au),
          demandeurId: filters.demandeurId,
          service: filters.service,
          categorieId: filters.categorieId,
          objetId: filters.objetId,
          mode: filters.mode,
          statut: filters.statut,
          typeDemande: filters.typeDemande,
        }}
      />

      <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
        <h2 className="text-sm font-semibold text-foreground">Demandes par catégorie / objet</h2>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-medium text-muted-foreground">Catégorie</th>
                <th scope="col" className="px-4 py-2 text-left font-medium text-muted-foreground">Objet</th>
                <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Nb. demandes</th>
                <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Demandé</th>
                <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Validé</th>
                <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Réglé</th>
                <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Reste à régler</th>
                <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Réglé Caisse</th>
                <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Réglé Banque</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-surface">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">
                    Aucune demande ne correspond à ces filtres.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={`${r.categorieId ?? "none"}|${r.objetId ?? "none"}`} className="hover:bg-muted/50">
                    <td className="px-4 py-2 text-foreground">{r.categorieLabel}</td>
                    <td className="px-4 py-2 text-foreground">{r.objetLabel}</td>
                    <td className="px-4 py-2 text-right text-foreground">{r.nombreDemandes}</td>
                    <td className="px-4 py-2 text-right text-foreground">
                      {r.montantDemande.toLocaleString("fr-FR")} FCFA
                    </td>
                    <td className="px-4 py-2 text-right text-foreground">
                      {r.montantValide.toLocaleString("fr-FR")} FCFA
                    </td>
                    <td className="px-4 py-2 text-right text-foreground">
                      {r.montantRegle.toLocaleString("fr-FR")} FCFA
                    </td>
                    <td className="px-4 py-2 text-right text-foreground">
                      {r.resteARegler.toLocaleString("fr-FR")} FCFA
                    </td>
                    <td className="px-4 py-2 text-right text-foreground">
                      {r.montantRegleCaisse.toLocaleString("fr-FR")} FCFA
                    </td>
                    <td className="px-4 py-2 text-right text-foreground">
                      {r.montantRegleBanque.toLocaleString("fr-FR")} FCFA
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 ? (
              <tfoot className="bg-muted font-semibold">
                <tr>
                  <td className="px-4 py-2 text-foreground" colSpan={2}>Total général</td>
                  <td className="px-4 py-2 text-right text-foreground">{total.nombreDemandes}</td>
                  <td className="px-4 py-2 text-right text-foreground">
                    {total.montantDemande.toLocaleString("fr-FR")} FCFA
                  </td>
                  <td className="px-4 py-2 text-right text-foreground">
                    {total.montantValide.toLocaleString("fr-FR")} FCFA
                  </td>
                  <td className="px-4 py-2 text-right text-foreground">
                    {total.montantRegle.toLocaleString("fr-FR")} FCFA
                  </td>
                  <td className="px-4 py-2 text-right text-foreground">
                    {totalResteARegler.toLocaleString("fr-FR")} FCFA
                  </td>
                  <td className="px-4 py-2 text-right text-foreground">
                    {total.montantRegleCaisse.toLocaleString("fr-FR")} FCFA
                  </td>
                  <td className="px-4 py-2 text-right text-foreground">
                    {total.montantRegleBanque.toLocaleString("fr-FR")} FCFA
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
        <h2 className="text-sm font-semibold text-foreground">Suivi budgétaire</h2>
        {rowsAvecBudget.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune demande de ces filtres n&apos;a de budget disponible renseigné.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left font-medium text-muted-foreground">Catégorie</th>
                  <th scope="col" className="px-4 py-2 text-left font-medium text-muted-foreground">Objet</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Budget alloué</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Montant réglé</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Écart</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-surface">
                {rowsAvecBudget.map((r) => {
                  const ecart = r.budgetAlloue - r.montantRegle;
                  const depassement = ecart < 0;
                  return (
                    <tr key={`${r.categorieId ?? "none"}|${r.objetId ?? "none"}`} className="hover:bg-muted/50">
                      <td className="px-4 py-2 text-foreground">{r.categorieLabel}</td>
                      <td className="px-4 py-2 text-foreground">{r.objetLabel}</td>
                      <td className="px-4 py-2 text-right text-foreground">
                        {r.budgetAlloue.toLocaleString("fr-FR")} FCFA
                      </td>
                      <td className="px-4 py-2 text-right text-foreground">
                        {r.montantRegle.toLocaleString("fr-FR")} FCFA
                      </td>
                      <td className={`px-4 py-2 text-right font-semibold ${depassement ? "text-danger" : "text-success"}`}>
                        {depassement ? "Dépassement de " : ""}
                        {Math.abs(ecart).toLocaleString("fr-FR")} FCFA
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
