"use client";

import Link from "next/link";

import { libelleSituation } from "@/components/encaissements/libelles";
import { DataTable } from "@/components/ui";
import type { ResumeContrat } from "@/lib/encaissements/resumesContrats";

export function ResultatsRechercheTable({ rows }: { rows: ResumeContrat[] }) {
  return (
    <DataTable
      rowKey={(r) => r.id}
      data={rows}
      emptyMessage="Aucun contrat trouvé."
      columns={[
        {
          key: "police",
          header: "Police",
          sortable: true,
          accessor: (r) => r.numPolice,
          render: (r) => (
            <Link href={`/encaissements/contrats/${r.id}`} className="font-semibold tabular-nums text-primary hover:underline">
              {r.numPolice}
            </Link>
          ),
          className: "whitespace-nowrap",
        },
        {
          key: "client",
          header: "Client",
          sortable: true,
          accessor: (r) => r.clientNom ?? "",
          render: (r) => (
            <span>
              {r.clientNom ?? "—"}
              {r.clientId ? <span className="block text-xs text-muted-foreground">{r.clientId}</span> : null}
            </span>
          ),
        },
        { key: "partenaire", header: "Partenaire", sortable: true, accessor: (r) => r.partenaire ?? "—" },
        { key: "branche", header: "Branche", sortable: true, accessor: (r) => r.branche },
        { key: "produit", header: "Produit", accessor: (r) => r.produit ?? "—" },
        {
          key: "situation",
          header: "Reste dû",
          render: (r) => (
            <span className={`whitespace-nowrap font-semibold tabular-nums ${r.situation.type === "trop" ? "text-warning" : ""}`}>
              {libelleSituation(r.situation)}
            </span>
          ),
        },
      ]}
    />
  );
}
