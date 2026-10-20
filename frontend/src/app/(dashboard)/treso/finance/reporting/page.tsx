import { redirect } from "next/navigation";

import { Button, PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { peutTelechargerJustificatifsRetourExterne } from "@/lib/droitsPiecesJointes";
import { libelleSeuil, prisma } from "backend";

import { BadgeNiveauBudget } from "@/components/tresorerie/BudgetPrevision";
import {
  getBeneficiairesConnus,
  COLONNES_ARBRE,
  getReportingArbre,
  totauxParDevise,
  getReportingRows,
  getReportingSuiviBudgetaire,
  parseReportingFilters,
  reportingFiltersToQueryString,
} from "backend";

import { STATUT_DEMANDE_LABEL } from "@/components/tresorerie/demandeStatut";

import { ReportingArbreTable } from "./ReportingArbreTable";
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

  // Ticket A.1, modifié au lot J bis : les catégories/objets désactivés (soft-delete) restent filtrables, signalés « désactivée » —
  // les demandes historiques qui les référencent apparaissent de toute façon normalement dans les résultats.
  const [arbre, rows, suiviBudgetaireRows, categories, objets, users, servicesRaw, beneficiaires] =
    await Promise.all([
      getReportingArbre(filters, (statut) => STATUT_DEMANDE_LABEL[statut], {
        justificatifsRetoursExternes: peutTelechargerJustificatifsRetourExterne(session),
      }),
      getReportingRows(filters),
      getReportingSuiviBudgetaire(),
      // Lot J bis : une catégorie / un objet désactivé reste filtrable (l'historique et le reporting le gardent), signalé « désactivée ».
      prisma.categorie.findMany({ orderBy: { label: "asc" } }),
      prisma.objet.findMany({ orderBy: { label: "asc" } }),
      prisma.user.findMany({ orderBy: { fullName: "asc" } }),
      prisma.service.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
      getBeneficiairesConnus(),
    ]);

  const services = servicesRaw.map((s) => s.name);
  const totauxArbre = totauxParDevise(arbre.lignes);


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
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Reporting"
        description="Un seul tableau : la demande, ses articles et, sous chaque article, ses règlements, retours de caisse, mouvements banque et retours externes ; puis la synthèse par catégorie et objet."
        actions={
          <a href={exportHref}>
            <Button type="button">Exporter en Excel</Button>
          </a>
        }
      />

      <ReportingFiltersForm
        categories={categories.map((c) => ({ id: c.id, label: c.isActive ? c.label : `${c.label} (désactivée)` }))}
        objets={objets.map((o) => ({ id: o.id, label: o.isActive ? o.label : `${o.label} (désactivé)`, categorieId: o.categorieId }))}
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

      <ReportingArbreTable colonnes={COLONNES_ARBRE} lignes={arbre.lignes} totauxParDevise={totauxArbre} nbDemandes={arbre.arbres.length} />

      <div className="space-y-4 rounded-lg border border-border bg-surface p-4 shadow-elevated sm:p-6">
        <h2 className="text-sm font-semibold text-foreground">Synthèse par catégorie / objet</h2>
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
                <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Nb. lignes/demandes</th>
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

      <div id="suivi-budgetaire" className="space-y-4 rounded-lg border border-border bg-surface p-4 shadow-elevated sm:p-6">
        <h2 className="text-sm font-semibold text-foreground">Suivi budgétaire</h2>
        {/* Budget PARTAGÉ par Catégorie (pas par demande, pas par service du
            demandeur), décompté au RÈGLEMENT — voir CLAUDE.md "Budget
            partagé par Catégorie". Volontairement non filtré par période :
            c'est une enveloppe cumulative depuis toujours, pas une donnée
            découpable dans le temps (voir getReportingSuiviBudgetaire). */}
        {suiviBudgetaireRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune catégorie n&apos;a de budget alloué défini pour l&apos;instant — aucune limite
            n&apos;est donc appliquée. Un budget se paramètre (et se soumet à la validation du DG) depuis{" "}
            <a href="/treso/finance/budgets" className="text-info underline-offset-4 hover:underline">
              l&apos;écran Budgets
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
                    <th scope="col" className="px-4 py-2 text-left font-medium text-muted-foreground">Budget</th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-muted-foreground">Période</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Budget alloué</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Consommé (réglé)</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Restant</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Reste après validations</th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-muted-foreground">Seuils</th>
                    <th scope="col" className="px-4 py-2 text-left font-medium text-muted-foreground">Niveau</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-surface">
                  {suiviBudgetaireRows.map((r) => {
                    const depassement = r.budgetRestant !== null && r.budgetRestant < 0;
                    return (
                      <tr key={r.global ? "global" : r.categorieId} data-suivi-budget={r.global ? "global" : r.categorieLabel} className="hover:bg-muted/50">
                        <td className="px-4 py-2 text-foreground">{r.categorieLabel}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{r.periode}</td>
                        <td className="px-4 py-2 text-right text-foreground" data-budget-alloue>
                          {r.budgetAlloue.toLocaleString("fr-FR")} FCFA
                          {r.global ? <span className="block text-xs text-muted-foreground">solde de caisse actuel</span> : null}
                        </td>
                        <td className="px-4 py-2 text-right text-foreground">
                          {r.montantConsomme === null ? "—" : `${r.montantConsomme.toLocaleString("fr-FR")} FCFA`}
                        </td>
                        <td
                          className={`px-4 py-2 text-right font-semibold ${depassement ? "text-danger" : "text-success"}`}
                        >
                          {r.budgetRestant === null ? (
                            "—"
                          ) : (
                            <>
                              {depassement ? "Dépassement de " : ""}
                              {Math.abs(r.budgetRestant).toLocaleString("fr-FR")} FCFA
                            </>
                          )}
                        </td>
                        <td className={`px-4 py-2 text-right font-semibold ${r.resteApresEngagements < 0 ? "text-danger" : "text-foreground"}`} data-reste-apres-validations>
                          {r.resteApresEngagements < 0 ? "Dépassement de " : ""}
                          {Math.abs(r.resteApresEngagements).toLocaleString("fr-FR")} FCFA
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{libelleSeuil(r.seuil)}</td>
                        <td className="px-4 py-2">
                          <BadgeNiveauBudget niveau={r.niveau} />
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
