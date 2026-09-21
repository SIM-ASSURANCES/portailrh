"use client";

import Link from "next/link";

import { Badge, Button, DataTable } from "@/components/ui";
import { STATUT_DEMANDE_BADGE_VARIANT, STATUT_DEMANDE_LABEL } from "@/components/tresorerie/demandeStatut";
import type { StatutDemande } from "backend";

interface DemandeRow {
  id: string;
  reference: string;
  createurNom: string;
  beneficiaireNom: string;
  montant: number;
  createdAt: Date;
  statut: StatutDemande;
}

/**
 * Wrapper Client Component autour de DataTable — même pattern que
 * `DemandesACategoriserTable.tsx`. Contrairement à cette dernière (une
 * liste de tâches à faire), cette table n'a pas de statut implicite : le
 * statut de chaque ligne est affiché explicitement (badge), jamais déduit
 * du contexte de la page.
 */
export function ToutesLesDemandesTable({ demandes }: { demandes: DemandeRow[] }) {
  return (
    <DataTable
      rowKey={(d) => d.id}
      emptyMessage="Aucune demande ne correspond à ces filtres."
      columns={[
        { key: "reference", header: "Référence", sortable: true, accessor: (d) => d.reference },
        { key: "createurNom", header: "Créateur", sortable: true, accessor: (d) => d.createurNom },
        { key: "beneficiaireNom", header: "Bénéficiaire", sortable: true, accessor: (d) => d.beneficiaireNom },
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
          render: (d) => <Badge variant={STATUT_DEMANDE_BADGE_VARIANT[d.statut]}>{STATUT_DEMANDE_LABEL[d.statut]}</Badge>,
        },
        {
          key: "createdAt",
          header: "Créée le",
          sortable: true,
          accessor: (d) => d.createdAt,
          render: (d) => d.createdAt.toLocaleDateString("fr-FR"),
        },
        {
          key: "actions",
          header: "Actions",
          render: (d) => (
            <Link href={`/treso/finance/demandes/${d.id}`}>
              <Button variant="secondary">Voir le détail</Button>
            </Link>
          ),
        },
      ]}
      data={demandes}
    />
  );
}
