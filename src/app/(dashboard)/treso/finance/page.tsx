import Link from "next/link";
import { redirect } from "next/navigation";

import { Icon } from "@/components/icons";
import { PageHeader, StatCard, type StatTone } from "@/components/ui";
import {
  getDecaissementsARegulariser,
  getDemandesEnAttenteValidation,
  getDepensesNonJustifiees,
  getFondsRemisARegulariser,
  getMontantsValidesNonRegles,
  getReglementsPartielsACompleter,
  getRetoursEnAttenteReception,
} from "@/lib/dashboardFinance";
import { getSession, hasPermission } from "@/lib/auth";
import { getSoldeCaisse } from "@/lib/tresorerie";

/**
 * Tableau de bord Finance (Phase G, cahier des charges section 12) —
 * refonte de l'ancien dashboard à 4 indicateurs (Ticket 8) en une zone
 * "À traiter" enrichie à 6 indicateurs cliquables, plus le solde de caisse
 * gardé comme information de CONTEXTE distincte (bandeau dédié en tête de
 * page, jamais une carte "à traiter" au même titre que les six autres —
 * ce n'est pas une action mais un chiffre de référence). Tout est
 * recalculé en temps réel à chaque chargement (aucune mise en cache
 * applicative), comme le reste du dashboard depuis le Ticket 8.
 *
 * Les 6 indicateurs, dans l'ordre du cahier des charges :
 * 1. Demandes en attente de validation
 * 2. Montants validés restant à régler (rien réglé encore)
 * 3. Règlements partiels à compléter (déjà commencé, pas fini)
 * 4. Fonds remis à régulariser (règlements Caisse au solde non nul)
 * 5. Retours de fonds en attente de réception
 * 6. Dépenses non justifiées à suivre
 *
 * Chaque définition exacte vit dans `dashboardFinance.ts`, jamais dupliquée
 * ici. L'ancien indicateur "Décaissements à régulariser" (Ticket 8,
 * candidats à la clôture) ne fait plus partie des 6 — absent de la
 * section 12 — mais reste accessible via un lien secondaire discret en
 * bas de page : la clôture (Ticket 7) doit rester praticable, ce lien
 * évite de rendre `/treso/finance/a-regulariser` orphelin.
 *
 * Protégée par `treso.voir_dashboard_finance`, revérifiée ici même si le
 * layout Finance partagé l'accepte déjà parmi ses permissions valables —
 * jamais supposée acquise du simple fait d'avoir passé la garde du layout.
 */
export default async function DashboardFinancePage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.voir_dashboard_finance")) {
    redirect("/?error=acces_refuse_dashboard_finance");
  }

  const [
    solde,
    enAttenteValidation,
    montantsNonRegles,
    reglementsPartiels,
    fondsARegulariser,
    retoursEnAttente,
    depensesNonJustifiees,
    decaissementsARegulariser,
  ] = await Promise.all([
    getSoldeCaisse(),
    getDemandesEnAttenteValidation(),
    getMontantsValidesNonRegles(),
    getReglementsPartielsACompleter(),
    getFondsRemisARegulariser(),
    getRetoursEnAttenteReception(),
    getDepensesNonJustifiees(),
    getDecaissementsARegulariser(),
  ]);

  // Le DG a `voir_dashboard_finance` mais jamais `receptionner_retour`
  // (rôle validation/consultation, voir seed) : sans ce garde-fou, la carte
  // "Retours de fonds en attente" lui promettrait un clic vers une page qui
  // le refuse aussitôt (`/treso/finance/retours`, gardée par cette
  // permission précise) — même principe que "Bientôt disponible" sur le
  // dashboard général, appliqué ici à une carte réellement construite mais
  // pas actionnable par ce rôle précis : reste visible (chiffre de
  // consultation), devient simplement non cliquable.
  const canReceptionnerRetour = hasPermission(session, "treso.receptionner_retour");

  const totalATraiter =
    enAttenteValidation.nombre +
    montantsNonRegles.nombre +
    reglementsPartiels.nombre +
    fondsARegulariser.nombre +
    retoursEnAttente.nombre +
    depensesNonJustifiees.nombre;

  // Une carte ne "s'allume" dans sa teinte d'urgence que s'il y a
  // effectivement quelque chose à traiter — à 0, elle repasse en neutre
  // pour ne pas crier au loup (ex: "Dépenses non justifiées" ne doit pas
  // s'afficher en rouge quand ce nombre est nul). La hiérarchie visuelle ne
  // doit signaler que ce qui est réellement actionnable.
  function toneSiActif(nombre: number, toneActif: StatTone): StatTone {
    return nombre > 0 ? toneActif : "neutral";
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Tableau de bord Finance"
        description="Vue d'ensemble de la trésorerie, recalculée en temps réel."
      />

      {/* Solde de caisse : LE chiffre le plus important de l'écran, traité
          comme tel — bandeau plein dégradé (identité SIM Assurances),
          jamais une simple carte parmi d'autres. Volontairement distinct
          des StatCard "à traiter" ci-dessous (pas de bordure fine ni de
          lien cliquable : un chiffre de référence, pas une action). */}
      <div className="relative overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#0063c9_0%,#004b9c_48%,#00203f_100%)] px-6 py-7 shadow-elevated-lg sm:px-8 sm:py-8">
        <div
          className="pointer-events-none absolute -right-10 -top-16 size-56 rounded-full bg-sim-blue-light/20 blur-2xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-20 left-1/3 size-64 rounded-full bg-white/5 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
          <span className="inline-grid size-14 shrink-0 place-items-center rounded-2xl bg-white/15 text-white ring-1 ring-inset ring-white/25">
            <Icon name="wallet" className="size-7" />
          </span>
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-white/70">
              Solde de caisse actuel
            </p>
            <p className="mt-1 text-[40px] font-black leading-none tracking-tight text-white tabular-nums sm:text-5xl">
              {solde.toLocaleString("fr-FR")}
              <span className="ml-2 text-lg font-bold text-white/60 sm:text-xl">FCFA</span>
            </p>
          </div>
        </div>
      </div>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="flex items-center gap-2.5 text-xl font-black tracking-tight text-foreground">
            <span className="h-5 w-1 rounded-full bg-primary" aria-hidden="true" />
            À traiter
          </h2>
          {totalATraiter > 0 ? (
            <span className="rounded-full bg-warning-bg px-2.5 py-1 text-xs font-semibold text-warning">
              {totalATraiter} point{totalATraiter > 1 ? "s" : ""} au total
            </span>
          ) : (
            <span className="text-xs font-medium text-success">Tout est à jour</span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="stat-card-enter">
            <StatCard
              href="/treso/finance/demandes"
              icon="file-text"
              tone={toneSiActif(enAttenteValidation.nombre, "warning")}
              label="Demandes en attente de validation"
              value={enAttenteValidation.nombre}
            />
          </div>
          <div className="stat-card-enter">
            <StatCard
              href="/treso/finance/a-decaisser"
              icon="wallet"
              tone={toneSiActif(montantsNonRegles.nombre, "info")}
              label="Montants validés restant à régler"
              value={montantsNonRegles.nombre}
              hint={`${montantsNonRegles.montant.toLocaleString("fr-FR")} FCFA`}
            />
          </div>
          <div className="stat-card-enter">
            <StatCard
              href="/treso/finance/reglements-partiels"
              icon="pencil"
              tone={toneSiActif(reglementsPartiels.nombre, "info")}
              label="Règlements partiels à compléter"
              value={reglementsPartiels.nombre}
              hint={`${reglementsPartiels.montant.toLocaleString("fr-FR")} FCFA`}
            />
          </div>
          <div className="stat-card-enter">
            <StatCard
              href="/treso/finance/fonds-a-regulariser"
              icon="book-text"
              tone={toneSiActif(fondsARegulariser.nombre, "warning")}
              label="Fonds remis à régulariser"
              value={fondsARegulariser.nombre}
              hint={`${fondsARegulariser.montant.toLocaleString("fr-FR")} FCFA`}
            />
          </div>
          <div className="stat-card-enter">
            <StatCard
              href={canReceptionnerRetour ? "/treso/finance/retours" : undefined}
              icon="rotate-ccw"
              tone={toneSiActif(retoursEnAttente.nombre, "warning")}
              label="Retours de fonds en attente de réception"
              value={retoursEnAttente.nombre}
            />
          </div>
          <div className="stat-card-enter">
            <StatCard
              href="/treso/finance/depenses-non-justifiees"
              icon="alert-triangle"
              tone={toneSiActif(depensesNonJustifiees.nombre, "danger")}
              label="Dépenses non justifiées à suivre"
              value={depensesNonJustifiees.nombre}
              hint={`${depensesNonJustifiees.montant.toLocaleString("fr-FR")} FCFA`}
            />
          </div>
        </div>
      </section>

      <p className="text-sm text-muted-foreground">
        <Link
          href="/treso/finance/a-regulariser"
          className="font-medium text-info underline-offset-4 transition-colors hover:text-primary hover:underline"
        >
          Décaissements entièrement réglés en attente de clôture
        </Link>
        {decaissementsARegulariser.nombre > 0 ? ` — ${decaissementsARegulariser.nombre}` : " — aucun pour l'instant"}
      </p>
    </div>
  );
}
