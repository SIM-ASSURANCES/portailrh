import {
  horairesPointage,
  messageAlerteDecideurJustification,
  messageClotureJustification,
  messageDemandeJustification,
  destinatairesDecideur,
  prisma,
  prochaineActionJustification,
  type DecideurJustification,
  type MessageJustification,
  type ParametresRelanceJustification,
} from "backend";
import { chargerComptesRH, decideurDuCollaborateur, SELECT_COLLABORATEUR_JUSTIFICATION } from "@/lib/justificationsPointage";
import { notify, notifyByPermission } from "@/lib/notifications";

export interface BilanRelances {
  examinees: number;
  envois: number;
  clotures: number;
  dejaTraitees: number;
  erreurs: number;
}

/**
 * Tâche planifiée du Pointage V2, lot 5 : demandes de justification, relances et clôture. Logique déplacée ici le 2026-10-14
 * (phase 2 de la fiabilisation) : appelée toutes les 5 minutes par le planificateur intégré et par la route
 * `/api/cron/relances-justification` (déclenchement manuel), via `executerTache` (verrou, ligne `ExecutionTache`). Lève en
 * cas d'échec global ; une erreur sur une justification est comptée dans `erreurs` sans arrêter les autres.
 *
 * Pour chaque justification EN_ATTENTE, `prochaineActionJustification` (moteur pur, paramètres RH du lot 2) dit quoi
 * faire. Idempotence : chaque envoi est RÉSERVÉ par une écriture conditionnelle (`nombreEnvois` attendu) et ne part que
 * si elle a réussi ; même principe pour la clôture (EN_ATTENTE → NON_JUSTIFIEE). Deux exécutions simultanées ou
 * rapprochées n'envoient donc jamais deux fois.
 *
 * Destinataires (§2 du plan) : le collaborateur (1er envoi : interne + push + e-mail, relances : interne + push) ; le
 * décideur — responsable actuel du service, sinon la RH du pointage (jamais le collaborateur lui-même) — au 1er envoi et
 * à la clôture seulement. Journal : un récapitulatif chiffré par exécution, erreurs repérées par identifiant seulement.
 */
export async function executerRelancesJustification(): Promise<BilanRelances> {
  const now = new Date();
  const bilan: BilanRelances = { examinees: 0, envois: 0, clotures: 0, dejaTraitees: 0, erreurs: 0 };
    const parametrage = await prisma.parametrageHoraire.findFirst({ where: { isActive: true } });
    const params: ParametresRelanceJustification = {
      delaiDemandeJustificationMinutes: parametrage?.delaiDemandeJustificationMinutes ?? 15,
      intervalleRelanceJustificationMinutes: parametrage?.intervalleRelanceJustificationMinutes ?? 30,
      nombreMaxRelancesJustification: parametrage?.nombreMaxRelancesJustification ?? 3,
      heureFinApresMidi: horairesPointage(parametrage).heureFinApresMidi,
    };

    const justifications = await prisma.justificationPointage.findMany({
      where: { statut: "EN_ATTENTE" },
      select: {
        id: true,
        statut: true,
        nombreEnvois: true,
        dernierEnvoiAt: true,
        pointage: {
          select: { id: true, type: true, heure: true, minutesRetard: true, user: { select: SELECT_COLLABORATEUR_JUSTIFICATION } },
        },
      },
    });
    bilan.examinees = justifications.length;
    // Comptes RH lus une fois par exécution : décideur RH, sinon DG (2026-10-12).
    const comptesRH = justifications.length > 0 ? await chargerComptesRH() : [];

    for (const j of justifications) {
      const action = prochaineActionJustification(
        { statut: j.statut, nombreEnvois: j.nombreEnvois, dernierEnvoiAt: j.dernierEnvoiAt, heurePointage: j.pointage.heure },
        params,
        now
      );
      if (action.type === "AUCUNE") continue;
      try {
        const collaborateur = j.pointage.user;
        const decideur = decideurDuCollaborateur(collaborateur, comptesRH);
        const contexte = {
          collaborateurNom: collaborateur.fullName,
          serviceNom: collaborateur.service?.name ?? null,
          decideur,
          pointage: j.pointage,
        };

        if (action.type === "ENVOI") {
          // Réservation : seule l'exécution qui fait passer le compteur de n−1 à n envoie.
          const { count } = await prisma.justificationPointage.updateMany({
            where: { id: j.id, statut: "EN_ATTENTE", nombreEnvois: action.numero - 1 },
            data: { nombreEnvois: action.numero, dernierEnvoiAt: now },
          });
          if (count !== 1) {
            bilan.dejaTraitees++;
            continue;
          }
          const m = messageDemandeJustification({ pointage: j.pointage, numero: action.numero, nombreMax: params.nombreMaxRelancesJustification });
          await notify({
            userId: collaborateur.id,
            titre: m.titre,
            message: m.message,
            lien: `/pointage/justifier/${j.pointage.id}`,
            priority: action.numero === 1 ? "CRITIQUE" : "IMPORTANT",
            category: "POINTAGE",
          });
          if (action.numero === 1) await notifierDecideur(decideur, collaborateur.id, messageAlerteDecideurJustification(contexte));
          bilan.envois++;
        } else {
          const { count } = await prisma.justificationPointage.updateMany({
            where: { id: j.id, statut: "EN_ATTENTE", nombreEnvois: j.nombreEnvois },
            data: { statut: "NON_JUSTIFIEE", clotureeAt: now },
          });
          if (count !== 1) {
            bilan.dejaTraitees++;
            continue;
          }
          await notifierDecideur(decideur, collaborateur.id, messageClotureJustification(contexte));
          bilan.clotures++;
        }
      } catch (e) {
        bilan.erreurs++;
        console.error(`[Cron relances-justification] Échec sur la justification ${j.id} :`, e instanceof Error ? e.message : e);
      }
    }

    console.info(`[Cron relances-justification] ${now.toISOString()} ${JSON.stringify(bilan)}`);
    return bilan;
}

/** Décideur : le responsable actuel du service, sinon la RH, sinon le DG ; jamais le collaborateur (`destinatairesDecideur`). */
async function notifierDecideur(decideur: DecideurJustification, collaborateurId: string, m: MessageJustification) {
  const commun = { titre: m.titre, message: m.message, lien: "/pointage/justifications", priority: "IMPORTANT" as const, category: "POINTAGE" as const };
  const dest = destinatairesDecideur(decideur, collaborateurId);
  if (dest.type === "COMPTE") {
    await notify({ userId: dest.userId, ...commun });
  } else {
    await notifyByPermission(dest.permission, { ...commun, excludeUserId: dest.exclureUserId });
  }
}
