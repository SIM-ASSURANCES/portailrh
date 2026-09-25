"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/icons";
import { TopbarCalendar } from "./TopbarCalendar";
import { NotificationBell } from "./NotificationBell";
import { ProfileMenu } from "./ProfileMenu";
import type { TopbarAlertData } from "@/lib/topbarAlerts";
import Link from "next/link";

interface TopbarProps {
  user: { fullName: string; email: string; photoUrl?: string | null };
  role: string;
  canAccessPointageRH?: boolean;
  unreadNotificationsCount?: number;
  alert?: TopbarAlertData | null;
  /** Ouvre le tiroir de navigation mobile (bouton visible seulement < lg). */
  onOpenMobileMenu: () => void;
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

import { playNotificationSound } from "@/lib/audio/notificationSound";
import { onForegroundMessage } from "@/lib/notifications/fcmClient";
import { toast } from "sonner";
import { ShieldAlert, AlertTriangle, Bell } from "lucide-react";

export function Topbar({ user, role, canAccessPointageRH, unreadNotificationsCount = 0, alert, onOpenMobileMenu }: TopbarProps) {
  const router = useRouter();
  const isEditingRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const recentNotifIdsRef = useRef<Set<string>>(new Set());

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
    const source = new EventSource(EVENTS_URL);

    // 1. Évènement global de changement de données
    source.addEventListener("data-changed", () => {
      if (isEditingRef.current) {
        pendingRefreshRef.current = true;
        return;
      }
      router.refresh();
    });

    // 2. Évènement ciblé temps réel (Notification spécifique à l'utilisateur)
    source.addEventListener("notification", (event) => {
      try {
        const notif = JSON.parse(event.data);
        if (notif.id) {
          recentNotifIdsRef.current.add(notif.id);
          setTimeout(() => recentNotifIdsRef.current.delete(notif.id), 5000);
        }

        // Jouer le carillon sonore
        playNotificationSound(notif.priority);

        // Afficher le toast selon le niveau de priorité aux couleurs institutionnelles
        const toastAction = notif.lien
          ? {
            label: "Consulter",
            onClick: () => router.push(notif.lien),
          }
          : undefined;

        const isCritical = notif.priority === "CRITIQUE";
        const isImportant = notif.priority === "IMPORTANT";

        const priorityPrefix = isCritical
          ? "[Alerte critique] "
          : isImportant
            ? "[Important] "
            : "";
        const toastTitle = `${priorityPrefix}${notif.titre}`;
        const toastDuration = isCritical ? 9000 : isImportant ? 6000 : 4000;

        const priorityIcon = isCritical ? (
          <ShieldAlert className="size-5 text-primary shrink-0" />
        ) : isImportant ? (
          <AlertTriangle className="size-5 text-primary shrink-0" />
        ) : (
          <Bell className="size-5 text-primary shrink-0" />
        );

        toast(toastTitle, {
          description: notif.message,
          duration: toastDuration,
          action: toastAction,
          icon: priorityIcon,
          className: "!bg-primary-bg !text-primary !border-primary-border",
        });

        // Actualiser l'UI (notamment le compteur de la cloche)
        if (!isEditingRef.current) {
          router.refresh();
        } else {
          pendingRefreshRef.current = true;
        }
      } catch (err) {
        console.error("[SSE] Erreur parsing notification:", err);
      }
    });

    // 3. Écoute FCM au premier plan (si l'onglet est actif et qu'un push arrive)
    const unsubscribeFcm = onForegroundMessage((fcmData) => {
      if (fcmData.id && recentNotifIdsRef.current.has(fcmData.id)) {
        return; // Déjà traité par le flux SSE
      }
      if (fcmData.id) {
        recentNotifIdsRef.current.add(fcmData.id);
        setTimeout(() => recentNotifIdsRef.current.delete(fcmData.id!), 5000);
      }

      playNotificationSound(fcmData.priority as 'INFO' | 'IMPORTANT' | 'CRITIQUE');

      const toastAction = fcmData.lien
        ? {
          label: "Consulter",
          onClick: () => router.push(fcmData.lien!),
        }
        : undefined;

      const isCritical = fcmData.priority === "CRITIQUE";
      const isImportant = fcmData.priority === "IMPORTANT";

      const fcmPriorityPrefix = isCritical
        ? "[Alerte critique] "
        : isImportant
          ? "[Important] "
          : "";
      const fcmToastTitle = `${fcmPriorityPrefix}${fcmData.titre}`;

      const fcmPriorityIcon = isCritical ? (
        <ShieldAlert className="size-5 text-primary shrink-0" />
      ) : isImportant ? (
        <AlertTriangle className="size-5 text-primary shrink-0" />
      ) : (
        <Bell className="size-5 text-primary shrink-0" />
      );

      toast(fcmToastTitle, {
        description: fcmData.message,
        duration: isCritical ? 9000 : 5000,
        action: toastAction,
        icon: fcmPriorityIcon,
        className: "!bg-primary-bg !text-primary !border-primary-border",
      });

      router.refresh();
    });

    return () => {
      source.close();
      unsubscribeFcm();
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

      <div className="ml-auto flex items-center gap-3 sm:gap-4">
        {alert && (
          alert.href ? (
            <Link
              href={alert.href}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 sm:px-3 text-xs font-medium transition-colors ${
                alert.variant === "danger"
                  ? "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
                  : alert.variant === "warning"
                  ? "bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100"
                  : "bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200/70"
              }`}
              title={alert.message}
            >
              <Icon
                name={
                  alert.variant === "danger"
                    ? "alert-triangle"
                    : alert.variant === "warning"
                    ? "clock"
                    : "info"
                }
                className="size-4 shrink-0"
              />
              <span className="hidden md:inline">{alert.message}</span>
              <span className="md:hidden">{alert.shortMessage || alert.message}</span>
              <Icon name="arrow-right" className="size-3.5 shrink-0 hidden sm:inline" />
            </Link>
          ) : (
            <div
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 sm:px-3 text-xs font-medium border ${
                alert.variant === "danger"
                  ? "bg-red-50 text-red-700 border-red-200"
                  : alert.variant === "warning"
                  ? "bg-amber-50 text-amber-800 border-amber-200"
                  : "bg-slate-50 text-slate-700 border-slate-200"
              }`}
              title={alert.message}
            >
              <Icon
                name={
                  alert.variant === "danger"
                    ? "alert-triangle"
                    : alert.variant === "warning"
                    ? "clock"
                    : "info"
                }
                className="size-4 shrink-0"
              />
              <span className="hidden md:inline">{alert.message}</span>
              <span className="md:hidden">{alert.shortMessage || alert.message}</span>
            </div>
          )
        )}

        <TopbarCalendar isRH={canAccessPointageRH} />

        <NotificationBell initialUnreadCount={unreadNotificationsCount} />

        <ProfileMenu user={user} role={role} />
      </div>
    </header>
  );
}
