"use client";

import Link from "next/link";

import { Button, DataTable } from "@/components/ui";

interface DepenseNonJustifieeRow {
  id: string;
  demandeId: string;
  demandeReference: string;
  objet: string;
  montant: number;
  date: Date;
  commentaire: string | null;
}

function truncate(text: string, max = 50): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Wrapper Client Component autour de DataTable — voir MesDemandesTable.tsx
 * (Ticket 1) pour l'explication (colonnes avec accessor/render : fonctions
 * non sérialisables entre Server et Client Component).
 */
export function DepensesNonJustifieesTable({ lignes }: { lignes: DepenseNonJustifieeRow[] }) {
  return (
    <DataTable
      rowKey={(l) => l.id}
      emptyMessage="Aucune dépense non justifiée à suivre pour l'instant."
      columns={[
        { key: "demandeReference", header: "Demande", sortable: true, accessor: (l) => l.demandeReference },
        { key: "objet", header: "Objet de la dépense", render: (l) => truncate(l.objet) },
        {
          key: "montant",
          header: "Montant",
          sortable: true,
          accessor: (l) => l.montant,
          render: (l) => <span className="font-semibold text-warning">{l.montant.toLocaleString("fr-FR")} FCFA</span>,
        },
        {
          key: "date",
          header: "Date de la dépense",
          sortable: true,
          accessor: (l) => l.date,
          render: (l) => l.date.toLocaleDateString("fr-FR"),
        },
        {
          key: "commentaire",
          header: "Commentaire",
          render: (l) => (l.commentaire ? truncate(l.commentaire) : "—"),
        },
        {
          key: "actions",
          header: "Actions",
          render: (l) => (
            <Link href={`/treso/finance/demandes/${l.demandeId}`}>
              <Button variant="secondary">Voir la demande</Button>
            </Link>
          ),
        },
      ]}
      data={lignes}
    />
  );
}
