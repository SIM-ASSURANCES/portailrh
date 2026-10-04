"use client";

import Link from "next/link";

import { libelleAnalyse } from "@/components/encaissements/libelles";
import { DataTable } from "@/components/ui";

import { MarquerTraiteButton } from "./MarquerTraiteButton";

/** Valeurs déjà mises en forme côté serveur (date, mode en clair, montant). */
export interface SignalementATraiterRow {
  id: string;
  numPolice: string | null;
  contratId: string | null;
  analyse: string;
  branche: string | null;
  paiement: string | null;
  detail: string;
  importId: string;
  importLabel: string;
}

function lienPolice(r: SignalementATraiterRow): string | null {
  if (r.contratId) return `/encaissements/contrats/${r.contratId}`;
  // Ligne rejetée (aucun contrat créé) : la recherche par n° de police reste le meilleur point d'entrée.
  if (r.numPolice) return `/encaissements/recherche?q=${encodeURIComponent(r.numPolice)}`;
  return null;
}

export function SignalementsATraiterTable({ rows, peutTraiter }: { rows: SignalementATraiterRow[]; peutTraiter: boolean }) {
  return (
    <DataTable
      rowKey={(r) => r.id}
      data={rows}
      emptyMessage="Aucun signalement à traiter."
      columns={[
        {
          key: "police",
          header: "Police",
          render: (r) => <span className="font-medium tabular-nums">{r.numPolice ?? "Sans numéro"}</span>,
          className: "whitespace-nowrap",
        },
        { key: "type", header: "Type", render: (r) => libelleAnalyse(r.analyse) },
        { key: "branche", header: "Branche", render: (r) => r.branche ?? "—" },
        { key: "paiement", header: "Paiement indiqué", render: (r) => r.paiement ?? "—" },
        { key: "detail", header: "Détail", render: (r) => r.detail, className: "min-w-[16rem]" },
        {
          key: "import",
          header: "Import",
          render: (r) => (
            <Link href={`/encaissements/import/${r.importId}`} className="whitespace-nowrap text-primary hover:underline">
              {r.importLabel}
            </Link>
          ),
        },
        {
          key: "actions",
          header: "Actions",
          render: (r) => {
            const lien = lienPolice(r);
            return (
              <div className="flex flex-col items-start gap-2">
                {lien ? (
                  <Link
                    href={lien}
                    className="inline-flex items-center rounded-lg border border-border bg-secondary px-3 py-1.5 text-sm font-semibold text-secondary-foreground hover:bg-secondary-hover"
                  >
                    Ouvrir la police
                  </Link>
                ) : null}
                {peutTraiter ? <MarquerTraiteButton signalementId={r.id} /> : null}
              </div>
            );
          },
        },
      ]}
    />
  );
}
