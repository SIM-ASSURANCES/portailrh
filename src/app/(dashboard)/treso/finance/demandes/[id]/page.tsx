import { notFound } from "next/navigation";

import { Badge, PageHeader } from "@/components/ui";
import { STATUT_DEMANDE_BADGE_VARIANT, STATUT_DEMANDE_LABEL } from "@/components/tresorerie/demandeStatut";
import { DemandeHistorique } from "@/components/tresorerie/DemandeHistorique";
import { RegularisationSummary } from "@/components/tresorerie/RegularisationSummary";
import type { Prisma } from "@/generated/prisma/client";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { CategorisationForm } from "./CategorisationForm";
import { ClotureActions } from "./ClotureActions";
import { ReglementsSection } from "./ReglementsSection";
import { ValidationActions } from "./ValidationActions";

export default async function CategoriserDemandePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await getSession();
  const canCategoriser = hasPermission(session, "treso.categoriser_demande");
  const canValider = hasPermission(session, "treso.valider_demande");
  const canEffectuerReglement = hasPermission(session, "treso.effectuer_reglement");
  const canCloturerDemande = hasPermission(session, "treso.cloturer_demande");

  const demande = await prisma.demande.findUnique({
    where: { id },
    include: { createur: true, categorie: true, objet: true },
  });

  if (!demande) {
    notFound();
  }

  // Ticket A.1 : seules les catégories/objets actifs sont proposables pour
  // une nouvelle catégorisation (soft-delete, jamais de suppression
  // définitive — voir admin/categories).
  const [categoriesActives, objetsActives] =
    demande.statut === "EN_ATTENTE_VALIDATION" && canCategoriser
      ? await Promise.all([
          prisma.categorie.findMany({ where: { isActive: true }, orderBy: { label: "asc" } }),
          prisma.objet.findMany({ where: { isActive: true }, orderBy: { label: "asc" } }),
        ])
      : [[], []];

  // Piège trouvé et corrigé en vérification manuelle : si la demande est
  // déjà catégorisée (EN_ATTENTE, en cours de correction par Finance) avec
  // une catégorie/objet désactivé entre-temps, celui-ci est absent de la
  // liste ci-dessus — le <select> non contrôlé retombe alors SILENCIEUSEMENT
  // sur sa première option (comportement natif du navigateur pour une
  // defaultValue sans option correspondante), sans que l'état React
  // `categorieId` ne s'en aperçoive. Réenregistrer le formulaire sans rien
  // changer écraserait alors la vraie catégorie par cette fausse valeur
  // affichée. On réinjecte donc la catégorie/l'objet déjà assignés à CETTE
  // demande même s'ils sont désactivés, marqués « (inactive) » — jamais les
  // autres catégories/objets désactivés, qui restent indisponibles pour
  // toute nouvelle sélection.
  const categories =
    demande.categorie && !categoriesActives.some((c) => c.id === demande.categorie!.id)
      ? [...categoriesActives, { ...demande.categorie, label: `${demande.categorie.label} (inactive)` }]
      : categoriesActives;
  const objets =
    demande.objet && !objetsActives.some((o) => o.id === demande.objet!.id)
      ? [...objetsActives, { ...demande.objet, label: `${demande.objet.label} (inactif)` }]
      : objetsActives;

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

      {demande.statut === "EN_ATTENTE_VALIDATION" ? (
        <>
          {canCategoriser ? (
            <CategorisationForm
              demandeId={demande.id}
              categories={categories.map((c) => ({ id: c.id, label: c.label }))}
              objets={objets.map((o) => ({ id: o.id, label: o.label, categorieId: o.categorieId }))}
              initialCategorieId={demande.categorieId ?? undefined}
              initialObjetId={demande.objetId ?? undefined}
              initialBudget={demande.budgetDisponible != null ? Number(demande.budgetDisponible) : undefined}
            />
          ) : (
            <CategorisationSummary
              categorieLabel={demande.categorie?.label}
              objetLabel={demande.objet?.label}
              budget={demande.budgetDisponible}
              note="Catégorie, objet et budget sont renseignés par l'équipe Finance."
            />
          )}

          {canValider ? <ValidationActions demandeId={demande.id} /> : null}
        </>
      ) : demande.statut === "VALIDEE" ? (
        <>
          <CategorisationSummary
            categorieLabel={demande.categorie?.label}
            objetLabel={demande.objet?.label}
            budget={demande.budgetDisponible}
            lockMessage="Cette demande est validée : catégorie, objet et budget sont définitivement verrouillés et ne peuvent plus être modifiés."
          />
          <ReglementsSection
            demandeId={demande.id}
            montantDemande={Number(demande.montant)}
            canEffectuerReglement={canEffectuerReglement}
          />
          <RegularisationSummary demandeId={demande.id} montantDemande={Number(demande.montant)} />
          {canCloturerDemande ? <ClotureActions demandeId={demande.id} /> : null}
        </>
      ) : demande.statut === "CLOTUREE" ? (
        // REFONTE V1 (temporaire, voir CLAUDE.md "Refonte V1 en cours") :
        // CLOTUREE_TOTALE/CLOTUREE_PARTIELLE fusionnées en un unique statut
        // CLOTUREE — motifCloture reste affiché tel quel s'il est renseigné.
        <>
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            Ce dossier est clôturé : plus aucune action n&apos;est possible (règlement, retour de
            caisse, re-clôture).
          </p>
          <CategorisationSummary
            categorieLabel={demande.categorie?.label}
            objetLabel={demande.objet?.label}
            budget={demande.budgetDisponible}
            lockMessage="Catégorie, objet et budget sont définitivement verrouillés."
          />
          <RegularisationSummary demandeId={demande.id} montantDemande={Number(demande.montant)} />
          {demande.motifCloture ? (
            <div className="rounded-lg border border-border bg-surface p-4 sm:p-6">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Motif de la clôture
              </p>
              <p className="mt-1 text-sm text-foreground">{demande.motifCloture}</p>
            </div>
          ) : null}
        </>
      ) : demande.statut === "REJETEE" ? (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-4 sm:p-6">
          <p className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
            Cette demande a été rejetée.
          </p>
          {demande.motifRejet ? (
            <p className="text-sm text-foreground">
              <span className="font-medium">Motif : </span>
              {demande.motifRejet}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="rounded-lg border border-border bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
          Cette demande est au statut «&nbsp;{STATUT_DEMANDE_LABEL[demande.statut]}&nbsp;» : aucune
          catégorisation n&apos;est possible à ce stade.
        </p>
      )}

      <DemandeHistorique demandeId={demande.id} />
    </div>
  );
}

/**
 * Résumé en lecture seule de la catégorisation (catégorie/objet/budget) —
 * utilisé quand aucun formulaire éditable n'est proposé, soit parce que la
 * demande est verrouillée (`lockMessage`), soit parce que l'utilisateur n'a
 * pas la permission de catégoriser (`note`). Colocalisé : uniquement utilisé
 * par cette page, dans deux branches différentes.
 */
function CategorisationSummary({
  categorieLabel,
  objetLabel,
  budget,
  lockMessage,
  note,
}: {
  categorieLabel?: string;
  objetLabel?: string;
  budget: Prisma.Decimal | null;
  lockMessage?: string;
  note?: string;
}) {
  const budgetValue =
    budget != null ? `${Number(budget).toLocaleString("fr-FR")} FCFA` : "—";

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
      {lockMessage ? (
        <p className="rounded-md bg-info-bg px-3 py-2 text-sm text-info">{lockMessage}</p>
      ) : note ? (
        <p className="text-sm text-muted-foreground">{note}</p>
      ) : null}
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Catégorie
          </dt>
          <dd className="text-sm text-foreground">{categorieLabel ?? "Non catégorisée"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Objet
          </dt>
          <dd className="text-sm text-foreground">{objetLabel ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Budget disponible
          </dt>
          <dd className="text-sm text-foreground">{budgetValue}</dd>
        </div>
      </dl>
    </div>
  );
}
