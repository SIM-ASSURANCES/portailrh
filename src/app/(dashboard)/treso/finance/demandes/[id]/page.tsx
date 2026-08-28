import { notFound } from "next/navigation";

import { Badge, PageHeader } from "@/components/ui";
import { STATUT_DEMANDE_BADGE_VARIANT, STATUT_DEMANDE_LABEL } from "@/components/tresorerie/demandeStatut";
import { prisma } from "@/lib/prisma";

import { CategorisationForm } from "./CategorisationForm";

export default async function CategoriserDemandePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const demande = await prisma.demande.findUnique({
    where: { id },
    include: { createur: true, categorie: true, objet: true },
  });

  if (!demande) {
    notFound();
  }

  const [categories, objets] =
    demande.statut === "EN_ATTENTE"
      ? await Promise.all([
          prisma.categorie.findMany({ orderBy: { label: "asc" } }),
          prisma.objet.findMany({ orderBy: { label: "asc" } }),
        ])
      : [[], []];

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title={`Demande ${demande.reference}`}
        description={`Créée par ${demande.createur.fullName} le ${demande.createdAt.toLocaleDateString("fr-FR")}`}
      />

      <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Montant
            </dt>
            <dd className="text-base font-semibold text-foreground">
              {Number(demande.montant).toLocaleString("fr-FR")} FCFA
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Statut
            </dt>
            <dd>
              <Badge variant={STATUT_DEMANDE_BADGE_VARIANT[demande.statut]}>
                {STATUT_DEMANDE_LABEL[demande.statut]}
              </Badge>
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Description du besoin
            </dt>
            <dd className="text-sm text-foreground">{demande.description}</dd>
          </div>
          {demande.commentaire ? (
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Commentaire
              </dt>
              <dd className="text-sm text-foreground">{demande.commentaire}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      {demande.statut === "EN_ATTENTE" ? (
        <CategorisationForm
          demandeId={demande.id}
          categories={categories.map((c) => ({ id: c.id, label: c.label }))}
          objets={objets.map((o) => ({ id: o.id, label: o.label, categorieId: o.categorieId }))}
          initialCategorieId={demande.categorieId ?? undefined}
          initialObjetId={demande.objetId ?? undefined}
          initialBudget={demande.budgetDisponible != null ? Number(demande.budgetDisponible) : undefined}
        />
      ) : demande.statut === "VALIDEE" ? (
        <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
          <p className="rounded-md bg-info-bg px-3 py-2 text-sm text-info">
            Cette demande est validée : catégorie, objet et budget sont
            définitivement verrouillés et ne peuvent plus être modifiés.
          </p>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Catégorie
              </dt>
              <dd className="text-sm text-foreground">{demande.categorie?.label ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Objet
              </dt>
              <dd className="text-sm text-foreground">{demande.objet?.label ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Budget disponible
              </dt>
              <dd className="text-sm text-foreground">
                {demande.budgetDisponible != null
                  ? `${Number(demande.budgetDisponible).toLocaleString("fr-FR")} FCFA`
                  : "—"}
              </dd>
            </div>
          </dl>
        </div>
      ) : (
        <p className="rounded-lg border border-border bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
          Cette demande est au statut «&nbsp;{STATUT_DEMANDE_LABEL[demande.statut]}&nbsp;» : aucune
          catégorisation n&apos;est possible à ce stade.
        </p>
      )}
    </div>
  );
}
