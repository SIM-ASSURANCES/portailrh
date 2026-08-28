"use client";

import Link from "next/link";

import { Badge, Button, DataTable } from "@/components/ui";
import { STATUT_DEMANDE_BADGE_VARIANT, STATUT_DEMANDE_LABEL } from "@/components/tresorerie/demandeStatut";
import type { StatutDemande } from "@/generated/prisma/client";

interface DemandeRow {
  id: string;
  reference: string;
  createurNom: string;
  montant: number;
  description: string;
  createdAt: Date;
  statut: StatutDemande;
}

function truncate(text: string, max = 50): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Wrapper Client Component autour de DataTable — voir UsersTable.tsx
 * (console admin) ou MesDemandesTable.tsx (Ticket 1) pour l'explication.
 */
export function DemandesACategoriserTable({ demandes }: { demandes: DemandeRow[] }) {
  return (
    <DataTable
      rowKey={(d) => d.id}
      emptyMessage="Aucune demande en attente de catégorisation."
      columns={[
        { key: "reference", header: "Référence", sortable: true, accessor: (d) => d.reference },
        { key: "createurNom", header: "Créateur", sortable: true, accessor: (d) => d.createurNom },
        {
          key: "montant",
          header: "Montant",
          sortable: true,
          accessor: (d) => d.montant,
          render: (d) => `${d.montant.toLocaleString("fr-FR")} FCFA`,
        },
        { key: "description", header: "Description", render: (d) => truncate(d.description) },
        {
          key: "createdAt",
          header: "Créée le",
          sortable: true,
          accessor: (d) => d.createdAt,
          render: (d) => d.createdAt.toLocaleDateString("fr-FR"),
        },
        {
          key: "statut",
          header: "Statut",
          render: (d) => (
            <Badge variant={STATUT_DEMANDE_BADGE_VARIANT[d.statut]}>
              {STATUT_DEMANDE_LABEL[d.statut]}
            </Badge>
          ),
        },
        {
          key: "actions",
          header: "Actions",
          render: (d) => (
            <Link href={`/treso/finance/demandes/${d.id}`}>
              <Button variant="secondary">Catégoriser</Button>
            </Link>
          ),
        },
      ]}
      data={demandes}
    />
  );
}
