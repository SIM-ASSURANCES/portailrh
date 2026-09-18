import { Icon, type IconName } from "@/components/icons";
import type { StatTone } from "@/components/ui";

export interface CollaborateurStatCardProps {
  icon: IconName;
  label: string;
  value: string;
  tone: StatTone;
}

/**
 * Carte d'indicateur DÉDIÉE à "Mon tableau de bord" (Collaborateur) — voir
 * CLAUDE.md "Modernisation du dashboard Collaborateur". Même esprit que
 * `FinanceActionCard.tsx` (badge d'icône teinté par `tone`, jamais l'aplat
 * bleu uniforme de `StatCard`) mais une identité distincte, pas un
 * copier-coller : badge CIRCULAIRE posé en HAUT-DROITE (`FinanceActionCard`
 * le pose en haut-gauche dans un badge carré arrondi), libellé/valeur
 * alignés à gauche sous le badge, et un pictogramme fantôme surdimensionné
 * en bas-droite (très faible opacité) pour donner du relief sans surcharger
 * la carte — un flourish propre à ce dashboard, jamais réutilisé ailleurs.
 *
 * **`StatCard` (composant partagé avec les dashboards DG/Admin/Finance)
 * n'est pas touché** : ce composant est utilisé UNIQUEMENT par
 * `treso/tableau-de-bord/page.tsx`, jamais importé ailleurs.
 */
const BADGE_CLASSES: Record<StatTone, string> = {
  info: "bg-info-bg text-info",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  neutral: "bg-neutral-bg text-neutral",
  danger: "bg-danger-bg text-danger",
  primary: "bg-primary-bg text-primary",
};

const GHOST_CLASSES: Record<StatTone, string> = {
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  neutral: "text-neutral",
  danger: "text-danger",
  primary: "text-primary",
};

const HOVER_TINT_CLASSES: Record<StatTone, string> = {
  info: "hover:bg-info-bg",
  success: "hover:bg-success-bg",
  warning: "hover:bg-warning-bg",
  neutral: "hover:bg-muted",
  danger: "hover:bg-danger-bg",
  primary: "hover:bg-primary-bg",
};

export function CollaborateurStatCard({ icon, label, value, tone }: CollaborateurStatCardProps) {
  return (
    <div
      className={`card-shadow-hover group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface p-4 shadow-elevated transition-[box-shadow,background-color,transform] duration-200 ease-out-strong motion-safe:hover:-translate-y-0.5 xl:p-3.5 ${HOVER_TINT_CLASSES[tone]}`}
    >
      <Icon
        name={icon}
        className={`pointer-events-none absolute -bottom-3 -right-3 size-20 opacity-[0.07] transition-transform duration-300 ease-out-strong motion-safe:group-hover:scale-110 ${GHOST_CLASSES[tone]}`}
        aria-hidden="true"
      />
      <div className="relative flex items-start justify-between gap-2">
        <p className="text-[12px] font-semibold leading-tight text-muted-foreground xl:text-[11px]">{label}</p>
        <span
          className={`inline-grid size-9 shrink-0 place-items-center rounded-full ${BADGE_CLASSES[tone]} xl:size-8`}
        >
          <Icon name={icon} className="size-4 xl:size-3.5" />
        </span>
      </div>
      <p className="relative mt-3 whitespace-nowrap text-[22px] font-black leading-none tracking-tight text-foreground tabular-nums xl:mt-2 xl:text-[17px]">
        {value}
      </p>
    </div>
  );
}
