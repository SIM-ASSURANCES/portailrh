import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge, Button, Card, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { VARIANTE_STATUT_CONGE } from "@/components/conges/statutConge";
import { getSession, hasPermission } from "@/lib/auth";
import { aujourdhui, frDate, libelleJours } from "@/lib/conges/format";
import { listerTousConges } from "@/lib/conges/lecture";
import {
  ajouterJours,
  filtresCongesDepuisRecherche,
  LIBELLE_NATURE_CONGE,
  LIBELLE_STATUT_CONGE,
  prisma,
  STATUTS_CONGE_VUE_ENSEMBLE,
  type DemandeVueEnsemble,
  type StatutCircuitConge,
} from "backend";

const TAILLE_PAGE = 50;
const STATUTS_CONGE_ACTIF: readonly StatutCircuitConge[] = [
  "VALIDEE",
  "EN_ATTENTE_RESPONSABLE",
  "EN_ATTENTE_RH",
];

type OngletVueEnsemble = "aujourdhui" | "a-venir" | "toutes";

interface SearchParamsVueEnsemble {
  onglet?: string;
  du?: string;
  au?: string;
  service?: string;
  statut?: string;
  nature?: string;
  page?: string;
}

function resoudreOnglet(brut?: string): OngletVueEnsemble {
  if (brut === "aujourdhui" || brut === "a-venir") return brut;
  return "toutes";
}

function construireSearchExport(params: SearchParamsVueEnsemble): string {
  const qs = new URLSearchParams();
  if (params.du !== undefined && params.du !== "") qs.set("du", params.du);
  if (params.au !== undefined && params.au !== "") qs.set("au", params.au);
  if (params.service !== undefined && params.service !== "") qs.set("service", params.service);
  if (params.statut !== undefined && params.statut !== "") qs.set("statut", params.statut);
  if (params.nature !== undefined && params.nature !== "") qs.set("nature", params.nature);
  return qs.toString();
}

function construireHrefPage(params: SearchParamsVueEnsemble, page: number): string {
  const qs = new URLSearchParams();
  qs.set("onglet", "toutes");
  if (params.du) qs.set("du", params.du);
  if (params.au) qs.set("au", params.au);
  if (params.service) qs.set("service", params.service);
  if (params.statut) qs.set("statut", params.statut);
  if (params.nature) qs.set("nature", params.nature);
  if (page > 1) qs.set("page", String(page));
  return `/conges/toutes?${qs.toString()}`;
}

export default async function ToutesLesDemandesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsVueEnsemble>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const autorise =
    hasPermission(session, "conges.consulter_tous") ||
    session.rolePermissions.includes("conges.valider_rh");
  if (!autorise) redirect("/?error=acces_refuse_conges");

  const params = await searchParams;
  const onglet = resoudreOnglet(params.onglet);
  const jourActuel = aujourdhui();

  if (onglet === "aujourdhui") {
    const { lignes } = await listerTousConges({
      du: jourActuel,
      au: jourActuel,
      statuts: STATUTS_CONGE_ACTIF,
    });

    return (
      <div className="space-y-6">
        <PageHeader
          title="Toutes les demandes"
          description="Vue d’ensemble des congés et permissions exceptionnelles pour la RH et la Direction Générale."
        />
        <OngletsNavigation ongletActif={onglet} />
        <ListeCongesVueEnsemble
          demandes={lignes}
          messageVide="Aucun collaborateur n’est en congé ou en attente de validation aujourd’hui."
        />
      </div>
    );
  }

  if (onglet === "a-venir") {
    const demain = ajouterJours(jourActuel, 1);
    const horizon = ajouterJours(jourActuel, 30);
    const { lignes } = await listerTousConges({
      du: demain,
      au: horizon,
      statuts: STATUTS_CONGE_ACTIF,
      debutDansPeriode: true,
    });

    return (
      <div className="space-y-6">
        <PageHeader
          title="Toutes les demandes"
          description="Vue d’ensemble des congés et permissions exceptionnelles pour la RH et la Direction Générale."
        />
        <OngletsNavigation ongletActif={onglet} />
        <ListeCongesVueEnsemble
          demandes={lignes}
          messageVide="Aucun congé à venir dans les 30 prochains jours."
        />
      </div>
    );
  }

  const [services, resultatFiltres] = await Promise.all([
    prisma.service.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    Promise.resolve(filtresCongesDepuisRecherche(params, jourActuel)),
  ]);

  const pageDemandee = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const donnees = resultatFiltres.ok
    ? await listerTousConges(resultatFiltres, { page: pageDemandee, taille: TAILLE_PAGE })
    : { lignes: [], total: 0 };

  const searchExport = construireSearchExport(params);
  const hrefExport = searchExport ? `/api/conges/export?${searchExport}` : "/api/conges/export";
  const nbPages = Math.max(1, Math.ceil(donnees.total / TAILLE_PAGE));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Toutes les demandes"
        description="Vue d’ensemble des congés et permissions exceptionnelles pour la RH et la Direction Générale."
        actions={
          resultatFiltres.ok ? (
            <a
              href={hrefExport}
              className="inline-flex items-center justify-center rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground shadow-elevated transition-colors hover:bg-muted"
            >
              Exporter en Excel
            </a>
          ) : null
        }
      />

      <OngletsNavigation ongletActif={onglet} />

      <form
        method="get"
        className="grid gap-4 rounded-2xl border border-border bg-surface p-4 shadow-elevated sm:grid-cols-2 lg:grid-cols-6"
      >
        <input type="hidden" name="onglet" value="toutes" />
        <Input
          label="Du"
          type="date"
          name="du"
          defaultValue={resultatFiltres.ok ? resultatFiltres.du : (params.du ?? "")}
        />
        <Input
          label="Au"
          type="date"
          name="au"
          defaultValue={resultatFiltres.ok ? resultatFiltres.au : (params.au ?? "")}
        />
        <Select
          label="Service"
          name="service"
          defaultValue={resultatFiltres.ok ? (resultatFiltres.serviceId ?? "") : (params.service ?? "")}
          options={services.map((s) => ({ value: s.id, label: s.name }))}
          placeholder="Tous les services"
        />
        <Select
          label="Statut"
          name="statut"
          defaultValue={resultatFiltres.ok ? resultatFiltres.statut : (params.statut || "VALIDEE")}
          options={[
            { value: "TOUS", label: "Tous les statuts" },
            ...STATUTS_CONGE_VUE_ENSEMBLE.map((value) => ({
              value,
              label: LIBELLE_STATUT_CONGE[value],
            })),
          ]}
        />
        <Select
          label="Nature"
          name="nature"
          defaultValue={resultatFiltres.ok ? (resultatFiltres.nature ?? "") : (params.nature ?? "")}
          options={[
            { value: "CONGE", label: LIBELLE_NATURE_CONGE.CONGE },
            {
              value: "PERMISSION_EXCEPTIONNELLE",
              label: LIBELLE_NATURE_CONGE.PERMISSION_EXCEPTIONNELLE,
            },
          ]}
          placeholder="Toutes les natures"
        />
        <div className="flex flex-wrap items-end gap-2">
          <Button type="submit" variant="primary">
            Filtrer
          </Button>
          <Link
            href="/conges/toutes"
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground"
          >
            Effacer
          </Link>
        </div>
      </form>

      {!resultatFiltres.ok ? (
        <p role="alert" className="rounded-lg border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger">
          {resultatFiltres.erreur}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <p>
              {donnees.lignes.length} affichée{donnees.lignes.length > 1 ? "s" : ""} sur {donnees.total}
            </p>
            {nbPages > 1 ? (
              <div className="flex items-center gap-2">
                {pageDemandee > 1 ? (
                  <Link
                    href={construireHrefPage(params, pageDemandee - 1)}
                    className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground"
                  >
                    Précédent
                  </Link>
                ) : null}
                <span className="text-xs">
                  Page {pageDemandee} / {nbPages}
                </span>
                {pageDemandee < nbPages ? (
                  <Link
                    href={construireHrefPage(params, pageDemandee + 1)}
                    className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground"
                  >
                    Suivant
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>

          <ListeCongesVueEnsemble
            demandes={donnees.lignes}
            messageVide="Aucune demande ne correspond à ces filtres."
          />
        </div>
      )}
    </div>
  );
}

function OngletsNavigation({ ongletActif }: { ongletActif: OngletVueEnsemble }) {
  const onglets: { cle: OngletVueEnsemble; label: string; href: string }[] = [
    { cle: "aujourdhui", label: "En congé aujourd’hui", href: "/conges/toutes?onglet=aujourdhui" },
    { cle: "a-venir", label: "À venir", href: "/conges/toutes?onglet=a-venir" },
    { cle: "toutes", label: "Toutes les demandes", href: "/conges/toutes?onglet=toutes" },
  ];

  return (
    <nav aria-label="Vues des congés" className="flex flex-wrap gap-2 border-b border-border pb-3">
      {onglets.map((item) => {
        const actif = item.cle === ongletActif;
        return (
          <Link
            key={item.cle}
            href={item.href}
            aria-current={actif ? "page" : undefined}
            className={
              actif
                ? "rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground"
                : "rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium text-foreground hover:bg-muted"
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function ListeCongesVueEnsemble({
  demandes,
  messageVide,
}: {
  demandes: DemandeVueEnsemble[];
  messageVide: string;
}) {
  if (demandes.length === 0) {
    return <EmptyState icon="calendar" message={messageVide} />;
  }

  return (
    <>
      <ul className="space-y-3 sm:hidden">
        {demandes.map((demande) => (
          <li key={demande.id}>
            <Card className="space-y-2 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/conges/${demande.id}`}
                    className="font-bold text-primary underline-offset-2 hover:underline"
                  >
                    {demande.reference}
                  </Link>
                  <p className="text-sm font-semibold text-foreground">{demande.user.fullName}</p>
                  <p className="text-xs text-muted-foreground">
                    {demande.user.service?.name ?? "Aucun service"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={VARIANTE_STATUT_CONGE[demande.statut]}>
                    {LIBELLE_STATUT_CONGE[demande.statut]}
                  </Badge>
                  {demande.saisieParRH ? <Badge variant="info">Saisi par la RH</Badge> : null}
                </div>
              </div>
              <p className="text-sm text-foreground">
                {LIBELLE_NATURE_CONGE[demande.nature]} · du {frDate(demande.dateDebut)} au{" "}
                {frDate(demande.dateFin)} · {libelleJours(demande.nbJoursOuvres)}
              </p>
            </Card>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-2xl border border-border bg-surface shadow-elevated sm:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-muted text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3">Référence</th>
              <th className="px-4 py-3">Collaborateur</th>
              <th className="px-4 py-3">Service</th>
              <th className="px-4 py-3">Nature</th>
              <th className="px-4 py-3">Période</th>
              <th className="px-4 py-3">Jours ouvrés</th>
              <th className="px-4 py-3">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {demandes.map((demande) => (
              <tr key={demande.id} className="hover:bg-muted/50">
                <td className="px-4 py-3 font-semibold">
                  <Link
                    href={`/conges/${demande.id}`}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {demande.reference}
                  </Link>
                </td>
                <td className="px-4 py-3 font-medium text-foreground">{demande.user.fullName}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {demande.user.service?.name ?? "Aucun service"}
                </td>
                <td className="px-4 py-3 text-foreground">{LIBELLE_NATURE_CONGE[demande.nature]}</td>
                <td className="px-4 py-3 text-foreground">
                  Du {frDate(demande.dateDebut)} au {frDate(demande.dateFin)}
                </td>
                <td className="px-4 py-3 tabular-nums text-foreground">
                  {libelleJours(demande.nbJoursOuvres)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={VARIANTE_STATUT_CONGE[demande.statut]}>
                      {LIBELLE_STATUT_CONGE[demande.statut]}
                    </Badge>
                    {demande.saisieParRH ? <Badge variant="info">Saisi par la RH</Badge> : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
