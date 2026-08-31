"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { EmptyState } from "./EmptyState";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  sortable?: boolean;
  /** Requis si `sortable` est vrai : valeur brute utilisée pour comparer les lignes. */
  accessor?: (row: T) => string | number | Date | null | undefined;
  /** Rendu personnalisé de la cellule (sinon, valeur de `accessor` affichée telle quelle). */
  render?: (row: T) => ReactNode;
  className?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
}

type SortState = { key: string; direction: "asc" | "desc" } | null;

/**
 * Tableau générique pour toute liste métier (demandes, règlements, retours de
 * caisse...). Le tri par colonne ne s'active que si `sortable: true` et
 * `accessor` est fourni sur la colonne.
 *
 * Exemple :
 *   <DataTable
 *     rowKey={(d) => d.id}
 *     columns={[
 *       { key: "reference", header: "Référence", sortable: true, accessor: (d) => d.reference },
 *       { key: "montant", header: "Montant", sortable: true, accessor: (d) => d.montant,
 *         render: (d) => formatCurrency(d.montant) },
 *       { key: "statut", header: "Statut", render: (d) => <Badge variant="warning">{d.statut}</Badge> },
 *     ]}
 *     data={demandes}
 *   />
 */
export function DataTable<T>({ columns, data, rowKey, emptyMessage = "Aucune donnée." }: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState>(null);

  const sortedData = useMemo(() => {
    if (!sort) return data;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.accessor) return data;
    const accessor = column.accessor;
    const factor = sort.direction === "asc" ? 1 : -1;

    return [...data].sort((a, b) => {
      const va = accessor(a);
      const vb = accessor(b);
      if (va == null && vb == null) return 0;
      if (va == null) return factor;
      if (vb == null) return -factor;
      if (va < vb) return -factor;
      if (va > vb) return factor;
      return 0;
    });
  }, [data, sort, columns]);

  function toggleSort(column: DataTableColumn<T>) {
    if (!column.sortable) return;
    setSort((current) => {
      if (current?.key !== column.key) return { key: column.key, direction: "asc" };
      if (current.direction === "asc") return { key: column.key, direction: "desc" };
      return null;
    });
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-full divide-y divide-border text-sm">
        <thead className="bg-muted">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`px-4 py-2 text-left font-medium text-muted-foreground ${column.className ?? ""}`}
              >
                {column.sortable ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(column)}
                    className="inline-flex items-center gap-1 transition-colors duration-150 hover:text-foreground"
                  >
                    {column.header}
                    <SortIcon direction={sort?.key === column.key ? sort.direction : undefined} />
                  </button>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-surface">
          {sortedData.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>
                <EmptyState icon="inbox" message={emptyMessage} bordered={false} />
              </td>
            </tr>
          ) : (
            sortedData.map((row) => (
              <tr key={rowKey(row)} className="hover:bg-muted/50">
                {columns.map((column) => (
                  <td key={column.key} className={`px-4 py-2 text-foreground ${column.className ?? ""}`}>
                    {column.render ? column.render(row) : String(column.accessor?.(row) ?? "")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function SortIcon({ direction }: { direction?: "asc" | "desc" }) {
  return (
    <svg
      className={`h-3 w-3 ${direction ? "text-foreground" : "text-muted-foreground/50"}`}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      {direction === "desc" ? (
        <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      ) : direction === "asc" ? (
        <path d="M2 8l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path
          d="M2 4.5l4-3 4 3M2 7.5l4 3 4-3"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
