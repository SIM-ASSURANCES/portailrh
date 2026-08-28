"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Icon } from "@/components/icons";
import { ADMIN_GROUP, DASHBOARD_ITEM, getNavBranches, type NavBranch, type NavItem } from "./nav";
import { signOutAction } from "./actions";

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Rôle Admin : ajoute la section « Administration » au bas de la navigation. */
  canAdmin?: boolean;
  /** categoriser_demande OU valider_demande : ajoute "Demandes à traiter (Finance)". */
  canAccesFinanceDemandes?: boolean;
  /** Tiroir mobile (< lg) : ouvert/fermé. Sans effet à partir de lg. */
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function branchContains(branch: NavBranch, pathname: string) {
  return branch.groups.some((group) => group.items.some((item) => isActive(pathname, item.href)));
}

/**
 * Sidebar de la coquille applicative.
 *
 * - En-tête logo (bandeau bleu déployé / marque seule en réduit).
 * - « Tableau de bord » épinglé, puis les deux branches fonctionnelles en
 *   accordéon (une seule ouverte à la fois ; celle de la route courante
 *   est ouverte au chargement).
 * - Pied : bascule « Réduire » et « Déconnexion ».
 * - En mode réduit : colonne d'icônes, branches séparées par un filet,
 *   libellés portés par l'attribut `title`.
 * - En dessous de `lg` : tiroir hors-écran (position fixe, glissé depuis la
 *   gauche), ouvert via le bouton menu de la Topbar, avec un fond
 *   d'estompage cliquable pour le refermer, et qui se referme automatiquement
 *   au clic sur un lien. Toujours en flux normal à partir de `lg`, inchangé.
 */
export function Sidebar({
  collapsed,
  onToggleCollapse,
  canAdmin = false,
  canAccesFinanceDemandes = false,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const pathname = usePathname();
  const navBranches = getNavBranches({ canAccesFinanceDemandes });
  const [openBranch, setOpenBranch] = useState<string | null>(
    () => navBranches.find((branch) => branchContains(branch, pathname))?.key ?? navBranches[0].key
  );

  return (
    <>
      {mobileOpen ? (
        <div
          onClick={onCloseMobile}
          aria-hidden="true"
          className="fixed inset-0 z-20 bg-slate-900/40 lg:hidden"
        />
      ) : null}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-200 lg:sticky lg:top-0 lg:translate-x-0 lg:transition-[width] ${
          collapsed ? "w-[72px]" : "w-64"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* En-tête logo */}
        <div
          className={`flex h-16 shrink-0 items-center ${
            collapsed ? "justify-center bg-sidebar" : "justify-between bg-primary px-5"
          }`}
        >
          {collapsed ? (
            <LogoMark className="size-8 text-primary" />
          ) : (
            <Image src="/logo-sim-blanc.webp" alt="SIM Assurances" width={188} height={28} priority />
          )}
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Fermer le menu"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-primary-foreground/80 hover:bg-white/10 lg:hidden"
          >
            <Icon name="x" className="size-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-3 py-4">
          <ItemLink
            item={DASHBOARD_ITEM}
            active={isActive(pathname, DASHBOARD_ITEM.href)}
            collapsed={collapsed}
            onNavigate={onCloseMobile}
          />

          {navBranches.map((branch) => {
            const open = openBranch === branch.key;
            const hasActive = branchContains(branch, pathname);

            if (collapsed) {
              return (
                <div key={branch.key} className="mt-2 border-t border-sidebar-border pt-2">
                  <ul className="space-y-1">
                    {branch.groups.flatMap((group) =>
                      group.items.map((item) => (
                        <li key={item.href}>
                          <ItemLink
                            item={item}
                            active={isActive(pathname, item.href)}
                            collapsed
                            onNavigate={onCloseMobile}
                          />
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              );
            }

            return (
              <div key={branch.key} className="pt-2">
                <button
                  type="button"
                  onClick={() => setOpenBranch(open ? null : branch.key)}
                  aria-expanded={open}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                    hasActive ? "text-primary" : "text-slate-800"
                  } hover:bg-slate-100`}
                >
                  <Icon name={branch.icon} className="size-[18px] shrink-0" />
                  <span className="flex-1 truncate text-left">{branch.label}</span>
                  <Icon
                    name="chevron-down"
                    className={`size-4 shrink-0 text-slate-400 transition-transform ${open ? "" : "-rotate-90"}`}
                  />
                </button>

                {open ? (
                  <div className="mt-1 space-y-2 pb-1">
                    {branch.groups.map((group, index) => (
                      <div key={group.title ?? `g-${index}`}>
                        {group.title ? (
                          <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-section">
                            {group.title}
                          </p>
                        ) : null}
                        <ul className="space-y-1">
                          {group.items.map((item) => (
                            <li key={item.href}>
                              <ItemLink
                                item={item}
                                active={isActive(pathname, item.href)}
                                collapsed={false}
                                nested
                                onNavigate={onCloseMobile}
                              />
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}

          {canAdmin ? (
            <div className="mt-2 border-t border-sidebar-border pt-2">
              {!collapsed ? (
                <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-section">
                  {ADMIN_GROUP.title}
                </p>
              ) : null}
              <ul className="space-y-1">
                {ADMIN_GROUP.items.map((item) => (
                  <li key={item.href}>
                    <ItemLink
                      item={item}
                      active={isActive(pathname, item.href)}
                      collapsed={collapsed}
                      onNavigate={onCloseMobile}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </nav>

        {/* Pied : bascule + déconnexion */}
        <div className="shrink-0 space-y-1 border-t border-sidebar-border px-3 py-3">
          <button
            type="button"
            onClick={onToggleCollapse}
            title={collapsed ? "Déployer le menu" : "Réduire le menu"}
            aria-label={collapsed ? "Déployer le menu" : "Réduire le menu"}
            className={`hidden w-full items-center rounded-lg text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 lg:flex ${
              collapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2"
            }`}
          >
            <Icon
              name="chevrons-left"
              className={`size-[18px] shrink-0 transition-transform ${collapsed ? "rotate-180" : ""}`}
            />
            {!collapsed ? <span>Réduire</span> : null}
          </button>

          <form action={signOutAction}>
            <button
              type="submit"
              title={collapsed ? "Déconnexion" : undefined}
              className={`flex w-full items-center rounded-lg text-sm font-medium text-danger transition-colors hover:bg-danger-bg ${
                collapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2"
              }`}
            >
              <Icon name="log-out" className="size-[18px] shrink-0" />
              {!collapsed ? <span>Déconnexion</span> : null}
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}

function ItemLink({
  item,
  active,
  collapsed,
  nested = false,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  nested?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={`flex items-center rounded-lg text-sm font-medium transition-colors ${
        collapsed ? "justify-center p-2.5" : `gap-3 py-2 ${nested ? "pl-8 pr-3" : "px-3"}`
      } ${active ? "bg-primary text-primary-foreground" : "text-slate-700 hover:bg-slate-100"}`}
    >
      <Icon name={item.icon} className="size-[18px] shrink-0" />
      {!collapsed ? <span className="truncate">{item.label}</span> : null}
    </Link>
  );
}

function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="m12 3 10 18H2z" />
    </svg>
  );
}
