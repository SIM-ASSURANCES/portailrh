"use client";

import Link from "next/link";

import { Badge, Button, DataTable } from "@/components/ui";
import { STATUT_DEMANDE_BADGE_VARIANT, STATUT_DEMANDE_LABEL } from "@/components/tresorerie/demandeStatut";
import { formatMontantDevise } from "@/components/tresorerie/devise";
import { DepenseDirecteBadge } from "@/components/tresorerie/DepenseDirecteBadge";
import type { NatureDepenseDirecte, StatutDemande, TypeDemande } from "@/generated/prisma/client";

interface DemandeRow {
  id: string;
  reference: string;
  description: string;
  montant: number;
  devise: string;
  statut: StatutDemande;
  createdAt: Date;
  typeDemande: TypeDemande;
  natureDepenseDirecte: NatureDepenseDirecte | null;
  beneficiaireNom: string;
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
        { key: "beneficiaireNom", header: "Bénéficiaire", sortable: true, accessor: (d) => d.beneficiaireNom },
        {
          key: "type",
          header: "Type",
          render: (d) =>
            d.typeDemande === "DEPENSE_DIRECTE" && d.natureDepenseDirecte ? (
              <DepenseDirecteBadge nature={d.natureDepenseDirecte} />
            ) : (
              "—"
            ),
        },
        {
          key: "montant",
          header: "Montant",
          sortable: true,
          accessor: (d) => d.montant,
          render: (d) => formatMontantDevise(d.montant, d.devise),
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
        {
          key: "actions",
          header: "Actions",
          render: (d) => (
            <Link href={`/treso/demandes/${d.id}`}>
              <Button variant="secondary">Voir</Button>
            </Link>
          ),
        },
      ]}
      data={demandes}
    />
  );
}
