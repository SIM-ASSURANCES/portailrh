"use client";

import Link from "next/link";

import { formatFcfa } from "@/components/encaissements/libelles";
import { Badge, DataTable } from "@/components/ui";

export interface HistoriqueImportRow {
  id: string;
  importeAt: string;
  /** Formatée côté serveur (jamais dans le navigateur : fuseau différent = écart d'hydratation). */
  importeAtLabel: string;
  auteur: string;
  nomFichier: string;
  branche: string;
  nbLignes: number;
  nbContratsCrees: number;
  nbContratsMaj: number;
  nbPaiementsAConfirmer: number;
  nbATraiter: number;
  totalPrimesTtc: string | null;
}

export function HistoriqueImportsTable({ rows }: { rows: HistoriqueImportRow[] }) {
  return (
    <DataTable
      rowKey={(r) => r.id}
      data={rows}
      emptyMessage="Aucun import pour le moment."
      columns={[
        {
          key: "date",
          header: "Date",
          sortable: true,
          accessor: (r) => r.importeAt,
          render: (r) => <span className="tabular-nums">{r.importeAtLabel}</span>,
        },
        { key: "fichier", header: "Fichier", accessor: (r) => r.nomFichier, render: (r) => <span className="break-all">{r.nomFichier}</span> },
        { key: "auteur", header: "Auteur", sortable: true, accessor: (r) => r.auteur },
        { key: "branche", header: "Branche", accessor: (r) => r.branche },
        { key: "lignes", header: "Lignes", sortable: true, accessor: (r) => r.nbLignes, className: "text-right tabular-nums" },
        {
          key: "contrats",
          header: "Contrats créés / mis à jour",
          render: (r) => (
            <span className="tabular-nums">
              {r.nbContratsCrees} / {r.nbContratsMaj}
            </span>
          ),
        },
        { key: "paiements", header: "Paiements à confirmer", accessor: (r) => r.nbPaiementsAConfirmer, className: "tabular-nums" },
        {
          key: "aTraiter",
          header: "À traiter",
          sortable: true,
          accessor: (r) => r.nbATraiter,
          render: (r) => <Badge variant={r.nbATraiter > 0 ? "warning" : "neutral"}>{r.nbATraiter}</Badge>,
        },
        { key: "primes", header: "Primes TTC", render: (r) => <span className="tabular-nums">{formatFcfa(r.totalPrimesTtc)}</span> },
        {
          key: "actions",
          header: "Actions",
          render: (r) => (
            <Link href={`/encaissements/import/${r.id}`} className="text-sm font-semibold text-primary hover:underline">
              Voir le rapport
            </Link>
          ),
        },
      ]}
    />
  );
}
