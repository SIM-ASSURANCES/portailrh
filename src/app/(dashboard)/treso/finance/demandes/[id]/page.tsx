import { notFound } from "next/navigation";

import { Badge, PageHeader } from "@/components/ui";
import { STATUT_DEMANDE_BADGE_VARIANT, STATUT_DEMANDE_LABEL } from "@/components/tresorerie/demandeStatut";
import { BENEFICIAIRE_TYPE_LABEL, getBeneficiaireNom } from "@/components/tresorerie/beneficiaire";
import { DemandeHistorique } from "@/components/tresorerie/DemandeHistorique";
import { DepenseDirecteBadge } from "@/components/tresorerie/DepenseDirecteBadge";
import { PersonnesIntervenantes } from "@/components/tresorerie/PersonnesIntervenantes";
import { RegularisationSummary } from "@/components/tresorerie/RegularisationSummary";
import type { Prisma } from "@/generated/prisma/client";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { STATUTS_VALIDATION_COMPLETE } from "@/lib/tresorerie";

import { CategorisationForm } from "./CategorisationForm";
import { ClotureActions } from "./ClotureActions";
import { ReglementsSection } from "./ReglementsSection";
import { ValidationActions } from "./ValidationActions";
import { ValidationComplementaireActions } from "./ValidationComplementaireActions";
import { ValidationCompleteDGActions } from "./ValidationCompleteDGActions";

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
  const canApprouverValidationComplete = hasPermission(session, "treso.approuver_validation_complete");

  const demande = await prisma.demande.findUnique({
    where: { id },
    include: {
      createur: true,
      categorie: true,
      objet: true,
      beneficiaireUser: true,
      dgApprobateur: true,
      pieces: true,
    },
  });

  if (!demande) {
    notFound();
  }

  // Verrou de clôture — dernier évènement négatif (rejet lors d'un examen,
  // ou annulation d'une approbation déjà donnée) affiché en évidence tant
  // que la demande reste en attente (`validationCompleteParDG = false`) :
  // le plus récent des deux, jamais seulement le dernier rejet, pour ne
  // jamais afficher un motif de rejet devenu obsolète après une annulation
  // ultérieure plus pertinente (ni l'inverse) — voir CLAUDE.md.
  const dernierEvenementNegatifDG = demande.validationCompleteParDG
    ? null
    : await prisma.historiqueEntry.findFirst({
        where: {
          entity: "Demande",
          entityId: demande.id,
          action: { in: ["rejet_validation_complete", "annulation_validation_complete"] },
        },
        include: { user: true },
        orderBy: { createdAt: "desc" },
      });

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
        actions={
          demande.typeDemande === "DEPENSE_DIRECTE" && demande.natureDepenseDirecte ? (
            <DepenseDirecteBadge nature={demande.natureDepenseDirecte} />
          ) : undefined
        }
      />

      <div className="space-y-4 rounded-2xl border border-border bg-surface p-4 shadow-elevated sm:p-6">
        <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Montant
            </dt>
            <dd className="mt-1 text-2xl font-black tracking-tight text-foreground tabular-nums">
              {Number(demande.montant).toLocaleString("fr-FR")}{" "}
              <span className="text-sm font-bold text-muted-foreground">FCFA</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Statut
            </dt>
            <dd className="mt-1.5">
              <Badge variant={STATUT_DEMANDE_BADGE_VARIANT[demande.statut]}>
                {STATUT_DEMANDE_LABEL[demande.statut]}
              </Badge>
            </dd>
          </div>
          {/* Phase F (saisie directe) : bénéficiaire toujours affiché, y
              compris pour une demande STANDARD (où il vaut généralement le
              créateur) — distinction visible immédiatement pour une
              DEPENSE_DIRECTE, où créateur et bénéficiaire diffèrent. */}
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Bénéficiaire
            </dt>
            <dd className="mt-1 text-sm text-foreground">
              {getBeneficiaireNom(demande)}{" "}
              <span className="text-muted-foreground">({BENEFICIAIRE_TYPE_LABEL[demande.beneficiaireType]})</span>
            </dd>
          </div>
          {/* Phase B (validation partielle) : montant validé/restant visible
              partout où le statut de validation est affiché — voir CLAUDE.md
              "Refonte V1 en cours" / Phase B, règle impérative 6. */}
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Montant validé
            </dt>
            <dd className="mt-1 text-base font-bold text-foreground tabular-nums">
              {demande.montantValide != null ? Number(demande.montantValide).toLocaleString("fr-FR") : "0"} FCFA
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Montant restant à valider
            </dt>
            <dd className="mt-1 text-base font-bold text-foreground tabular-nums">
              {Math.max(0, Number(demande.montant) - Number(demande.montantValide ?? 0)).toLocaleString("fr-FR")}{" "}
              FCFA
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
          {demande.pieces.length > 0 ? (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Pièce jointe
              </dt>
              <dd className="space-x-3 text-sm text-foreground">
                {demande.pieces.map((piece, index) => (
                  <a
                    key={piece.id}
                    href={`/api/treso/pieces-jointes/${piece.id}`}
                    className="text-info underline-offset-4 transition-colors hover:text-primary hover:underline"
                  >
                    Télécharger{demande.pieces.length > 1 ? ` (${index + 1})` : ""}
                  </a>
                ))}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      {/* Historique remonté juste après l'en-tête (au lieu du bas de page) :
          une fois le dossier clôturé, tout ce qui suit (régularisation,
          personnes intervenantes, règlements, retours...) pouvait repousser
          ce titre à près de 2 écrans de défilement, le rendant quasiment
          invisible sans scroller volontairement — vérifié explicitement par
          un parcours navigateur réel sur un cycle complet. Position
          désormais fixe, uniforme quel que soit le statut. */}
      <DemandeHistorique demandeId={demande.id} />

      {/* Verrou de clôture (Ticket 7) — indépendant du circuit de
          validation/règlement des Phases B/C, qui reste inchangé (n'affecte
          jamais l'éligibilité au règlement, seulement la clôture) : visible
          dès qu'un montant est validé, peu importe l'avancement du
          règlement — jamais uniquement dans la branche "montant entièrement
          validé", une demande PARTIELLEMENT_VALIDEE peut aussi être
          approuvée par le DG. */}
      {demande.montantValide != null && Number(demande.montantValide) > 0 ? (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Validation complète (DG)
              </p>
              {demande.validationCompleteParDG ? (
                <p className="mt-1 text-sm text-foreground">
                  Validation complète : approuvée le{" "}
                  <span className="font-semibold">{demande.dgApprouveAt?.toLocaleDateString("fr-FR")}</span> par{" "}
                  <span className="font-semibold">{demande.dgApprobateur?.fullName ?? "—"}</span>
                </p>
              ) : (
                <div className="mt-1">
                  <Badge variant="warning">Validation complète : en attente du DG</Badge>
                </div>
              )}
            </div>
            {canApprouverValidationComplete && !demande.validationCompleteParDG ? (
              <ValidationCompleteDGActions demandeId={demande.id} mode="examen" />
            ) : null}
            {canApprouverValidationComplete &&
            demande.validationCompleteParDG &&
            demande.statut !== "CLOTUREE" ? (
              <ValidationCompleteDGActions demandeId={demande.id} mode="annulation" />
            ) : null}
          </div>
          {/* Motif du dernier évènement négatif (rejet d'examen ou annulation
              d'une approbation) — visible tant que la demande reste en
              attente, pour que Finance sache ce qui doit être corrigé avant
              un nouvel examen du DG. */}
          {dernierEvenementNegatifDG ? (
            <p className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
              {dernierEvenementNegatifDG.action === "rejet_validation_complete"
                ? "Rejeté par le DG lors de l'examen"
                : "Approbation précédemment annulée par le DG"}{" "}
              ({dernierEvenementNegatifDG.user.fullName}, le{" "}
              {dernierEvenementNegatifDG.createdAt.toLocaleDateString("fr-FR")}) — motif :{" "}
              <span className="font-semibold">{dernierEvenementNegatifDG.detail}</span>
            </p>
          ) : null}
          {canApprouverValidationComplete && demande.validationCompleteParDG && demande.statut === "CLOTUREE" ? (
            <p className="text-xs text-muted-foreground">
              Cette approbation ne peut plus être annulée : la demande a déjà été clôturée sur cette base.
            </p>
          ) : null}
        </div>
      ) : null}

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

          {canValider ? (
            <ValidationActions demandeId={demande.id} montantDemande={Number(demande.montant)} />
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
          <RegularisationSummary demandeId={demande.id} montantValide={Number(demande.montantValide ?? 0)} />
          <PersonnesIntervenantes demandeId={demande.id} demandeurNom={demande.createur.fullName} />
          {demande.motifCloture ? (
            <div className="rounded-lg border border-border bg-surface p-4 sm:p-6">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Motif de la clôture
              </p>
              <p className="mt-1 text-sm text-foreground">{demande.motifCloture}</p>
            </div>
          ) : null}
        </>
      ) : demande.montantValide != null && Number(demande.montantValide) > 0 ? (
        // REFONTE V1 / Phase C (voir CLAUDE.md "Refonte V1 en cours") :
        // regroupe PARTIELLEMENT_VALIDEE + la famille "montant entièrement
        // validé" (VALIDEE/VALIDEE_NON_REGLEE/PARTIELLEMENT_REGLEE/REGLEE) —
        // dès qu'un montant est validé, le règlement est possible sur ce
        // montant (`ReglementsSection`), que la validation soit totale ou
        // seulement partielle (cahier des charges section 4). Seule la
        // validation complémentaire (reliquat) et la clôture distinguent
        // encore ces deux cas.
        <>
          <CategorisationSummary
            categorieLabel={demande.categorie?.label}
            objetLabel={demande.objet?.label}
            budget={demande.budgetDisponible}
            lockMessage={
              demande.statut === "PARTIELLEMENT_VALIDEE"
                ? "Cette demande est partiellement validée : catégorie, objet et budget sont verrouillés."
                : "Cette demande est validée : catégorie, objet et budget sont définitivement verrouillés et ne peuvent plus être modifiés."
            }
          />
          {demande.statut === "PARTIELLEMENT_VALIDEE" && canValider ? (
            <ValidationComplementaireActions
              demandeId={demande.id}
              montantRestant={Number(demande.montant) - Number(demande.montantValide)}
            />
          ) : null}
          <ReglementsSection
            demandeId={demande.id}
            montantValide={Number(demande.montantValide)}
            canEffectuerReglement={canEffectuerReglement}
          />
          <RegularisationSummary demandeId={demande.id} montantValide={Number(demande.montantValide)} />
          {STATUTS_VALIDATION_COMPLETE.includes(demande.statut) && canCloturerDemande ? (
            demande.validationCompleteParDG ? (
              <ClotureActions demandeId={demande.id} />
            ) : (
              // Ticket 7 + verrou de clôture : jamais un simple masquage
              // silencieux des boutons — le message explique explicitement
              // pourquoi la clôture n'est pas encore possible.
              <div className="rounded-lg border border-border bg-warning-bg px-4 py-3 text-sm text-warning">
                La clôture nécessite l&apos;approbation complète du DG au préalable (voir «&nbsp;Validation
                complète&nbsp;» ci-dessus).
              </div>
            )
          ) : null}
        </>
      ) : (
        <p className="rounded-lg border border-border bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
          Cette demande est au statut «&nbsp;{STATUT_DEMANDE_LABEL[demande.statut]}&nbsp;» : aucune
          catégorisation n&apos;est possible à ce stade.
        </p>
      )}
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
