import { notFound, redirect } from "next/navigation";

import { Badge, PageHeader } from "@/components/ui";
import { DemandeHistorique } from "@/components/tresorerie/DemandeHistorique";
import { EnteteDemandeArticle } from "@/components/tresorerie/EnteteDemandeArticle";
import { FriseCircuit } from "@/components/tresorerie/FriseCircuit";
import { RepriseEtapeSection } from "@/components/tresorerie/RepriseEtapeSection";
import {
  STATUT_LIGNE_DEMANDE_BADGE_VARIANT,
  STATUT_LIGNE_DEMANDE_LABEL,
} from "@/components/tresorerie/demandeStatut";
import { detailsArticleDe } from "@/components/tresorerie/DetailsArticle";
import { getSession, hasPermission } from "@/lib/auth";
import { chargerBudgetValidation } from "@/lib/budgetValidation";
import {
  aPlusieursBeneficiaires,
  BENEFICIAIRE_TYPE_LABEL,
  chargerActeur,
  detailsArticles,
  nomBeneficiaireDemande,
  chargerElementsReprise,
  prisma,
  raisonIndisponible,
  categorisationEstObligatoire,
  refusDemandeSansCategorie,
  versDemandeCircuit,
  getParcoursArticles,
} from "backend";

import { LignesValidationTable } from "../../finance/demandes/[id]/LignesValidationTable";
import { ValidationActions } from "../../finance/demandes/[id]/ValidationActions";
import { DecisionLignesDG } from "./DecisionLignesDG";
import { DgDecisionActions } from "./DgDecisionActions";

/**
 * Demande vue par le DG (circuit de validation, commit 4) : lignes une par une, montants, motif, pièces jointes,
 * frise, historique, et sa décision. Demande soumise par la Finance : Valider / Rejeter la demande entière. Demande
 * de la Finance (cas b) : décision ligne par ligne (`validerLignesAction`, finale, vaut l'approbation de clôture) et
 * « Rejeter la demande ». Réservée à `treso.decider_dg` ; à toute étape pour suivre la demande, les boutons étant
 * grisés hors de l'étape DG avec la phrase du moteur (qui applique aussi la règle des deux personnes).
 */
export default async function DemandeDGPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "treso.decider_dg")) redirect("/?error=acces_refuse_dg");

  const demande = await prisma.demande.findUnique({
    where: { id },
    include: {
      createur: { select: { fullName: true, service: { select: { name: true } } } },
      beneficiaireUser: true,
      pieces: true,
      lignes: {
        orderBy: { createdAt: "asc" },
        include: {
          decidePar: true,
          beneficiaireUser: true,
          categorie: true,
          objet: true,
          decisionDGPar: { select: { fullName: true } },
          soumiseDGPar: { select: { fullName: true } },
        },
      },
    },
  });
  if (!demande) notFound();

  const categorisationObligatoire = await categorisationEstObligatoire();
  // Lot J : budgets en vigueur et confirmations de dépassement de cette demande (reste après chaque validation du DG).
  const budgetValidation = await chargerBudgetValidation(demande.id, session);
  const demandeCircuit = versDemandeCircuit(demande, categorisationObligatoire);
  const enteteDemande = {
    reference: demande.reference,
    demandeurNom: demande.createur.fullName,
    serviceNom: demande.createur.service?.name ?? null,
    creeeLe: demande.createdAt,
    devise: demande.devise,
  };
  const acteur = await chargerActeur(prisma, session, demande.createurId, demande.id);
  // Lot K : retirer ou renvoyer à la Finance un article soumis au DG (reprise, motif obligatoire).
  const elementsReprise = await chargerElementsReprise(prisma, demande.id, acteur);
  const decisionParLigne = demande.modeEtapeDG === "OBLIGATOIRE";
  const raisonDecider = raisonIndisponible(demandeCircuit, acteur, "DECIDER_LIGNES");
  // Soumission au DG ligne par ligne (2026-10-10) : le DG ne voit et ne décide que les lignes soumises par la Finance.
  const soumissionParLignes = demande.lignes.length > 0 && demande.typeDemande === "STANDARD" && demande.modeEtapeDG === "OPTIONNELLE";
  const lignesSoumises = demande.lignes.filter((l) => l.soumiseAuDG);
  const vueArticles = detailsArticles(demande, demande.lignes, demande.pieces);
  // Lot D : parcours de chaque article (validé, réglé, retour de caisse, régularisé), lecture seule.
  const parcoursArticles = await getParcoursArticles(demande.id, { avecBudget: true });
  const devise = demande.devise === "XOF" ? "FCFA" : demande.devise;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title={`Demande ${demande.reference}`}
        description={`Demande créée le ${demande.createdAt.toLocaleDateString("fr-FR")} par ${demande.createur.fullName} (${demande.createur.service?.name ?? "—"})`}
      />

      <div className="space-y-4 rounded-2xl border border-border bg-surface p-4 shadow-elevated sm:p-6">
        <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Montant demandé</dt>
            <dd className="mt-1 text-2xl font-black tracking-tight text-foreground tabular-nums">
              {Number(demande.montant).toLocaleString("fr-FR")} <span className="text-sm font-bold text-muted-foreground">{devise}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Montant validé</dt>
            <dd className="mt-1 text-base font-bold text-foreground tabular-nums">
              {Number(demande.montantValide ?? 0).toLocaleString("fr-FR")} {devise}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bénéficiaire</dt>
            <dd className="mt-1 text-sm text-foreground">
              {nomBeneficiaireDemande(demande, demande.lignes)}{" "}
              {aPlusieursBeneficiaires(demande, demande.lignes) ? null : (
                <span className="text-muted-foreground">({BENEFICIAIRE_TYPE_LABEL[demande.beneficiaireType]})</span>
              )}
            </dd>
          </div>
          {demande.dateLivraisonSouhaitee ? (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Livraison souhaitée</dt>
              <dd className="mt-1 text-sm text-foreground">{demande.dateLivraisonSouhaitee.toLocaleDateString("fr-FR")}</dd>
            </div>
          ) : null}
          {/* Ancien motif d'en-tête ou description d'une dépense directe ; une demande récente porte un motif par ligne. */}
          {demande.description ? (
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Motif de l&apos;achat</dt>
              <dd className="mt-1 whitespace-pre-line text-sm text-foreground">{demande.description}</dd>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pièces jointes</dt>
            <dd className="mt-1 space-x-3 text-sm text-foreground">
              {vueArticles.communes.length === 0 ? (
                <span className="text-muted-foreground">Aucune pièce jointe.</span>
              ) : (
                vueArticles.communes.map((piece, index) => (
                  <a
                    key={piece.id}
                    href={`/api/treso/pieces-jointes/${piece.id}`}
                    className="text-info underline-offset-4 transition-colors hover:text-primary hover:underline"
                  >
                    Télécharger{vueArticles.communes.length > 1 ? ` (${index + 1})` : ""}
                  </a>
                ))
              )}
            </dd>
          </div>
        </dl>
      </div>

      <FriseCircuit
        demande={{ ...demandeCircuit, soumiseAuDG: demande.soumiseAuDG }}
        niveauRejet={demande.niveauRejet}
        motifRejet={demande.motifRejet}
      />

      {decisionParLigne && demande.lignes.length > 0 ? (
        // Cas b : le DG décide ligne par ligne (même composant que la Finance, sans catégorisation ni libellé).
        <LignesValidationTable
          budget={budgetValidation}
          parDG
          categorisationObligatoire={categorisationObligatoire}
          demandeId={demande.id}
          lignes={demande.lignes.map((l) => ({
            id: l.id,
            details: detailsArticleDe(vueArticles, l.id, parcoursArticles),
            libelle: l.libelle,
            libelleOriginal: l.libelleOriginal,
            motif: l.motif,
            motifOriginal: l.motifOriginal,
            quantite: l.quantite,
            prixUnitaire: Number(l.prixUnitaire),
            statutValidation: l.statutValidation,
            motifRejet: l.motifRejet,
            decideParNom: l.decidePar?.fullName ?? null,
            decideAt: l.decideAt,
            categorieId: l.categorieId,
            categorieLabel: l.categorie?.label ?? null,
            objetId: l.objetId,
            objetLabel: l.objet?.label ?? null,
            motifSoumissionDG: l.motifSoumissionDG,
            motifDecisionDG: l.motifDecisionDG,
          }))}
          enteteDemande={enteteDemande}
          canValider={raisonDecider === null}
          raisonIndisponible={raisonDecider}
          canModifierLibelle={false}
          libelleModifiable={false}
          canCategoriser={false}
          categories={[]}
          objets={[]}
          budgetParCategorie={{}}
        />
      ) : soumissionParLignes ? (
        <DecisionLignesDG
          budget={budgetValidation}
          devise={devise}
          enteteDemande={enteteDemande}
          raisonDecider={raisonIndisponible(demandeCircuit, acteur, "DECIDER_LIGNE_DG")}
          lignes={lignesSoumises.map((l) => ({
            id: l.id,
            details: detailsArticleDe(vueArticles, l.id, parcoursArticles),
            libelle: l.libelle,
            motif: l.motif,
            quantite: l.quantite,
            prixUnitaire: Number(l.prixUnitaire),
            categorieLabel: l.categorie?.label ?? null,
            categorieId: l.categorieId,
            objetLabel: l.objet?.label ?? null,
            decisionDG: l.decisionDG,
            decisionDGParNom: l.decisionDGPar?.fullName ?? null,
            decisionDGAt: l.decisionDGAt,
            motifRefusDG: l.motifRefusDG,
            motifSoumissionDG: l.motifSoumissionDG,
            motifDecisionDG: l.motifDecisionDG,
            soumiseParNom: l.soumiseDGPar?.fullName ?? null,
          }))}
        />
      ) : demande.lignes.length > 0 ? (
        <section aria-label="Articles demandés" className="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-elevated sm:p-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Articles demandés</h2>
          <ul className="divide-y divide-border">
            {demande.lignes.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="text-sm font-medium text-foreground">
                  <EnteteDemandeArticle contexte={enteteDemande} />
                  {l.libelle}
                  <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                    {l.quantite} × {Number(l.prixUnitaire).toLocaleString("fr-FR")} {devise}
                  </span>
                  {l.motif ? (
                    <span data-motif-ligne className="block text-xs font-normal text-muted-foreground">
                      Motif : {l.motif}
                    </span>
                  ) : null}
                  {detailsArticleDe(vueArticles, l.id, parcoursArticles)}
                </span>
                <span className="flex items-center gap-2">
                  {l.statutValidation !== "EN_ATTENTE" ? (
                    <Badge variant={STATUT_LIGNE_DEMANDE_BADGE_VARIANT[l.statutValidation]}>
                      {STATUT_LIGNE_DEMANDE_LABEL[l.statutValidation]}
                    </Badge>
                  ) : null}
                  <span className="text-sm font-bold text-foreground tabular-nums">
                    {(l.quantite * Number(l.prixUnitaire)).toLocaleString("fr-FR")} {devise}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {decisionParLigne && demande.lignes.length === 0 ? (
        // Garde 9 : dépense directe de la Finance pour elle-même, sans lignes — le DG décide le montant.
        <ValidationActions
          parDG
          budget={budgetValidation ? { ...budgetValidation, categorieId: demande.categorieId } : null}
          demandeId={demande.id}
          montantDemande={Number(demande.montant)}
          disabled={raisonDecider !== null}
          raisonIndisponible={raisonDecider}
          // Le DG ne catégorise pas : la Finance renseigne la catégorie avant sa décision.
          raisonValidationIndisponible={
            refusDemandeSansCategorie(demande, categorisationObligatoire) ? `${refusDemandeSansCategorie(demande, categorisationObligatoire)} La catégorie est renseignée par la Finance.` : null
          }
        />
      ) : soumissionParLignes ? null : (
        <DgDecisionActions
          demandeId={demande.id}
          decisionParLigne={decisionParLigne}
          raisonValider={raisonIndisponible(demandeCircuit, acteur, "VALIDER_DG")}
          raisonRejeter={raisonIndisponible(demandeCircuit, acteur, decisionParLigne ? "REJETER" : "REJETER_DG")}
        />
      )}

      <RepriseEtapeSection
        demandeId={demande.id}
        elements={elementsReprise}
        titre="Reprise — renvoyer à l'étape précédente"
        libelleBoutonArticle="Renvoyer à la Finance"
        libelleBoutonDemande="Reprendre"
      />

      <DemandeHistorique demandeId={demande.id} />
    </div>
  );
}
