import { notFound, redirect } from "next/navigation";

import { STATUT_DEMANDE_BADGE_VARIANT, STATUT_DEMANDE_LABEL } from "@/components/tresorerie/demandeStatut";
import { DemandeHistorique } from "@/components/tresorerie/DemandeHistorique";
import { RegularisationSummary } from "@/components/tresorerie/RegularisationSummary";
import { Badge, PageHeader } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { ReglementsRecusSection } from "./ReglementsRecusSection";
import { RetoursCaisseSection } from "./RetoursCaisseSection";

/**
 * Détail d'une demande côté Collaborateur (créateur). Distinct de
 * `/treso/finance/demandes/[id]` (Finance/DG) : cet écran n'appartient
 * qu'à son créateur, jamais accessible aux demandes d'un tiers — vérifié
 * ici côté serveur, pas seulement par l'absence de lien dans l'UI.
 */
export default async function MaDemandeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();

  const demande = await prisma.demande.findUnique({
    where: { id },
    include: { categorie: true, objet: true },
  });

  if (!demande) {
    notFound();
  }

  if (!session || demande.createurId !== session.user.id) {
    redirect("/treso/demandes?error=acces_refuse_demande");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title={`Demande ${demande.reference}`}
        description={`Créée le ${demande.createdAt.toLocaleDateString("fr-FR")}`}
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
          {demande.categorie ? (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Catégorie
              </dt>
              <dd className="text-sm text-foreground">{demande.categorie.label}</dd>
            </div>
          ) : null}
          {demande.objet ? (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Objet
              </dt>
              <dd className="text-sm text-foreground">{demande.objet.label}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      {demande.statut === "CLOTUREE_TOTALE" || demande.statut === "CLOTUREE_PARTIELLE" ? (
        <>
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            Ce dossier est clôturé{demande.statut === "CLOTUREE_PARTIELLE" ? " (partiellement)" : ""} :
            plus aucune action n&apos;est possible dessus.
          </p>
          <RegularisationSummary
            demandeId={demande.id}
            montantDemande={Number(demande.montant)}
            title="Situation finale"
          />
          {demande.statut === "CLOTUREE_PARTIELLE" && demande.motifCloture ? (
            <div className="rounded-lg border border-border bg-surface p-4 sm:p-6">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Motif de la clôture partielle
              </p>
              <p className="mt-1 text-sm text-foreground">{demande.motifCloture}</p>
            </div>
          ) : null}
        </>
      ) : null}

      <ReglementsRecusSection demandeId={demande.id} />

      <RetoursCaisseSection demandeId={demande.id} peutDeclarer={demande.statut === "VALIDEE"} />

      <DemandeHistorique demandeId={demande.id} />
    </div>
  );
}
