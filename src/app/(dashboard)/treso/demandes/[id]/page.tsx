import { notFound, redirect } from "next/navigation";

import { STATUT_DEMANDE_BADGE_VARIANT, STATUT_DEMANDE_LABEL } from "@/components/tresorerie/demandeStatut";
import { BENEFICIAIRE_TYPE_LABEL, getBeneficiaireNom } from "@/components/tresorerie/beneficiaire";
import { formatMontantDevise } from "@/components/tresorerie/devise";
import { DemandeHistorique } from "@/components/tresorerie/DemandeHistorique";
import { DepenseDirecteBadge } from "@/components/tresorerie/DepenseDirecteBadge";
import { RegularisationSummary } from "@/components/tresorerie/RegularisationSummary";
import { Badge, PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { ReglementsRecusSection } from "./ReglementsRecusSection";
import { RetoursCaisseSection } from "./RetoursCaisseSection";

/**
 * Détail d'une demande côté Collaborateur (créateur). Distinct de
 * `/treso/finance/demandes/[id]` (Finance/DG) : cet écran n'appartient
 * qu'à son créateur, jamais accessible aux demandes d'un tiers — vérifié
 * ici côté serveur, pas seulement par l'absence de lien dans l'UI.
 *
 * **Phase F (saisie directe) — cohérence documentée** : pour une
 * `DEPENSE_DIRECTE`, le créateur (`createurId`) est l'utilisateur Finance
 * qui l'a saisie, jamais le bénéficiaire réel (Phase A,
 * `beneficiaireType`/`beneficiaireUserId`/`beneficiaireNom`) — ces deux
 * notions sont désormais explicitement distinctes, pas seulement en
 * théorie. Conséquence mécanique : cet écran reste accessible (Finance EST
 * le créateur, la garde ci-dessus passe normalement) et fonctionne
 * correctement, mais **le bénéficiaire, même s'il a un compte
 * Collaborateur, ne voit jamais "sa" dépense directe dans son propre
 * "Mes demandes"** (filtré par `createurId`, jamais par bénéficiaire) — un
 * onglet dédié "Dépenses dont je suis bénéficiaire" n'existe pas à ce
 * stade, volontairement hors périmètre de cette phase (voir CLAUDE.md
 * "Refonte V1 en cours" / Phase F).
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
    include: {
      categorie: true,
      objet: true,
      posteBudgetaire: true,
      beneficiaireUser: true,
      lignes: { orderBy: { createdAt: "asc" } },
      pieces: true,
    },
  });

  if (!demande) {
    notFound();
  }

  if (!session || demande.createurId !== session.user.id) {
    redirect("/treso/demandes?error=acces_refuse_demande");
  }

  // Phase F : le bouton "Déclarer un retour de caisse" (RetoursCaisseSection)
  // n'a de sens que pour un créateur ayant réellement `treso.declarer_retour`
  // — jamais garanti avant cette phase (le créateur était toujours un
  // Collaborateur, qui l'a systématiquement). Une DEPENSE_DIRECTE créée par
  // Finance (qui ne l'a pas dans le seed) afficherait sinon un bouton voué à
  // échouer côté serveur — même principe que `canEffectuerReglement` ailleurs.
  const peutDeclarerRetour = demande.statut !== "CLOTUREE" && hasPermission(session, "treso.declarer_retour");

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title={`Demande ${demande.reference}`}
        description={`Créée le ${demande.createdAt.toLocaleDateString("fr-FR")}`}
        actions={
          demande.typeDemande === "DEPENSE_DIRECTE" && demande.natureDepenseDirecte ? (
            <DepenseDirecteBadge nature={demande.natureDepenseDirecte} />
          ) : undefined
        }
      />

      <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Montant
            </dt>
            <dd className="text-base font-semibold text-foreground">
              {formatMontantDevise(Number(demande.montant), demande.devise)}
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
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Bénéficiaire
            </dt>
            <dd className="text-sm text-foreground">
              {getBeneficiaireNom(demande)}{" "}
              <span className="text-muted-foreground">({BENEFICIAIRE_TYPE_LABEL[demande.beneficiaireType]})</span>
            </dd>
          </div>
          {/* Phase B (validation partielle) : montant validé/restant visible
              partout où le statut de validation est affiché — voir CLAUDE.md
              "Refonte V1 en cours" / Phase B, règle impérative 6. */}
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Montant validé
            </dt>
            <dd className="text-sm text-foreground">
              {formatMontantDevise(Number(demande.montantValide ?? 0), demande.devise)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Montant restant à valider
            </dt>
            <dd className="text-sm text-foreground">
              {formatMontantDevise(
                Math.max(0, Number(demande.montant) - Number(demande.montantValide ?? 0)),
                demande.devise
              )}
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
          {demande.categorie ? (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Catégorie d&apos;achat
              </dt>
              <dd className="text-sm text-foreground">{demande.categorie.label}</dd>
            </div>
          ) : null}
          {demande.posteBudgetaire ? (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Poste budgétaire
              </dt>
              <dd className="text-sm text-foreground">{demande.posteBudgetaire.label}</dd>
            </div>
          ) : null}
          {demande.dateLivraisonSouhaitee ? (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Date de livraison souhaitée
              </dt>
              <dd className="text-sm text-foreground">
                {demande.dateLivraisonSouhaitee.toLocaleDateString("fr-FR")}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Devise
            </dt>
            <dd className="text-sm text-foreground">{demande.devise}</dd>
          </div>
          {demande.objet ? (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Objet
              </dt>
              <dd className="text-sm text-foreground">{demande.objet.label}</dd>
            </div>
          ) : null}
        </dl>

        {demande.lignes.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Articles
            </p>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Libellé</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Nombre</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Prix unitaire</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-surface">
                  {demande.lignes.map((ligne) => (
                    <tr key={ligne.id}>
                      <td className="px-3 py-2 text-foreground">{ligne.libelle}</td>
                      <td className="px-3 py-2 text-right text-foreground">{ligne.quantite}</td>
                      <td className="px-3 py-2 text-right text-foreground">
                        {formatMontantDevise(Number(ligne.prixUnitaire), demande.devise)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-foreground">
                        {formatMontantDevise(ligne.quantite * Number(ligne.prixUnitaire), demande.devise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>

      {/* REFONTE V1 (temporaire, voir CLAUDE.md "Refonte V1 en cours") :
          CLOTUREE_TOTALE/CLOTUREE_PARTIELLE fusionnées en un unique statut
          CLOTUREE — la distinction totale/partielle sera réintroduite par
          la phase de régularisation (EN_ATTENTE_REGULARISATION/REGULARISEE). */}
      {demande.statut === "CLOTUREE" ? (
        <>
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            Ce dossier est clôturé : plus aucune action n&apos;est possible dessus.
          </p>
          <RegularisationSummary
            demandeId={demande.id}
            montantValide={Number(demande.montantValide ?? 0)}
            title="Situation finale"
          />
          {demande.motifCloture ? (
            <div className="rounded-lg border border-border bg-surface p-4 sm:p-6">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Motif de la clôture
              </p>
              <p className="mt-1 text-sm text-foreground">{demande.motifCloture}</p>
            </div>
          ) : null}
        </>
      ) : null}

      <ReglementsRecusSection demandeId={demande.id} />

      <RetoursCaisseSection demandeId={demande.id} peutDeclarer={peutDeclarerRetour} userId={session.user.id} />

      <DemandeHistorique demandeId={demande.id} />
    </div>
  );
}
