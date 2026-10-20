import {
  chargerContexteCircuit,
  destinatairesEtapeConge,
  jourCivilDepuisColonneDate,
  messageRappelConge,
  prioriteRappelConge,
  prisma,
  rappelCongeDu,
} from "backend";
import { aujourdhui } from "@/lib/conges/format";
import { notify } from "@/lib/notifications";

export interface BilanRappelsConges {
  examinees: number;
  rappels: number;
  sansDestinataire: number;
  erreurs: number;
}

/**
 * Rappel quotidien des demandes de congé en attente (`EN_ATTENTE_RESPONSABLE`, `EN_ATTENTE_RH`) depuis au moins 24 h.
 * Chaque demande est réservée par `updateMany` conditionné au statut et à `dernierRappelAt` lu AVANT tout envoi :
 * deux exécutions simultanées ne peuvent jamais envoyer deux rappels pour la même demande.
 */
export async function executerRappelsConges(): Promise<BilanRappelsConges> {
  const now = new Date();
  const jourCourant = aujourdhui();
  const demandes = await prisma.demandeConge.findMany({
    where: { statut: { in: ["EN_ATTENTE_RESPONSABLE", "EN_ATTENTE_RH"] } },
    select: {
      id: true,
      reference: true,
      nature: true,
      dateDebut: true,
      dateFin: true,
      nbJoursOuvres: true,
      statut: true,
      etapeDepuis: true,
      dernierRappelAt: true,
      userId: true,
      user: { select: { fullName: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const bilan: BilanRappelsConges = {
    examinees: demandes.length,
    rappels: 0,
    sansDestinataire: 0,
    erreurs: 0,
  };

  for (const d of demandes) {
    try {
      if (
        !rappelCongeDu({
          statut: d.statut,
          dernierRappelAt: d.dernierRappelAt,
          etapeDepuis: d.etapeDepuis,
          now,
        })
      ) {
        continue;
      }

      const reserve = await prisma.demandeConge.updateMany({
        where: { id: d.id, statut: d.statut, dernierRappelAt: d.dernierRappelAt },
        data: { dernierRappelAt: now },
      });
      if (reserve.count === 0) continue;

      const ctx = await chargerContexteCircuit(prisma, d.userId);
      const destinataires = [...new Set(destinatairesEtapeConge(d.statut, ctx))].filter(
        (id) => id !== d.userId
      );
      if (destinataires.length === 0) {
        bilan.sansDestinataire++;
        continue;
      }

      const debutCivil = jourCivilDepuisColonneDate(d.dateDebut);
      const finCivil = jourCivilDepuisColonneDate(d.dateFin);
      const priority = prioriteRappelConge({ dateDebut: debutCivil, aujourdhui: jourCourant });
      const message = messageRappelConge({
        demandeurNom: d.user.fullName,
        reference: d.reference,
        nature: d.nature,
        dateDebut: debutCivil,
        dateFin: finCivil,
        nbJoursOuvres: d.nbJoursOuvres,
      });

      await Promise.all(
        destinataires.map((userId) =>
          notify({
            userId,
            titre: "Demande de congé en attente",
            message,
            lien: `/conges/${d.id}`,
            priority,
            category: "RH",
          })
        )
      );
      bilan.rappels++;
    } catch (err) {
      bilan.erreurs++;
      console.error("[Tâche rappels-conges] Erreur demande", d.id, err instanceof Error ? err.message : "Erreur");
    }
  }

  console.info(
    `[Tâche rappels-conges] Examinées : ${bilan.examinees}, rappels : ${bilan.rappels}, sans destinataire : ${bilan.sansDestinataire}, erreurs : ${bilan.erreurs}`
  );
  return bilan;
}
