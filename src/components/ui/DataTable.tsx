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

/** Une colonne "Action(s)" mérite un traitement à part en carte mobile :
 * détachée de la liste label/valeur, affichée pleine largeur sous un séparateur
 * (bouton(s) d'action), plutôt que comparée à tort à une simple donnée. */
function isActionsColumn(column: { header: string }): boolean {
  return /^actions?$/i.test(column.header.trim());
}

function renderCell<T>(column: DataTableColumn<T>, row: T): ReactNode {
  return column.render ? column.render(row) : String(column.accessor?.(row) ?? "");
}

/**
 * Tableau générique pour toute liste métier (demandes, règlements, retours de
 * caisse...). Le tri par colonne ne s'active que si `sortable: true` et
 * `accessor` est fourni sur la colonne.
 *
 * **Stratégie responsive (audit mobile, voir CLAUDE.md)** : en dessous de `md`,
 * le tableau HTML classique (illisible sur 375px dès qu'il dépasse 3-4
 * colonnes — colonnes tronquées hors écran, sans aucun indice de défilement)
 * est remplacé par une liste de cartes empilées, une par ligne : première
 * colonne en titre, colonnes suivantes en paires libellé/valeur, et une
 * colonne "Actions" détachée en pied de carte. Le tri par colonne (perdu sans
 * en-têtes cliquables en mode carte) est reporté sur un sélecteur "Trier par"
 * dédié, visible uniquement sous `md`, qui pilote le même état de tri.
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

  const sortableColumns = columns.filter((c) => c.sortable);
  const [titleColumn, ...bodyColumns] = columns;
  const actionColumns = bodyColumns.filter(isActionsColumn);
  const valueColumns = bodyColumns.filter((c) => !isActionsColumn(c));

  if (sortedData.length === 0) {
    return (
      <div className="rounded-md border border-border shadow-elevated">
        <EmptyState icon="inbox" message={emptyMessage} bordered={false} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sortableColumns.length > 0 && (
        <div className="flex items-center gap-2 md:hidden">
          <label htmlFor="datatable-mobile-sort" className="shrink-0 text-xs font-medium text-muted-foreground">
            Trier par
          </label>
          <select
            id="datatable-mobile-sort"
            className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground transition-colors duration-150 ease-out-strong hover:border-muted-foreground/60"
            value={sort ? `${sort.key}:${sort.direction}` : ""}
            onChange={(e) => {
              const val = e.target.value;
              if (!val) {
                setSort(null);
                return;
              }
              const [key, direction] = val.split(":") as [string, "asc" | "desc"];
              setSort({ key, direction });
            }}
          >
            <option value="">Ordre par défaut</option>
            {sortableColumns.map((c) => (
              <optgroup key={c.key} label={c.header}>
                <option value={`${c.key}:asc`}>{c.header} (croissant)</option>
                <option value={`${c.key}:desc`}>{c.header} (décroissant)</option>
              </optgroup>
            ))}
          </select>
        </div>
      )}

      {/* Cartes empilées — sous md uniquement. */}
      <div className="space-y-3 md:hidden">
        {sortedData.map((row) => (
          <div key={rowKey(row)} className="rounded-md border border-border bg-surface p-4 shadow-elevated">
            {titleColumn && <div className="font-medium text-foreground">{renderCell(titleColumn, row)}</div>}
            {valueColumns.length > 0 && (
              <dl className="mt-2 space-y-1.5 text-sm">
                {valueColumns.map((column) => (
                  <div key={column.key} className="flex items-baseline justify-between gap-3">
                    <dt className="shrink-0 text-muted-foreground">{column.header}</dt>
                    <dd className="text-right text-foreground">{renderCell(column, row)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {actionColumns.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                {actionColumns.map((column) => (
                  <div key={column.key}>{renderCell(column, row)}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Tableau classique — à partir de md. Fond général de l'application
          désormais blanc (voir CLAUDE.md "Fond blanc uniforme") : le
          `border-border` seul ne se détache presque plus d'un fond blanc pur
          (contraste mesuré ~1.26:1, quasi invisible) — `shadow-elevated`
          (même traitement que Card/StatCard) fait porter la délimitation, et
          les lignes reçoivent une légère alternance (`even:bg-muted/40`) pour
          rester lisibles même si l'œil perd le fil d'une ligne à l'autre. */}
      <div className="hidden overflow-x-auto rounded-md border border-border shadow-elevated md:block">
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
            {sortedData.map((row) => (
              <tr key={rowKey(row)} className="even:bg-muted/40 hover:bg-muted/60">
                {columns.map((column) => (
                  <td key={column.key} className={`px-4 py-2 text-foreground ${column.className ?? ""}`}>
                    {renderCell(column, row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
