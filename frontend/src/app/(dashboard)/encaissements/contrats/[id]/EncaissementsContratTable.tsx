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
  /** Montants et exigibilité figés à la confirmation (commit 6a), déjà mis en forme ; `null` si non confirmé. */
  fige: {
    rang: number | null;
    AA: string;
    AB: string;
    AC: string;
    AD: string;
    commission: string;
    honoraires: string;
    moisExigibilite: string;
    dateLimite: string;
    regularisation: string | null;
  } | null;
  motifNonReception: string | null;
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
            return (
              <span>
                <Badge variant={s?.variant ?? "neutral"}>{s?.libelle ?? r.statut}</Badge>
                {r.fige?.rang ? <span className="mt-1 block text-xs text-muted-foreground">Rang {r.fige.rang}</span> : null}
                {r.motifNonReception ? <span className="mt-1 block text-xs text-danger">{r.motifNonReception}</span> : null}
              </span>
            );
          },
        },
        {
          key: "fige",
          header: "Montants figés",
          render: (r) =>
            r.fige ? (
              <span data-montants-figes className="block whitespace-nowrap text-xs tabular-nums">
                Reste après : <span className="font-semibold">{r.fige.AA}</span>
                <span className="block">Prime nette {r.fige.AB} · Accessoires {r.fige.AC}</span>
                <span className="block">Taxe {r.fige.AD}</span>
                <span className="block text-muted-foreground">
                  Commission {r.fige.commission} · Honoraires {r.fige.honoraires}
                </span>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            ),
        },
        {
          key: "exigibilite",
          header: "Taxe exigible",
          render: (r) =>
            r.fige ? (
              <span data-exigibilite className="block text-xs">
                <span className="font-semibold capitalize">{r.fige.moisExigibilite}</span>
                <span className="block text-muted-foreground">avant le {r.fige.dateLimite}</span>
                {r.fige.regularisation ? (
                  <span className="mt-1 block">
                    <Badge variant="warning">Régularisation</Badge>
                    <span className="mt-0.5 block text-muted-foreground">{r.fige.regularisation.replace("Régularisation — ", "")}</span>
                  </span>
                ) : null}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            ),
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
