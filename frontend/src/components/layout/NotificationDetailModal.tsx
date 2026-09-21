"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { Bell, X, ArrowUpRight, ShieldAlert, AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui";

export interface NotificationItem {
  id: string;
  titre: string;
  message: string;
  lien?: string | null;
  estLue: boolean;
  priority?: "CRITIQUE" | "IMPORTANT" | "INFO";
  category?: "TRESORERIE" | "POINTAGE" | "RH" | "ADMIN" | "SYSTEME";
  createdAt: string | Date;
}

interface NotificationDetailModalProps {
  notification: NotificationItem | null;
  onClose: () => void;
  onMarkAsRead?: (id: string) => void;
}

export function NotificationDetailModal({
  notification,
  onClose,
  onMarkAsRead,
}: NotificationDetailModalProps) {
  const router = useRouter();

  // Fermer la modale avec la touche Échap
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!notification) return null;

  const dateObj = new Date(notification.createdAt);
  const formattedDate = format(dateObj, "d MMMM yyyy 'à' HH:mm", { locale: fr });
  const relativeTime = formatDistanceToNow(dateObj, { addSuffix: true, locale: fr });

  const handleOpenLink = () => {
    if (onMarkAsRead) {
      onMarkAsRead(notification.id);
    }
    onClose();
    if (notification.lien) {
      router.push(notification.lien);
    }
  };

  const handleAcknowledge = () => {
    if (onMarkAsRead) {
      onMarkAsRead(notification.id);
    }
    onClose();
  };

  const isCritical = notification.priority === "CRITIQUE";
  const isImportant = notification.priority === "IMPORTANT";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface shadow-xl animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-notif-title"
      >
        {/* En-tête sobre et raffiné */}
        <div className="flex items-start justify-between border-b border-border/80 px-6 py-4 bg-surface">
          <div className="flex items-start gap-3.5 min-w-0 pr-2">
            <div className="mt-0.5 shrink-0">
              {isCritical ? (
                <div className="grid size-9 place-items-center rounded-lg bg-red-100 text-red-700">
                  <ShieldAlert className="size-4.5" />
                </div>
              ) : isImportant ? (
                <div className="grid size-9 place-items-center rounded-lg bg-amber-100 text-amber-700">
                  <AlertTriangle className="size-4.5" />
                </div>
              ) : (
                <div className="grid size-9 place-items-center rounded-lg bg-slate-100 text-slate-600">
                  <Bell className="size-4.5" />
                </div>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                {isCritical && (
                  <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700 border border-red-200/60 uppercase tracking-wide">
                    Alerte critique
                  </span>
                )}
                {isImportant && (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 border border-amber-200/60 uppercase tracking-wide">
                    Important
                  </span>
                )}
                {notification.category && notification.category !== "SYSTEME" && (
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                    {notification.category}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground/60">•</span>
                <span className="text-xs text-muted-foreground">
                  {relativeTime}
                </span>
              </div>
              <h3
                id="modal-notif-title"
                className="text-base font-semibold text-foreground leading-snug break-words"
              >
                {notification.titre}
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
            aria-label="Fermer la boîte de dialogue"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Corps du message épuré */}
        <div className="p-6 space-y-4">
          <div className="rounded-lg border border-border/60 bg-slate-50/60 p-4 text-sm text-foreground/90 leading-relaxed whitespace-pre-line">
            {notification.message}
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>Date de réception : {formattedDate}</span>
            {notification.estLue ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground/80">
                <Check className="size-3.5" />
                Lue
              </span>
            ) : (
              <span className="font-medium text-primary">Non lue</span>
            )}
          </div>
        </div>

        {/* Pied de page épuré */}
        <div className="flex items-center justify-end gap-2 border-t border-border/80 bg-slate-50/40 px-6 py-3.5">
          <Button
            variant="secondary"
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-medium"
          >
            Fermer
          </Button>

          {notification.lien ? (
            <Button
              onClick={handleOpenLink}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium"
            >
              <span>Accéder</span>
              <ArrowUpRight className="size-3.5" />
            </Button>
          ) : !notification.estLue ? (
            <Button
              variant="secondary"
              onClick={handleAcknowledge}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium"
            >
              <Check className="size-3.5" />
              <span>Marquer comme lu</span>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
