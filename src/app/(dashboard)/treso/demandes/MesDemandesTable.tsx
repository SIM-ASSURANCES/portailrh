"use client";

import { Badge, DataTable } from "@/components/ui";
import { STATUT_DEMANDE_BADGE_VARIANT, STATUT_DEMANDE_LABEL } from "@/components/tresorerie/demandeStatut";
import type { StatutDemande } from "@/generated/prisma/client";

interface DemandeRow {
  id: string;
  reference: string;
  description: string;
  montant: number;
  statut: StatutDemande;
  createdAt: Date;
}

function truncate(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Wrapper Client Component autour de DataTable : voir UsersTable.tsx
 * (console admin) pour l'explication — les `columns` (accessor/render sont
 * des fonctions) doivent être construites côté client, pas dans la page
 * Server Component qui ne fournit que les données (sérialisables).
 */
export function MesDemandesTable({ demandes }: { demandes: DemandeRow[] }) {
  return (
    <DataTable
      rowKey={(d) => d.id}
      emptyMessage="Vous n'avez encore créé aucune demande."
      columns={[
        { key: "reference", header: "Référence", sortable: true, accessor: (d) => d.reference },
        {
          key: "description",
          header: "Description",
          render: (d) => truncate(d.description),
        },
        {
          key: "montant",
          header: "Montant",
          sortable: true,
          accessor: (d) => d.montant,
          render: (d) => `${d.montant.toLocaleString("fr-FR")} FCFA`,
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
          key: "createdAt",
          header: "Créée le",
          sortable: true,
          accessor: (d) => d.createdAt,
          render: (d) => d.createdAt.toLocaleDateString("fr-FR"),
        },
      ]}
      data={demandes}
    />
  );
}
