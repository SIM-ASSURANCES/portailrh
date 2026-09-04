import Link from "next/link";
import { redirect } from "next/navigation";

import { Button, PageHeader, StatCard, type StatTone } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth";
import {
  getMesDemandesEnAttente,
  getMesIndicateurs,
  getReglementsCaisseADeclarer,
} from "@/lib/tresorerie";

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
  const [indicateurs, enAttente, retoursADeclarer] = await Promise.all([
    getMesIndicateurs(userId),
    getMesDemandesEnAttente(userId),
    getReglementsCaisseADeclarer(userId),
  ]);

  const canCreate = hasPermission(session, "treso.creer_demande");

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
            aux 5 colonnes sur une seule ligne — retour utilisateur explicite.
            xl plutôt que lg : à 1024-1279px, 5 colonnes resteraient trop
            étroites même en `size="compact"`.
            `size="compact"` (StatCard) : gabarit "default" (28px) faisait
            passer "550 000 FCFA" sur deux lignes de façon inégale d'une
            carte à l'autre à cette largeur — corrigé par un second gabarit
            dédié (20px, icône/padding réduits), réservé à cette grille :
            jamais appliqué au dashboard Finance (6 cartes, jamais plus de 3
            par ligne) ni au dashboard général, qui gardent le gabarit par
            défaut inchangé. `h-full` sur chaque StatCard (interne au
            composant) garantit que les 5 cartes partagent exactement la
            même hauteur sur la ligne, icône/libellé/montant alignés au même
            niveau vertical d'une carte à l'autre. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <div className="stat-card-enter">
            <StatCard
              size="compact"
              icon="shopping-cart"
              tone="neutral"
              label="Demandé"
              value={fmt(indicateurs.demande)}
            />
          </div>
          <div className="stat-card-enter">
            <StatCard
              size="compact"
              icon="shield-check"
              tone="success"
              label="Validé"
              value={fmt(indicateurs.valide)}
            />
          </div>
          <div className="stat-card-enter">
            <StatCard
              size="compact"
              icon="clock"
              tone={toneSiActif(indicateurs.restantAValider, "warning")}
              label="Restant à valider"
              value={fmt(indicateurs.restantAValider)}
            />
          </div>
          <div className="stat-card-enter">
            <StatCard size="compact" icon="wallet" tone="success" label="Réglé" value={fmt(indicateurs.regle)} />
          </div>
          <div className="stat-card-enter">
            <StatCard
              size="compact"
              icon="book-text"
              tone={toneSiActif(indicateurs.valideRestantARegler, "warning")}
              label="Validé restant à régler"
              value={fmt(indicateurs.valideRestantARegler)}
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
          <div className="stat-card-enter">
            <StatCard
              href={hrefRetours}
              icon="rotate-ccw"
              tone={toneSiActif(retoursADeclarer.length, "warning")}
              label="Mes retours de caisse à déclarer"
              value={retoursADeclarer.length}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
