"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

import { Icon, type IconName } from "@/components/icons";
import { Badge, EmptyState } from "@/components/ui";
import { NotificationDetailModal, type NotificationItem } from "@/components/layout/NotificationDetailModal";
import { markNotificationAsRead } from "@/app/(dashboard)/profil/actions";

export interface DashboardAlertItem {
  id: string;
  title: string;
  description?: string;
  href?: string;
  variant: "danger" | "warning" | "info" | "success";
  icon: IconName;
}

interface DashboardNotificationsSectionProps {
  notifications: NotificationItem[];
  alerts: DashboardAlertItem[];
}

export function DashboardNotificationsSection({
  notifications: initialNotifications,
  alerts,
}: DashboardNotificationsSectionProps) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationItem[]>(initialNotifications);
  const [selectedNotif, setSelectedNotif] = useState<NotificationItem | null>(null);

  const handleSelectNotif = async (notif: NotificationItem) => {
    if (!notif.estLue) {
      await markNotificationAsRead(notif.id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, estLue: true } : n))
      );
    }

    if (notif.lien) {
      router.push(notif.lien);
      return;
    }

    setSelectedNotif(notif);
  };

  const handleMarkAsRead = async (id: string) => {
    await markNotificationAsRead(id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, estLue: true } : n))
    );
  };

  const alertVariantStyles: Record<string, { bg: string; border: string; text: string; iconColor: string }> = {
    danger: {
      bg: "bg-red-50/80 hover:bg-red-50",
      border: "border-red-200",
      text: "text-red-900",
      iconColor: "text-red-600",
    },
    warning: {
      bg: "bg-amber-50/80 hover:bg-amber-50",
      border: "border-amber-200",
      text: "text-amber-900",
      iconColor: "text-amber-600",
    },
    info: {
      bg: "bg-blue-50/80 hover:bg-blue-50",
      border: "border-blue-200",
      text: "text-blue-900",
      iconColor: "text-blue-600",
    },
    success: {
      bg: "bg-emerald-50/80 hover:bg-emerald-50",
      border: "border-emerald-200",
      text: "text-emerald-900",
      iconColor: "text-emerald-600",
    },
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2.5 text-xl font-black tracking-tight text-foreground">
          <span className="h-5 w-1 rounded-full bg-primary" aria-hidden="true" />
          Notifications et alertes
        </h2>
      </div>

      <div className="space-y-4">
        {/* 1. Bloc des Alertes d'action prioritaires */}
        {alerts.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {alerts.map((alert) => {
              const style = alertVariantStyles[alert.variant] || alertVariantStyles.info;
              const content = (
                <div
                  className={`flex items-start gap-3 rounded-xl border ${style.border} ${style.bg} p-4 transition-all duration-150 shadow-sm`}
                >
                  <span className={`mt-0.5 shrink-0 ${style.iconColor}`}>
                    <Icon name={alert.icon} className="size-5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold ${style.text}`}>{alert.title}</p>
                    {alert.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                        {alert.description}
                      </p>
                    )}
                  </div>
                  {alert.href && (
                    <Icon
                      name="arrow-right"
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    />
                  )}
                </div>
              );

              return alert.href ? (
                <Link key={alert.id} href={alert.href} className="group block">
                  {content}
                </Link>
              ) : (
                <div key={alert.id}>{content}</div>
              );
            })}
          </div>
        )}

        {/* 2. Flux des Notifications Personnelles Récentes */}
        <div className="rounded-2xl border border-border bg-surface shadow-elevated overflow-hidden">
          <div className="border-b border-border bg-slate-50/60 px-5 py-3 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Vos notifications récentes
            </span>
            <span className="text-xs text-muted-foreground">
              {notifications.filter((n) => !n.estLue).length} non lue(s)
            </span>
          </div>

          {notifications.length === 0 ? (
            <div className="p-8">
              <EmptyState icon="bell" message="Aucune notification pour le moment." compact />
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {notifications.map((notif) => {
                const dateObj = new Date(notif.createdAt);
                const relativeTime = formatDistanceToNow(dateObj, { addSuffix: true, locale: fr });

                return (
                  <div
                    key={notif.id}
                    onClick={() => handleSelectNotif(notif)}
                    className={`group flex items-center gap-4 px-5 py-3.5 transition-colors cursor-pointer ${
                      notif.estLue
                        ? "hover:bg-slate-50/80"
                        : "bg-primary/[0.03] hover:bg-primary/[0.07]"
                    }`}
                  >
                    <div className="shrink-0">
                      <div
                        className={`flex size-9 items-center justify-center rounded-xl ${
                          notif.estLue
                            ? "bg-muted text-muted-foreground"
                            : "bg-primary/10 text-primary"
                        }`}
                      >
                        <Icon name="bell" className="size-4" />
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p
                          className={`text-sm leading-snug truncate ${
                            notif.estLue
                              ? "text-foreground font-medium"
                              : "text-foreground font-bold"
                          }`}
                        >
                          {notif.titre}
                        </p>
                        {!notif.estLue && (
                          <Badge variant="danger">
                            Nouveau
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                        {notif.message}
                      </p>
                    </div>

                    <div className="shrink-0 flex items-center gap-3">
                      <span className="text-xs text-muted-foreground/80 hidden sm:inline">
                        {relativeTime}
                      </span>
                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        title="Ouvrir les détails"
                      >
                        <Icon name="chevron-right" className="size-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <NotificationDetailModal
        notification={selectedNotif}
        onClose={() => setSelectedNotif(null)}
        onMarkAsRead={handleMarkAsRead}
      />
    </section>
  );
}
