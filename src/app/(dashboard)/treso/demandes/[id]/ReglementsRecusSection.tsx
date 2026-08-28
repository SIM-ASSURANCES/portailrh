import { Button } from "@/components/ui";
import { prisma } from "@/lib/prisma";

const MODE_LABEL: Record<"CAISSE" | "BANQUE", string> = { CAISSE: "Caisse", BANQUE: "Banque" };

/**
 * Section "Règlements" en lecture seule côté Collaborateur (Ticket 9) —
 * n'existait pas encore sur cet écran (seule `RetoursCaisseSection`, Ticket
 * 5, affichait indirectement les règlements CAISSE confirmés, à des fins de
 * déclaration de retour). Ici : tous les règlements confirmés et non
 * annulés de la demande (Caisse ET Banque), avec le bouton "Télécharger le
 * reçu" pointant vers la même Route Handler que côté Finance
 * (`/api/treso/reglements/[id]/recu`) — le collaborateur créateur de la
 * demande y est autorisé (vérifié côté serveur dans la route elle-même).
 * Server Component autonome, aucune action possible ici (aucun bouton
 * Modifier/Confirmer/Annuler : réservés à Finance).
 */
export async function ReglementsRecusSection({ demandeId }: { demandeId: string }) {
  const reglements = await prisma.reglement.findMany({
    where: { demandeId, estConfirme: true, estAnnule: false },
    orderBy: { createdAt: "asc" },
  });

  if (reglements.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-foreground">Règlements</h2>
      <ul className="space-y-3">
        {reglements.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-4">
            <div>
              <p className="font-medium text-foreground">
                {Number(r.montant).toLocaleString("fr-FR")} FCFA — {MODE_LABEL[r.mode]}
              </p>
              <p className="text-xs text-muted-foreground">
                Réglé le {(r.confirmeAt ?? r.createdAt).toLocaleDateString("fr-FR")}
              </p>
            </div>
            <a href={`/api/treso/reglements/${r.id}/recu`}>
              <Button type="button" variant="secondary">
                Télécharger le reçu
              </Button>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
