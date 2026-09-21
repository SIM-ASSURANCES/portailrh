import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import { RETOUR_EN_ATTENTE_WHERE } from "backend";
import { prisma } from "backend";

import { RetoursEnAttenteTable } from "./RetoursEnAttenteTable";

/**
 * "Retours en attente" — tous les `RetourCaisse` non encore réceptionnés,
 * tous collaborateurs confondus, triés par ancienneté croissante (même
 * convention que `finance/demandes` : les plus anciens en premier).
 * Distincte de la garde générique de `finance/layout.tsx` (qui accepte
 * categoriser_demande OU valider_demande OU receptionner_retour) : cette
 * page exige précisément `treso.receptionner_retour` OU (depuis "Accès
 * lecture seule du Responsable Finance à Retours en attente", voir
 * CLAUDE.md) `treso.valider_demande` — jamais supposée acquise du simple
 * fait d'avoir passé le layout.
 *
 * **Lecture seule pour le Responsable Finance** — depuis la séparation
 * Responsable/Assistant Finance, `treso.receptionner_retour` est devenue
 * l'exclusivité de l'Assistant. Le Responsable (`treso.valider_demande`,
 * jamais `receptionner_retour`) garde néanmoins un accès de consultation
 * complet à cette liste (montants, collaborateurs, statuts) — seules les
 * actions (`Réceptionner`, `Marquer non justifiée`) restent visibles mais
 * désactivées, jamais un redirect. Un compte n'ayant NI l'une NI l'autre
 * permission (ex: DG, Collaborateur) reste redirigé comme avant.
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
  const canReceptionner = !!session && hasPermission(session, "treso.receptionner_retour");
  const canConsulterLectureSeule = !!session && hasPermission(session, "treso.valider_demande");
  if (!canReceptionner && !canConsulterLectureSeule) {
    redirect("/?error=acces_refuse_receptionner_retour");
  }

  const rawRetours = await prisma.retourCaisse.findMany({
    where: RETOUR_EN_ATTENTE_WHERE,
    include: {
      declarant: true,
      reglement: { include: { demande: true } },
      depenses: { include: { pieceJointe: true, motifNonJustifiePar: true } },
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
      dateRetour: r.dateRetour,
      depenses: r.depenses.map((d) => ({
        id: d.id,
        montant: Number(d.montant),
        objet: d.objet,
        date: d.date,
        nature: d.nature,
        justification: d.justification,
        commentaire: d.commentaire,
        pieceJointeId: d.pieceJointe?.id ?? null,
        motifNonJustifie: d.motifNonJustifie,
        motifNonJustifiePar: d.motifNonJustifiePar?.fullName ?? null,
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
      {!canReceptionner ? (
        <p className="rounded-md bg-info-bg px-3 py-2 text-sm text-info">
          Consultation en lecture seule : la réception des retours de caisse et le marquage des dépenses non
          justifiées sont réservés à l&apos;Assistant Finance.
        </p>
      ) : null}
      <RetoursEnAttenteTable retours={retours} disabled={!canReceptionner} />
    </div>
  );
}
