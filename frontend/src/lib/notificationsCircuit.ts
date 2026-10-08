import {
  notificationApprobationCloture,
  notificationRappel,
  notificationsEtape,
  PERMISSIONS_NOTIFICATION_CIRCUIT,
  prisma,
  reserverRappelsDus,
  type CandidatNotification,
  type ContexteNotificationCircuit,
  type NotificationCircuit,
} from "backend";

import { notify } from "@/lib/notifications";

/**
 * Notifications du circuit de validation (commit 5, 2026-10-09) : envoi par le service de notifications existant
 * (`notify` : base, cloche en temps réel, push, e-mail selon la priorité). Les destinataires et les messages viennent
 * de `backend/src/circuitNotifications.ts`. Appelé APRÈS l'écriture : un échec d'envoi est journalisé, jamais remonté
 * (la décision est déjà enregistrée).
 */

async function chargerContexte(demandeId: string): Promise<ContexteNotificationCircuit | null> {
  const d = await prisma.demande.findUnique({
    where: { id: demandeId },
    select: {
      id: true,
      reference: true,
      etapeCircuit: true,
      typeDemande: true,
      createurId: true,
      beneficiaireUserId: true,
      modeEtapeDG: true,
      decideurFinanceId: true,
      dgApprobateurId: true,
      niveauRejet: true,
      motifRejet: true,
      montant: true,
      montantValide: true,
      approbationClotureNonRequise: true,
      validationCompleteParDG: true,
      createur: { select: { fullName: true, service: { select: { responsableId: true } } } },
    },
  });
  if (!d) return null;
  return {
    demandeId: d.id,
    reference: d.reference,
    etape: d.etapeCircuit,
    typeDemande: d.typeDemande,
    createurId: d.createurId,
    createurNom: d.createur.fullName,
    beneficiaireUserId: d.beneficiaireUserId,
    modeEtapeDG: d.modeEtapeDG,
    decideurFinanceId: d.decideurFinanceId,
    dgApprobateurId: d.dgApprobateurId,
    responsableServiceId: d.createur.service?.responsableId ?? null,
    niveauRejet: d.niveauRejet,
    motifRejet: d.motifRejet,
    montant: Number(d.montant),
    montantValide: d.montantValide === null ? null : Number(d.montantValide),
    approbationClotureNonRequise: d.approbationClotureNonRequise,
    validationCompleteParDG: d.validationCompleteParDG,
  };
}

/** Comptes ACTIFS portant une permission du circuit par leur rôle, plus le responsable du service s'il est actif. */
async function chargerCandidats(responsableServiceId: string | null): Promise<CandidatNotification[]> {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [
        { role: { permissions: { some: { permission: { key: { in: [...PERMISSIONS_NOTIFICATION_CIRCUIT] } } } } } },
        ...(responsableServiceId ? [{ id: responsableServiceId }] : []),
      ],
    },
    select: { id: true, role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } },
  });
  return users.map((u) => ({ id: u.id, permissions: u.role.permissions.map((rp) => rp.permission.key) }));
}

async function envoyer(notifications: NotificationCircuit[]) {
  for (const n of notifications) {
    for (const userId of n.destinataires) {
      await notify({ userId, titre: n.titre, message: n.message, lien: n.lien, priority: n.priority, category: "TRESORERIE" });
    }
  }
}

/** Après un passage d'étape (création, décision, rejet, soumission, resoumission) : notifie ceux qui doivent agir. */
export async function notifierEtapeCircuit(demandeId: string, acteurId: string): Promise<void> {
  try {
    const ctx = await chargerContexte(demandeId);
    if (!ctx) return;
    await envoyer(notificationsEtape(ctx, await chargerCandidats(ctx.responsableServiceId), acteurId));
  } catch (e) {
    console.error(`[Circuit] Notification de la demande ${demandeId} impossible :`, e);
  }
}

/** Approbation de clôture devenue due hors passage d'étape (validation complémentaire d'une dépense directe). */
export async function notifierApprobationCloture(demandeId: string, acteurId: string): Promise<void> {
  try {
    const ctx = await chargerContexte(demandeId);
    if (!ctx) return;
    const n = notificationApprobationCloture(ctx, await chargerCandidats(null));
    if (n) await envoyer([{ ...n, destinataires: n.destinataires.filter((id) => id !== acteurId) }]);
  } catch (e) {
    console.error(`[Circuit] Notification de clôture de la demande ${demandeId} impossible :`, e);
  }
}

/**
 * Rappels à 48 h, calculés à la volée (appelé après l'affichage d'une page du portail, aucune tâche planifiée) :
 * chaque demande due est d'abord réservée (`dernierRappelAt`), puis ses destinataires actuels sont relancés.
 */
export async function envoyerRappelsCircuit(maintenant = new Date()): Promise<void> {
  try {
    const reserves = await reserverRappelsDus(prisma, maintenant);
    for (const r of reserves) {
      const ctx = await chargerContexte(r.id);
      if (!ctx) continue;
      const n = notificationRappel(ctx, await chargerCandidats(ctx.responsableServiceId), r.etapeCircuitDepuis, maintenant);
      if (n) await envoyer([n]);
    }
  } catch (e) {
    console.error("[Circuit] Rappels impossibles :", e);
  }
}
