import Link from "next/link";

import { Badge, Button } from "@/components/ui";
import { prisma } from "backend";

import { RetourAssistantTrigger } from "./RetourAssistantTrigger";

/**
 * Section "Retours de caisse" côté écran Finance/DG (Tâche "L'Assistant
 * Finance déclare les dépenses sur toute demande, retour ou pas" + Tâche
 * "Réouverture exceptionnelle post-clôture", voir CLAUDE.md) — affichée
 * pour TOUT statut de demande (y compris `CLOTUREE`, la seule branche qui
 * a réellement besoin de cette section, puisque son écran n'affiche
 * normalement plus aucune action) : rien à afficher si la demande n'a
 * aucun règlement Caisse confirmé, jamais un bloc vide.
 *
 * Pour chaque règlement Caisse confirmé : la liste de ses retours déjà
 * créés (lien "Voir le détail" vers `/treso/finance/retours/[id]`, où se
 * trouve désormais la seule action "Réceptionner" — voir CLAUDE.md "Écran
 * 'Voir' avant 'Réceptionner'"), puis, si `canDeclarerAssistant`
 * (`treso.receptionner_retour`) ET qu'aucun retour n'est déjà en attente
 * de réception sur ce règlement, le déclencheur permettant à l'Assistant
 * de déclarer lui-même la répartition des dépenses. `motifReouvertureRequis`
 * (= `demandeEstCloturee`) impose alors le motif obligatoire de la Tâche
 * "Réouverture exceptionnelle".
 */
export async function RetoursCaisseFinanceSection({
  demandeId,
  demandeEstCloturee,
  canDeclarerAssistant,
}: {
  demandeId: string;
  demandeEstCloturee: boolean;
  canDeclarerAssistant: boolean;
}) {
  const reglements = await prisma.reglement.findMany({
    where: { demandeId, estConfirme: true, estAnnule: false },
    include: { retours: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "asc" },
  });

  if (reglements.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-foreground">Retours de caisse</h2>
      <ul className="space-y-4">
        {reglements.map((r) => {
          const aUnRetourEnAttente = r.retours.some((retour) => !retour.estReceptionne);
          return (
            <li key={r.id} className="space-y-3 rounded-md border border-border p-3">
              <p className="text-sm font-medium text-foreground">
                {Number(r.montant).toLocaleString("fr-FR")} FCFA — {r.mode === "BANQUE" ? "Banque" : "Caisse"}
              </p>
              {r.retours.length > 0 ? (
                <ul className="space-y-2">
                  {r.retours.map((retour) => (
                    <li key={retour.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted p-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={retour.estReceptionne ? "success" : "warning"}>
                          {retour.estReceptionne ? "Réceptionné" : "En attente de réception"}
                        </Badge>
                        {retour.creeParAssistant ? <Badge variant="info">Assistant Finance</Badge> : null}
                      </div>
                      <Link href={`/treso/finance/retours/${retour.id}`}>
                        <Button type="button" variant="secondary">
                          Voir le détail
                        </Button>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Aucun retour déclaré pour l&apos;instant.</p>
              )}
              {!aUnRetourEnAttente && canDeclarerAssistant ? (
                <RetourAssistantTrigger
                  reglementId={r.id}
                  montantReglement={Number(r.montant)}
                  motifReouvertureRequis={demandeEstCloturee}
                  modeReglement={r.mode}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
