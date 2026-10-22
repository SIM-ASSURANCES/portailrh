import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSession, hasPermission, isAdmin } from "@/lib/auth";
import { listerReinitialisations, lireEtatEtapes, planDesactivationComptesDeTest } from "backend";

import { AssistantReinitialisation } from "./AssistantReinitialisation";
import { ComptesDeTestPanel, type CompteTestAffiche } from "./ComptesDeTestPanel";

const date = (d: Date) => d.toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" });

/**
 * Remise à zéro de mise en production (lot R) : DG (`systeme.reinitialiser`) pour les 4 étapes et l'audit ; l'Admin n'y
 * voit, une fois une remise à zéro enregistrée, que le panneau de désactivation des comptes de test.
 */
export default async function ReinitialisationPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const porteur = hasPermission(session, "systeme.reinitialiser");
  const historique = await listerReinitialisations();
  const apresPurge = historique.length > 0;
  if (!porteur && !(isAdmin(session) && apresPurge)) {
    redirect("/?error=acces_refuse_reinitialisation");
  }

  const { comptes, plan } = apresPurge ? await planDesactivationComptesDeTest(session.user.id) : { comptes: [], plan: { aDesactiver: [], refuses: [] } };
  const refusParId = new Map(plan.refuses.map((r) => [r.compte.id, r.raison]));
  const comptesAffiches: CompteTestAffiche[] = comptes.map((c) => ({
    id: c.id,
    fullName: c.fullName,
    email: c.email,
    roleName: c.roleName,
    refus: refusParId.get(c.id) ?? null,
  }));

  const panneauComptes = apresPurge ? (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-4" data-section="comptes-test">
      <h2 className="text-sm font-bold text-foreground">Après la remise à zéro — comptes de test</h2>
      <p className="rounded-md bg-warning-bg px-3 py-2 text-sm font-semibold text-warning" data-rappel-solde-ouverture>
        Saisir le solde d&apos;ouverture de caisse avant d&apos;ouvrir l&apos;application.{" "}
        <Link href="/treso/finance/solde-ouverture" className="underline">
          Solde d&apos;ouverture
        </Link>
      </p>
      <ComptesDeTestPanel comptes={comptesAffiches} />
    </section>
  ) : null;

  if (!porteur) {
    // Admin sans la permission de remise à zéro : uniquement la désactivation des comptes de test.
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
        <PageHeader
          title="Comptes de test"
          description="Une remise à zéro de mise en production a été effectuée. Désactivez les comptes de test avant d'ouvrir l'application."
        />
        {panneauComptes}
      </div>
    );
  }

  const { etat } = await lireEtatEtapes(session.user.id);
  const derniere = historique[0];

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Remise à zéro de mise en production"
        description="Supprime TOUTES les données de test (Trésorerie, Pointage RH, Congés, FeedbackApp, Encaissements non mis en service, journaux, signatures d'actions) et conserve la configuration. Quatre étapes, dans l'ordre."
      />

      {derniere ? (
        <div
          className={`space-y-1 rounded-lg border p-4 text-sm ${derniere.verrouActif ? "border-warning/40 bg-warning-bg text-warning" : "border-border bg-surface"}`}
          data-etat-verrou={derniere.verrouActif ? "actif" : "leve"}
        >
          <p className="font-semibold">
            {derniere.verrouActif ? "Une remise à zéro a déjà été effectuée : le verrou est actif." : "Le verrou de la dernière remise à zéro a été levé."}
          </p>
          <p>
            Dernière remise à zéro le <strong>{date(derniere.effectueeAt)}</strong> par <strong>{derniere.effectueePar}</strong>.
            {derniere.verrouActif ? " Pour en refaire une, passez par les étapes 1 à 3 : la levée du verrou est une décision explicite." : null}
          </p>
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border border-danger/40 bg-danger-bg p-4 text-sm text-danger">
          <p className="font-semibold">Action irréversible.</p>
          <p>
            Supprimés : demandes, articles, règlements, retours (caisse, exceptionnels, externes), remboursements, journaux de caisse et de
            banque (le solde d&apos;ouverture est à ressaisir ensuite), pièces jointes (et leurs fichiers), confirmations de dépassement, actions
            signées, pointages, justifications, corrections, absences, demandes de congé, feedbacks, données de test d&apos;Encaissements (si
            le module n&apos;est pas encore en service), journaux techniques et les notifications et historiques liés. Conservés : comptes, rôles,
            permissions, délégations, services et responsables, catégories, objets, budgets et seuils validés, paramètres, signatures enrôlées,
            horaires, jours fériés, jetons de notification, audit d&apos;administration, verrous.
          </p>
        </div>
      )}

      <AssistantReinitialisation etatInitial={etat} />

      {panneauComptes}

      {historique.length > 0 ? (
        <section className="space-y-3 rounded-lg border border-border bg-surface p-4" data-section="audit">
          <h2 className="text-sm font-bold text-foreground">Audit des remises à zéro</h2>
          <ul className="space-y-3 text-sm">
            {historique.map((h) => (
              <li key={h.id} className="space-y-1 border-b border-border pb-3 last:border-b-0">
                <p>
                  <strong>{date(h.effectueeAt)}</strong> par <strong>{h.effectueePar}</strong> —{" "}
                  {Object.values(h.decompte).reduce((a, b) => a + b, 0)} ligne(s) supprimée(s), {h.fichiersSupprimes} fichier(s)
                  {h.fichiersEchecs > 0 ? ` (${h.fichiersEchecs} non supprimés, à nettoyer à la main)` : ""}.
                </p>
                <p className="break-all text-xs text-muted-foreground">Empreinte de la sauvegarde : {h.sauvegardeSha256}</p>
                <p className="text-xs">
                  {h.verrouActif ? (
                    <span className="text-warning">Verrou actif.</span>
                  ) : h.levee ? (
                    <span>
                      Verrou levé le {date(h.levee.at)} par {h.levee.par}. {h.levee.detail}
                    </span>
                  ) : (
                    <span>Verrou levé (hors application).</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
