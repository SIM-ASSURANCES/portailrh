"use client";

import Link from "next/link";

import { STATUT_ENCAISSEMENT } from "@/components/encaissements/libelles";
import { Badge, DataTable } from "@/components/ui";

/** Valeurs déjà mises en forme côté serveur (dates, mode en clair, montant), sauf les clés de tri. */
export interface EncaissementRow {
  id: string;
  paiementId: string;
  datePaiementIso: string;
  datePaiement: string;
  mode: string;
  reference: string | null;
  montant: string;
  source: string;
  importId: string | null;
  statut: string;
  dateSaisie: string;
  dateConfirmation: string | null;
}

export function EncaissementsContratTable({ rows }: { rows: EncaissementRow[] }) {
  return (
    <DataTable
      rowKey={(r) => r.id}
      data={rows}
      emptyMessage="Aucun paiement enregistré pour ce contrat."
      columns={[
        {
          key: "paiementId",
          header: "N° de paiement",
          sortable: true,
          accessor: (r) => r.paiementId,
          render: (r) => <span className="font-medium tabular-nums">{r.paiementId}</span>,
          className: "whitespace-nowrap",
        },
        {
          key: "date",
          header: "Date du paiement",
          sortable: true,
          accessor: (r) => r.datePaiementIso,
          render: (r) => r.datePaiement,
          className: "whitespace-nowrap",
        },
        { key: "mode", header: "Mode", accessor: (r) => r.mode },
        { key: "reference", header: "Référence", accessor: (r) => r.reference ?? "—" },
        {
          key: "montant",
          header: "Montant",
          render: (r) => <span className="whitespace-nowrap font-semibold tabular-nums">{r.montant}</span>,
        },
        {
          key: "source",
          header: "Source",
          render: (r) =>
            r.importId ? (
              <Link href={`/encaissements/import/${r.importId}`} className="text-primary hover:underline">
                {r.source}
              </Link>
            ) : (
              r.source
            ),
        },
        {
          key: "statut",
          header: "Statut",
          sortable: true,
          accessor: (r) => STATUT_ENCAISSEMENT[r.statut]?.libelle ?? r.statut,
          render: (r) => {
            const s = STATUT_ENCAISSEMENT[r.statut];
            return <Badge variant={s?.variant ?? "neutral"}>{s?.libelle ?? r.statut}</Badge>;
          },
        },
        {
          key: "dates",
          header: "Saisi / confirmé le",
          render: (r) => (
            <span className="whitespace-nowrap text-xs">
              {r.dateSaisie}
              <span className="block text-muted-foreground">{r.dateConfirmation ?? "Non confirmé"}</span>
            </span>
          ),
        },
      ]}
    />
  );
}
