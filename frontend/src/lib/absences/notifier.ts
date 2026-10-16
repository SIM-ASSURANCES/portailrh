// Notifications des permissions d'absence (Lot 4). Même principe que les congés : CIBLÉES (le décideur de l'étape qui
// vient d'être atteinte, calculé par le moteur, puis le demandeur pour l'issue). Jamais tous les porteurs d'une
// permission, jamais l'auteur de l'action. Liens relatifs (les gabarits d'e-mail les préfixent avec `urlPublique()`).

import type { DecisionPermission, SoumissionPermission } from "backend";
import { formatMinutesEnHeures } from "backend";
import { notify } from "@/lib/notifications";

function frDate(jour: string): string {
  return jour.split("-").reverse().join("/");
}

export async function notifierSoumissionPermission(p: {
  soumission: SoumissionPermission;
  demandeurNom: string;
  date: string;
  heureDepart: string;
  heureRetourPrevue: string;
  auteurId: string;
}) {
  const { soumission: s } = p;
  const plafond = s.auDelaDuPlafond ? " Le plafond mensuel de ce type est déjà atteint : un accord demandera une dérogation de la RH." : "";
  await Promise.all(
    s.destinataires
      .filter((id) => id !== p.auteurId)
      .map((userId) =>
        notify({
          userId,
          titre: "Permission d'absence à examiner",
          message: `${p.demandeurNom} demande une permission (${s.libelleType}, ${formatMinutesEnHeures(s.dureeMinutes)}) le ${frDate(p.date)} de ${p.heureDepart} à ${p.heureRetourPrevue}. Référence ${s.reference}.${plafond}`,
          lien: `/permissions-absence/${s.id}`,
          priority: "IMPORTANT",
          category: "RH",
        })
      )
  );
}

export async function notifierDecisionPermission(p: { decision: DecisionPermission; acteurId: string; acteurNom: string }) {
  const d = p.decision;
  const quand = `le ${frDate(d.date)} de ${d.heureDepart} à ${d.heureRetourPrevue}`;
  const lien = `/permissions-absence/${d.id}`;
  const envois: Promise<unknown>[] = [];

  if (d.statut === "EN_ATTENTE_RH" || d.statut === "EN_ATTENTE_RESPONSABLE") {
    for (const userId of d.destinatairesSuivants.filter((id) => id !== p.acteurId)) {
      envois.push(
        notify({
          userId,
          titre: "Permission d'absence à examiner",
          message: `Demande ${d.reference} (${d.libelleType}, ${quand}) en attente de votre décision.`,
          lien,
          priority: "IMPORTANT",
          category: "RH",
        })
      );
    }
  }

  if (d.demandeurId !== p.acteurId) {
    const base = `Votre permission ${d.reference} (${d.libelleType}, ${quand})`;
    const parStatut: Record<string, { titre: string; message: string; priority: "INFO" | "IMPORTANT" } | undefined> = {
      EN_ATTENTE_RH: { titre: "Permission approuvée par votre responsable", message: `${base} a été approuvée par ${p.acteurNom} ; elle attend maintenant la RH.`, priority: "INFO" },
      APPROUVEE: {
        titre: "Permission approuvée",
        message: `${base} est approuvée.${d.exceptionPlafond ? " Elle dépasse le plafond mensuel : la RH a accordé une dérogation." : ""}`,
        priority: "IMPORTANT",
      },
      REJETEE: { titre: "Permission rejetée", message: `${base} est rejetée par ${p.acteurNom}.${d.motif ? ` Motif : ${d.motif}` : ""}`, priority: "IMPORTANT" },
      ANNULEE: { titre: "Permission annulée", message: `${base} a été annulée par ${p.acteurNom}.${d.motif ? ` Motif : ${d.motif}` : ""}`, priority: "IMPORTANT" },
    };
    const msg = parStatut[d.statut];
    if (msg) envois.push(notify({ userId: d.demandeurId, titre: msg.titre, message: msg.message, lien, priority: msg.priority, category: "RH" }));
  }
  await Promise.all(envois);
}
