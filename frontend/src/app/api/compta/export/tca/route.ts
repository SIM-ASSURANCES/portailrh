import { NextResponse } from "next/server";

import { chargerEtatParTauxCpt, LIBELLE_PRIMES_REMBOURSEES_CPT, prisma, texteDepuisCentimes, type ColonneExportCpt, type LigneExportCpt } from "backend";

import { getSession, hasPermission } from "@/lib/auth";
import { exporterEnFlux, type FormatExportCpt, TYPE_MIME_EXPORT_CPT } from "@/lib/compta/exportFlux";

/**
 * Export de l'état de déclaration par taux d'un mois (lot GC-8e), en flux. `GET /api/compta/export/tca?mois=AAAA-MM&format=csv|xlsx`. Accès
 * `cpt.consulter` (401 sans session, 403 sans la permission). Les lignes sont celles de l'écran : même fonction (`chargerEtatParTauxCpt`),
 * aucun second calcul. La dernière ligne est le total.
 */
const COLONNES: ColonneExportCpt[] = [
  { cle: "taux", titre: "Taux", type: "texte" },
  { cle: "primes", titre: "Primes hors taxe (FCFA)", type: "montant" },
  { cle: "accessoires", titre: "Accessoires hors taxe (FCFA)", type: "montant" },
  { cle: "remboursees", titre: "Primes remboursées", type: "texte", largeur: 22 },
  { cle: "base", titre: "Base d'imposition (FCFA)", type: "montant" },
  { cle: "impot", titre: "Impôt (FCFA)", type: "montant" },
  { cle: "lignes", titre: "Lignes de taxe", type: "entier" },
];
const euros = (centimes: bigint) => Number(texteDepuisCentimes(centimes));

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (!hasPermission(session, "cpt.consulter")) return NextResponse.json({ error: "Action non autorisée." }, { status: 403 });

  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "csv";
  if (format !== "xlsx" && format !== "csv") return NextResponse.json({ error: "Format inconnu (xlsx ou csv)." }, { status: 400 });
  const mois = url.searchParams.get("mois") ?? "";
  if (!/^\d{4}-\d{2}$/.test(mois)) return NextResponse.json({ error: "Mois invalide (AAAA-MM)." }, { status: 400 });

  const e = await chargerEtatParTauxCpt(prisma, `${mois}-01`);
  const lignes: LigneExportCpt[] = e.etat.lignes.map((l) => ({
    taux: l.libelleTaux,
    primes: euros(l.primesHt),
    accessoires: euros(l.accessoiresHt),
    remboursees: LIBELLE_PRIMES_REMBOURSEES_CPT,
    base: euros(l.baseImposition),
    impot: euros(l.impot),
    lignes: l.nbLignes,
  }));
  lignes.push({
    taux: "Total",
    primes: euros(e.etat.total.primesHt),
    accessoires: euros(e.etat.total.accessoiresHt),
    remboursees: LIBELLE_PRIMES_REMBOURSEES_CPT,
    base: euros(e.etat.total.baseImposition),
    impot: euros(e.etat.total.impot),
    lignes: e.etat.total.nbLignes,
  });

  const flux = exporterEnFlux({ format: format as FormatExportCpt, nomFeuille: `TCA ${mois}`, colonnes: COLONNES, lignes });
  return new Response(flux, {
    headers: {
      "Content-Type": TYPE_MIME_EXPORT_CPT[format as FormatExportCpt],
      "Content-Disposition": `attachment; filename="tca-${mois}.${format}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
