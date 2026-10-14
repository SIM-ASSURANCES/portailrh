"use client";

import Link from "next/link";

import { libelleGestionArticle } from "backend/client";
import type { GestionArticle } from "backend";

import { Badge, Button, DataTable } from "@/components/ui";
import { STATUT_DEMANDE_BADGE_VARIANT, STATUT_DEMANDE_LABEL } from "@/components/tresorerie/demandeStatut";
import type { BadgeVariant } from "@/components/ui";
import type { StatutDemande } from "backend";

interface DemandeRow {
  id: string;
  reference: string;
  createurNom: string;
  beneficiaireNom: string;
  montant: number;
  createdAt: Date;
  /** Lot H : dernier événement de la demande (« Géré le »), `null` si rien n'a encore été traité. */
  gere: GestionArticle | null;
  statut: StatutDemande;
  /** Libellé affiché si différent du statut (lot B : « En cours (x/n traités) »), posé par la page. */
  statutAffiche?: { label: string; variant: BadgeVariant };
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
          render: (d) => <Badge variant={d.statutAffiche?.variant ?? STATUT_DEMANDE_BADGE_VARIANT[d.statut]}>{d.statutAffiche?.label ?? STATUT_DEMANDE_LABEL[d.statut]}</Badge>,
        },
        {
          key: "createdAt",
          header: "Demande créée le",
          sortable: true,
          accessor: (d) => d.createdAt,
          render: (d) => d.createdAt.toLocaleDateString("fr-FR"),
        },
        {
          key: "gereLe",
          header: "Géré le",
          sortable: true,
          accessor: (d) => d.gere?.date ?? null,
          render: (d) => <span data-gere-le>{libelleGestionArticle(d.gere).replace(/^Géré le /, "")}</span>,
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
