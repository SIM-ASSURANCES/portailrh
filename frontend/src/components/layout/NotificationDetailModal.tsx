"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

import { Icon } from "@/components/icons";
import { Badge, Button } from "@/components/ui";

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

  // Fermer la modale avec la touche Echap
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-elevated-lg animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-start justify-between border-b border-border bg-slate-50/80 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon name="bell" className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-foreground">{notification.titre}</h3>
                {notification.priority === "CRITIQUE" && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-red-100 text-red-700 border border-red-200">
                    Critique
                  </span>
                )}
                {notification.priority === "IMPORTANT" && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-200">
                    Important
                  </span>
                )}
                {notification.category && notification.category !== "SYSTEME" && (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                    {notification.category}
                  </span>
                )}
                {!notification.estLue && (
                  <Badge variant="danger">
                    Nouveau
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formattedDate} ({relativeTime})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Fermer"
          >
            <Icon name="x" className="size-5" />
          </button>
        </div>

        {/* Corps du message */}
        <div className="p-6 space-y-4">
          <div className="rounded-xl border border-border/80 bg-slate-50/50 p-4 text-sm text-foreground leading-relaxed whitespace-pre-line">
            {notification.message}
          </div>

          {notification.lien && (
            <div className="flex items-center gap-2 rounded-lg bg-primary/5 p-3 text-xs text-primary">
              <Icon name="info" className="size-4 shrink-0" />
              <span>Un raccourci est disponible pour traiter ou consulter cet élément directement.</span>
            </div>
          )}
        </div>

        {/* Pied de page avec actions */}
        <div className="flex items-center justify-between border-t border-border bg-slate-50/50 px-6 py-3.5">
          <Button variant="secondary" onClick={onClose} className="px-3 py-1.5 text-xs">
            Fermer
          </Button>

          {notification.lien ? (
            <Button onClick={handleOpenLink} className="gap-1.5 px-3 py-1.5 text-xs">
              <span>Accéder à l&apos;élément</span>
              <Icon name="arrow-right" className="size-4" />
            </Button>
          ) : (
            <Button
              variant="secondary"
              className="px-3 py-1.5 text-xs"
              onClick={() => {
                if (onMarkAsRead) onMarkAsRead(notification.id);
                onClose();
              }}
            >
              Compris
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
