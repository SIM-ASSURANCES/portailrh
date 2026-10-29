import {
  beneficiaireArticle,
  chargerEvaluationCloture,
  decideursFinanceDemande,
  etatLigneCircuit,
  manqueArticle,
  totalArticle,
  notificationApprobationCloture,
  notificationsRappel,
  notificationRefusLigneDG,
  notificationsReorientation,
  notificationsReprise,
  responsableServiceEffectif,
  type EvenementReorientation,
  type EvenementReprise,
  notificationsEtape,
  PERMISSIONS_NOTIFICATION_CIRCUIT,
  prisma,
  reserverRappelsDus,
  beneficiairesBloquesReglement,
  resumeArticles,
  type CandidatNotification,
  type ArticleNotification,
  type ContexteNotificationCircuit,
  type EvenementCircuit,
  type NotificationCircuit,
} from "backend";

import { notify } from "@/lib/notifications";

/**
 * Notifications du circuit de validation (commit 5, 2026-10-09) : envoi par le service de notifications existant
 * (`notify` : base, cloche en temps réel, push, e-mail selon la priorité). Les destinataires et les messages viennent
 * de `backend/src/circuitNotifications.ts`. Appelé APRÈS l'écriture : un échec d'envoi est journalisé, jamais remonté
 * (la décision est déjà enregistrée).
 */

/** Ce que l'événement qui vient d'avoir lieu a touché : articles décidés ou soumis, et parmi eux ceux que le DG avait refusés. */
export interface DetailEvenementCircuit {
  ligneIds?: string[];
  resoumisIds?: string[];
}

async function chargerContexte(demandeId: string, detail: DetailEvenementCircuit = {}): Promise<ContexteNotificationCircuit | null> {
  const d = await prisma.demande.findUnique({
    where: { id: demandeId },
    select: {
      id: true,
      reference: true,
      etapeCircuit: true,
      typeDemande: true,
      createurId: true,
      beneficiaireUserId: true,
      responsableEtapeServiceId: true,
      modeEtapeDG: true,
      decideurFinanceId: true,
      dgApprobateurId: true,
      niveauRejet: true,
      motifRejet: true,
      motifSoumissionDG: true,
      motifDecisionDG: true,
      montant: true,
      montantValide: true,
      statut: true,
      approbationClotureNonRequise: true,
      validationCompleteParDG: true,
      beneficiaireType: true,
      beneficiaireNom: true,
      beneficiaireUser: { select: { fullName: true } },
      createur: { select: { fullName: true, service: { select: { responsableId: true, name: true } } } },
      lignes: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          libelle: true,
          quantite: true,
          prixUnitaire: true,
          motifRejet: true,
          motifRefusDG: true,
          motifSoumissionDG: true,
          motifDecisionDG: true,
          statutValidation: true,
          soumiseAuDG: true,
          decisionDG: true,
          decideurFinanceId: true,
          beneficiaireType: true,
          beneficiaireUserId: true,
          beneficiaireNom: true,
          beneficiaireUser: { select: { fullName: true } },
        },
      },
    },
  });
  if (!d) return null;
  // Garde 8 par article (lot D) : un compte n'est écarté de « Demande à régler » que s'il est bénéficiaire de TOUS les
  // articles validés (il ne peut alors en régler aucun) ; bénéficiaire d'un seul, il peut régler les autres.
  const beneficiairesBloques = beneficiairesBloquesReglement(
    { beneficiaireUserId: d.beneficiaireUserId },
    d.lignes.map((l) => ({ statutValidation: l.statutValidation, beneficiaireType: l.beneficiaireType, beneficiaireUserId: l.beneficiaireUserId }))
  );
  // Demande à articles (lot B) : état des articles (Finance et DG peuvent en avoir chacun à traiter) et décideurs Finance.
  const articles =
    d.typeDemande !== "DEPENSE_DIRECTE" && d.lignes.length > 0
      ? resumeArticles(
          d.lignes.map((l) => ({ statut: l.statutValidation, soumiseAuDG: l.soumiseAuDG, decisionDG: l.decisionDG })),
          d.modeEtapeDG
        )
      : undefined;
  // Lot C : chaque article est NOMMÉ dans les messages (libellé, bénéficiaire, montant) ; pour un article validé, on lit aussi
  // ce qui lui manque pour être terminé (règlement, retour, dépenses) — une seule lecture de la régularisation par événement.
  let manques = new Map<string, ReturnType<typeof manqueArticle>>();
  if (articles && d.lignes.some((l) => l.statutValidation === "VALIDEE")) {
    const { articles: evalArticles } = await chargerEvaluationCloture(d.id);
    manques = new Map(evalArticles.filter((a) => a.statut === "VALIDEE").map((a) => [a.ligneId, manqueArticle(a)]));
  }
  const articlesDetail: ArticleNotification[] | undefined = articles
    ? d.lignes.map((l) => {
        const benef = beneficiaireArticle(l, d);
        const etat = etatLigneCircuit({ statut: l.statutValidation, soumiseAuDG: l.soumiseAuDG, decisionDG: l.decisionDG }, d.modeEtapeDG);
        return {
          id: l.id,
          libelle: l.libelle,
          beneficiaire: benef.libelle,
          beneficiaireUserId: benef.userId,
          montant: totalArticle({ quantite: l.quantite, prixUnitaire: Number(l.prixUnitaire) }),
          statut: l.statutValidation,
          etat,
          motif: l.statutValidation === "REJETEE" ? l.motifRejet : l.decisionDG === "REFUSEE" ? l.motifRefusDG : null,
          // Lot M : motif d'envoi au DG et motif de sa réponse (un article antérieur au lot M n'en a pas : « Non renseigné »).
          motifSoumissionDG: l.motifSoumissionDG,
          motifDecisionDG: l.motifDecisionDG,
          manque: l.statutValidation === "VALIDEE" ? (manques.get(l.id) ?? null) : null,
        };
      })
    : undefined;
  return {
    articles,
    articlesDetail,
    articlesConcernes: detail.ligneIds,
    articlesResoumis: detail.resoumisIds,
    serviceNom: d.createur.service?.name ?? null,
    statutDemande: d.statut,
    decideursFinanceIds: decideursFinanceDemande(d),
    demandeId: d.id,
    reference: d.reference,
    etape: d.etapeCircuit,
    typeDemande: d.typeDemande,
    createurId: d.createurId,
    createurNom: d.createur.fullName,
    beneficiaireUserId: d.beneficiaireUserId,
    beneficiairesBloquesReglement: beneficiairesBloques,
    modeEtapeDG: d.modeEtapeDG,
    decideurFinanceId: d.decideurFinanceId,
    dgApprobateurId: d.dgApprobateurId,
    // Lot K : le décideur de l'étape Service est celui de CETTE demande (réorientation), sinon le responsable du service.
    responsableServiceId: responsableServiceEffectif(d, d.createur.service?.responsableId),
    niveauRejet: d.niveauRejet,
    motifRejet: d.motifRejet,
    motifSoumissionDG: d.motifSoumissionDG,
    motifDecisionDG: d.motifDecisionDG,
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
export async function notifierEtapeCircuit(
  demandeId: string,
  acteurId: string,
  evenement: EvenementCircuit = "ETAPE",
  detail: DetailEvenementCircuit = {}
): Promise<void> {
  try {
    const ctx = await chargerContexte(demandeId, detail);
    if (!ctx) return;
    await envoyer(notificationsEtape(ctx, await chargerCandidats(ctx.responsableServiceId), acteurId, evenement));
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
      await envoyer(notificationsRappel(ctx, await chargerCandidats(ctx.responsableServiceId), r.etapeCircuitDepuis, maintenant));
    }
  } catch (e) {
    console.error("[Circuit] Rappels impossibles :", e);
  }
}

/** Rejet d'une ligne par le DG qui ne termine pas son examen : la Finance qui peut agir est prévenue. */
export async function notifierRefusLigneDG(
  demandeId: string,
  acteurId: string,
  refus: { libelle: string; motif: string; ligneId?: string }
): Promise<void> {
  try {
    const ctx = await chargerContexte(demandeId);
    if (!ctx) return;
    const n = notificationRefusLigneDG(ctx, await chargerCandidats(ctx.responsableServiceId), refus, acteurId);
    if (n) await envoyer([n]);
  } catch (e) {
    console.error(`[Circuit] Notification du rejet DG (demande ${demandeId}) impossible :`, e);
  }
}

/** Lot K : réorientation de l'étape Service — le nouveau responsable agit, l'ancien est prévenu du retrait. Rappels : ils lisent le nouveau. */
export async function notifierReorientation(demandeId: string, evenement: EvenementReorientation): Promise<void> {
  try {
    const ctx = await chargerContexte(demandeId);
    if (!ctx) return;
    await envoyer(notificationsReorientation(ctx, evenement));
  } catch (e) {
    console.error(`[Circuit] Notification de réorientation (demande ${demandeId}) impossible :`, e);
  }
}

/** Lot K : reprise — le décideur de l'étape précédente est prévenu avec le motif. */
export async function notifierReprise(demandeId: string, evenement: Omit<EvenementReprise, "article"> & { ligneId?: string | null }): Promise<void> {
  try {
    const ctx = await chargerContexte(demandeId, { ligneIds: evenement.ligneId ? [evenement.ligneId] : undefined });
    if (!ctx) return;
    const article = evenement.ligneId ? ctx.articlesDetail?.find((a) => a.id === evenement.ligneId) : undefined;
    await envoyer(notificationsReprise(ctx, await chargerCandidats(ctx.responsableServiceId), { ...evenement, article }));
  } catch (e) {
    console.error(`[Circuit] Notification de reprise (demande ${demandeId}) impossible :`, e);
  }
}
