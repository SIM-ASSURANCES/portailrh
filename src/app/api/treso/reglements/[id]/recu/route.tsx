import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";

import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ReceiptDocument, type ReceiptData } from "@/lib/pdf/ReceiptDocument";
import { getResteARegler, getTotalRegle } from "@/lib/tresorerie";

/**
 * Génère le reçu PDF d'un règlement confirmé (Ticket 9).
 *
 * Accès : Finance/DG (n'importe laquelle des permissions Trésorerie du
 * dashboard Finance — `treso.effectuer_reglement`, `treso.categoriser_demande`,
 * `treso.valider_demande`, `treso.receptionner_retour`,
 * `treso.voir_dashboard_finance`) **OU** le collaborateur créateur de la
 * demande liée à ce règlement (il peut voir le reçu de son propre
 * décaissement). Jamais un autre collaborateur.
 *
 * 404 si le règlement n'existe pas OU n'est pas confirmé (un brouillon n'a
 * pas de reçu — pas encore un paiement réel) ; 401 si non authentifié ; 403
 * si authentifié mais ni Finance/DG ni créateur de la demande.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await getSession();
  if (!session) {
    return new NextResponse("Non authentifié.", { status: 401 });
  }

  const reglement = await prisma.reglement.findUnique({
    where: { id },
    include: {
      demande: { include: { createur: true, categorie: true, objet: true } },
      auteur: true,
    },
  });

  if (!reglement || !reglement.estConfirme) {
    return new NextResponse("Reçu introuvable.", { status: 404 });
  }

  const estFinanceOuDG =
    hasPermission(session, "treso.effectuer_reglement") ||
    hasPermission(session, "treso.categoriser_demande") ||
    hasPermission(session, "treso.valider_demande") ||
    hasPermission(session, "treso.receptionner_retour") ||
    hasPermission(session, "treso.voir_dashboard_finance");
  const estCreateurDemande = reglement.demande.createurId === session.user.id;

  if (!estFinanceOuDG && !estCreateurDemande) {
    return new NextResponse("Accès refusé.", { status: 403 });
  }

  // Référence du reçu = référence de la demande + rang du règlement parmi
  // les règlements confirmés de cette demande, dans l'ordre de création.
  const reglementsConfirmes = await prisma.reglement.findMany({
    where: { demandeId: reglement.demandeId, estConfirme: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const rang = reglementsConfirmes.findIndex((r) => r.id === reglement.id) + 1;
  const recuReference = `${reglement.demande.reference}-R${rang}`;

  // Correction (audit de conformité) : montant demandé, total réglé et
  // reste à régler sont l'état LE PLUS À JOUR au moment de la génération du
  // reçu, jamais figés à la date de ce règlement précis — un même règlement
  // téléchargé à deux moments différents peut donc afficher un "reste à
  // régler" différent si d'autres règlements sont intervenus depuis.
  const [totalRegleADate, resteARegler] = await Promise.all([
    getTotalRegle(reglement.demandeId),
    getResteARegler(reglement.demandeId),
  ]);

  const data: ReceiptData = {
    recuReference,
    demandeReference: reglement.demande.reference,
    demandeurNom: reglement.demande.createur.fullName,
    categorieLabel: reglement.demande.categorie?.label ?? null,
    objetLabel: reglement.demande.objet?.label ?? null,
    montant: Number(reglement.montant),
    mode: reglement.mode,
    confirmeLe: reglement.confirmeAt ?? reglement.createdAt,
    auteurNom: reglement.auteur.fullName,
    genereLe: new Date(),
    montantDemande: Number(reglement.demande.montant),
    totalRegleADate,
    resteARegler,
  };

  const buffer = await renderToBuffer(<ReceiptDocument data={data} />);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="recu-${reglement.demande.reference}-R${rang}.pdf"`,
    },
  });
}
