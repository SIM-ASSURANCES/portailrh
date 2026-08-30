import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";

import { getBeneficiaireNom } from "@/components/tresorerie/beneficiaire";
import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BonDeCaisseDocument, type BonDeCaisseData } from "@/lib/pdf/BonDeCaisseDocument";

/**
 * Génère le bon de caisse PDF d'un règlement CAISSE confirmé (Phase E,
 * cahier des charges section 12.1) — document DISTINCT du reçu complet
 * (Ticket 9, `/api/treso/reglements/[id]/recu`) : volontairement
 * minimaliste, ne contient que le montant réglé lors de cette opération
 * précise. Voir `BonDeCaisseDocument.tsx` pour la justification détaillée
 * de cette différence.
 *
 * Mêmes règles d'accès EXACTEMENT que le reçu (Ticket 9) : Finance/DG
 * (n'importe laquelle des permissions Trésorerie du dashboard Finance)
 * **OU** le collaborateur créateur de la demande liée à ce règlement.
 * Jamais un autre collaborateur.
 *
 * 404 si le règlement n'existe pas OU n'est pas confirmé (même règle que
 * le reçu) ; 400 si le règlement existe et est confirmé mais n'est PAS en
 * mode CAISSE (un bon de caisse n'a pas de sens pour un règlement Banque) ;
 * 401 si non authentifié ; 403 si authentifié mais ni Finance/DG ni
 * créateur de la demande.
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
      demande: { include: { createur: true, beneficiaireUser: true } },
      auteur: true,
    },
  });

  if (!reglement || !reglement.estConfirme) {
    return new NextResponse("Bon de caisse introuvable.", { status: 404 });
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

  if (reglement.mode !== "CAISSE") {
    return new NextResponse("Le bon de caisse n'est disponible que pour les règlements en Caisse.", {
      status: 400,
    });
  }

  const data: BonDeCaisseData = {
    demandeReference: reglement.demande.reference,
    beneficiaireNom: getBeneficiaireNom(reglement.demande),
    confirmeLe: reglement.confirmeAt ?? reglement.createdAt,
    montant: Number(reglement.montant),
    auteurNom: reglement.auteur.fullName,
    genereLe: new Date(),
  };

  const buffer = await renderToBuffer(<BonDeCaisseDocument data={data} />);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="bon-de-caisse-${reglement.demande.reference}.pdf"`,
    },
  });
}
