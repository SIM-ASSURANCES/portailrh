import { getCouvertureRetoursPostCloture, getDateDernierReglementConfirme, getMontantsDefinitifsRetours } from "backend";
import { prisma } from "backend";

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
 *
 * **Retours multiples** (voir CLAUDE.md "Retours multiples autorisés sur
 * une même demande") — affiche désormais TOUS les retours de chaque
 * règlement (`r.retours`, pas seulement `r.retours[0]`), y compris ceux
 * créés par l'Assistant Finance en l'absence de déclaration du
 * collaborateur (Tâche "L'Assistant Finance déclare les dépenses...") :
 * leurs pièces jointes doivent rester consultables ici (Tâche "Visibilité
 * des pièces jointes pour le Collaborateur"), en pure lecture (aucune
 * action de modification n'est jamais proposée pour un retour dont
 * `declarantId` n'est pas l'utilisateur connecté).
 *
 * **Détail réel + signalement** (Tâches "Le Collaborateur voit le détail
 * réel"/"Signalement d'erreur par le Collaborateur", voir CLAUDE.md) —
 * transmet désormais `motifNonJustifie`/`motifNonJustifiePar` par ligne
 * (jamais affiché avant cette tâche côté Collaborateur) et le signalement
 * ACTIF éventuel de chaque retour (`estResolu: false`), pour que le bouton
 * "Signaler une erreur" reflète déjà un signalement en cours plutôt que
 * d'en proposer un second.
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
  const [reglements, dateDernierReglement] = await Promise.all([
    prisma.reglement.findMany({
      where: { demandeId, estConfirme: true, estAnnule: false },
      include: {
        retours: {
          include: {
            depenses: { include: { pieceJointe: true, motifNonJustifiePar: true } },
            signalements: { orderBy: { signaleAt: "desc" } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    getDateDernierReglementConfirme(demandeId),
  ]);

  if (reglements.length === 0) {
    return null;
  }

  // Retours exceptionnels post-clôture VALIDÉS imputés sur les retours non réceptionnés (source unique partagée avec l'écran Finance).
  const couvertParRetour = await getCouvertureRetoursPostCloture(demandeId);
  // "Montant à retourner définitif" (net après compléments/remboursements) : c'est l'argent du Collaborateur, il le voit aussi.
  const definitifs = await getMontantsDefinitifsRetours(reglements.flatMap((r) => r.retours.map((t) => t.id)));

  const dateMin = dateDernierReglement ? dateDernierReglement.toISOString().slice(0, 10) : undefined;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-foreground">Retours de caisse</h2>
      <ul className="space-y-3">
        {reglements.map((r, index) => (
          <RetourCaisseRow
            key={r.id}
            reglementId={r.id}
            modeReglement={r.mode}
            montant={Number(r.montant)}
            retours={r.retours.map((retour) => ({
              id: retour.id,
              estReceptionne: retour.estReceptionne,
              montantARetourner: Number(retour.montantARetourner),
              dejaCouvertPostCloture: couvertParRetour.get(retour.id) ?? 0,
              montantDefinitif: definitifs.get(retour.id)?.aCorrection ? definitifs.get(retour.id)! : null,
              peutSignaler: peutDeclarer || !!retour.motifReouvertureExceptionnelle,
              dateRetour: retour.dateRetour,
              creeParAssistant: retour.creeParAssistant,
              // Modification (avant réception) réservée au déclarant
              // original — cohérent avec la déclaration elle-même. Un
              // retour créé par l'Assistant Finance (declarantId = son
              // propre id) n'est donc jamais modifiable depuis cet écran
              // Collaborateur.
              peutModifier: !retour.estReceptionne && retour.declarantId === userId && peutDeclarer && r.mode !== "BANQUE",
              depenses: retour.depenses.map((d) => ({
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
              signalementActif: retour.signalements.find((s) => !s.estResolu)
                ? { commentaire: retour.signalements.find((s) => !s.estResolu)!.commentaire }
                : null,
            }))}
            peutDeclarer={peutDeclarer}
            dateMin={dateMin}
            repere={
              reglements.length > 1
                ? `Règlement ${index + 1}/${reglements.length}${r.mode === "BANQUE" ? " (Banque)" : ""} — ${(r.confirmeAt ?? r.createdAt).toLocaleDateString("fr-FR")}`
                : undefined
            }
          />
        ))}
      </ul>
    </div>
  );
}
