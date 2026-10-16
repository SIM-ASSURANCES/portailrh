"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface LienSousNav {
  href: string;
  label: string;
  compteur?: number;
}

/**
 * Sous-navigation d'un module d'absence (Congés, Permissions d'absence) : liens en défilement horizontal sur mobile
 * (jamais de débordement de la page). `racine` : le lien « Mes … », actif seulement à l'identique.
 */
export function SousNavConges({ liens, racine = "/conges", libelle = "Congés" }: { liens: LienSousNav[]; racine?: string; libelle?: string }) {
  const chemin = usePathname();
  return (
    <nav aria-label={libelle} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-2 border-b border-border">
        {liens.map((l) => {
          const actif = l.href === racine ? chemin === racine : chemin === l.href || chemin.startsWith(`${l.href}/`);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={actif ? "page" : undefined}
                className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                  actif ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {l.label}
                {l.compteur ? <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">{l.compteur}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
