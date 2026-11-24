import { NextResponse } from "next/server";

import type { ColonneExportCpt, LigneExportCpt } from "backend";

import { getSession, hasPermission } from "@/lib/auth";
import { exporterEnFlux, type FormatExportCpt, TYPE_MIME_EXPORT_CPT } from "@/lib/compta/exportFlux";

/**
 * Export d'ESSAI de Gestion Compta (lot GC-1f) : prouve que l'export en flux tient la charge avant que les vrais états
 * (journal, bordereaux, clôture : GC-10) ne l'utilisent. Les lignes sont SYNTHÉTIQUES, générées à la volée ; aucune donnée
 * du module n'est lue ni exportée (aucune requête en base).
 *
 * `GET /api/compta/export/essai?format=xlsx|csv&lignes=100000` — `cpt.parametrer` (équipe technique, Finance). Au plus
 * `LIGNES_MAX_ESSAI` lignes : l'essai ne doit pas devenir un moyen de saturer le serveur.
 */

const LIGNES_MAX_ESSAI = 1_000_000;
const LIGNES_PAR_DEFAUT = 1000;

const COLONNES: ColonneExportCpt[] = [
  { cle: "reference", titre: "Référence", type: "texte", largeur: 18 },
  { cle: "date", titre: "Date", type: "date" },
  { cle: "client", titre: "Client", type: "texte", largeur: 30 },
  { cle: "montant", titre: "Montant (FCFA)", type: "montant" },
  { cle: "rang", titre: "Rang", type: "entier" },
];

function* lignesSynthetiques(nombre: number): Generator<LigneExportCpt> {
  for (let i = 1; i <= nombre; i++) {
    yield {
      reference: `ESSAI-${String(i).padStart(7, "0")}`,
      date: new Date(Date.UTC(2026, 0, 1 + (i % 365))),
      // Un texte sur 50 commence par « = » : il doit sortir neutralisé en CSV, jamais exécutable dans Excel.
      client: i % 50 === 0 ? `=CLIENT(${i})` : `Client synthétique ${i}`,
      // Un montant sur 10 est négatif (un relevé en contient) ; deux décimales exactes.
      montant: ((i % 10 === 0 ? -1 : 1) * (i * 37)) / 100,
      rang: i,
    };
  }
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (!hasPermission(session, "cpt.parametrer")) return NextResponse.json({ error: "Action non autorisée." }, { status: 403 });

  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "xlsx";
  if (format !== "xlsx" && format !== "csv") {
    return NextResponse.json({ error: "Format inconnu (xlsx ou csv)." }, { status: 400 });
  }
  const brut = url.searchParams.get("lignes");
  const nombre = brut === null ? LIGNES_PAR_DEFAUT : Number(brut);
  if (!Number.isInteger(nombre) || nombre < 1 || nombre > LIGNES_MAX_ESSAI) {
    return NextResponse.json({ error: `Le nombre de lignes doit être un entier de 1 à ${LIGNES_MAX_ESSAI}.` }, { status: 400 });
  }

  const flux = exporterEnFlux({
    format: format as FormatExportCpt,
    nomFeuille: "Essai",
    colonnes: COLONNES,
    lignes: lignesSynthetiques(nombre),
  });
  return new Response(flux, {
    headers: {
      "Content-Type": TYPE_MIME_EXPORT_CPT[format as FormatExportCpt],
      "Content-Disposition": `attachment; filename="essai-export-compta.${format}"`,
      "Cache-Control": "no-store",
    },
  });
}
