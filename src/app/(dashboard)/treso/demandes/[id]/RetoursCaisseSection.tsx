import { prisma } from "@/lib/prisma";

import { RetourCaisseRow } from "./RetourCaisseRow";

/**
 * Section "Retours de caisse" : un règlement CAISSE confirmé et non annulé
 * de la demande = une ligne éligible à un retour. Rien n'est affiché si la
 * demande n'a aucun règlement de ce type (les règlements BANQUE ne donnent
 * jamais lieu à un retour de caisse). Server Component autonome : ne prend
 * que l'id de la demande.
 */
export async function RetoursCaisseSection({ demandeId }: { demandeId: string }) {
  const reglements = await prisma.reglement.findMany({
    where: { demandeId, mode: "CAISSE", estConfirme: true, estAnnule: false },
    include: { retours: true },
    orderBy: { createdAt: "asc" },
  });

  if (reglements.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-foreground">Retours de caisse</h2>
      <ul className="space-y-3">
        {reglements.map((r) => (
          <RetourCaisseRow
            key={r.id}
            reglementId={r.id}
            montant={Number(r.montant)}
            retour={r.retours[0] ? { estReceptionne: r.retours[0].estReceptionne } : null}
          />
        ))}
      </ul>
    </div>
  );
}
