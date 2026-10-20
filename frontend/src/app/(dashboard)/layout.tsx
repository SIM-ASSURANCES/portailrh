import { redirect } from "next/navigation";
import { after } from "next/server";

import { AppShell } from "@/components/layout/AppShell";
import { BanniereSignature } from "@/components/signature/BanniereSignature";
import { FournisseurSignature } from "@/components/signature/ContexteSignature";
import { getSession, hasPermission, isAdmin } from "@/lib/auth";
import {
  demandesEtapeDGWhere,
  demandesServiceAValiderWhere,
  prisma,
  PERMISSION_REINITIALISER_POINTAGE,
  PERMISSIONS_SIGNATAIRES,
  signatureCourante,
  pointageEnService,
  reinitialisationEffectuee,
} from "backend";
import { getUnreadNotificationsCount } from "@/app/(dashboard)/profil/actions";
import { getTopbarAlert } from "@/lib/topbarAlerts";
import { envoyerRappelsCircuit } from "@/lib/notificationsCircuit";
import { compteurMenuJustificationsSession } from "@/lib/justificationsPointage";

import { PushPermissionPrompt } from "@/components/notifications/PushPermissionPrompt";

/**
 * Layout du Socle Portail (écrans authentifiés). Toute route de ce groupe
 * hérite de la coquille applicative (sidebar + topbar) et exige une session
 * valide — redirection vers /login sinon.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  // Rappels à 48 h du circuit de validation, calculés à la volée après l'envoi de la page (aucune tâche planifiée) :
  // au plus un rappel par 24 h et par demande, quel que soit le nombre de pages affichées.
  after(() => envoyerRappelsCircuit());

  const [unreadCount, topbarAlert, servicesResponsable, signature] = await Promise.all([
    getUnreadNotificationsCount(),
    getTopbarAlert(session.user.id, hasPermission(session, "pointage.pointer")),
    prisma.service.count({ where: { responsableId: session.user.id } }),
    signatureCourante(prisma, session.user.id),
  ]);
  // Lot L : le bandeau « Créer ma signature » s'adresse aux comptes qui signent des actions (permission de décision, d'exécution… ou responsable de service).
  const doitSigner = servicesResponsable > 0 || PERMISSIONS_SIGNATAIRES.some((p) => hasPermission(session, p));
  // « Demandes de mon service » : seulement pour un responsable d'au moins un service (circuit de validation).
  const demandesServiceAValider =
    servicesResponsable > 0
      ? await prisma.demande.count({ where: demandesServiceAValiderWhere(session.user.id) })
      : null;
  // « Étape DG » : seulement pour un compte qui décide à l'étape DG.
  const demandesDGADecider = hasPermission(session, "treso.decider_dg")
    ? await prisma.demande.count({ where: demandesEtapeDGWhere(session.user.id) })
    : null;
  // « Justifications à traiter » (Pointage V2) : responsable d'au moins un service ou RH (par le rôle) ; le DG seulement
  // si sa file n'est pas vide ou s'il a déjà décidé (`compteurMenuJustifications`, 2026-10-12).
  const justificationsADecider = await compteurMenuJustificationsSession(session);

  return (
    <FournisseurSignature aSignature={signature !== null}>
    <AppShell
      user={session.user}
      role={session.role}
      topbarAlert={topbarAlert}
      canAdmin={isAdmin(session)}
      canAccesDemandes={
        hasPermission(session, "treso.creer_demande") || hasPermission(session, "treso.declarer_retour")
      }
      canAccesMonTableauDeBord={hasPermission(session, "treso.creer_demande")}
      canAccesFinanceDemandes={
        hasPermission(session, "treso.categoriser_demande") ||
        hasPermission(session, "treso.valider_demande")
      }
      // "Toutes les demandes" (Tâche "Traçabilité d'une demande après
      // règlement/clôture", voir CLAUDE.md) — Responsable Finance, Assistant
      // Finance ET DG, jamais RH ni Collaborateur ; distincte de
      // `canAccesFinanceDemandes` ci-dessus (liste de tâches, Responsable
      // Finance seul), jamais fusionnée avec elle.
      canVoirToutesLesDemandes={
        hasPermission(session, "treso.valider_demande") ||
        // Décision 10 (2026-10-08) : le DG consulte par `treso.voir_dashboard_finance`.
        hasPermission(session, "treso.voir_dashboard_finance") ||
        hasPermission(session, "treso.effectuer_reglement") ||
        hasPermission(session, "treso.receptionner_retour")
      }
      canRetourExterne={hasPermission(session, "treso.creer_retour_externe")}
      // Lot J : budgets — la Finance les paramètre, le DG les valide, les autres comptes Finance/DG les consultent.
      canVoirBudgets={
        hasPermission(session, "treso.modifier_budget_categorie") ||
        hasPermission(session, "treso.valider_budget") ||
        hasPermission(session, "treso.voir_dashboard_finance")
      }
      canReceptionnerRetour={hasPermission(session, "treso.receptionner_retour")}
      canVoirDashboardFinance={hasPermission(session, "treso.voir_dashboard_finance")}
      canVoirReporting={hasPermission(session, "treso.voir_reporting")}
      // Élargi (Tâche "Séparation Responsable Finance / Assistant
      // Finance", voir CLAUDE.md) : reste visible pour un Assistant
      // Finance sans délégation, pour qu'il atteigne la page et voie le
      // bouton "Créer la dépense directe" VISIBLE MAIS DÉSACTIVÉ plutôt
      // que de ne jamais voir le lien du tout — même garde élargie que
      // `depenses-directes/nouvelle/page.tsx`.
      canSaisirDepenseDirecte={
        hasPermission(session, "treso.saisir_depense_directe") ||
        hasPermission(session, "treso.effectuer_reglement") ||
        hasPermission(session, "treso.receptionner_retour")
      }
      canApprouverValidationComplete={hasPermission(session, "treso.approuver_validation_complete")}
      // Élargi de la même façon (voir `solde-ouverture/page.tsx`) : un
      // Assistant Finance (treso.effectuer_reglement/receptionner_retour)
      // doit atteindre la page pour voir ses boutons désactivés, même
      // sans `treso.corriger_solde_ouverture`/`treso.alimenter_caisse`.
      canGererSoldeOuverture={
        isAdmin(session) ||
        hasPermission(session, "treso.corriger_solde_ouverture") ||
        hasPermission(session, "treso.alimenter_caisse") ||
        hasPermission(session, "treso.effectuer_reglement") ||
        hasPermission(session, "treso.receptionner_retour")
      }
      canGererCategories={isAdmin(session) || hasPermission(session, "treso.gerer_categories")}
      hasPointageAccess={[
        "pointage.pointer",
        "pointage.consulter_historique",
        "pointage.consulter_tous",
        "pointage.pointage_exceptionnel",
        "pointage.corriger_pointage",
        "pointage.gerer_horaires",
        "pointage.voir_dashboard_rh",
        "pointage.voir_reporting",
      ].some((permission) => hasPermission(session, permission))}
      canAccessPointageRH={
        hasPermission(session, "pointage.consulter_tous") ||
        hasPermission(session, "pointage.pointage_exceptionnel") ||
        hasPermission(session, "pointage.corriger_pointage") ||
        hasPermission(session, "pointage.gerer_horaires") ||
        hasPermission(session, "pointage.voir_dashboard_rh") ||
        hasPermission(session, "pointage.voir_reporting")
      }
      // Déléguer des accès : permission explicite `treso.deleguer_acces` (2026-10-06, remplace la règle
      // « valider_demande sans approuver_validation_complete »). Lue sur `rolePermissions` (jamais `permissions`, qui
      // inclurait des permissions reçues par délégation) — même garde que `delegations/page.tsx` et
      // `accorderDelegationAction`.
      canDelegerAcces={session.rolePermissions.includes("treso.deleguer_acces")}
      canReinitialiser={hasPermission(session, "systeme.reinitialiser") && !(await reinitialisationEffectuee())}
      canReinitialiserPointage={hasPermission(session, PERMISSION_REINITIALISER_POINTAGE) && !(await pointageEnService())}
      canPointer={hasPermission(session, "pointage.pointer")}
      canConsulterHistorique={hasPermission(session, "pointage.consulter_historique")}
      canModererFeedback={hasPermission(session, "feedback.moderer")}
      canConsulterEncaissements={hasPermission(session, "enc.consulter")}
      demandesServiceAValider={demandesServiceAValider}
      demandesDGADecider={demandesDGADecider}
      justificationsADecider={justificationsADecider}
      canVoirMonEquipe={servicesResponsable > 0}
      canRecevoirFeedback={session.peutRecevoirFeedback}
      unreadNotificationsCount={unreadCount}
    >
      <BanniereSignature visible={doitSigner} />
      {children}
      <PushPermissionPrompt />
    </AppShell>
    </FournisseurSignature>
  );
}

