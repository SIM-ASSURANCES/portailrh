import { COLONNES_REPORTING_RETOUR, type LigneReportingRetour } from "backend";

const fcfa = (m: number) => `${Math.round(m).toLocaleString("fr-FR")} FCFA`;

/**
 * Reporting des retours de caisse (lot G.5) : une ligne par retour, avec le détail de l'article d'origine, la demande et les
 * règlements de l'article (Caisse et Banque). Mêmes colonnes que la feuille « Retours de caisse » de l'export Excel
 * (`COLONNES_REPORTING_RETOUR`). Tableau analytique large : défilement horizontal et en-tête figé.
 */
export function ReportingRetoursTable({ lignes }: { lignes: LigneReportingRetour[] }) {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 shadow-elevated sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Retours de caisse — détail de l&apos;article d&apos;origine</h2>
        <p className="text-xs text-muted-foreground">
          {lignes.length} retour{lignes.length > 1 ? "s" : ""}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">Faites glisser pour voir toutes les colonnes →</p>
      <div className="max-h-[70vh] overflow-auto rounded-md border border-border">
        <table data-reporting-retours className="min-w-max divide-y divide-border text-sm">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              {COLONNES_REPORTING_RETOUR.map((c) => (
                <th
                  key={c.cle}
                  scope="col"
                  className={`whitespace-nowrap px-3 py-2 font-medium text-muted-foreground ${c.montant ? "text-right" : "text-left"}`}
                >
                  {c.titre}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-surface">
            {lignes.length === 0 ? (
              <tr>
                <td colSpan={COLONNES_REPORTING_RETOUR.length} className="px-4 py-6 text-center text-muted-foreground">
                  Aucun retour de caisse ne correspond à ces filtres.
                </td>
              </tr>
            ) : (
              lignes.map((l, i) => (
                <tr key={`${l.demande}-${i}`} className="align-top hover:bg-muted/50">
                  {COLONNES_REPORTING_RETOUR.map((c) => {
                    const v = l[c.cle];
                    if (c.multi) {
                      const elements = v as string[];
                      return (
                        <td key={c.cle} className="min-w-64 max-w-md px-3 py-2 text-foreground">
                          {elements.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <ul className="space-y-1">
                              {elements.map((e, j) => (
                                <li key={j} className="break-words">
                                  {e}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      );
                    }
                    if (c.montant) {
                      return (
                        <td key={c.cle} className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-foreground">
                          {v == null ? "—" : fcfa(v as number)}
                        </td>
                      );
                    }
                    return (
                      <td key={c.cle} className="whitespace-nowrap px-3 py-2 text-foreground">
                        {v instanceof Date ? v.toLocaleDateString("fr-FR", { timeZone: "Africa/Abidjan" }) : String(v)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
