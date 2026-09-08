"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { Icon } from "@/components/icons";
import { getNotifications, markAllNotificationsAsRead, markNotificationAsRead } from "@/app/(dashboard)/profil/actions";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import type { Notification } from "backend";

interface NotificationBellProps {
  initialUnreadCount: number;
}

export function NotificationBell({ initialUnreadCount }: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

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

  const handleMarkAsRead = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await markNotificationAsRead(id);
    setNotifications((prev) => prev.filter(n => n.id !== id));
  };

  const handleNavigate = async (lien: string | null, id: string, estLue: boolean) => {
    if (!estLue) {
      markNotificationAsRead(id); // Fire and forget
      setNotifications((prev) => prev.filter(n => n.id !== id));
    }
    setIsOpen(false);
    if (lien) router.push(lien);
  };

  const handleMarkAllAsRead = async () => {
    await markAllNotificationsAsRead();
    setNotifications([]);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={handleOpen}
        aria-label="Notifications"
        className="relative grid size-10 place-items-center rounded-lg border border-border text-muted-foreground transition-[background-color,transform] duration-150 ease-out-strong motion-safe:active:scale-[0.95] hover:bg-muted"
      >
        <Icon name="bell" className="size-5" />
        {initialUnreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white">
            {initialUnreadCount > 9 ? "9+" : initialUnreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 origin-top-right rounded-xl border border-border bg-white shadow-elevated-lg ring-1 ring-black/5 animate-in fade-in slide-in-from-top-2 flex flex-col max-h-[85vh] overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-slate-50 rounded-t-xl">
            <h3 className="font-semibold text-foreground">Notifications</h3>
            {initialUnreadCount > 0 && (
              <button 
                onClick={handleMarkAllAsRead}
                className="text-xs text-primary hover:underline"
              >
                Tout marquer comme lu
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {isLoading ? (
              <div className="flex justify-center p-4">
                <Icon name="loader" className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Aucune notification pour le moment.
              </div>
            ) : (
              notifications.map((notif) => (
                <div
                  key={notif.id}
                  onClick={() => handleNavigate(notif.lien, notif.id, notif.estLue)}
                  className={`group relative block rounded-lg p-3 transition-colors cursor-pointer ${notif.estLue ? 'hover:bg-slate-50' : 'bg-primary/5 hover:bg-primary/10'}`}
                >
                  <button 
                    onClick={(e) => handleMarkAsRead(notif.id, e)} 
                    className="absolute right-2 top-2 rounded p-1 text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100"
                    title="Masquer la notification"
                  >
                    <Icon name="x" className="size-4" />
                  </button>
                  <div className="flex gap-3 pr-4">
                    <div className="mt-0.5 shrink-0">
                      {!notif.estLue ? (
                        <div className="size-2 rounded-full bg-primary mt-1.5" />
                      ) : (
                        <div className="size-2 rounded-full mt-1.5" />
                      )}
                    </div>
                    <div className="flex-1 space-y-1">
                      <p className={`text-sm ${notif.estLue ? 'text-foreground font-medium' : 'text-foreground font-semibold'}`}>
                        {notif.titre}
                      </p>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {notif.message}
                      </p>
                      <p className="text-[11px] text-muted-foreground/80 pt-1">
                        {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true, locale: fr })}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
