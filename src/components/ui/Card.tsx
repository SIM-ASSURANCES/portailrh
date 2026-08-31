import type { ReactNode } from "react";

export interface CardProps {
  children: ReactNode;
  className?: string;
}

/**
 * Conteneur de surface standard : fond blanc, coins arrondis, bordure fine
 * et légère ombre. Brique de base des blocs du tableau de bord et des
 * écrans (filtres, encarts, panneaux).
 *
 * Exemple :
 *   <Card>
 *     <h2 className="text-base font-bold text-slate-900">Filtrer par période</h2>
 *     …
 *   </Card>
 */
export function Card({ children, className = "" }: CardProps) {
  return (
    <div
      className={`rounded-2xl border border-border bg-surface p-6 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}
