import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/icons";

export type StatTone = "info" | "success" | "warning" | "neutral";

export interface StatCardProps {
  icon: IconName;
  label: string;
  value: ReactNode;
  /** Ligne secondaire optionnelle sous la valeur (ex: base de calcul). */
  hint?: string;
  tone?: StatTone;
}

const toneClasses: Record<StatTone, string> = {
  info: "bg-info-bg text-info",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  neutral: "bg-neutral-bg text-neutral",
};

/**
 * Carte d'indicateur du tableau de bord : pastille d'icône teintée, libellé,
 * valeur en gras et sous-texte optionnel. La couleur (`tone`) n'a qu'une
 * valeur visuelle — la choisir de façon cohérente entre indicateurs proches.
 *
 * Exemple :
 *   <StatCard icon="wallet" tone="success" label="Montant à régler" value="1 250 000 FCFA" />
 */
export function StatCard({ icon, label, value, hint, tone = "info" }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <span
        className={`mb-3 inline-grid size-10 place-items-center rounded-xl ${toneClasses[tone]}`}
      >
        <Icon name={icon} className="size-5" />
      </span>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}
