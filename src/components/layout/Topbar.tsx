import { Icon } from "@/components/icons";
import { TopbarCalendar } from "./TopbarCalendar";

interface TopbarProps {
  user: { fullName: string; email: string };
  role: string;
  canAccessPointageRH?: boolean;
  /** Ouvre le tiroir de navigation mobile (bouton visible seulement < lg). */
  onOpenMobileMenu: () => void;
}

function initials(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Barre supérieure : cloche de notifications (décorative pour l'instant, pas
 * de système de notifications) et bloc profil (avatar initiales, nom, email,
 * rôle). Reste blanche, au-dessus du contenu, alignée à droite.
 */
export function Topbar({ user, role, canAccessPointageRH, onOpenMobileMenu }: TopbarProps) {
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
        <TopbarCalendar isRH={canAccessPointageRH} />
        
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
