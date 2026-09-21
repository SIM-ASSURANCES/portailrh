"use client";

import { useState, useEffect, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import {
  Bell,
  X,
  CheckCheck,
  ArrowUpRight,
  ShieldAlert,
  AlertTriangle,
  Info,
  Check,
  Loader2,
} from "lucide-react";
import type { Notification } from "backend";
import {
  getNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "@/app/(dashboard)/profil/actions";
import { NotificationDetailModal } from "./NotificationDetailModal";

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  unreadCount: number;
  onUnreadCountChange: (count: number) => void;
}

type FilterTab = "all" | "unread" | "priority";

export function NotificationDrawer({
  isOpen,
  onClose,
  unreadCount,
  onUnreadCountChange,
}: NotificationDrawerProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [selectedNotif, setSelectedNotif] = useState<Notification | null>(null);
  const [isLoading, startLoadingTransition] = useTransition();
  const [isMarkingAll, setIsMarkingAll] = useState(false);

  // Charger les notifications dès l'ouverture du tiroir
  useEffect(() => {
    if (isOpen) {
      startLoadingTransition(async () => {
        try {
          const data = await getNotifications();
          setNotifications(data);
        } catch (error) {
          console.error("Erreur chargement notifications:", error);
        }
      });
    }
  }, [isOpen]);

  // Fermer le tiroir avec la touche Échap
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Verrouiller le défilement de l'arrière-plan quand le tiroir est ouvert
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Marquer une notification comme lue
  const handleMarkAsRead = async (id: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    // Mise à jour optimiste
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, estLue: true } : n))
    );
    onUnreadCountChange(Math.max(0, unreadCount - 1));

    try {
      await markNotificationAsRead(id);
    } catch (error) {
      console.error("Erreur marquage notification:", error);
    }
  };

  // Marquer toutes les notifications comme lues
  const handleMarkAllAsRead = async () => {
    if (unreadCount === 0 || isMarkingAll) return;
    setIsMarkingAll(true);
    // Mise à jour optimiste
    setNotifications((prev) => prev.map((n) => ({ ...n, estLue: true })));
    onUnreadCountChange(0);

    try {
      await markAllNotificationsAsRead();
    } catch (error) {
      console.error("Erreur tout marquer comme lu:", error);
    } finally {
      setIsMarkingAll(false);
    }
  };

  // Clic sur une notification
  const handleSelectNotification = (notif: Notification) => {
    if (!notif.estLue) {
      handleMarkAsRead(notif.id);
    }
    // Si la notification a un lien direct, on peut ouvrir la modale ou naviguer
    setSelectedNotif(notif);
  };

  // Filtrage selon l'onglet actif
  const filteredNotifications = notifications.filter((notif) => {
    if (activeTab === "unread") return !notif.estLue;
    if (activeTab === "priority") return notif.priority === "CRITIQUE" || notif.priority === "IMPORTANT";
    return true;
  });

  const unreadTotal = notifications.filter((n) => !n.estLue).length;
  const priorityTotal = notifications.filter(
    (n) => n.priority === "CRITIQUE" || n.priority === "IMPORTANT"
  ).length;

  if (!isOpen) return null;

  return (
    <>
      {/* Voile d'arrière-plan feutré */}
      <div
        className="fixed inset-0 z-40 bg-slate-900/25 backdrop-blur-[2px] transition-opacity duration-200 animate-in fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Tiroir latéral coulissant */}
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-surface shadow-2xl border-l border-border animate-in slide-in-from-right duration-250 ease-out sm:max-w-[440px]"
        role="dialog"
        aria-modal="true"
        aria-label="Centre de notifications"
      >
        {/* EN-TÊTE ÉPURÉ */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4 bg-surface">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-bold text-foreground tracking-tight">
              Notifications
            </h2>
            {unreadTotal > 0 && (
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                {unreadTotal}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {unreadTotal > 0 && (
              <button
                type="button"
                onClick={handleMarkAllAsRead}
                disabled={isMarkingAll}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
                title="Tout marquer comme lu"
              >
                {isMarkingAll ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CheckCheck className="size-3.5" />
                )}
                <span>Tout marquer comme lu</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="Fermer le tiroir"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* BARRE DE FILTRES MINIMALISTE */}
        <div className="flex items-center gap-1.5 border-b border-border/70 px-5 py-2.5 bg-slate-50/50">
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              activeTab === "all"
                ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            Toutes ({notifications.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("unread")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              activeTab === "unread"
                ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            Non lues {unreadTotal > 0 ? `(${unreadTotal})` : ""}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("priority")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              activeTab === "priority"
                ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            Prioritaires {priorityTotal > 0 ? `(${priorityTotal})` : ""}
          </button>
        </div>

        {/* LISTE DES NOTIFICATIONS */}
        <div className="flex-1 overflow-y-auto divide-y divide-border/40">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="size-6 animate-spin mb-2" />
              <p className="text-xs">Chargement des notifications...</p>
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
              <div className="grid size-12 place-items-center rounded-full bg-muted/60 text-muted-foreground/60 mb-3">
                <Bell className="size-5" />
              </div>
              <p className="text-sm font-semibold text-foreground">
                Vous êtes à jour
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-[240px]">
                {activeTab === "unread"
                  ? "Aucune notification non lue pour le moment."
                  : activeTab === "priority"
                  ? "Aucune alerte prioritaire en attente."
                  : "Aucune notification enregistrée."}
              </p>
            </div>
          ) : (
            filteredNotifications.map((notif) => {
              const isCritical = notif.priority === "CRITIQUE";
              const isImportant = notif.priority === "IMPORTANT";
              const isUnread = !notif.estLue;

              return (
                <div
                  key={notif.id}
                  onClick={() => handleSelectNotification(notif)}
                  className={`group relative p-4 transition-colors cursor-pointer border-l-[3px] ${
                    isCritical
                      ? "border-l-red-600 bg-red-50/10 hover:bg-red-50/20"
                      : isImportant && isUnread
                      ? "border-l-amber-500 bg-amber-50/10 hover:bg-amber-50/20"
                      : isUnread
                      ? "border-l-primary bg-primary/[0.03] hover:bg-primary/[0.06]"
                      : "border-l-transparent hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Discrète icône de priorité */}
                    <div className="mt-0.5 shrink-0">
                      {isCritical ? (
                        <div className="grid size-7 place-items-center rounded-lg bg-red-100 text-red-700">
                          <ShieldAlert className="size-4" />
                        </div>
                      ) : isImportant ? (
                        <div className="grid size-7 place-items-center rounded-lg bg-amber-100 text-amber-700">
                          <AlertTriangle className="size-4" />
                        </div>
                      ) : (
                        <div className="grid size-7 place-items-center rounded-lg bg-slate-100 text-slate-600">
                          <Info className="size-4" />
                        </div>
                      )}
                    </div>

                    {/* Contenu principal */}
                    <div className="flex-1 min-w-0 pr-6">
                      <div className="flex items-center gap-1.5 mb-1">
                        {isCritical && (
                          <span className="text-[10px] font-bold text-red-700 tracking-wider uppercase">
                            Alerte
                          </span>
                        )}
                        {isCritical && <span className="text-slate-300">•</span>}
                        {notif.category && notif.category !== "SYSTEME" && (
                          <span className="text-[10px] font-medium text-muted-foreground uppercase">
                            {notif.category}
                          </span>
                        )}
                        {notif.category && notif.category !== "SYSTEME" && (
                          <span className="text-slate-300">•</span>
                        )}
                        <span className="text-[11px] text-muted-foreground">
                          {formatDistanceToNow(new Date(notif.createdAt), {
                            addSuffix: true,
                            locale: fr,
                          })}
                        </span>
                      </div>

                      <h4
                        className={`text-xs leading-snug line-clamp-1 ${
                          isUnread
                            ? "font-bold text-foreground"
                            : "font-medium text-foreground/80"
                        }`}
                      >
                        {notif.titre}
                      </h4>

                      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed mt-1">
                        {notif.message}
                      </p>

                      {notif.lien && (
                        <div className="mt-2 flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                          <span>Consulter</span>
                          <ArrowUpRight className="size-3" />
                        </div>
                      )}
                    </div>

                    {/* Bouton de marquage individuel discret au survol */}
                    {isUnread && (
                      <button
                        type="button"
                        onClick={(e) => handleMarkAsRead(notif.id, e)}
                        className="absolute right-3 top-4 grid size-7 place-items-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground transition-all"
                        title="Marquer comme lu"
                      >
                        <Check className="size-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Modale de consultation détaillée sobre */}
      {selectedNotif && (
        <NotificationDetailModal
          notification={selectedNotif}
          onClose={() => setSelectedNotif(null)}
          onMarkAsRead={(id) => handleMarkAsRead(id)}
        />
      )}
    </>
  );
}
