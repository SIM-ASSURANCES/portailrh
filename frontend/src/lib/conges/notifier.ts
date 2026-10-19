// Notifications des congés (Lot 3b). Toujours CIBLÉES (correction I2 du plan de fusion) : le décideur de l'étape qui
// vient d'être atteinte (calculé par le moteur, `destinatairesEtapeAbsence`), puis le demandeur pour l'issue de sa
// demande. Jamais tous les porteurs d'une permission, jamais l'auteur de l'action. Les liens sont relatifs : les
// gabarits d'e-mail les préfixent avec `urlPublique()`.

import type { DecisionConge, ObservationDG, SoumissionConge } from "backend";
import { notify } from "@/lib/notifications";

function frDate(jour: string): string {
  const [a, m, j] = jour.split("-");
  return `${j}/${m}/${a}`;
}

export async function notifierSoumissionConge(p: {
  soumission: SoumissionConge;
  demandeurNom: string;
  dateDebut: string;
  dateFin: string;
  auteurId: string;
}) {
  const { soumission: s } = p;
  await Promise.all(
    s.destinataires
      .filter((id) => id !== p.auteurId)
      .map((userId) =>
        notify({
          userId,
          titre: "Demande de congé à examiner",
          message: `${p.demandeurNom} demande un congé (${s.libelleType}, ${s.nbJours} jour(s)) du ${frDate(p.dateDebut)} au ${frDate(p.dateFin)}. Référence ${s.reference}.`,
          lien: `/conges/${s.id}`,
          priority: "IMPORTANT",
          category: "RH",
        })
      )
  );
}

export async function notifierDecisionConge(p: { decision: DecisionConge; acteurId: string; acteurNom: string }) {
  const d = p.decision;
  const periode = `du ${frDate(d.dateDebut)} au ${frDate(d.dateFin)}`;
  const lien = `/conges/${d.id}`;
  const envois: Promise<unknown>[] = [];

  // Étape suivante : ses décideurs (le responsable a approuvé → la RH ; renvoi après modification…).
  if (d.statut === "EN_ATTENTE_RH" || d.statut === "EN_ATTENTE_RESPONSABLE") {
    for (const userId of d.destinatairesSuivants.filter((id) => id !== p.acteurId)) {
      envois.push(
        notify({
          userId,
          titre: "Demande de congé à examiner",
          message: `Demande ${d.reference} (${d.libelleType}, ${d.nbJours} jour(s), ${periode}) en attente de votre décision.`,
          lien,
          priority: "IMPORTANT",
          category: "RH",
        })
      );
    }
  }

  // Issue pour le demandeur (sauf s'il est l'auteur de l'action : annulation de sa propre demande).
  if (d.demandeurId !== p.acteurId) {
    const base = `Votre demande ${d.reference} (${d.libelleType}, ${periode})`;
    const parStatut: Record<string, { titre: string; message: string; priority: "INFO" | "IMPORTANT" } | undefined> = {
      EN_ATTENTE_RH: { titre: "Congé approuvé par votre responsable", message: `${base} a été approuvée par ${p.acteurNom} ; elle attend maintenant la RH.`, priority: "INFO" },
      VALIDEE: { titre: "Congé validé", message: `${base} est validée.`, priority: "IMPORTANT" },
      REJETEE: { titre: "Congé rejeté", message: `${base} est rejetée par ${p.acteurNom}.${d.motif ? ` Motif : ${d.motif}` : ""}`, priority: "IMPORTANT" },
      MODIFICATION_DEMANDEE: { titre: "Modification demandée sur votre congé", message: `${p.acteurNom} demande une modification de ${base.toLowerCase()}.${d.motif ? ` ${d.motif}` : ""}`, priority: "IMPORTANT" },
      ANNULEE: { titre: "Congé annulé", message: `${base} a été annulée par ${p.acteurNom}.${d.motif ? ` Motif : ${d.motif}` : ""}`, priority: "IMPORTANT" },
    };
    const msg = parStatut[d.statut];
    if (msg) envois.push(notify({ userId: d.demandeurId, titre: msg.titre, message: msg.message, lien, priority: msg.priority, category: "RH" }));
  }
  await Promise.all(envois);
}

/**
 * Observation du DG (C3) : une INFORMATION pour le demandeur et la RH, jamais une demande d'action. Priorité INFO, aucun rappel
 * (les rappels ne portent que sur les demandes en attente de décision). Le texte complet est lisible sur la demande.
 */
export async function notifierObservationDG(p: { observation: ObservationDG; acteurNom: string; texte: string }) {
  const o = p.observation;
  const lien = `/conges/${o.demandeId}`;
  await Promise.all(
    o.destinataires.map((userId) =>
      notify({
        userId,
        titre: "Observation du DG",
        message: `${p.acteurNom} a ajouté une observation sur ${userId === o.demandeurId ? "votre" : "le"} congé ${o.reference} (${o.libelleType}) : ${p.texte}`,
        lien,
        priority: "INFO",
        category: "RH",
      })
    )
  );
}
