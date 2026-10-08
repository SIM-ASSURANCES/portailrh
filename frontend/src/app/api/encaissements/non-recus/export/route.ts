import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";

import { libelleMode, libelleSource } from "@/components/encaissements/libelles";
import { getSession, hasPermission } from "@/lib/auth";
import { clauseFiltres, lireFiltres } from "@/lib/encaissements/filtresAConfirmer";
import { prisma } from "backend";

/**
 * Export Excel des paiements « non reçus » (F5, commit 6b), avec les filtres de l'écran (période, mode, partenaire,
 * branche, recherche). Réservé à `enc.confirmer_paiement`, comme l'écran.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("Non authentifié.", { status: 401 });
  if (!hasPermission(session, "enc.confirmer_paiement")) return new NextResponse("Accès refusé.", { status: 403 });

  const filtres = lireFiltres(Object.fromEntries(request.nextUrl.searchParams), "NON_RECU");
  const where = await clauseFiltres(filtres);
  const lignes = where
    ? await prisma.encEncaissement.findMany({
        where,
        orderBy: [{ datePaiement: "asc" }, { paiementId: "asc" }],
        select: {
          paiementId: true,
          datePaiement: true,
          mode: true,
          reference: true,
          Z: true,
          source: true,
          motifNonReception: true,
          nonRecuAt: true,
          nonRecuPar: { select: { fullName: true } },
          contrat: { select: { numPolice: true, clientNom: true, partenaire: { select: { nom: true } } } },
          branche: { select: { libelle: true } },
        },
      })
    : [];

  const classeur = new ExcelJS.Workbook();
  classeur.creator = "Portail SIM Assurances";
  classeur.created = new Date();
  const feuille = classeur.addWorksheet("Non reçus");
  feuille.columns = [
    { header: "N° de paiement", key: "paiementId", width: 18 },
    { header: "N° de police", key: "police", width: 24 },
    { header: "Client", key: "client", width: 26 },
    { header: "Partenaire", key: "partenaire", width: 20 },
    { header: "Branche", key: "branche", width: 16 },
    { header: "Payé le", key: "datePaiement", width: 12 },
    { header: "Mode", key: "mode", width: 16 },
    { header: "Référence", key: "reference", width: 22 },
    { header: "Montant (FCFA)", key: "montant", width: 14 },
    { header: "Source", key: "source", width: 20 },
    { header: "Motif", key: "motif", width: 34 },
    { header: "Marqué non reçu par", key: "par", width: 22 },
    { header: "Le", key: "le", width: 18 },
  ];
  feuille.getRow(1).font = { bold: true };
  for (const l of lignes) {
    feuille.addRow({
      paiementId: l.paiementId,
      police: l.contrat.numPolice,
      client: l.contrat.clientNom ?? "",
      partenaire: l.contrat.partenaire?.nom ?? "",
      branche: l.branche.libelle,
      datePaiement: l.datePaiement.toLocaleDateString("fr-FR", { timeZone: "UTC" }),
      mode: libelleMode(l.mode),
      reference: l.reference ?? "",
      montant: Number(l.Z),
      source: libelleSource(l.source),
      motif: l.motifNonReception ?? "",
      par: l.nonRecuPar?.fullName ?? "",
      le: l.nonRecuAt ? l.nonRecuAt.toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" }) : "",
    });
  }
  feuille.getColumn("montant").numFmt = "#,##0";

  const buffer = await classeur.xlsx.writeBuffer();
  const jour = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="paiements-non-recus-${jour}.xlsx"`,
    },
  });
}
