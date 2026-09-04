"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { BrandBackdrop } from "@/components/ui";

import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

interface AppShellProps {
  user: { fullName: string; email: string };
  role: string;
  /** Affiche la section « Administration » dans la sidebar (rôle Admin). */
  canAdmin?: boolean;
  /** Affiche "Demandes" (treso.creer_demande OU treso.declarer_retour). */
  canAccesDemandes?: boolean;
  /** Affiche "Mon tableau de bord" (treso.creer_demande seule). */
  canAccesMonTableauDeBord?: boolean;
  /** Affiche "Demandes à traiter (Finance)" (categoriser_demande OU valider_demande). */
  canAccesFinanceDemandes?: boolean;
  /** Affiche "Retours en attente" (treso.receptionner_retour). */
  canReceptionnerRetour?: boolean;
  /** Affiche "Tableau de bord Finance" (treso.voir_dashboard_finance). */
  canVoirDashboardFinance?: boolean;
  /** Affiche "Reporting" (treso.voir_reporting). */
  canVoirReporting?: boolean;
  /** Affiche "Nouvelle dépense directe" (treso.saisir_depense_directe, Phase F). */
  canSaisirDepenseDirecte?: boolean;
  /** Affiche "Validations complètes en attente" (treso.approuver_validation_complete, DG). */
  canApprouverValidationComplete?: boolean;
  /** Affiche la branche "Pointage de Présence" et "Mon espace" (au moins une permission pointage.*). */
  hasPointageAccess?: boolean;
  /** Ajoute le groupe "RH" du Pointage (permissions RH uniquement). */
  canAccessPointageRH?: boolean;
  children: ReactNode;
}

const STORAGE_KEY = "sim-sidebar-collapsed";

/**
 * Coquille des écrans authentifiés : sidebar + topbar + zone de contenu.
 * Détient l'état « réduit » de la sidebar (persisté en localStorage) afin
 * que la largeur du contenu s'ajuste. Le layout serveur ne fait que lui
 * transmettre l'utilisateur et son rôle.
 */
export function AppShell({
  user,
  role,
  canAdmin = false,
  canAccesDemandes = false,
  canAccesMonTableauDeBord = false,
  canAccesFinanceDemandes = false,
  canReceptionnerRetour = false,
  canVoirDashboardFinance = false,
  canVoirReporting = false,
  canSaisirDepenseDirecte = false,
  canApprouverValidationComplete = false,
  hasPointageAccess = false,
  canAccessPointageRH = false,
  children,
}: AppShellProps) {
  // Rendu initial (serveur + première passe client) toujours « déployé »
  // pour éviter tout écart d'hydratation ; on relit la préférence persistée
  // juste après le montage, côté client uniquement.
  const [collapsed, setCollapsed] = useState(false);
  // Tiroir mobile (< lg) : caché par défaut, ouvert via le bouton menu de la
  // Topbar. N'a aucun effet au-dessus de lg (la sidebar y est toujours en
  // flux normal, cf. Sidebar.tsx).
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) === "1";
      // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture unique d'une préférence UI au montage (pattern deux passes, sûr pour l'hydratation)
      if (stored) setCollapsed(true);
    } catch {
      /* localStorage indisponible : on garde l'état déployé par défaut. */
    }
  }, []);

  function toggleCollapse() {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <div className="relative z-0 flex min-h-screen border-[3px] border-primary bg-app-bg">
      {/* Fond de marque étendu à toute l'application (voir CLAUDE.md "Fond
          de marque étendu à toute l'application" — décision explicite de
          l'utilisateur, revient sur la restriction initiale à /login).
          Précautions de lisibilité (écrans denses consultés en continu) :
          - `fixed` (pas `absolute`) : épinglé au VIEWPORT, jamais à la
            hauteur du contenu — ne réapparaît jamais en bas de page après
            défilement d'un long tableau, contrairement à un positionnement
            centré sur la hauteur totale du document.
          - `-z-10` : reste strictement DERRIÈRE tout contenu normal
            (Sidebar/Topbar/cartes, tous avec leur propre fond opaque) —
            jamais au-dessus, jamais de gêne au défilement/à la lecture.
            **Nécessite `relative z-0` sur CE conteneur** (piège CSS
            vérifié explicitement en debug) : sans stacking context propre
            créé ici, un enfant `fixed` à z-index négatif « s'échappe » au
            stacking context RACINE du document, où il se retrouve peint
            EN DESSOUS du fond `bg-app-bg` de ce même conteneur (traité
            comme un contenu normal du document, qui peint toujours
            au-dessus d'un enfant à z-index négatif de la racine) — le
            filigrane devenait alors invisible à 100%, à N'IMPORTE QUELLE
            opacité, jusqu'à ce test. `z-0` (valeur explicite, pas `auto`)
            crée le stacking context qui contient le filigrane et le fait
            peindre au-dessus du fond de CE conteneur précis, comme prévu.
          - `watermarkPosition="corner-br"` (pas le "bleed-left" de /login) :
            vérifié explicitement par capture d'écran que le positionnement
            en pourcentage de /login, pensé pour une carte étroite, plaçait
            l'icône ENTIÈREMENT hors champ sur un viewport pleine largeur —
            corrigé en un variant dédié coin bas-droit, seul coin du
            viewport que ni la Sidebar (hauteur pleine) ni la Topbar
            (largeur pleine du contenu) n'occupent déjà.
          - Opacité fortement abaissée par rapport à /login (9% -> 3,5%) :
            testé visuellement sur le reporting (l'écran le plus dense du
            portail), ajusté jusqu'à devenir à peine perceptible.
          - Filet dégradé du bas désactivé : resterait sinon collé en
            permanence au bas du VIEWPORT plutôt qu'au bas du contenu. */}
      <BrandBackdrop
        className="fixed inset-0 -z-10"
        watermarkOpacityClassName="opacity-[0.05]"
        watermarkPosition="corner-br"
        showBottomAccent={false}
      />
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        canAdmin={canAdmin}
        canAccesDemandes={canAccesDemandes}
        canAccesMonTableauDeBord={canAccesMonTableauDeBord}
        canAccesFinanceDemandes={canAccesFinanceDemandes}
        canReceptionnerRetour={canReceptionnerRetour}
        canVoirDashboardFinance={canVoirDashboardFinance}
        canVoirReporting={canVoirReporting}
        canSaisirDepenseDirecte={canSaisirDepenseDirecte}
        canApprouverValidationComplete={canApprouverValidationComplete}
        hasPointageAccess={hasPointageAccess}
        canAccessPointageRH={canAccessPointageRH}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar 
          user={user} 
          role={role} 
          canAccessPointageRH={canAccessPointageRH}
          onOpenMobileMenu={() => setMobileOpen(true)} 
        />
        <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
