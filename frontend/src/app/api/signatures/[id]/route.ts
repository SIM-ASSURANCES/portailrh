import { NextResponse } from "next/server";

import { getSession, hasPermission } from "@/lib/auth";
import { lireImageSignature, prisma, responsableServiceEffectif } from "backend";

/**
 * Image d'une signature manuscrite (lot L). Jamais d'URL publique : session obligatoire, puis accès accordé seulement à
 * (1) son propriétaire, (2) qui peut voir une action signée avec cette signature — l'équipe Finance / le DG / les lecteurs du
 * reporting, ou le demandeur, le bénéficiaire et le responsable de service de la demande concernée.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return new NextResponse("Non authentifié.", { status: 401 });

  const signature = await lireImageSignature(prisma, id);
  if (!signature) return new NextResponse("Signature introuvable.", { status: 404 });

  let autorise = signature.userId === session.user.id;
  if (!autorise) {
    const lecteurFinance = [
      "treso.voir_reporting",
      "treso.decider_dg",
      "treso.decider_finance",
      "treso.valider_demande",
      "treso.effectuer_reglement",
      "treso.receptionner_retour",
      "treso.voir_dashboard_finance",
      "treso.categoriser_demande",
    ].some((p) => hasPermission(session, p));
    if (lecteurFinance) {
      // Il faut qu'elle ait réellement signé une action : on ne sert pas une signature jamais utilisée.
      autorise = (await prisma.actionSignee.count({ where: { signatureId: id } })) > 0;
    } else {
      const actions = await prisma.actionSignee.findMany({
        where: { signatureId: id, demandeId: { not: null } },
        distinct: ["demandeId"],
        take: 200,
        select: { demandeId: true },
      });
      const demandes = actions.length
        ? await prisma.demande.findMany({
            where: { id: { in: actions.map((a) => a.demandeId!) } },
            select: {
              createurId: true,
              beneficiaireUserId: true,
              responsableEtapeServiceId: true,
              createur: { select: { service: { select: { responsableId: true } } } },
              lignes: { select: { beneficiaireUserId: true } },
            },
          })
        : [];
      autorise = demandes.some(
        (d) =>
          d.createurId === session.user.id ||
          d.beneficiaireUserId === session.user.id ||
          d.lignes.some((l) => l.beneficiaireUserId === session.user.id) ||
          responsableServiceEffectif(d, d.createur.service?.responsableId) === session.user.id
      );
    }
  }
  if (!autorise) return new NextResponse("Accès refusé.", { status: 403 });

  return new NextResponse(new Uint8Array(signature.image), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": 'inline; filename="signature.png"',
      "X-Content-Type-Options": "nosniff",
      // Une version de signature ne change jamais : le navigateur peut la garder (cache privé uniquement).
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
