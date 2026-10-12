import { COLONNES_REPORTING_DEMANDE, type LigneReportingDemande } from "backend";

const fcfa = (m: number) => `${Math.round(m).toLocaleString("fr-FR")} FCFA`;

/**
 * Reporting « une ligne par demande » (2026-10-08) : mêmes colonnes et même contenu que la feuille « Demandes » de
 * l'export Excel (`COLONNES_REPORTING_DEMANDE`). Les données multiples d'une demande sont regroupées dans la cellule,
 * un élément par ligne ; les totaux numériques sont à côté, avec une ligne de total général. Tableau analytique large :
 * défilement horizontal et en-tête figé, comme les autres tableaux du reporting.
 */
export function ReportingDemandesTable({ lignes }: { lignes: LigneReportingDemande[] }) {
  const totaux = Object.fromEntries(
    COLONNES_REPORTING_DEMANDE.filter((c) => c.montant).map((c) => [
      c.cle,
      lignes.reduce((t, l) => t + (l[c.cle] as number), 0),
    ])
  );
  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 shadow-elevated sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Demandes — une ligne par demande</h2>
        <p className="text-xs text-muted-foreground">
          {lignes.length} demande{lignes.length > 1 ? "s" : ""}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">Faites glisser pour voir toutes les colonnes →</p>
      <div className="max-h-[70vh] overflow-auto rounded-md border border-border">
        <table data-reporting-demandes className="min-w-max divide-y divide-border text-sm">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              {COLONNES_REPORTING_DEMANDE.map((c) => (
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
                <td colSpan={COLONNES_REPORTING_DEMANDE.length} className="px-4 py-6 text-center text-muted-foreground">
                  Aucune demande ne correspond à ces filtres.
                </td>
              </tr>
            ) : (
              lignes.map((l) => (
                <tr key={l.reference} className="align-top hover:bg-muted/50">
                  {COLONNES_REPORTING_DEMANDE.map((c) => {
                    const v = l[c.cle];
                    if (c.multi) {
                      const elements = v as string[];
                      return (
                        <td key={c.cle} className="min-w-72 max-w-md px-3 py-2 text-foreground">
                          {elements.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <ul className="space-y-1">
                              {elements.map((e, i) => (
                                <li key={i} className="break-words">
                                  {e}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      );
                    }
                    if (c.montant) {
                      const m = v as number;
                      return (
                        <td
                          key={c.cle}
                          className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                            c.cle === "solde" && Math.round(m) !== 0 ? "font-semibold text-warning" : "text-foreground"
                          }`}
                        >
                          {fcfa(m)}
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
          {lignes.length > 0 ? (
            <tfoot className="bg-muted font-semibold">
              <tr>
                {COLONNES_REPORTING_DEMANDE.map((c, i) => (
                  <td key={c.cle} className={`whitespace-nowrap px-3 py-2 ${c.montant ? "text-right tabular-nums" : ""}`}>
                    {c.montant ? fcfa(totaux[c.cle]) : i === 0 ? "Total général" : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
