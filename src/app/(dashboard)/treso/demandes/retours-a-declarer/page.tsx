import Link from "next/link";
import { redirect } from "next/navigation";

import { Button, EmptyState, PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { getReglementsCaisseADeclarer } from "@/lib/tresorerie";

/**
 * Liste des règlements Caisse de l'utilisateur connecté encore en attente
 * d'un retour de caisse déclaré ("Mon tableau de bord", carte "Mes retours
 * de caisse à déclarer" — voir CLAUDE.md). Cible uniquement quand il y en a
 * **plusieurs** : avec un seul, la carte mène directement à la demande
 * concernée (`treso/tableau-de-bord/page.tsx`) — cet écran-ci reste
 * accessible dans tous les cas (y compris à 0, `EmptyState`).
 *
 * Pas de formulaire de déclaration ici : chaque ligne renvoie vers le
 * détail de sa demande (`RetoursCaisseSection`, Ticket 5), seul endroit où
 * l'action "Déclarer un retour de caisse" existe réellement — cet écran ne
 * duplique jamais cette logique, il se contente d'aider à localiser le bon
 * règlement quand plusieurs sont en attente simultanément.
 *
 * Pas de `DataTable` : liste courte et rare (un Collaborateur avec plus
 * d'un règlement Caisse en attente de déclaration au même moment reste un
 * cas limite), une liste de cartes simple suffit — même principe que
 * `RetoursCaisseSection` (Ticket 5), pas besoin de tri/pagination pour ce
 * volume.
 */
export default async function RetoursADeclarerPage() {
  const session = await getSession();
  if (
    !session ||
    !(hasPermission(session, "treso.creer_demande") || hasPermission(session, "treso.declarer_retour"))
  ) {
    redirect("/?error=acces_refuse_demandes");
  }

  const reglements = await getReglementsCaisseADeclarer(session.user.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Mes retours de caisse à déclarer"
        description="Règlements Caisse dont vous devez encore déclarer l'usage des fonds remis."
      />

      {reglements.length === 0 ? (
        <EmptyState icon="rotate-ccw" message="Aucun retour de caisse à déclarer pour le moment." />
      ) : (
        <ul className="space-y-3">
          {reglements.map((r) => (
            <li
              key={r.reglementId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4"
            >
              <div>
                <p className="font-medium text-foreground">{r.reference}</p>
                <p className="text-sm text-muted-foreground">
                  {r.montant.toLocaleString("fr-FR")} FCFA — Caisse
                  {r.confirmeAt ? ` — réglé le ${r.confirmeAt.toLocaleDateString("fr-FR")}` : ""}
                </p>
              </div>
              <Link href={`/treso/demandes/${r.demandeId}`}>
                <Button>Déclarer un retour de caisse</Button>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
