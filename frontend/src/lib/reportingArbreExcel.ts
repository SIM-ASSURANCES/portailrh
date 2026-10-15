// Feuille Excel « Reporting » du lot F : UN seul tableau, de la demande jusqu'au détail de chaque article (voir
// `reportingArbre.ts`, qui fournit les lignes et les colonnes — la page affiche exactement les mêmes).
//
// Mise en forme : regroupement (plan) Excel sur 3 niveaux — les lignes ARTICLE sont des sous-lignes de leur DEMANDE, les événements
// des sous-lignes de leur ARTICLE, repliables ; style distinct par niveau ; filtre automatique ; volets figés (en-tête + 2 premières
// colonnes) ; montants numériques avec séparateur de milliers ; dates réelles ; AUCUN retour à la ligne sauf la colonne « Motif ».
// Le total général est une formule SUMIF sur « Compte dans les totaux = Oui » (seules les lignes DEMANDE y entrent), avec son résultat
// déjà calculé : il reste exact même dans un lecteur qui ne recalcule pas.

import type ExcelJS from "exceljs";
import { COLONNES_ARBRE, COLONNES_TOTAUX, totauxParDevise, type LigneArbre } from "backend";

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF004B9C" } };
const FILL_DEMANDE: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD6E6F7" } };
const FILL_ARTICLE: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF3F8" } };
const FORMAT_MONTANT = "#,##0.##;-#,##0.##;0";

/** Date du jour calendaire sans heure (minuit UTC) : l'heure ne doit jamais fausser un tri ou un regroupement par date. */
function jourSansHeure(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function lettreColonne(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** `origine` : origine du site (`https://hôte`), pour des liens de téléchargement absolus utilisables depuis Excel. */
export function ajouterFeuilleReporting(workbook: ExcelJS.Workbook, lignes: readonly LigneArbre[], origine: string): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet("Reporting", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
  // Les lignes de détail sont SOUS leur ligne de synthèse (la demande, l'article) : le bouton de repli est sur celle-ci.
  sheet.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  sheet.properties.outlineLevelRow = 2;

  sheet.columns = COLONNES_ARBRE.map((c) => ({
    key: String(c.cle),
    header: c.titre,
    width: c.largeur,
    style: {
      ...(c.genre === "montant" ? { numFmt: FORMAT_MONTANT } : c.genre === "entier" ? { numFmt: "0" } : c.genre === "date" ? { numFmt: "dd/mm/yyyy" } : {}),
      alignment: { wrapText: c.longue === true, vertical: "top" as const },
    },
  }));

  const entete = sheet.getRow(1);
  entete.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { wrapText: false, vertical: "middle" };
  });

  for (const l of lignes) {
    const valeurs: Record<string, string | number | Date | null> = {};
    for (const c of COLONNES_ARBRE) {
      const v = l[c.cle];
      if (v == null || v === "") valeurs[String(c.cle)] = null;
      else if (c.genre === "lien") valeurs[String(c.cle)] = { text: "Télécharger", hyperlink: `${origine}${v}` } as unknown as string;
      else if (v instanceof Date) valeurs[String(c.cle)] = jourSansHeure(v);
      else if (typeof v === "number") valeurs[String(c.cle)] = Math.round(v * 100) / 100;
      else valeurs[String(c.cle)] = v;
    }
    const row = sheet.addRow(valeurs);
    row.outlineLevel = l.niveau;
    // Niveau 0 : demande (gras, fond marqué) ; niveau 1 : article (fond léger, retrait) ; niveau 2 : événements (texte courant, retrait double).
    if (l.niveau === 0) {
      row.font = { bold: true };
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = FILL_DEMANDE;
      });
    } else if (l.niveau === 1) {
      row.font = { bold: true, color: { argb: "FF1F3A5F" } };
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = FILL_ARTICLE;
      });
    } else {
      row.font = { color: { argb: "FF475569" } };
    }
    for (const c of COLONNES_ARBRE) {
      if (c.genre === "lien" && l[c.cle]) row.getCell(String(c.cle)).font = { underline: true, color: { argb: "FF0563C1" } };
    }
    for (const nom of ["typeLibelle", "article"]) {
      const cell = row.getCell(nom);
      cell.alignment = { ...cell.alignment, indent: l.niveau, vertical: "top", wrapText: false };
    }
  }

  const derniereLigneDonnees = sheet.rowCount;
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLONNES_ARBRE.length } };

  // Ligne vide de séparation (le filtre automatique ne doit jamais absorber les totaux), puis un total par devise.
  if (derniereLigneDonnees > 1) {
    sheet.addRow({});
    const parDevise = totauxParDevise(lignes);
    const colCompte = lettreColonne(COLONNES_ARBRE.findIndex((c) => c.cle === "compte"));
    const colDevise = lettreColonne(COLONNES_ARBRE.findIndex((c) => c.cle === "devise"));
    for (const { devise, totaux } of parDevise) {
      const row = sheet.addRow({ typeLibelle: parDevise.length === 1 ? "Total général" : `Total ${devise}`, compte: "Oui = lignes Demande", devise });
      for (const cle of COLONNES_TOTAUX) {
        const idx = COLONNES_ARBRE.findIndex((c) => c.cle === cle);
        const lettre = lettreColonne(idx);
        row.getCell(idx + 1).value = {
          formula: `SUMIFS(${lettre}$2:${lettre}$${derniereLigneDonnees},$${colCompte}$2:$${colCompte}$${derniereLigneDonnees},"Oui",$${colDevise}$2:$${colDevise}$${derniereLigneDonnees},"${devise}")`,
          result: totaux[cle],
        };
      }
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = HEADER_FILL;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      });
    }
  }
  return sheet;
}
