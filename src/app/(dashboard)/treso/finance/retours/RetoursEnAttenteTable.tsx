"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, DataTable } from "@/components/ui";
import { JUSTIFICATION_LABEL } from "@/components/tresorerie/justification";
import type { ModeReglement, TypeJustification } from "@/generated/prisma/client";

import { receptionnerRetourAction } from "./retourActions";

interface RetourRow {
  id: string;
  demandeReference: string;
  declarantNom: string;
  reglementMontant: number;
  reglementMode: ModeReglement;
  montantDepense: number;
  montantARetourner: number;
  justification: TypeJustification;
  commentaire: string | null;
  createdAt: Date;
}

function truncate(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Wrapper Client Component autour de DataTable — voir MesDemandesTable.tsx
 * (Ticket 1) pour l'explication (colonnes avec accessor/render : fonctions
 * non sérialisables entre Server et Client Component).
 *
 * `receptionnerRetourAction` est appelée directement (comme
 * `confirmerReglementAction` au Ticket 4), pas via `<form action={...}>` :
 * pas de champ à valider, juste un identifiant. La ligne réceptionnée
 * disparaît immédiatement de cette liste après succès, puisqu'elle n'est
 * plus `estReceptionne: false` (revalidatePath sur cette page).
 */
export function RetoursEnAttenteTable({ retours }: { retours: RetourRow[] }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleReceptionner(id: string) {
    setPendingId(id);
    startTransition(async () => {
      const result = await receptionnerRetourAction(id);
      if (result.status === "success") {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
      setPendingId(null);
    });
  }

  return (
    <DataTable
      rowKey={(r) => r.id}
      emptyMessage="Aucun retour de caisse en attente de réception."
      columns={[
        { key: "demandeReference", header: "Demande", sortable: true, accessor: (r) => r.demandeReference },
        { key: "declarantNom", header: "Collaborateur", sortable: true, accessor: (r) => r.declarantNom },
        {
          key: "reglement",
          header: "Règlement d'origine",
          render: (r) => `${r.reglementMontant.toLocaleString("fr-FR")} FCFA (${r.reglementMode})`,
        },
        {
          key: "montantDepense",
          header: "Montant dépensé",
          sortable: true,
          accessor: (r) => r.montantDepense,
          render: (r) => `${r.montantDepense.toLocaleString("fr-FR")} FCFA`,
        },
        {
          key: "montantARetourner",
          header: "À retourner",
          sortable: true,
          accessor: (r) => r.montantARetourner,
          render: (r) => `${r.montantARetourner.toLocaleString("fr-FR")} FCFA`,
        },
        {
          key: "justification",
          header: "Justification",
          render: (r) => JUSTIFICATION_LABEL[r.justification],
        },
        {
          key: "commentaire",
          header: "Commentaire",
          render: (r) => (r.commentaire ? truncate(r.commentaire) : "—"),
        },
        {
          key: "createdAt",
          header: "Déclaré le",
          sortable: true,
          accessor: (r) => r.createdAt,
          render: (r) => r.createdAt.toLocaleDateString("fr-FR"),
        },
        {
          key: "actions",
          header: "Actions",
          render: (r) => (
            <Button
              type="button"
              loading={pendingId === r.id}
              onClick={() => handleReceptionner(r.id)}
            >
              Réceptionner
            </Button>
          ),
        },
      ]}
      data={retours}
    />
  );
}
