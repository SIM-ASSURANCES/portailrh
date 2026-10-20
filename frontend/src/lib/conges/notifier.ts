import {
  LIBELLE_NATURE_CONGE,
  LIBELLE_STATUT_CONGE,
  type DecisionConge,
  type EntreeConge,
  type SoumissionConge,
} from "backend";
import { notify } from "@/lib/notifications";
import { frDate } from "@/lib/conges/format";

function destinatairesUniques(ids: readonly string[], auteurId: string): string[] {
  return [...new Set(ids)].filter((id) => id !== auteurId);
}

function libellePeriode(dateDebut: string, dateFin: string): string {
  return dateDebut === dateFin ? frDate(dateDebut) : `du ${frDate(dateDebut)} au ${frDate(dateFin)}`;
}

export async function notifierSoumissionConge(params: {
  soumission: SoumissionConge;
  demandeurNom: string;
  nature: EntreeConge["nature"];
  dateDebut: string;
  dateFin: string;
  auteurId: string;
}): Promise<void> {
  const destinataires = destinatairesUniques(params.soumission.destinataires, params.auteurId);
  const message = `${params.demandeurNom} a soumis ${LIBELLE_NATURE_CONGE[params.nature].toLowerCase()} ${params.soumission.reference}, ${libellePeriode(params.dateDebut, params.dateFin)} (${params.soumission.nbJoursOuvres} jours ouvrés).`;

  await Promise.all(
    destinataires.map((userId) =>
      notify({
        userId,
        titre: "Demande de congé à examiner",
        message,
        lien: `/conges/${params.soumission.id}`,
        priority: "IMPORTANT",
        category: "RH",
      })
    )
  );
}

export async function notifierDecisionConge(params: {
  decision: DecisionConge;
  acteurId: string;
  acteurNom: string;
}): Promise<void> {
  const { decision } = params;
  const destinataires = destinatairesUniques(
    [decision.demandeurId, ...decision.destinatairesSuivants],
    params.acteurId
  );
  const titreParStatut: Record<DecisionConge["statut"], string> = {
    EN_ATTENTE_RESPONSABLE: "Demande de congé à examiner",
    EN_ATTENTE_RH: "Demande de congé transmise à la RH",
    MODIFICATION_DEMANDEE: "Modification demandée pour votre congé",
    VALIDEE: "Demande de congé validée",
    REJETEE: "Demande de congé rejetée",
    ANNULEE: "Demande de congé annulée",
  };
  const details = [
    `${params.acteurNom} a mis à jour la demande ${decision.reference} : ${LIBELLE_STATUT_CONGE[decision.statut].toLowerCase()}.`,
    decision.motif ? `Motif : ${decision.motif}` : null,
    decision.observationRH ? `Observation RH : ${decision.observationRH}` : null,
    decision.absencesCreees > 0
      ? `${decision.absencesCreees} jour(s) passé(s) ont été enregistrés comme absence à contrôler.`
      : null,
  ].filter((detail): detail is string => detail !== null);

  await Promise.all(
    destinataires.map((userId) =>
      notify({
        userId,
        titre: titreParStatut[decision.statut],
        message: details.join(" "),
        lien: `/conges/${decision.id}`,
        priority: "IMPORTANT",
        category: "RH",
      })
    )
  );
}

export async function notifierSaisieRHConge(params: {
  demandeId: string;
  reference: string;
  nature: EntreeConge["nature"];
  dateDebut: string;
  dateFin: string;
  salarieId: string;
  auteurId: string;
}): Promise<void> {
  const destinataires = destinatairesUniques([params.salarieId], params.auteurId);
  await Promise.all(
    destinataires.map((userId) =>
      notify({
        userId,
        titre: "Congé enregistré par la RH",
        message: `La RH a enregistré et validé ${LIBELLE_NATURE_CONGE[params.nature].toLowerCase()} ${params.reference}, ${libellePeriode(params.dateDebut, params.dateFin)}.`,
        lien: `/conges/${params.demandeId}`,
        priority: "IMPORTANT",
        category: "RH",
      })
    )
  );
}
