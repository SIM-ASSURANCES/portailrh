"use client";

import { useEffect, useRef } from "react";

import { logoutForInactivityAction } from "./actions";

// Déconnexion automatique après inactivité (voir CLAUDE.md "Déconnexion
// automatique après inactivité") — 60 minutes sans AUCUNE activité
// utilisateur réelle (souris, clavier, défilement, tactile). Valeur unique,
// à ne modifier qu'ici (jamais dupliquée ailleurs dans le composant).
const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes

// Évènements considérés comme une activité utilisateur réelle — volontairement
// restreint à des interactions physiques directes. Le rafraîchissement en
// temps réel (SSE, voir `Topbar.tsx`/`src/lib/eventBus.ts`) déclenche un
// `router.refresh()`, qui ne dispatche jamais aucun de ces évènements : la
// seule liste suffit déjà à garantir que le SSE ne compte jamais comme de
// l'activité, sans code de filtrage supplémentaire.
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart", "scroll"] as const;

// Évite de relancer clearTimeout/setTimeout à chaque pixel de mousemove
// (potentiellement des centaines par seconde) : un seul reset accepté par
// fenêtre de ce délai, largement suffisant pour rester réactif à une vraie
// reprise d'activité.
const RESET_THROTTLE_MS = 1_000;

/**
 * Monté une seule fois depuis `AppShell.tsx` (donc actif sur toutes les
 * pages authentifiées) : déclenche `logoutForInactivityAction()` — même
 * `signOut()` server-side que le bouton « Déconnexion » de la sidebar,
 * voir `actions.ts` — après `INACTIVITY_TIMEOUT_MS` sans la moindre
 * activité utilisateur réelle. Ne rend rien (purement un effet de bord).
 *
 * Fonctionne aussi sur un onglet resté en arrière-plan : un simple
 * `setTimeout`/`clearTimeout` continue de s'exécuter dans un onglet masqué
 * (contrairement à `requestAnimationFrame`, jamais utilisé ici) — seulement
 * ralenti par le navigateur au-delà de quelques minutes d'arrière-plan,
 * jamais interrompu, ce qui reste largement dans la marge d'une minuterie
 * de 60 minutes.
 */
export function InactivityLogout() {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastResetRef = useRef(0);

  useEffect(() => {
    function scheduleLogout() {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        logoutForInactivityAction();
      }, INACTIVITY_TIMEOUT_MS);
    }

    function handleActivity(event: Event) {
      // Défense en profondeur : ignore tout évènement non dispatché
      // directement par le navigateur en réponse à une action physique de
      // l'utilisateur (un évènement synthétique déclenché par du code —
      // volontairement ou non — n'est jamais `isTrusted`).
      if (!event.isTrusted) return;
      const now = Date.now();
      if (now - lastResetRef.current < RESET_THROTTLE_MS) return;
      lastResetRef.current = now;
      scheduleLogout();
    }

    scheduleLogout();
    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, handleActivity, { passive: true });
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, handleActivity);
      }
    };
  }, []);

  return null;
}
