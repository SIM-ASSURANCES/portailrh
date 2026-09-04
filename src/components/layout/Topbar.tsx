"use client";

import { useEffect, useRef } from "react";
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

// Rafraîchissement en temps réel (remplace le polling à 20s d'une itération
// précédente — voir CLAUDE.md "Rafraîchissement en temps réel") : ce
// composant s'abonne au flux SSE de `src/app/api/events/route.ts` et
// déclenche `router.refresh()` dès qu'un évènement "data-changed" arrive —
// publié par les Server Actions pertinentes via `src/lib/eventBus.ts`.
// Complètement invisible pour l'utilisateur (demande explicite) : aucun
// bouton, aucun indicateur, aucun texte — seul l'effet de bord compte.
const EVENTS_URL = "/api/events";

// Formulaire en cours de saisie détecté génériquement (focus sur un champ
// de saisie), plutôt qu'un opt-in à ajouter dans chaque formulaire du
// portail (des dizaines de formulaires, coût d'intégration prohibitif pour
// ce qui reste une protection best-effort, pas une garantie stricte). Un
// évènement arrivant pendant une saisie n'est jamais perdu ni ignoré : il
// est simplement DIFFÉRÉ (`pendingRefreshRef`) et appliqué dès que le focus
// quitte le champ — contrairement au polling précédent, où un tour sauté
// n'avait pas besoin d'être rattrapé (le suivant arrivait de toute façon
// 20s plus tard) : ici, un évènement ignoré pourrait rester le SEUL
// évènement à venir avant longtemps.
const FORM_FIELD_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function Topbar({ user, role, onOpenMobileMenu }: TopbarProps) {
  const router = useRouter();
  const isEditingRef = useRef(false);
  const pendingRefreshRef = useRef(false);

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
        if (pendingRefreshRef.current) {
          pendingRefreshRef.current = false;
          router.refresh();
        }
      }
    }
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
    };
  }, [router]);

  useEffect(() => {
    // `EventSource` se reconnecte nativement (backoff intégré du navigateur)
    // sur une coupure réseau ou un redémarrage du serveur dev — aucune
    // logique de reconnexion manuelle nécessaire, vérifié en conditions
    // réelles (voir CLAUDE.md).
    const source = new EventSource(EVENTS_URL);

    source.addEventListener("data-changed", () => {
      if (isEditingRef.current) {
        // Saisie en cours : différé plutôt que perdu (voir commentaire plus
        // haut) — appliqué au prochain `focusout`.
        pendingRefreshRef.current = true;
        return;
      }
      router.refresh();
    });

    // "ping" (heartbeat serveur) : volontairement aucun handler — la seule
    // fonction de cet évènement est de garder la connexion HTTP ouverte à
    // travers d'éventuels proxys, jamais de déclencher un rafraîchissement.

    return () => {
      source.close();
    };
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
