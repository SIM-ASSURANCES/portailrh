"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { Icon } from "@/components/icons";
import { getNotifications, markAllNotificationsAsRead, markNotificationAsRead } from "@/app/(dashboard)/profil/actions";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import type { Notification } from "backend";
import { NotificationDetailModal } from "./NotificationDetailModal";

interface NotificationBellProps {
  initialUnreadCount: number;
}

export function NotificationBell({ initialUnreadCount }: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [selectedNotif, setSelectedNotif] = useState<Notification | null>(null);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [prevInitialCount, setPrevInitialCount] = useState(initialUnreadCount);
  const [isLoading, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);

  if (prevInitialCount !== initialUnreadCount) {
    setPrevInitialCount(initialUnreadCount);
    setUnreadCount(initialUnreadCount);
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleOpen = () => {
    setIsOpen(!isOpen);
    if (!isOpen) {
      startTransition(async () => {
        const data = await getNotifications();
        setNotifications(data);
      });
    }
  };

  const handleMarkAsRead = async (id: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    await markNotificationAsRead(id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setUnreadCount((prev) => Math.max(0, prev - 1));
  };

  const handleSelectNotification = (notif: Notification) => {
    setIsOpen(false);
    setSelectedNotif(notif);
    if (!notif.estLue) {
      handleMarkAsRead(notif.id);
    }
  };

  const handleMarkAllAsRead = async () => {
    await markAllNotificationsAsRead();
    setNotifications([]);
    setUnreadCount(0);
  };

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={handleOpen}
          aria-label="Notifications"
          className="relative grid size-10 place-items-center rounded-lg border border-border text-muted-foreground transition-[background-color,transform] duration-150 ease-out-strong motion-safe:active:scale-[0.95] hover:bg-muted"
        >
          <Icon name="bell" className="size-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white animate-pulse">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>

        {isOpen && (
          <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 origin-top-right rounded-xl border border-border bg-white shadow-elevated-lg ring-1 ring-black/5 animate-in fade-in slide-in-from-top-2 flex flex-col max-h-[85vh] overflow-hidden z-40">
            <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-slate-50 rounded-t-xl">
              <h3 className="font-semibold text-foreground">Notifications</h3>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllAsRead}
                  className="text-xs text-primary hover:underline font-medium"
                >
                  Tout marquer comme lu
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {isLoading ? (
                <div className="flex justify-center p-6">
                  <Icon name="loader" className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : notifications.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Aucune notification non lue.
                </div>
              ) : (
                notifications.map((notif) => (
                  <div
                    key={notif.id}
                    onClick={() => handleSelectNotification(notif)}
                    className={`group relative block rounded-xl p-3 transition-colors cursor-pointer border border-transparent ${
                      notif.estLue
                        ? "hover:bg-slate-50 hover:border-border/60"
                        : "bg-primary/5 hover:bg-primary/10 hover:border-primary/20"
                    }`}
                  >
                    <button
                      onClick={(e) => handleMarkAsRead(notif.id, e)}
                      className="absolute right-2 top-2 rounded p-1 text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100 transition-opacity"
                      title="Marquer comme lu"
                    >
                      <Icon name="x" className="size-4" />
                    </button>
                    <div className="flex gap-3 pr-4">
                      <div className="mt-0.5 shrink-0">
                        {!notif.estLue ? (
                          <div className="size-2 rounded-full bg-primary mt-1.5 ring-4 ring-primary/20" />
                        ) : (
                          <div className="size-2 rounded-full mt-1.5 bg-slate-300" />
                        )}
                      </div>
                      <div className="flex-1 space-y-1 min-w-0">
                        <p
                          className={`text-sm leading-snug truncate ${
                            notif.estLue ? "text-foreground font-medium" : "text-foreground font-bold"
                          }`}
                        >
                          {notif.titre}
                        </p>
                        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                          {notif.message}
                        </p>
                        <div className="flex items-center gap-2 pt-1">
                          <span className="text-[11px] text-muted-foreground/80">
                            {formatDistanceToNow(new Date(notif.createdAt), {
                              addSuffix: true,
                              locale: fr,
                            })}
                          </span>
                          {notif.lien && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-primary">
                              <span>Action</span>
                              <Icon name="arrow-up-right" className="size-2.5" />
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <NotificationDetailModal
        notification={selectedNotif}
        onClose={() => setSelectedNotif(null)}
        onMarkAsRead={handleMarkAsRead}
      />
    </>
  );
}
