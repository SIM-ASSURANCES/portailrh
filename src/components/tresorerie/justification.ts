import type { TypeJustification } from "@/generated/prisma/client";

/**
 * Libellés humains de `TypeJustification`, partagés entre le formulaire de
 * déclaration (`RetourCaisseForm`, Ticket 5) et la liste "Retours en
 * attente" côté Finance (Ticket 6) — même principe que
 * `demandeStatut.ts` pour `StatutDemande`.
 */
export const JUSTIFICATION_LABEL: Record<TypeJustification, string> = {
  FACTURE: "Facture",
  RECU: "Reçu",
  TICKET: "Ticket",
  SANS_PIECE: "Dépense sans pièce formelle",
};

export const JUSTIFICATION_OPTIONS = (
  Object.entries(JUSTIFICATION_LABEL) as [TypeJustification, string][]
).map(([value, label]) => ({ value, label }));
