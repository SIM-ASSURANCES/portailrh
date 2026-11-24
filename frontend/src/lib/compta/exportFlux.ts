import { PassThrough, Readable } from "node:stream";

import ExcelJS from "exceljs";

import {
  centimesExport,
  CPT_EXPORT_EXCEL_LIGNES_MAX,
  CptExportError,
  CSV_BOM,
  type ColonneExportCpt,
  enteteCsv,
  jourCivilExport,
  type LigneExportCpt,
  ligneCsv,
  type ValeurExportCpt,
} from "backend";

/**
 * Exports de Gestion Compta EN FLUX (lot GC-1f ; docs/compta-conception.md, GC-10d) : la mémoire reste bornée quel que soit
 * le nombre de lignes (objectif : 100 000 lignes en moins d'une minute).
 *
 *  - CSV : `ReadableStream` à `pull`, le navigateur tire le lot suivant seulement quand il a consommé le précédent
 *    (contre-pression native). Règles de mise en forme : `backend/src/cptExportCsv.ts`.
 *  - Excel : `stream.xlsx.WorkbookWriter` d'ExcelJS, chaque ligne est écrite puis « commit ». Une feuille compte au plus
 *    1 048 575 lignes de données : au-delà, `CptExportError` (exporter en CSV). Les textes d'une cellule Excel sont de
 *    vraies chaînes, jamais des formules : la neutralisation du `=` n'est nécessaire qu'en CSV.
 *
 * Les `lignes` sont un itérable (ou asynchrone) : l'appelant lit la base par pages, sans tout charger.
 */

export type FormatExportCpt = "xlsx" | "csv";

export interface ParametresExportCpt {
  format: FormatExportCpt;
  nomFeuille: string;
  colonnes: readonly ColonneExportCpt[];
  lignes: Iterable<LigneExportCpt> | AsyncIterable<LigneExportCpt>;
}

export const TYPE_MIME_EXPORT_CPT: Record<FormatExportCpt, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
};

const LIGNES_PAR_LOT_CSV = 500;
/** Cède la main à la boucle d'événements toutes les N lignes Excel, pour que le flux de sortie se vide. */
const LIGNES_ENTRE_CESSIONS = 2000;

/** Valeur de cellule Excel selon le type de colonne : nombre, `Date` UTC, texte ou vide. Ne lève jamais. */
function celluleExcel(valeur: ValeurExportCpt, type: ColonneExportCpt["type"]): ExcelJS.CellValue {
  if (valeur === null || valeur === undefined || valeur === "") return null;
  switch (type) {
    case "montant": {
      const c = centimesExport(valeur);
      return c === null ? null : c / 100;
    }
    case "date": {
      const jour = jourCivilExport(valeur);
      return jour ? new Date(Date.UTC(jour.a, jour.m - 1, jour.j)) : null;
    }
    case "entier":
      return typeof valeur === "number" && Number.isFinite(valeur) ? valeur : null;
    default:
      return valeur instanceof Date ? valeur.toISOString() : String(valeur);
  }
}

const FORMAT_NOMBRE: Partial<Record<ColonneExportCpt["type"], string>> = {
  montant: "#,##0.00",
  date: "dd/mm/yyyy",
  entier: "0",
};

function exporterCsv({ colonnes, lignes }: ParametresExportCpt): ReadableStream<Uint8Array> {
  const encodeur = new TextEncoder();
  const iterateur = (Symbol.asyncIterator in lignes ? lignes[Symbol.asyncIterator]() : lignes[Symbol.iterator]()) as
    | AsyncIterator<LigneExportCpt>
    | Iterator<LigneExportCpt>;
  let entetePosee = false;

  return new ReadableStream<Uint8Array>({
    async pull(controleur) {
      let texte = "";
      if (!entetePosee) {
        texte += CSV_BOM + enteteCsv(colonnes);
        entetePosee = true;
      }
      for (let i = 0; i < LIGNES_PAR_LOT_CSV; i++) {
        const suivant = await iterateur.next();
        if (suivant.done) {
          if (texte) controleur.enqueue(encodeur.encode(texte));
          controleur.close();
          return;
        }
        texte += ligneCsv(colonnes, suivant.value);
      }
      controleur.enqueue(encodeur.encode(texte));
    },
    async cancel() {
      await iterateur.return?.();
    },
  });
}

function exporterExcel({ nomFeuille, colonnes, lignes }: ParametresExportCpt): ReadableStream<Uint8Array> {
  const sortie = new PassThrough();
  const classeur = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: sortie, useStyles: true, useSharedStrings: false });
  const feuille = classeur.addWorksheet(nomFeuille.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
  feuille.columns = colonnes.map((c) => ({
    header: c.titre,
    key: c.cle,
    width: c.largeur ?? (c.type === "texte" ? 28 : 16),
    style: FORMAT_NOMBRE[c.type] ? { numFmt: FORMAT_NOMBRE[c.type] } : {},
  }));
  feuille.getRow(1).font = { bold: true };
  feuille.getRow(1).commit();

  void (async () => {
    try {
      let nb = 0;
      for await (const ligne of lignes) {
        if (nb >= CPT_EXPORT_EXCEL_LIGNES_MAX) {
          throw new CptExportError(
            `Trop de lignes pour une feuille Excel (${CPT_EXPORT_EXCEL_LIGNES_MAX.toLocaleString("fr-FR")} au plus) : exportez en CSV.`
          );
        }
        feuille.addRow(colonnes.map((c) => celluleExcel(ligne[c.cle], c.type))).commit();
        nb++;
        if (nb % LIGNES_ENTRE_CESSIONS === 0) await new Promise<void>((resolu) => setImmediate(resolu));
      }
      feuille.commit();
      await classeur.commit();
    } catch (erreur) {
      sortie.destroy(erreur instanceof Error ? erreur : new Error(String(erreur)));
    }
  })();

  return Readable.toWeb(sortie) as ReadableStream<Uint8Array>;
}

/** Export en flux d'un jeu de lignes, au format demandé. */
export function exporterEnFlux(parametres: ParametresExportCpt): ReadableStream<Uint8Array> {
  return parametres.format === "csv" ? exporterCsv(parametres) : exporterExcel(parametres);
}
