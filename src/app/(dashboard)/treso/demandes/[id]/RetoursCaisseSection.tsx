import { prisma } from "@/lib/prisma";

import { RetourCaisseRow } from "./RetourCaisseRow";

/**
 * Section "Retours de caisse" : un règlement CAISSE confirmé et non annulé
 * de la demande = une ligne éligible à un retour. Rien n'est affiché si la
 * demande n'a aucun règlement de ce type (les règlements BANQUE ne donnent
 * jamais lieu à un retour de caisse). Server Component autonome : ne prend
 * que l'id de la demande.
 *
 * `peutDeclarer` (Ticket 7) : masque le bouton "Déclarer un retour de
 * caisse" une fois la demande clôturée — `creerRetourCaisseAction` le
 * refuserait de toute façon côté serveur, mais autant ne pas proposer une
 * action vouée à échouer (même principe que `canEffectuerReglement`).
 */
export async function RetoursCaisseSection({
  demandeId,
  peutDeclarer,
  userId,
}: {
  demandeId: string;
  peutDeclarer: boolean;
  /** Utilisateur connecté — sert à réserver le bouton "Modifier" au déclarant original de chaque retour. */
  userId: string;
}) {
  const reglements = await prisma.reglement.findMany({
    where: { demandeId, mode: "CAISSE", estConfirme: true, estAnnule: false },
    include: { retours: { include: { depenses: { include: { pieceJointe: true } } } } },
    orderBy: { createdAt: "asc" },
  });

  if (reglements.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-foreground">Retours de caisse</h2>
      <ul className="space-y-3">
        {reglements.map((r) => {
          const retour = r.retours[0];
          return (
            <RetourCaisseRow
              key={r.id}
              reglementId={r.id}
              montant={Number(r.montant)}
              retour={
                retour
                  ? {
                      id: retour.id,
                      estReceptionne: retour.estReceptionne,
                      montantARetourner: Number(retour.montantARetourner),
                      // Modification (avant réception) réservée au déclarant
                      // original — cohérent avec la déclaration elle-même.
                      peutModifier: !retour.estReceptionne && retour.declarantId === userId && peutDeclarer,
                      depenses: retour.depenses.map((d) => ({
                        id: d.id,
                        montant: Number(d.montant),
                        objet: d.objet,
                        date: d.date,
                        nature: d.nature,
                        justification: d.justification,
                        commentaire: d.commentaire,
                        pieceJointeId: d.pieceJointe?.id ?? null,
                      })),
                    }
                  : null
              }
              peutDeclarer={peutDeclarer}
            />
          );
        })}
      </ul>
    </div>
  );
}
