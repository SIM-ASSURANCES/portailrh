import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { DemandeHistorique } from "@/components/tresorerie/DemandeHistorique";
import { FriseCircuit } from "@/components/tresorerie/FriseCircuit";
import { getSession } from "@/lib/auth";
import {
  BENEFICIAIRE_TYPE_LABEL,
  chargerActeur,
  getBeneficiaireNom,
  prisma,
  raisonIndisponible,
  versDemandeCircuit,
} from "backend";

import { ServiceDecisionActions } from "./ServiceDecisionActions";

/**
 * Demande vue par le responsable du service du demandeur (circuit de validation, commit 4) : lignes, montants,
 * motif, pièces jointes, frise, et la décision de l'étape Service. Accessible au seul responsable ACTUEL du service
 * du demandeur (introuvable pour tout autre compte, sans rien révéler) ; à toute étape, pour suivre la demande —
 * hors de l'étape Service, les boutons sont grisés avec la phrase du moteur. Historique sans les données de gestion
 * interne de la Finance (catégorie, description modifiée), comme pour le demandeur.
 */
export default async function DemandeServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const demande = await prisma.demande.findUnique({
    where: { id },
    include: {
      createur: { select: { fullName: true, service: { select: { name: true, responsableId: true } } } },
      beneficiaireUser: true,
      pieces: true,
      lignes: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!demande || demande.createur.service?.responsableId !== session.user.id) notFound();

  const demandeCircuit = versDemandeCircuit(demande);
  const acteur = await chargerActeur(prisma, session, demande.createurId);
  // La version du demandeur, jamais une description modifiée par la Finance.
  const motif = demande.descriptionDemandeur ?? demande.descriptionOriginale ?? demande.description;

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
              {Number(demande.montant).toLocaleString("fr-FR")}{" "}
              <span className="text-sm font-bold text-muted-foreground">{demande.devise === "XOF" ? "FCFA" : demande.devise}</span>
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
            <dd className="mt-1 whitespace-pre-line text-sm text-foreground">{motif}</dd>
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

      {demande.lignes.length > 0 ? (
        <section aria-label="Articles demandés" className="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-elevated sm:p-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Articles demandés</h2>
          <ul className="divide-y divide-border">
            {demande.lignes.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="text-sm font-medium text-foreground">
                  {l.libelleDemandeur ?? l.libelleOriginal ?? l.libelle}
                  <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                    {l.quantite} × {Number(l.prixUnitaire).toLocaleString("fr-FR")} FCFA
                  </span>
                </span>
                <span className="text-sm font-bold text-foreground tabular-nums">
                  {(l.quantite * Number(l.prixUnitaire)).toLocaleString("fr-FR")} FCFA
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <FriseCircuit
        demande={{ ...demandeCircuit, soumiseAuDG: demande.soumiseAuDG }}
        niveauRejet={demande.niveauRejet}
        motifRejet={demande.motifRejet}
      />

      <ServiceDecisionActions
        demandeId={demande.id}
        raisonValider={raisonIndisponible(demandeCircuit, acteur, "VALIDER_SERVICE")}
        raisonRejeter={raisonIndisponible(demandeCircuit, acteur, "REJETER")}
      />

      <DemandeHistorique demandeId={demande.id} masquerGestionInterne />
    </div>
  );
}
