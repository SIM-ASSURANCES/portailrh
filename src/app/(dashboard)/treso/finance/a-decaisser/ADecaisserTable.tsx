"use client";

import Link from "next/link";

import { Button, DataTable } from "@/components/ui";

interface ADecaisserRow {
  id: string;
  reference: string;
  createurNom: string;
  montantValide: number;
  reste: number;
  valideeLe: Date;
}

/**
 * Wrapper Client Component autour de DataTable — voir MesDemandesTable.tsx
 * (Ticket 1) pour l'explication (colonnes avec accessor/render : fonctions
 * non sérialisables entre Server et Client Component).
 */
export function ADecaisserTable({ demandes }: { demandes: ADecaisserRow[] }) {
  return (
    <DataTable
      rowKey={(d) => d.id}
      emptyMessage="Aucune demande à décaisser pour l'instant."
      columns={[
        { key: "reference", header: "Référence", sortable: true, accessor: (d) => d.reference },
        { key: "createurNom", header: "Créateur", sortable: true, accessor: (d) => d.createurNom },
        {
          key: "montantValide",
          header: "Montant validé",
          sortable: true,
          accessor: (d) => d.montantValide,
          render: (d) => `${d.montantValide.toLocaleString("fr-FR")} FCFA`,
        },
        {
          key: "reste",
          header: "Reste à régler",
          sortable: true,
          accessor: (d) => d.reste,
          render: (d) => (
            <span className="font-semibold text-warning">{d.reste.toLocaleString("fr-FR")} FCFA</span>
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
