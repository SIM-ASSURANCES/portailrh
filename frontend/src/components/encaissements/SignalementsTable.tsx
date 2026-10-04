"use client";

import { libelleAnalyse } from "@/components/encaissements/libelles";
import { DataTable } from "@/components/ui";

export interface SignalementRow {
  id: string;
  numPolice: string | null;
  analyse: string;
  branche: string | null;
  /** Déjà mis en forme côté serveur (date, mode en clair, montant). */
  paiement: string | null;
  detail: string;
  /** Déjà mis en forme côté serveur (« À traiter », « Traité par … le … — commentaire »…) ; affiché si `afficherEtat`. */
  etat?: string | null;
}

export function SignalementsTable({
  rows,
  emptyMessage,
  afficherEtat = false,
}: {
  rows: SignalementRow[];
  emptyMessage: string;
  afficherEtat?: boolean;
}) {
  return (
    <DataTable
      rowKey={(r) => r.id}
      data={rows}
      emptyMessage={emptyMessage}
      columns={[
        {
          key: "police",
          header: "Police",
          sortable: true,
          accessor: (r) => r.numPolice ?? "",
          render: (r) => <span className="font-medium tabular-nums">{r.numPolice ?? "Sans numéro"}</span>,
          className: "whitespace-nowrap",
        },
        { key: "type", header: "Type", sortable: true, accessor: (r) => libelleAnalyse(r.analyse) },
        { key: "branche", header: "Branche", accessor: (r) => r.branche ?? "—" },
        { key: "paiement", header: "Paiement indiqué", accessor: (r) => r.paiement ?? "—" },
        { key: "detail", header: "Détail", accessor: (r) => r.detail, className: "min-w-[16rem]" },
        ...(afficherEtat ? [{ key: "etat", header: "État", accessor: (r: SignalementRow) => r.etat ?? "—", className: "min-w-[10rem]" }] : []),
      ]}
    />
  );
}
