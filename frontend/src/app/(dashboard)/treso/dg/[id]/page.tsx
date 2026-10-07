import { notFound, redirect } from "next/navigation";

import { Badge, PageHeader } from "@/components/ui";
import { DemandeHistorique } from "@/components/tresorerie/DemandeHistorique";
import { FriseCircuit } from "@/components/tresorerie/FriseCircuit";
import {
  STATUT_LIGNE_DEMANDE_BADGE_VARIANT,
  STATUT_LIGNE_DEMANDE_LABEL,
} from "@/components/tresorerie/demandeStatut";
import { getSession, hasPermission } from "@/lib/auth";
import {
  BENEFICIAIRE_TYPE_LABEL,
  chargerActeur,
  getBeneficiaireNom,
  prisma,
  raisonIndisponible,
  versDemandeCircuit,
} from "backend";

import { LignesValidationTable } from "../../finance/demandes/[id]/LignesValidationTable";
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
      lignes: { orderBy: { createdAt: "asc" }, include: { decidePar: true, categorie: true, objet: true } },
    },
  });
  if (!demande) notFound();

  const demandeCircuit = versDemandeCircuit(demande);
  const acteur = await chargerActeur(prisma, session, demande.createurId);
  const decisionParLigne = demande.modeEtapeDG === "OBLIGATOIRE";
  const raisonDecider = raisonIndisponible(demandeCircuit, acteur, "DECIDER_LIGNES");
  const devise = demande.devise === "XOF" ? "FCFA" : demande.devise;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title={`Demande ${demande.reference}`}
        description={`Créée par ${demande.createur.fullName} (${demande.createur.service?.name ?? "—"}) le ${demande.createdAt.toLocaleDateString("fr-FR")}`}
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
              {getBeneficiaireNom(demande)}{" "}
              <span className="text-muted-foreground">({BENEFICIAIRE_TYPE_LABEL[demande.beneficiaireType]})</span>
            </dd>
          </div>
          {demande.dateLivraisonSouhaitee ? (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Livraison souhaitée</dt>
              <dd className="mt-1 text-sm text-foreground">{demande.dateLivraisonSouhaitee.toLocaleDateString("fr-FR")}</dd>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Motif de l&apos;achat</dt>
            <dd className="mt-1 whitespace-pre-line text-sm text-foreground">{demande.description}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pièces jointes</dt>
            <dd className="mt-1 space-x-3 text-sm text-foreground">
              {demande.pieces.length === 0 ? (
                <span className="text-muted-foreground">Aucune pièce jointe.</span>
              ) : (
                demande.pieces.map((piece, index) => (
                  <a
                    key={piece.id}
                    href={`/api/treso/pieces-jointes/${piece.id}`}
                    className="text-info underline-offset-4 transition-colors hover:text-primary hover:underline"
                  >
                    Télécharger{demande.pieces.length > 1 ? ` (${index + 1})` : ""}
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
          demandeId={demande.id}
          lignes={demande.lignes.map((l) => ({
            id: l.id,
            libelle: l.libelle,
            libelleOriginal: l.libelleOriginal,
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
          }))}
          canValider={raisonDecider === null}
          raisonIndisponible={raisonDecider}
          canModifierLibelle={false}
          libelleModifiable={false}
          canCategoriser={false}
          categories={[]}
          objets={[]}
          budgetParCategorie={{}}
        />
      ) : demande.lignes.length > 0 ? (
        <section aria-label="Articles demandés" className="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-elevated sm:p-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Articles demandés</h2>
          <ul className="divide-y divide-border">
            {demande.lignes.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="text-sm font-medium text-foreground">
                  {l.libelle}
                  <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                    {l.quantite} × {Number(l.prixUnitaire).toLocaleString("fr-FR")} {devise}
                  </span>
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

      <DgDecisionActions
        demandeId={demande.id}
        decisionParLigne={decisionParLigne}
        raisonValider={raisonIndisponible(demandeCircuit, acteur, "VALIDER_DG")}
        raisonRejeter={raisonIndisponible(demandeCircuit, acteur, decisionParLigne ? "REJETER" : "REJETER_DG")}
      />

      <DemandeHistorique demandeId={demande.id} />
    </div>
  );
}
