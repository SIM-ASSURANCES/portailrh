"use client";

import Link from "next/link";

import { Button, DataTable } from "@/components/ui";

interface ReglementPartielRow {
  id: string;
  reference: string;
  createurNom: string;
  montantValide: number;
  totalRegle: number;
  reste: number;
  valideeLe: Date;
}

/**
 * Wrapper Client Component autour de DataTable — voir MesDemandesTable.tsx
 * (Ticket 1) pour l'explication (colonnes avec accessor/render : fonctions
 * non sérialisables entre Server et Client Component).
 */
export function ReglementsPartielsTable({ demandes }: { demandes: ReglementPartielRow[] }) {
  return (
    <DataTable
      rowKey={(d) => d.id}
      emptyMessage="Aucun règlement partiel à compléter pour l'instant."
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
          key: "totalRegle",
          header: "Déjà réglé",
          sortable: true,
          accessor: (d) => d.totalRegle,
          render: (d) => `${d.totalRegle.toLocaleString("fr-FR")} FCFA`,
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
