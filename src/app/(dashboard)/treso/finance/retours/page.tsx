import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { RETOUR_EN_ATTENTE_WHERE } from "@/lib/dashboardFinance";
import { prisma } from "@/lib/prisma";

import { RetoursEnAttenteTable } from "./RetoursEnAttenteTable";

/**
 * "Retours en attente" — tous les `RetourCaisse` non encore réceptionnés,
 * tous collaborateurs confondus, triés par ancienneté croissante (même
 * convention que `finance/demandes` : les plus anciens en premier).
 * Distincte de la garde générique de `finance/layout.tsx` (qui accepte
 * categoriser_demande OU valider_demande OU receptionner_retour) : cette
 * page exige précisément `treso.receptionner_retour`, jamais supposée
 * acquise du simple fait d'avoir passé le layout.
 *
 * Exclut aussi les retours dont la demande n'est plus `VALIDEE` (Ticket 7) :
 * une demande clôturée avec un retour resté en attente ne doit plus
 * proposer de bouton "Réceptionner" voué à échouer côté serveur
 * (`receptionnerRetourAction` le refuserait de toute façon, mais autant ne
 * pas l'afficher — même principe que `canEffectuerReglement` au Ticket 4).
 * Filtre factorisé dans `RETOUR_EN_ATTENTE_WHERE` (Ticket 8) : le compteur
 * "Retours de caisse en attente" du dashboard Finance désigne exactement
 * le même ensemble de lignes que cette liste.
 */
export default async function RetoursEnAttentePage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.receptionner_retour")) {
    redirect("/?error=acces_refuse_receptionner_retour");
  }

  const rawRetours = await prisma.retourCaisse.findMany({
    where: RETOUR_EN_ATTENTE_WHERE,
    include: {
      declarant: true,
      reglement: { include: { demande: true } },
      depenses: { include: { pieceJointe: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // REFONTE V1 / Phase D (voir CLAUDE.md "Refonte V1 en cours") : un retour
  // n'a plus de montant dépensé/justification/commentaire uniques — chaque
  // ligne de dépense (`depenses`) porte désormais sa propre justification.
  const retours = rawRetours.map((r) => {
    const totalDeclare = r.depenses.reduce((sum, d) => sum + Number(d.montant), 0);
    const montantNonJustifie = r.depenses
      .filter((d) => d.justification === "SANS_PIECE")
      .reduce((sum, d) => sum + Number(d.montant), 0);
    return {
      id: r.id,
      demandeReference: r.reglement.demande.reference,
      declarantNom: r.declarant.fullName,
      reglementMontant: Number(r.reglement.montant),
      reglementMode: r.reglement.mode,
      totalDeclare,
      montantARetourner: Number(r.montantARetourner),
      montantNonJustifie,
      depenses: r.depenses.map((d) => ({
        id: d.id,
        montant: Number(d.montant),
        objet: d.objet,
        date: d.date,
        nature: d.nature,
        justification: d.justification,
        commentaire: d.commentaire,
        pieceJointeId: d.pieceJointe?.id ?? null,
      })),
      createdAt: r.createdAt,
    };
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Retours en attente"
        description="Retours de caisse déclarés par les collaborateurs, en attente de réception. Triés par ancienneté : les plus anciens en premier."
      />
      <RetoursEnAttenteTable retours={retours} />
    </div>
  );
}
