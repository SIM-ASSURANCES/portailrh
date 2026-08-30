import { Badge } from "@/components/ui";
import type { NatureDepenseDirecte } from "@/generated/prisma/client";

import { NATURE_DEPENSE_DIRECTE_LABEL } from "./depenseDirecte";

/**
 * Badge "Dépense directe" + sa nature (Phase F) — affiché sur les listes
 * et détails partout où une Demande peut être `typeDemande = DEPENSE_DIRECTE`.
 * Rien n'est rendu pour une demande `STANDARD` (le cas normal, largement
 * majoritaire, ne doit pas être surchargé d'un badge).
 */
export function DepenseDirecteBadge({ nature }: { nature: NatureDepenseDirecte }) {
  return <Badge variant="info">Dépense directe — {NATURE_DEPENSE_DIRECTE_LABEL[nature]}</Badge>;
}
