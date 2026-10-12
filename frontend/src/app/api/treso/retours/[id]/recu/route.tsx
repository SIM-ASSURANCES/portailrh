import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";

import { estRetourNul, getBeneficiaireNom, prisma, referenceRecuRetour } from "backend";
import { getSession, hasPermission } from "@/lib/auth";
import { RetourReceiptDocument, type RetourReceiptData } from "@/lib/pdf/RetourReceiptDocument";

/**
 * Reçu PDF d'un retour de caisse (2026-10-08), nul ou non, disponible dès que l'Assistant Finance l'a réceptionné (ou,
 * pour un retour nul, constaté). Mêmes conventions que le reçu de règlement : numérotation `<demande>-RC<rang>` (rang
 * parmi les retours réceptionnés de la demande, dans l'ordre de réception), 401 / 404 / 403.
 *
 * Accès réservé à ceux qui ont déjà accès au retour : les permissions de l'écran de détail d'un retour
 * (`treso.receptionner_retour`, `treso.valider_demande`, `treso.voir_dashboard_finance`), ou le créateur de la demande
 * (son écran « Retours de caisse »).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await getSession();
  if (!session) {
    return new NextResponse("Non authentifié.", { status: 401 });
  }

  const retour = await prisma.retourCaisse.findUnique({
    where: { id },
    include: {
      declarant: { select: { fullName: true } },
      receptionnePar: { select: { fullName: true } },
      depenses: { orderBy: { date: "asc" } },
      reglement: { include: { demande: { include: { createur: true, beneficiaireUser: true } } } },
    },
  });
  if (!retour || !retour.estReceptionne || !retour.receptionneAt) {
    return new NextResponse("Reçu introuvable.", { status: 404 });
  }

  const demande = retour.reglement.demande;
  const accesFinance =
    hasPermission(session, "treso.receptionner_retour") ||
    hasPermission(session, "treso.valider_demande") ||
    hasPermission(session, "treso.voir_dashboard_finance");
  if (!accesFinance && demande.createurId !== session.user.id) {
    return new NextResponse("Accès refusé.", { status: 403 });
  }

  const recus = await prisma.retourCaisse.findMany({
    where: { estReceptionne: true, reglement: { demandeId: demande.id } },
    orderBy: [{ receptionneAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  const rang = recus.findIndex((r) => r.id === retour.id) + 1;
  const recuReference = referenceRecuRetour(demande.reference, rang);

  const depenses = retour.depenses.map((d) => ({
    libelle: d.objet,
    montant: Number(d.montant),
    etat:
      d.justification !== "SANS_PIECE"
        ? "justifiée"
        : d.motifNonJustifie
          ? "non justifiée"
          : "non détaillée",
  }));
  const totalJustifie = depenses.filter((d) => d.etat === "justifiée").reduce((t, d) => t + d.montant, 0);
  const totalNonJustifie = depenses.filter((d) => d.etat !== "justifiée").reduce((t, d) => t + d.montant, 0);

  const data: RetourReceiptData = {
    recuReference,
    demandeReference: demande.reference,
    demandeurNom: demande.createur.fullName,
    beneficiaireNom: getBeneficiaireNom(demande),
    montantRegle: Number(retour.reglement.montant),
    mode: retour.reglement.mode,
    regleLe: retour.reglement.confirmeAt ?? retour.reglement.createdAt,
    montantRetourne: Number(retour.montantARetourner),
    retourNul: estRetourNul({ montantARetourner: Number(retour.montantARetourner), mode: retour.reglement.mode }),
    receptionneLe: retour.receptionneAt,
    declarantNom: retour.declarant.fullName,
    creeParAssistant: retour.creeParAssistant,
    receptionneParNom: retour.receptionnePar?.fullName ?? "—",
    depenses,
    totalJustifie,
    totalNonJustifie,
    genereLe: new Date(),
  };

  const buffer = await renderToBuffer(<RetourReceiptDocument data={data} />);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="recu-retour-${recuReference}.pdf"`,
    },
  });
}
