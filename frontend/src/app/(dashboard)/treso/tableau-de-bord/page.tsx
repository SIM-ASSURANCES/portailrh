import Link from "next/link";
import { redirect } from "next/navigation";

import { Button, PageHeader, StatCard, type StatTone } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import {
  getMesDemandesDetail,
  getMesDemandesEnAttente,
  getMesDemandesParMois,
  getMesIndicateurs,
  getReglementsCaisseADeclarer,
} from "backend";

import { CollaborateurDemandesBarChart } from "./CollaborateurDemandesBarChart";
import { CollaborateurStatCard } from "./CollaborateurStatCard";
import { MesDemandesDetailTable } from "./MesDemandesDetailTable";
import { TauxRegularisationGauge } from "./TauxRegularisationGauge";

/**
 * "Mon tableau de bord" — cahier des charges section 14 : la vision
 * synthétique générale (5 indicateurs : Demandé/Validé/Restant à
 * valider/Réglé/Validé restant à régler, + zone "À TRAITER" cliquable)
 * n'est PAS réservée à Finance. Ici, exactement les mêmes 5 indicateurs et
 * le même principe de zone actionnable, mais scopés aux demandes du
 * Collaborateur connecté — le pendant personnel de `/treso/finance` (dont
 * les indicateurs restent, eux, à l'échelle de toute l'organisation).
 *
 * Distinct de `/treso/demandes` ("Mes demandes", Ticket 1, une simple
 * liste) — même choix structurel que Finance (`/treso/finance` = tableau
 * de bord, `/treso/finance/demandes` = liste) plutôt que de surcharger la
 * liste existante avec des indicateurs et une zone "à traiter" qui n'ont
 * rien à voir avec son rôle de simple historique. Point d'entrée du module
 * Trésorerie pour un Collaborateur depuis le dashboard général (`/`, voir
 * `getTresorerieHref`) — au même titre que `/treso/finance` pour Finance/DG.
 *
 * Gardée par `treso.creer_demande` **seule** — délibérément pas le même
 * critère que "Mes demandes" (`creer_demande` OU `declarer_retour`) :
 * les 5 indicateurs et la zone "À traiter" ne portent que sur les demandes
 * dont l'utilisateur est le créateur (`createurId`), jamais sur son rôle
 * dans le circuit de retour de caisse. Un rôle combiné avec
 * `declarer_retour` mais sans `creer_demande` (ex: Finance/RH, voir
 * CLAUDE.md "Sidebar Trésorerie — un seul tableau de bord par profil")
 * n'a par construction jamais créé de demande : cette page lui serait
 * vide et redondante avec les autres tableaux de bord déjà visibles
 * (général, Finance). Jamais uniquement masquée côté nav, revérifiée ici.
 */
export default async function MonTableauDeBordPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "treso.creer_demande")) {
    redirect("/?error=acces_refuse_demandes");
  }

  const userId = session.user.id;
  const [indicateurs, enAttente, retoursADeclarer, demandesDetail, demandesParMois] = await Promise.all([
    getMesIndicateurs(userId),
    getMesDemandesEnAttente(userId),
    getReglementsCaisseADeclarer(userId),
    getMesDemandesDetail(userId),
    getMesDemandesParMois(userId, 6),
  ]);

  const canCreate = hasPermission(session, "treso.creer_demande");

  // Taux de régularisation — dérivé du même `demandesDetail` déjà chargé
  // ci-dessus, JAMAIS une deuxième requête ni un nouveau calcul de seuil :
  // exactement les mêmes `montantRecu`/`soldeARegulariser` (et le même
  // découpage "réglée"/"régularisée") que `EtatRegularisation`
  // (`MesDemandesDetailTable.tsx`) — voir CLAUDE.md "Modernisation du
  // dashboard Collaborateur".
  const demandesReglees = demandesDetail.filter((d) => d.montantRecu > 0);
  const demandesRegularisees = demandesReglees.filter((d) => d.soldeARegulariser === 0);

  // Une seule demande concernée : la carte mène directement à son détail
  // (là où vit le bouton "Déclarer un retour de caisse", Ticket 5) — sinon
  // vers l'écran de liste dédié (voir `retours-a-declarer/page.tsx`).
  const hrefRetours =
    retoursADeclarer.length === 1
      ? `/treso/demandes/${retoursADeclarer[0].demandeId}`
      : "/treso/demandes/retours-a-declarer";

  // Une carte ne s'allume dans sa teinte d'urgence que si elle est
  // réellement actionnable (nombre > 0) — même garde-fou que le dashboard
  // Finance (Phase G, `toneSiActif`), pour ne signaler que ce qui compte.
  function toneSiActif(nombre: number, toneActif: StatTone): StatTone {
    return nombre > 0 ? toneActif : "neutral";
  }

  // Formatage volontairement simple ("FCFA" en dur) : ces 5 indicateurs
  // agrègent TOUTES les demandes de l'utilisateur sans distinction de
  // devise (même limitation déjà acceptée par `getReportingRows`, Phase H,
  // jamais devise-aware — voir CLAUDE.md "Formulaire Demande d'Achat").
  // Sans conséquence tant que XOF reste la devise par défaut de facto.
  const fmt = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Mon tableau de bord"
        description="Où en sont vos demandes, du dépôt à la clôture."
        actions={
          <div className="flex flex-wrap gap-3">
            <Link href="/treso/demandes">
              <Button variant="secondary">Mes demandes</Button>
            </Link>
            {canCreate ? (
              <Link href="/treso/demandes/nouvelle">
                <Button>Nouvelle demande</Button>
              </Link>
            ) : null}
          </div>
        }
      />

      <section className="space-y-4">
        <h2 className="flex items-center gap-2.5 text-xl font-black tracking-tight text-foreground">
          <span className="h-5 w-1 rounded-full bg-primary" aria-hidden="true" />
          Vue d&apos;ensemble
        </h2>
        {/* 5 cartes : progression responsive inchangée jusqu'à lg (1/2/3
            colonnes, comme avant), puis xl (desktop large, ≥1280px) passe
            aux 5 colonnes sur une seule ligne — retour utilisateur explicite
            déjà pris en compte par `CollaborateurStatCard` (padding/police
            réduits via des classes `xl:` internes, jamais un simple booléen
            JS) : composant DÉDIÉ à cette grille (voir CLAUDE.md
            "Modernisation du dashboard Collaborateur"), `StatCard`
            lui-même — partagé avec les dashboards DG/Admin/Finance — n'est
            pas touché. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <div className="stat-card-enter">
            <CollaborateurStatCard icon="shopping-cart" tone="neutral" label="Demandé" value={fmt(indicateurs.demande)} />
          </div>
          <div className="stat-card-enter">
            <CollaborateurStatCard icon="shield-check" tone="success" label="Validé" value={fmt(indicateurs.valide)} />
          </div>
          <div className="stat-card-enter">
            <CollaborateurStatCard
              icon="clock"
              tone={toneSiActif(indicateurs.restantAValider, "warning")}
              label="Restant à valider"
              value={fmt(indicateurs.restantAValider)}
            />
          </div>
          <div className="stat-card-enter">
            <CollaborateurStatCard icon="wallet" tone="success" label="Réglé" value={fmt(indicateurs.regle)} />
          </div>
          <div className="stat-card-enter">
            <CollaborateurStatCard
              icon="book-text"
              tone={toneSiActif(indicateurs.valideRestantARegler, "warning")}
              label="Validé restant à régler"
              value={fmt(indicateurs.valideRestantARegler)}
            />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-elevated sm:p-6">
          <h2 className="flex items-center gap-2.5 text-base font-black tracking-tight text-foreground">
            <span className="h-5 w-1 rounded-full bg-primary" aria-hidden="true" />
            Montant demandé — 6 derniers mois
          </h2>
          <div className="mt-4">
            <CollaborateurDemandesBarChart data={demandesParMois} aDejaDesDemandes={demandesDetail.length > 0} />
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-elevated sm:p-6">
          <h2 className="flex items-center gap-2.5 text-base font-black tracking-tight text-foreground">
            <span className="h-5 w-1 rounded-full bg-success" aria-hidden="true" />
            Taux de régularisation
          </h2>
          <div className="mt-4">
            <TauxRegularisationGauge
              demandesReglees={demandesReglees.length}
              demandesRegularisees={demandesRegularisees.length}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="flex items-center gap-2.5 text-xl font-black tracking-tight text-foreground">
          <span className="h-5 w-1 rounded-full bg-warning" aria-hidden="true" />
          À traiter
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="stat-card-enter">
            <StatCard
              href="/treso/demandes?statut=EN_ATTENTE_VALIDATION,PARTIELLEMENT_VALIDEE"
              icon="file-text"
              tone={toneSiActif(enAttente.nombre, "warning")}
              label="Mes demandes en attente de validation"
              value={enAttente.nombre}
            />
          </div>
        </div>
      </section>

      {/* "Retours de caisse" — délibérément HORS de "À traiter" et toujours
          en teinte neutre (jamais `warning`) : voir CLAUDE.md "Retour de
          caisse optionnel". Ne rien soumettre est un état terminal valide
          (rien à retourner ni à justifier) ; cette carte reste purement
          informationnelle ("vous POURRIEZ déclarer quelque chose ici"),
          jamais une obligation qui ne se résorbe qu'en soumettant quelque
          chose, même trivial. */}
      {retoursADeclarer.length > 0 ? (
        <section className="space-y-4">
          <h2 className="flex items-center gap-2.5 text-xl font-black tracking-tight text-foreground">
            <span className="h-5 w-1 rounded-full bg-border" aria-hidden="true" />
            Retours de caisse (facultatif)
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="stat-card-enter">
              <StatCard
                href={hrefRetours}
                icon="rotate-ccw"
                tone="neutral"
                label="Retours de caisse disponibles à déclarer — aucune action requise si rien à signaler"
                value={retoursADeclarer.length}
              />
            </div>
          </div>
        </section>
      ) : null}

      {/* Voir CLAUDE.md "Tableau de bord collaborateur détaillé" : chaque
          demande listée séparément (jamais agrégée derrière les 5
          indicateurs ci-dessus), avec son propre montant reçu et son
          propre état de régularisation — pour retrouver facilement où en
          est une demande précise et l'argent reçu pour elle. */}
      <section className="space-y-4">
        <h2 className="flex items-center gap-2.5 text-xl font-black tracking-tight text-foreground">
          <span className="h-5 w-1 rounded-full bg-primary" aria-hidden="true" />
          Mes demandes
        </h2>
        <MesDemandesDetailTable demandes={demandesDetail} />
      </section>
    </div>
  );
}
