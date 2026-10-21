"use client";

import Link from "next/link";

import { libelleGestionArticle } from "backend/client";
import type { GestionArticle } from "backend";

import { Badge, Button, DataTable } from "@/components/ui";
import { STATUT_DEMANDE_BADGE_VARIANT, STATUT_DEMANDE_LABEL } from "@/components/tresorerie/demandeStatut";
import type { BadgeVariant } from "@/components/ui";
import { formatMontantDevise } from "@/components/tresorerie/devise";
import { DepenseDirecteBadge } from "@/components/tresorerie/DepenseDirecteBadge";
import type { NatureDepenseDirecte, StatutDemande, TypeDemande } from "backend";

interface DemandeRow {
  id: string;
  reference: string;
  description: string;
  montant: number;
  devise: string;
  statut: StatutDemande;
  /** Libellé affiché si différent du statut (lot B : « En cours (x/n traités) »), posé par la page. */
  statutAffiche?: { label: string; variant: BadgeVariant };
  createdAt: Date;
  /** Lot H : dernier événement de la demande (« Géré le »), `null` si rien n'a encore été traité. */
  gere: GestionArticle | null;
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
            <Badge variant={d.statutAffiche?.variant ?? STATUT_DEMANDE_BADGE_VARIANT[d.statut]}>
              {d.statutAffiche?.label ?? STATUT_DEMANDE_LABEL[d.statut]}
            </Badge>
          ),
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
