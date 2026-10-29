"use client";

import Link from "next/link";

import { Button, DataTable } from "@/components/ui";

interface ARegulariserRow {
  id: string;
  reference: string;
  createurNom: string;
  totalRegle: number;
  valideeLe: Date;
  ecart: number;
  /** Articles validés de la demande et leur propre solde à régulariser (lot E). */
  articles: { id: string; libelle: string; solde: number; regularise: boolean }[];
  /** Solde de la part non rattachée à un article (anciens règlements), `null` s'il n'y en a pas. */
  nonRattacheSolde: number | null;
}

/**
 * Wrapper Client Component autour de DataTable — voir MesDemandesTable.tsx
 * (Ticket 1) pour l'explication (colonnes avec accessor/render : fonctions
 * non sérialisables entre Server et Client Component).
 */
export function ARegulariserTable({ demandes }: { demandes: ARegulariserRow[] }) {
  return (
    <DataTable
      rowKey={(d) => d.id}
      emptyMessage="Aucun décaissement à régulariser pour l'instant."
      columns={[
        { key: "reference", header: "Référence", sortable: true, accessor: (d) => d.reference },
        { key: "createurNom", header: "Créateur", sortable: true, accessor: (d) => d.createurNom },
        {
          key: "totalRegle",
          // "Fonds remis (Caisse + Banque)" et non "Fonds remis" simple :
          // ce montant vient de getTotalRegle (dashboardFinance.ts), tous
          // modes de règlement confondus — distinct du "Fonds remis" du
          // reporting/export Excel, strictement Caisse (voir CLAUDE.md
          // "Distinction Fonds remis (Caisse + Banque) vs Fonds remis
          // (Caisse seule)").
          header: "Fonds remis (Caisse + Banque)",
          sortable: true,
          accessor: (d) => d.totalRegle,
          render: (d) => `${d.totalRegle.toLocaleString("fr-FR")} FCFA`,
        },
        {
          key: "articles",
          header: "Articles",
          render: (d) =>
            d.articles.length === 0 ? (
              <span className="text-xs text-muted-foreground">—</span>
            ) : (
              <ul className="space-y-0.5 text-xs">
                {d.articles.map((a) => (
                  <li key={a.id} data-article-solde={a.id}>
                    Article : {a.libelle} —{" "}
                    <span className={a.regularise ? "text-success" : "font-semibold text-warning"}>
                      {a.regularise ? "régularisé" : `solde ${a.solde.toLocaleString("fr-FR")} FCFA`}
                    </span>
                  </li>
                ))}
                {d.nonRattacheSolde != null && d.nonRattacheSolde !== 0 ? (
                  <li className="text-warning">Non rattaché à un article : {d.nonRattacheSolde.toLocaleString("fr-FR")} FCFA</li>
                ) : null}
              </ul>
            ),
        },
        {
          key: "ecart",
          header: "Solde à régulariser (demande)",
          sortable: true,
          accessor: (d) => d.ecart,
          render: (d) =>
            d.ecart === 0 ? (
              <span className="text-success">0 FCFA</span>
            ) : (
              <span className="font-semibold text-warning">{d.ecart.toLocaleString("fr-FR")} FCFA</span>
            ),
        },
        {
          key: "valideeLe",
          header: "Validée le",
          sortable: true,
          accessor: (d) => d.valideeLe,
          render: (d) => d.valideeLe.toLocaleDateString("fr-FR"),
        },
        {
          key: "actions",
          header: "Actions",
          render: (d) => (
            <Link href={`/treso/finance/demandes/${d.id}`}>
              <Button variant="secondary">Voir</Button>
            </Link>
          ),
        },
      ]}
      data={demandes}
    />
  );
}
