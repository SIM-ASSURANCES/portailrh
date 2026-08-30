"use client";

import Link from "next/link";

import { Button, DataTable } from "@/components/ui";

interface FondsARegulariserRow {
  id: string;
  demandeId: string;
  demandeReference: string;
  montantReglement: number;
  depensesDeclarees: number;
  retoursRecus: number;
  solde: number;
}

/**
 * Wrapper Client Component autour de DataTable — voir MesDemandesTable.tsx
 * (Ticket 1) pour l'explication (colonnes avec accessor/render : fonctions
 * non sérialisables entre Server et Client Component).
 */
export function FondsARegulariserTable({ reglements }: { reglements: FondsARegulariserRow[] }) {
  return (
    <DataTable
      rowKey={(r) => r.id}
      emptyMessage="Aucun fonds remis à régulariser pour l'instant."
      columns={[
        {
          key: "demandeReference",
          header: "Demande",
          sortable: true,
          accessor: (r) => r.demandeReference,
        },
        {
          key: "montantReglement",
          header: "Montant réglé (Caisse)",
          sortable: true,
          accessor: (r) => r.montantReglement,
          render: (r) => `${r.montantReglement.toLocaleString("fr-FR")} FCFA`,
        },
        {
          key: "depensesDeclarees",
          header: "Dépenses déclarées",
          sortable: true,
          accessor: (r) => r.depensesDeclarees,
          render: (r) => `${r.depensesDeclarees.toLocaleString("fr-FR")} FCFA`,
        },
        {
          key: "retoursRecus",
          header: "Retours reçus",
          sortable: true,
          accessor: (r) => r.retoursRecus,
          render: (r) => `${r.retoursRecus.toLocaleString("fr-FR")} FCFA`,
        },
        {
          key: "solde",
          header: "Solde à régulariser",
          sortable: true,
          accessor: (r) => r.solde,
          render: (r) => (
            <span className="font-semibold text-warning">{r.solde.toLocaleString("fr-FR")} FCFA</span>
          ),
        },
        {
          key: "actions",
          header: "Actions",
          render: (r) => (
            <Link href={`/treso/finance/demandes/${r.demandeId}`}>
              <Button variant="secondary">Voir la demande</Button>
            </Link>
          ),
        },
      ]}
      data={reglements}
    />
  );
}
