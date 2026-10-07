"use client";

import Link from "next/link";

import { Button, DataTable } from "@/components/ui";

interface DemandeDGRow {
  id: string;
  reference: string;
  demandeur: string;
  service: string;
  montant: number;
  motif: string;
  /** ISO : sérialisable du Server Component vers ce Client Component. */
  createdAt: string;
}

function tronquer(texte: string, max = 60): string {
  return texte.length > max ? `${texte.slice(0, max - 1)}…` : texte;
}

/** Liste des demandes à l'étape DG (wrapper Client de DataTable, voir DemandesACategoriserTable.tsx). */
export function DemandesDGTable({ demandes, emptyMessage }: { demandes: DemandeDGRow[]; emptyMessage: string }) {
  return (
    <DataTable
      rowKey={(d) => d.id}
      emptyMessage={emptyMessage}
      columns={[
        { key: "reference", header: "Référence", sortable: true, accessor: (d) => d.reference },
        { key: "demandeur", header: "Demandeur", sortable: true, accessor: (d) => d.demandeur },
        { key: "service", header: "Service", accessor: (d) => d.service },
        {
          key: "montant",
          header: "Montant",
          sortable: true,
          accessor: (d) => d.montant,
          render: (d) => <span className="tabular-nums">{d.montant.toLocaleString("fr-FR")} FCFA</span>,
        },
        { key: "motif", header: "Motif", render: (d) => tronquer(d.motif) },
        {
          key: "createdAt",
          header: "Créée le",
          sortable: true,
          accessor: (d) => d.createdAt,
          render: (d) => new Date(d.createdAt).toLocaleDateString("fr-FR"),
        },
        {
          key: "actions",
          header: "Actions",
          render: (d) => (
            <Link href={`/treso/dg/${d.id}`}>
              <Button variant="secondary">Examiner</Button>
            </Link>
          ),
        },
      ]}
      data={demandes}
    />
  );
}
