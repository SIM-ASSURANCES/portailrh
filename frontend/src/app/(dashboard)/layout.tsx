import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { getSession, hasPermission, isAdmin } from "@/lib/auth";
import { getUnreadNotificationsCount } from "@/app/(dashboard)/profil/actions";
import { getTopbarAlert } from "@/lib/topbarAlerts";

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

  const [unreadCount, topbarAlert] = await Promise.all([
    getUnreadNotificationsCount(),
    getTopbarAlert(session.user.id, hasPermission(session, "pointage.pointer")),
  ]);

  return (
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
        hasPermission(session, "treso.effectuer_reglement") ||
        hasPermission(session, "treso.receptionner_retour")
      }
      canRetourExterne={
        hasPermission(session, "treso.valider_demande") &&
        !hasPermission(session, "treso.approuver_validation_complete")
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
      // Restreint au Responsable Finance uniquement (Tâche "Restreindre
      // 'Déléguer des accès'", voir CLAUDE.md) — `treso.valider_demande`
      // SEULE ne suffit pas à écarter le DG (qui la possède aussi) : la
      // deuxième condition (absence de `treso.approuver_validation_complete`,
      // le marqueur du DG) exclut spécifiquement ce rôle, jamais une
      // comparaison de nom de rôle en dur. Basé sur `rolePermissions`
      // (jamais `permissions`, qui inclurait des permissions reçues par
      // délégation) — même garde exacte que `delegations/page.tsx` et
      // `accorderDelegationAction`.
      //
      // CONFLIT DE MERGE (origin/thierry-kouame) résolu en faveur de cette
      // version : la branche de Thierry portait encore l'ancienne condition
      // large (`treso.*`/`pointage.* — n'importe laquelle`), antérieure à
      // cette restriction. Vérifié avant de trancher : `delegations/page.tsx`
      // et `accorderDelegationAction` (les points d'application réels)
      // portent déjà cette même garde restreinte après fusion, inchangés par
      // les commits de Thierry (son seul changement dans `delegations/actions.ts`
      // concerne le renommage `createNotification` -> `notify`, jamais cette
      // logique de permission) — garder la condition large ici aurait donc
      // seulement affiché le lien "Déléguer des accès" à des comptes
      // (RH/DG/Assistant Finance) qui se seraient ensuite fait rediriger en
      // cliquant dessus, sans aucune différence réelle de sécurité. Signalé
      // à l'utilisateur malgré tout (voir résumé) : c'est la même prop
      // modifiée des deux côtés au même endroit exact.
      canDelegerAcces={
        session.rolePermissions.includes("treso.valider_demande") &&
        !session.rolePermissions.includes("treso.approuver_validation_complete")
      }
      canPointer={hasPermission(session, "pointage.pointer")}
      canConsulterHistorique={hasPermission(session, "pointage.consulter_historique")}
      canModererFeedback={hasPermission(session, "feedback.moderer")}
      canRecevoirFeedback={session.peutRecevoirFeedback}
      unreadNotificationsCount={unreadCount}
    >
      {children}
      <PushPermissionPrompt />
    </AppShell>
  );
}

