"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/icons";

interface TopbarProps {
  user: { fullName: string; email: string };
  role: string;
  /** Ouvre le tiroir de navigation mobile (bouton visible seulement < lg). */
  onOpenMobileMenu: () => void;
}

function initials(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Auto-refresh (retour utilisateur : le bouton manuel n'était pas assez
// "vivant" — remplacé par un rafraîchissement automatique en tâche de
// fond). 20s : compromis entre "assez proche du temps réel" pour qu'un
// changement fait par un collègue dans un autre onglet apparaisse vite
// (cas d'usage explicite : validation d'une demande vue par Finance quasi
// immédiatement) et "pas de charge serveur inutile" pour une application
// interne à quelques dizaines d'utilisateurs simultanés au plus — un
// polling à 5-10s n'apporterait pas de bénéfice perceptible pour ce
// volume, seulement plus de requêtes. Choisi au milieu de la fourchette
// 15-30s demandée plutôt qu'à une extrémité, sans raison de favoriser
// l'un ou l'autre bord.
const REFRESH_INTERVAL_MS = 20_000;
const PULSE_DURATION_MS = 900;

// Formulaire en cours de saisie détecté génériquement (focus sur un champ
// de saisie), plutôt qu'un opt-in à ajouter dans chaque formulaire du
// portail (des dizaines de formulaires, coût d'intégration prohibitif
// pour ce qui reste une protection best-effort, pas une garantie stricte).
// Heuristique volontairement simple : tant qu'un <input>/<textarea>/
// <select> a le focus quelque part sur la page, le tour de rafraîchissement
// en cours est simplement SAUTÉ (pas annulé ni redémarré) — dès que le
// focus quitte le champ, le tour suivant s'exécute normalement.
const FORM_FIELD_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Barre supérieure : indicateur discret de rafraîchissement automatique,
 * cloche de notifications (décorative pour l'instant, pas de système de
 * notifications) et bloc profil (avatar initiales, nom, email, rôle).
 * Reste blanche, au-dessus du contenu, alignée à droite.
 */
export function Topbar({ user, role, onOpenMobileMenu }: TopbarProps) {
  const router = useRouter();
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isPulsing, setIsPulsing] = useState(false);
  const isEditingRef = useRef(false);

  // Horodatage initial posé après le montage seulement (jamais pendant le
  // rendu serveur) : un `new Date()` calculé côté serveur puis réévalué
  // côté client produirait un écart et un avertissement d'hydratation —
  // même précaution déjà appliquée ailleurs dans l'AppShell (préférence de
  // sidebar réduite, lue après montage uniquement).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture unique d'un horodatage au montage (même pattern deux passes que la préférence de sidebar réduite dans AppShell.tsx), sûr pour l'hydratation
    setLastUpdated(new Date());
  }, []);

  useEffect(() => {
    function handleFocusIn(event: FocusEvent) {
      const target = event.target as HTMLElement | null;
      if (target && FORM_FIELD_TAGS.has(target.tagName)) {
        isEditingRef.current = true;
      }
    }
    function handleFocusOut(event: FocusEvent) {
      const target = event.target as HTMLElement | null;
      if (target && FORM_FIELD_TAGS.has(target.tagName)) {
        isEditingRef.current = false;
      }
    }
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (isEditingRef.current) {
        // Saisie en cours détectée : ce tour est sauté, jamais annulé
        // définitivement — le suivant retentera dans REFRESH_INTERVAL_MS.
        return;
      }
      router.refresh();
      setLastUpdated(new Date());
      setIsPulsing(true);
      setTimeout(() => setIsPulsing(false), PULSE_DURATION_MS);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [router]);

  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-4 border-b border-border bg-surface px-4 sm:px-6">
      <button
        type="button"
        onClick={onOpenMobileMenu}
        aria-label="Ouvrir le menu"
        className="grid size-10 place-items-center rounded-lg text-muted-foreground transition-[background-color,transform] duration-150 ease-out-strong motion-safe:active:scale-[0.95] hover:bg-muted lg:hidden"
      >
        <Icon name="menu" className="size-5" />
      </button>

      <div className="ml-auto flex items-center gap-4">
        {/* Indicateur discret, non cliquable (pas de <button>/onClick) —
            remplace l'ancien bouton d'actualisation manuel. Le point pulse
            brièvement à chaque rafraîchissement réel ; le texte reste
            masqué sous sm pour ne pas surcharger la barre sur mobile. */}
        <div
          className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex"
          title={lastUpdated ? `Dernière actualisation automatique : ${lastUpdated.toLocaleTimeString("fr-FR")}` : undefined}
        >
          <span
            className={`size-1.5 rounded-full bg-success ${isPulsing ? "motion-safe:animate-refresh-pulse" : ""}`}
            aria-hidden="true"
          />
          <span className="tabular-nums">
            {lastUpdated ? `Mis à jour à ${lastUpdated.toLocaleTimeString("fr-FR")}` : ""}
          </span>
        </div>

        <button
          type="button"
          aria-label="Notifications"
          className="grid size-10 place-items-center rounded-lg border border-border text-muted-foreground transition-[background-color,transform] duration-150 ease-out-strong motion-safe:active:scale-[0.95] hover:bg-muted"
        >
          <Icon name="bell" className="size-5" />
        </button>

        <div className="flex items-center gap-3">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
            aria-hidden="true"
          >
            {initials(user.fullName)}
          </span>
          <div className="hidden leading-tight sm:block">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {user.fullName}
              <span className="rounded-full bg-info-bg px-2 py-0.5 text-[11px] font-medium text-info">
                {role}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
