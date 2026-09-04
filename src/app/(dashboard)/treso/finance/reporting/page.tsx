import { redirect } from "next/navigation";

import { Button, PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getBeneficiairesConnus,
  getReportingFondsRemis,
  getReportingRows,
  getReportingSuiviBudgetaire,
  parseReportingFilters,
  reportingFiltersToQueryString,
} from "@/lib/reporting";

import { ReportingFiltersForm } from "./ReportingFiltersForm";

function rawString(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/**
 * Écran de reporting Trésorerie (Ticket 10, adapté au nouveau modèle de
 * validation partielle/bénéficiaire à la Phase H). Protégé par
 * `treso.voir_reporting`, revérifié ici même si le layout Finance partagé
 * accepte déjà cette permission parmi les six possibles.
 *
 * Filtres en GET (search params), partageables/rechargeables tels quels —
 * `parseReportingFilters`/`getReportingRows` (src/lib/reporting.ts) sont
 * exactement les mêmes fonctions que celles utilisées par l'export Excel
 * (Tâche 3) : le tableau affiché ici et les feuilles du classeur téléchargé
 * désignent toujours le même jeu de données pour un même jeu de filtres.
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
  const [rows, fondsRemisRows, suiviBudgetaireRows, categories, objets, users, servicesRaw, beneficiaires] =
    await Promise.all([
      getReportingRows(filters),
      getReportingFondsRemis(filters),
      getReportingSuiviBudgetaire(),
      prisma.categorie.findMany({ where: { isActive: true }, orderBy: { label: "asc" } }),
      prisma.objet.findMany({ where: { isActive: true }, orderBy: { label: "asc" } }),
      prisma.user.findMany({ orderBy: { fullName: "asc" } }),
      prisma.user.findMany({ where: { service: { not: null } }, distinct: ["service"], select: { service: true } }),
      getBeneficiairesConnus(),
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
  // "Restant à valider" et "Validé restant à régler" du total général
  // recalculés à partir des totaux agrégés (jamais négatifs) — cohérent
  // avec le calcul par ligne, jamais une simple somme des colonnes déjà
  // arrondies au max(0, ...) de chaque ligne (Phase H : deux notions
  // distinctes, voir `ReportingRow` dans reporting.ts).
  const totalRestantAValider = Math.max(0, total.montantDemande - total.montantValide);
  const totalValideResteARegler = Math.max(0, total.montantValide - total.montantRegle);

  const queryString = reportingFiltersToQueryString(filters);
  const exportHref = `/api/treso/reporting/export${queryString ? `?${queryString}` : ""}`;

  const beneficiaireValue = filters.beneficiaireUserId
    ? `u:${filters.beneficiaireUserId}`
    : filters.beneficiaireNom
      ? `n:${encodeURIComponent(filters.beneficiaireNom)}`
      : undefined;

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
        beneficiaires={beneficiaires}
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
          beneficiaire: beneficiaireValue,
        }}
      />

      <div className="space-y-4 rounded-lg border border-border bg-surface p-4 shadow-elevated sm:p-6">
        <h2 className="text-sm font-semibold text-foreground">Demandes par catégorie / objet</h2>
        {/* Tableau analytique (colonnes numériques + ligne de total) : reste un
            tableau classique même sur mobile plutôt qu'un mode carte (peu
            adapté à une lecture en grille avec total) — défilement horizontal
            avec indice explicite, voir CLAUDE.md (stratégie DataTable). */}
        <p className="text-xs text-muted-foreground md:hidden">Faites glisser pour voir plus de colonnes →</p>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-medium text-muted-foreground">Catégorie</th>
                <th scope="col" className="px-4 py-2 text-left font-medium text-muted-foreground">Objet</th>
                <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Nb. demandes</th>
                <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Demandé</th>
                <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Validé</th>
                <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Restant à valider</th>
                <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Réglé</th>
                <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Validé restant à régler</th>
                <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Réglé Caisse</th>
                <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Réglé Banque</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-surface">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-6 text-center text-muted-foreground">
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
                      {r.montantRestantAValider.toLocaleString("fr-FR")} FCFA
                    </td>
                    <td className="px-4 py-2 text-right text-foreground">
                      {r.montantRegle.toLocaleString("fr-FR")} FCFA
                    </td>
                    <td className="px-4 py-2 text-right text-foreground">
                      {r.valideResteARegler.toLocaleString("fr-FR")} FCFA
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
                    {totalRestantAValider.toLocaleString("fr-FR")} FCFA
                  </td>
                  <td className="px-4 py-2 text-right text-foreground">
                    {total.montantRegle.toLocaleString("fr-FR")} FCFA
                  </td>
                  <td className="px-4 py-2 text-right text-foreground">
                    {totalValideResteARegler.toLocaleString("fr-FR")} FCFA
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

      <div className="space-y-4 rounded-lg border border-border bg-surface p-4 shadow-elevated sm:p-6">
        <h2 className="text-sm font-semibold text-foreground">Fonds remis</h2>
        {/* Section 15 du cahier des charges : distinct du tableau général
            ci-dessus — restreint aux demandes ayant au moins un règlement
            Caisse confirmé (voir `getReportingFondsRemis`, reporting.ts). */}
        {fondsRemisRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun règlement Caisse confirmé pour ces filtres.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground md:hidden">Faites glisser pour voir plus de colonnes →</p>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-muted-foreground">Catégorie</th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-muted-foreground">Objet</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Nb. opérations</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Demandé</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Validé</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Remis</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Dépenses déclarées</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Retours reçus</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Restant à régulariser</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-surface">
                  {fondsRemisRows.map((f) => (
                    <tr key={`${f.categorieId ?? "none"}|${f.objetId ?? "none"}`} className="hover:bg-muted/50">
                      <td className="px-4 py-2 text-foreground">{f.categorieLabel}</td>
                      <td className="px-4 py-2 text-foreground">{f.objetLabel}</td>
                      <td className="px-4 py-2 text-right text-foreground">{f.nombreOperations}</td>
                      <td className="px-4 py-2 text-right text-foreground">
                        {f.montantDemande.toLocaleString("fr-FR")} FCFA
                      </td>
                      <td className="px-4 py-2 text-right text-foreground">
                        {f.montantValide.toLocaleString("fr-FR")} FCFA
                      </td>
                      <td className="px-4 py-2 text-right text-foreground">
                        {f.montantRemis.toLocaleString("fr-FR")} FCFA
                      </td>
                      <td className="px-4 py-2 text-right text-foreground">
                        {f.depensesDeclarees.toLocaleString("fr-FR")} FCFA
                      </td>
                      <td className="px-4 py-2 text-right text-foreground">
                        {f.retoursRecus.toLocaleString("fr-FR")} FCFA
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-semibold ${
                          f.montantRestantARegulariser !== 0 ? "text-warning" : "text-success"
                        }`}
                      >
                        {f.montantRestantARegulariser.toLocaleString("fr-FR")} FCFA
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="space-y-4 rounded-lg border border-border bg-surface p-4 shadow-elevated sm:p-6">
        <h2 className="text-sm font-semibold text-foreground">Suivi budgétaire</h2>
        {/* Budget PARTAGÉ par Catégorie (pas par demande, pas par service du
            demandeur), décompté au RÈGLEMENT — voir CLAUDE.md "Budget
            partagé par Catégorie". Volontairement non filtré par période :
            c'est une enveloppe cumulative depuis toujours, pas une donnée
            découpable dans le temps (voir getReportingSuiviBudgetaire). */}
        {suiviBudgetaireRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune catégorie n&apos;a de budget alloué défini pour l&apos;instant — aucune limite
            n&apos;est donc appliquée. Un budget se définit par catégorie depuis{" "}
            <a href="/admin/categories" className="text-info underline-offset-4 hover:underline">
              la console d&apos;administration
            </a>
            .
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground md:hidden">Faites glisser pour voir plus de colonnes →</p>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-muted-foreground">Catégorie</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Budget alloué</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Consommé (réglé)</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Restant</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-surface">
                  {suiviBudgetaireRows.map((r) => {
                    const depassement = r.budgetRestant < 0;
                    return (
                      <tr key={r.categorieId} className="hover:bg-muted/50">
                        <td className="px-4 py-2 text-foreground">{r.categorieLabel}</td>
                        <td className="px-4 py-2 text-right text-foreground">
                          {r.budgetAlloue.toLocaleString("fr-FR")} FCFA
                        </td>
                        <td className="px-4 py-2 text-right text-foreground">
                          {r.montantConsomme.toLocaleString("fr-FR")} FCFA
                        </td>
                        <td
                          className={`px-4 py-2 text-right font-semibold ${depassement ? "text-danger" : "text-success"}`}
                        >
                          {depassement ? "Dépassement de " : ""}
                          {Math.abs(r.budgetRestant).toLocaleString("fr-FR")} FCFA
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
