"use client";

import Link from "next/link";

import { Button, DataTable } from "@/components/ui";

interface ARegulariserRow {
  id: string;
  reference: string;
  createurNom: string;
  totalRegle: number;
  valideeLe: Date;
  ecart: number;
}

/**
 * Wrapper Client Component autour de DataTable — voir MesDemandesTable.tsx
 * (Ticket 1) pour l'explication (colonnes avec accessor/render : fonctions
 * non sérialisables entre Server et Client Component).
 */
export function ARegulariserTable({ demandes }: { demandes: ARegulariserRow[] }) {
  return (
    <DataTable
      rowKey={(d) => d.id}
      emptyMessage="Aucun décaissement à régulariser pour l'instant."
      columns={[
        { key: "reference", header: "Référence", sortable: true, accessor: (d) => d.reference },
        { key: "createurNom", header: "Créateur", sortable: true, accessor: (d) => d.createurNom },
        {
          key: "totalRegle",
          header: "Montant décaissé",
          sortable: true,
          accessor: (d) => d.totalRegle,
          render: (d) => `${d.totalRegle.toLocaleString("fr-FR")} FCFA`,
        },
        {
          key: "ecart",
          header: "Écart",
          sortable: true,
          accessor: (d) => d.ecart,
          render: (d) =>
            d.ecart === 0 ? (
              <span className="text-success">0 FCFA</span>
            ) : (
              <span className="font-semibold text-warning">{d.ecart.toLocaleString("fr-FR")} FCFA</span>
            ),
        },
        {
          key: "valideeLe",
          header: "Validée le",
          sortable: true,
          accessor: (d) => d.valideeLe,
          render: (d) => d.valideeLe.toLocaleDateString("fr-FR"),
        },
        {
          key: "actions",
          header: "Actions",
          render: (d) => (
            <Link href={`/treso/finance/demandes/${d.id}`}>
              <Button variant="secondary">Voir</Button>
            </Link>
          ),
        },
      ]}
      data={demandes}
    />
  );
}
