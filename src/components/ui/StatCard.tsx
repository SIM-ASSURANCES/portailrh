import type { ReactNode } from "react";
import Link from "next/link";

import { Icon, type IconName } from "@/components/icons";

export type StatTone = "info" | "success" | "warning" | "neutral" | "danger";

export interface StatCardProps {
  icon: IconName;
  label: string;
  value: ReactNode;
  /** Ligne secondaire optionnelle sous la valeur (ex: base de calcul). */
  hint?: string;
  tone?: StatTone;
  /**
   * Rend la carte cliquable : rendue comme un `next/link` vers cette URL,
   * avec micro-interactions hover/focus (léger soulèvement, halo teinté
   * selon `tone`, icône qui s'anime, invite "Voir le détail") — sinon
   * rendue comme un simple bloc statique (comportement historique).
   */
  href?: string;
}

const toneClasses: Record<StatTone, string> = {
  info: "bg-info-bg text-info",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  neutral: "bg-neutral-bg text-neutral",
  danger: "bg-danger-bg text-danger",
};

/** Halo de focus et bordure au survol assortis au `tone` — un indicateur
 * "danger" ne doit pas se souligner en bleu au clavier, par exemple. */
const toneAccentClasses: Record<StatTone, string> = {
  info: "hover:border-info/40 focus-visible:outline-info",
  success: "hover:border-success/40 focus-visible:outline-success",
  warning: "hover:border-warning/40 focus-visible:outline-warning",
  neutral: "hover:border-neutral/40 focus-visible:outline-neutral",
  danger: "hover:border-danger/40 focus-visible:outline-danger",
};

/**
 * Carte d'indicateur du tableau de bord : pastille d'icône teintée, libellé,
 * valeur en gras et sous-texte optionnel. La couleur (`tone`) n'a qu'une
 * valeur visuelle — la choisir de façon cohérente entre indicateurs proches.
 *
 * Exemple (statique) :
 *   <StatCard icon="wallet" tone="success" label="Montant à régler" value="1 250 000 FCFA" />
 *
 * Exemple (cliquable, vers une liste filtrée) :
 *   <StatCard icon="wallet" tone="warning" href="/treso/finance/a-decaisser"
 *             label="Montants validés non réglés" value={12} hint="4 500 000 FCFA" />
 */
export function StatCard({ icon, label, value, hint, tone = "info", href }: StatCardProps) {
  const iconPill = (
    <span
      className={`mb-3 inline-grid size-10 place-items-center rounded-xl transition-transform duration-200 ${
        href ? "motion-safe:group-hover:scale-110" : ""
      } ${toneClasses[tone]}`}
    >
      <Icon name={icon} className="size-5" />
    </span>
  );

  const body = (
    <>
      {iconPill}
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={`group block rounded-2xl border border-border bg-surface p-5 outline-offset-2 transition-all duration-200 hover:shadow-md motion-safe:hover:-translate-y-0.5 focus-visible:outline-2 ${toneAccentClasses[tone]}`}
      >
        {body}
        <span className="mt-3 flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors duration-200 group-hover:text-foreground">
          Voir le détail
          <Icon
            name="arrow-up-right"
            className="size-3 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          />
        </span>
      </Link>
    );
  }

  return <div className="rounded-2xl border border-border bg-surface p-5">{body}</div>;
}
