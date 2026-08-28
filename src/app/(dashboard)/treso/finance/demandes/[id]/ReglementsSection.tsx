import { getResteARegler, getTotalRegle } from "@/lib/tresorerie";
import { prisma } from "@/lib/prisma";

import { ReglementForm } from "./ReglementForm";
import { ReglementRow } from "./ReglementRow";

/**
 * Section "Règlements" d'une demande VALIDEE : montant validé / total réglé
 * / reste à régler, liste des règlements (brouillon/confirmé/annulé), et le
 * formulaire d'ajout si l'utilisateur a `treso.effectuer_reglement` et qu'il
 * reste quelque chose à régler. Server Component autonome : requête
 * lui-même règlements + totaux à partir du seul id de la demande.
 */
export async function ReglementsSection({
  demandeId,
  montantDemande,
  canEffectuerReglement,
}: {
  demandeId: string;
  montantDemande: number;
  canEffectuerReglement: boolean;
}) {
  const [reglements, totalRegle, resteARegler] = await Promise.all([
    prisma.reglement.findMany({
      where: { demandeId },
      include: { auteur: true },
      orderBy: { createdAt: "asc" },
    }),
    getTotalRegle(demandeId),
    getResteARegler(demandeId),
  ]);

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-foreground">Règlements</h2>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Montant validé
          </dt>
          <dd className="text-sm font-semibold text-foreground">
            {montantDemande.toLocaleString("fr-FR")} FCFA
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Total réglé
          </dt>
          <dd className="text-sm font-semibold text-foreground">
            {totalRegle.toLocaleString("fr-FR")} FCFA
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Reste à régler
          </dt>
          <dd className={`text-sm font-semibold ${resteARegler > 0 ? "text-warning" : "text-success"}`}>
            {resteARegler.toLocaleString("fr-FR")} FCFA
          </dd>
        </div>
      </dl>

      {reglements.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun règlement pour l&apos;instant.</p>
      ) : (
        <ul className="space-y-3">
          {reglements.map((r) => (
            <ReglementRow
              key={r.id}
              canEffectuerReglement={canEffectuerReglement}
              reglement={{
                id: r.id,
                montant: Number(r.montant),
                mode: r.mode,
                estConfirme: r.estConfirme,
                estAnnule: r.estAnnule,
                motifAnnulation: r.motifAnnulation,
                auteurNom: r.auteur.fullName,
                createdAt: r.createdAt,
              }}
            />
          ))}
        </ul>
      )}

      {canEffectuerReglement && resteARegler > 0 ? (
        <ReglementForm demandeId={demandeId} resteARegler={resteARegler} />
      ) : null}
    </div>
  );
}
