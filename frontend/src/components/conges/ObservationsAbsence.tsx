import type { ReactNode } from "react";

import { Badge, Card } from "@/components/ui";
import { frDateHeure } from "@/lib/conges/format";
import { LIBELLE_ETAPE_OBSERVATION, type EtapeObservation } from "backend";

export interface ObservationAffichee {
  id: string;
  etape: EtapeObservation;
  texte: string;
  createdAt: Date;
  auteurNom: string;
}

const VARIANTE_ETAPE: Record<EtapeObservation, "neutral" | "info" | "warning"> = {
  RESPONSABLE: "neutral",
  RH: "info",
  DG: "warning",
};

/**
 * Observations d'une demande (congé ou permission d'absence), de la plus ancienne à la plus récente, avec le nom de
 * l'auteur et l'étape. Visibles de tous ceux qui voient la demande, demandeur compris. AJOUT SEUL : aucun bouton de
 * modification ni de suppression n'existe. `formulaire` : le formulaire du DG, seulement pour qui peut observer.
 */
export function ObservationsAbsence({ observations, formulaire }: { observations: ObservationAffichee[]; formulaire?: ReactNode }) {
  if (observations.length === 0 && !formulaire) return null;
  return (
    <section aria-label="Observations" data-section="observations" className="space-y-3">
      <h2 className="text-base font-bold text-foreground">Observations</h2>
      {observations.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune observation pour l&apos;instant.</p>
      ) : (
        <ul className="space-y-2">
          {observations.map((o) => (
            <li key={o.id} data-observation={o.etape}>
              <Card className="space-y-1 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={VARIANTE_ETAPE[o.etape]}>{LIBELLE_ETAPE_OBSERVATION[o.etape]}</Badge>
                  <span className="text-sm font-semibold text-foreground">{o.auteurNom}</span>
                  <span className="text-xs text-muted-foreground">{frDateHeure(o.createdAt)}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-foreground">{o.texte}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {formulaire}
    </section>
  );
}
