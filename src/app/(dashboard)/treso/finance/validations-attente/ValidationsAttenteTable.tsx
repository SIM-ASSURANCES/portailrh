"use client";

import Link from "next/link";

import { Badge, Button, DataTable } from "@/components/ui";
import { STATUT_DEMANDE_BADGE_VARIANT, STATUT_DEMANDE_LABEL } from "@/components/tresorerie/demandeStatut";
import type { StatutDemande } from "@/generated/prisma/client";

interface ValidationAttenteRow {
  id: string;
  reference: string;
  beneficiaire: string;
  montantValide: number;
  statut: StatutDemande;
  derniereValidation: Date | null;
}

/**
 * Wrapper Client Component autour de DataTable — voir MesDemandesTable.tsx
 * (Ticket 1) pour l'explication (colonnes avec accessor/render : fonctions
 * non sérialisables entre Server et Client Component).
 */
export function ValidationsAttenteTable({ demandes }: { demandes: ValidationAttenteRow[] }) {
  return (
    <DataTable
      rowKey={(d) => d.id}
      emptyMessage="Aucune validation complète en attente pour l'instant."
      columns={[
        {
          key: "reference",
          header: "Référence",
          sortable: true,
          accessor: (d) => d.reference,
        },
        {
          key: "beneficiaire",
          header: "Bénéficiaire",
          sortable: true,
          accessor: (d) => d.beneficiaire,
        },
        {
          key: "montantValide",
          header: "Montant validé",
          sortable: true,
          accessor: (d) => d.montantValide,
          render: (d) => `${d.montantValide.toLocaleString("fr-FR")} FCFA`,
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
          key: "derniereValidation",
          header: "Dernière validation",
          sortable: true,
          accessor: (d) => d.derniereValidation?.getTime() ?? 0,
          render: (d) => (d.derniereValidation ? d.derniereValidation.toLocaleDateString("fr-FR") : "—"),
        },
        {
          key: "actions",
          header: "Actions",
          render: (d) => (
            <Link href={`/treso/finance/demandes/${d.id}`}>
              <Button variant="secondary">Approuver</Button>
            </Link>
          ),
        },
      ]}
      data={demandes}
    />
  );
}
