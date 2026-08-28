"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

interface AppShellProps {
  user: { fullName: string; email: string };
  role: string;
  /** Affiche la section « Administration » dans la sidebar (rôle Admin). */
  canAdmin?: boolean;
  children: ReactNode;
}

const STORAGE_KEY = "sim-sidebar-collapsed";

/**
 * Coquille des écrans authentifiés : sidebar + topbar + zone de contenu.
 * Détient l'état « réduit » de la sidebar (persisté en localStorage) afin
 * que la largeur du contenu s'ajuste. Le layout serveur ne fait que lui
 * transmettre l'utilisateur et son rôle.
 */
export function AppShell({ user, role, canAdmin = false, children }: AppShellProps) {
  // Rendu initial (serveur + première passe client) toujours « déployé »
  // pour éviter tout écart d'hydratation ; on relit la préférence persistée
  // juste après le montage, côté client uniquement.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) === "1";
      // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture unique d'une préférence UI au montage (pattern deux passes, sûr pour l'hydratation)
      if (stored) setCollapsed(true);
    } catch {
      /* localStorage indisponible : on garde l'état déployé par défaut. */
    }
  }, []);

  function toggleCollapse() {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <div className="flex min-h-screen bg-app-bg">
      <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} canAdmin={canAdmin} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} role={role} />
        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
