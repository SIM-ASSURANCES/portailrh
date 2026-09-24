"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { NotificationDrawer } from "./NotificationDrawer";

interface NotificationBellProps {
  initialUnreadCount: number;
}

export function NotificationBell({ initialUnreadCount }: NotificationBellProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [prevInitialCount, setPrevInitialCount] = useState(initialUnreadCount);

  // Synchronisation si le compteur serveur change (ex: suite à router.refresh() déclenché par SSE/FCM)
  if (prevInitialCount !== initialUnreadCount) {
    setPrevInitialCount(initialUnreadCount);
    setUnreadCount(initialUnreadCount);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsDrawerOpen(true)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} non lues)` : ""}`}
        className="relative grid size-10 place-items-center rounded-lg border border-border text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out motion-safe:active:scale-[0.96] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground shadow-xs">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      <NotificationDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        unreadCount={unreadCount}
        onUnreadCountChange={setUnreadCount}
      />
    </>
  );
}
