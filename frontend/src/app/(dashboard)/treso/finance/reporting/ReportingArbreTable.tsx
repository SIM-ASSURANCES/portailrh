"use client";

import { useMemo, useState } from "react";

import type { ColonneArbre, LigneArbre } from "backend";

type Totaux = Record<string, number>;
interface TotalDevise {
  devise: string;
  totaux: Totaux;
}

const nombre = (m: number) => Math.round(m).toLocaleString("fr-FR");
const jour = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "Africa/Abidjan" });

/** Blocs de repli : une demande contient ses articles, un article ses événements. */
interface LigneAffichee {
  ligne: LigneArbre;
  cle: string;
  demandeCle: string | null;
  articleCle: string | null;
  aDesEnfants: boolean;
}

function preparer(lignes: readonly LigneArbre[]): LigneAffichee[] {
  const res: LigneAffichee[] = [];
  let d = -1;
  let a = -1;
  lignes.forEach((ligne, i) => {
    const suivant = lignes[i + 1];
    if (ligne.niveau === 0) {
      d += 1;
      a = -1;
      res.push({ ligne, cle: `d${d}`, demandeCle: null, articleCle: null, aDesEnfants: !!suivant && suivant.niveau > 0 });
    } else if (ligne.niveau === 1) {
      a += 1;
      res.push({ ligne, cle: `d${d}a${a}`, demandeCle: `d${d}`, articleCle: null, aDesEnfants: !!suivant && suivant.niveau === 2 });
    } else {
      res.push({ ligne, cle: `d${d}a${a}e${i}`, demandeCle: `d${d}`, articleCle: `d${d}a${a}`, aDesEnfants: false });
    }
  });
  return res;
}

/**
 * Reporting « un seul tableau » (lot F) : la demande, dépliable en ses articles, chaque article dépliable en ses règlements / fonds remis,
 * mouvements banque, retours de caisse, dépenses et retours externes. Mêmes lignes et mêmes colonnes que la feuille « Reporting » de
 * l'export Excel (`COLONNES_ARBRE`) ; le total général ne compte que les lignes « Demande » (aucun double comptage).
 */
export function ReportingArbreTable({ colonnes, lignes, totauxParDevise, nbDemandes }: { colonnes: readonly ColonneArbre[]; lignes: LigneArbre[]; totauxParDevise: TotalDevise[]; nbDemandes: number }) {
  const affichees = useMemo(() => preparer(lignes), [lignes]);
  const [demandesOuvertes, setDemandesOuvertes] = useState<ReadonlySet<string>>(new Set());
  const [articlesOuverts, setArticlesOuverts] = useState<ReadonlySet<string>>(new Set());

  const basculer = (ensemble: ReadonlySet<string>, cle: string): Set<string> => {
    const n = new Set(ensemble);
    if (n.has(cle)) n.delete(cle);
    else n.add(cle);
    return n;
  };
  const toutDeplier = () => {
    setDemandesOuvertes(new Set(affichees.filter((x) => x.ligne.niveau === 0 && x.aDesEnfants).map((x) => x.cle)));
    setArticlesOuverts(new Set(affichees.filter((x) => x.ligne.niveau === 1 && x.aDesEnfants).map((x) => x.cle)));
  };
  const toutReplier = () => {
    setDemandesOuvertes(new Set());
    setArticlesOuverts(new Set());
  };

  const visible = (x: LigneAffichee) => {
    if (x.ligne.niveau === 0) return true;
    if (!x.demandeCle || !demandesOuvertes.has(x.demandeCle)) return false;
    return x.ligne.niveau === 1 || (x.articleCle !== null && articlesOuverts.has(x.articleCle));
  };

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 shadow-elevated sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Demandes, articles et opérations — un seul tableau</h2>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {nbDemandes} demande{nbDemandes > 1 ? "s" : ""}
          </span>
          <button type="button" data-deplier-tout onClick={toutDeplier} className="font-medium text-info underline-offset-4 hover:underline">
            Tout déplier
          </button>
          <button type="button" data-replier-tout onClick={toutReplier} className="font-medium text-info underline-offset-4 hover:underline">
            Tout replier
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Dépliez une demande pour voir ses articles, puis un article pour voir ses règlements, retours de caisse, mouvements banque et retours
        externes. Les totaux, un par devise (jamais deux devises additionnées), ne comptent que les lignes « Demande ». Faites glisser pour voir toutes les colonnes →
      </p>
      <div className="max-h-[70vh] overflow-auto rounded-md border border-border">
        <table data-reporting-arbre className="min-w-max divide-y divide-border text-sm">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              {colonnes.map((c) => (
                <th
                  key={String(c.cle)}
                  scope="col"
                  className={`whitespace-nowrap px-3 py-2 font-medium text-muted-foreground ${c.genre === "montant" || c.genre === "entier" ? "text-right" : "text-left"}`}
                >
                  {c.titre}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-surface">
            {affichees.length === 0 ? (
              <tr>
                <td colSpan={colonnes.length} className="px-4 py-6 text-center text-muted-foreground">
                  Aucune demande ne correspond à ces filtres.
                </td>
              </tr>
            ) : (
              affichees.filter(visible).map((x) => {
                const l = x.ligne;
                const ouvert = l.niveau === 0 ? demandesOuvertes.has(x.cle) : articlesOuverts.has(x.cle);
                const fond = l.niveau === 0 ? "bg-primary-bg font-semibold" : l.niveau === 1 ? "bg-muted/60 font-medium" : "text-muted-foreground";
                return (
                  <tr key={x.cle} data-niveau={l.niveau} data-type={l.type} data-ref={l.reference} data-article={l.article} className={`align-top hover:bg-muted/50 ${fond}`}>
                    {colonnes.map((c, idx) => {
                      const v = l[c.cle];
                      let contenu: React.ReactNode = "";
                      if (c.genre === "montant") {
                        const m = v as number | null;
                        contenu = m == null ? "" : nombre(m);
                      } else if (c.genre === "entier") {
                        contenu = v == null ? "" : String(v);
                      } else if (c.genre === "lien") {
                        contenu =
                          typeof v === "string" && v !== "" ? (
                            <a href={v} data-justificatif className="font-medium text-info underline-offset-4 hover:underline">
                              Télécharger
                            </a>
                          ) : (
                            ""
                          );
                      } else if (c.genre === "date") {
                        contenu = v instanceof Date ? jour(v) : "";
                      } else {
                        contenu = v == null ? "" : String(v);
                      }
                      const estSolde = c.cle === "solde" && typeof v === "number" && Math.round(v) !== 0;
                      return (
                        <td
                          key={String(c.cle)}
                          className={`px-3 py-2 ${c.longue ? "min-w-72 max-w-md whitespace-normal break-words" : "whitespace-nowrap"} ${
                            c.genre === "montant" || c.genre === "entier" ? "text-right tabular-nums" : ""
                          } ${estSolde ? "font-semibold text-warning" : ""}`}
                        >
                          {idx === 0 ? (
                            <span className="inline-flex items-center gap-1" style={{ paddingLeft: `${l.niveau * 1.25}rem` }}>
                              {x.aDesEnfants ? (
                                <button
                                  type="button"
                                  data-toggle
                                  aria-expanded={ouvert}
                                  aria-label={ouvert ? "Replier" : "Déplier"}
                                  onClick={() => (l.niveau === 0 ? setDemandesOuvertes((s) => basculer(s, x.cle)) : setArticlesOuverts((s) => basculer(s, x.cle)))}
                                  className="inline-flex size-5 items-center justify-center rounded border border-border bg-surface text-xs text-foreground hover:bg-muted"
                                >
                                  {ouvert ? "−" : "+"}
                                </button>
                              ) : (
                                <span className="inline-block size-5" />
                              )}
                              {contenu}
                            </span>
                          ) : (
                            contenu
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
          {affichees.length > 0 ? (
            <tfoot className="bg-muted font-semibold">
              {/* Un total PAR DEVISE : on n'additionne jamais deux devises. Une seule devise : « Total général ». */}
              {totauxParDevise.map(({ devise, totaux }) => (
                <tr key={devise} data-total-devise={devise}>
                  {colonnes.map((c, i) => (
                    <td key={String(c.cle)} className={`whitespace-nowrap px-3 py-2 ${c.genre === "montant" || c.genre === "entier" ? "text-right tabular-nums" : ""}`}>
                      {totaux[String(c.cle)] !== undefined
                        ? nombre(totaux[String(c.cle)])
                        : i === 0
                          ? totauxParDevise.length === 1
                            ? "Total général"
                            : `Total ${devise}`
                          : c.cle === "devise"
                            ? devise
                            : ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
