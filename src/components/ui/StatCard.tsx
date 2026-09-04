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
  /**
   * `"compact"` réduit padding/icône/typographie, **uniquement à partir de
   * `xl`** (≥1280px, via des classes `xl:` — jamais un simple booléen JS) :
   * réservé à la grille dense "Mon tableau de bord" du Collaborateur (5
   * colonnes sur une ligne à `xl`), où le gabarit par défaut (28px,
   * `font-black`) forçait un retour à la ligne inégal d'une carte à l'autre
   * sur "550 000 FCFA". En dessous de `xl` (empilement/2/3 colonnes, où
   * cette grille a toujours assez de place), `"compact"` rend **exactement
   * comme `"default"`** — jamais de cartes plus petites que nécessaire sur
   * mobile/tablette juste parce que la page les demande en `"compact"`.
   * Par défaut `"default"` (aucune classe `xl:` ajoutée), comportement
   * strictement inchangé partout où ce prop n'est pas passé (dashboard
   * Finance à 6 cartes max 3 colonnes, dashboard général).
   */
  size?: "default" | "compact";
}

/** Pastille d'icône : aplat plein dans la teinte (jamais le fond pâle
 * `*-bg`, réservé aux surfaces d'arrière-plan) — les cinq teintes
 * sémantiques sont toutes assez soutenues pour rester lisibles en blanc
 * dessus (elles sont déjà calibrées ≥4.5:1 en texte sur blanc, donc a
 * fortiori en fond plein avec du blanc dessus). */
const toneSolidClasses: Record<StatTone, string> = {
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  neutral: "bg-neutral",
  danger: "bg-danger",
};

/** Filet de tête (3px) en haut de la carte : premier signal de couleur,
 * lisible avant même l'icône ou le chiffre. */
const toneBarClasses: Record<StatTone, string> = {
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  neutral: "bg-border",
  danger: "bg-danger",
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
 * Carte d'indicateur du tableau de bord. Hiérarchie délibérée : le chiffre
 * est l'élément le plus affirmé de la carte (grand, très gras, chiffres
 * tabulaires), le libellé reste discret au-dessus — jamais l'inverse. La
 * couleur (`tone`) porte le sens à elle seule (filet de tête + pastille
 * pleine), sans dépendre de l'icône pour se faire remarquer.
 *
 * Exemple (statique) :
 *   <StatCard icon="wallet" tone="success" label="Montant à régler" value="1 250 000 FCFA" />
 *
 * Exemple (cliquable, vers une liste filtrée) :
 *   <StatCard icon="wallet" tone="warning" href="/treso/finance/a-decaisser"
 *             label="Montants validés non réglés" value={12} hint="4 500 000 FCFA" />
 */
export function StatCard({ icon, label, value, hint, tone = "info", href, size = "default" }: StatCardProps) {
  const compact = size === "compact";

  const iconPill = (
    <span
      className={`${compact ? "mb-4 size-11 xl:mb-3 xl:size-9" : "mb-4 size-11"} inline-grid shrink-0 place-items-center rounded-xl text-white shadow-[0_4px_10px_-2px_rgba(0,0,0,0.25)] transition-transform duration-200 ease-out-strong ${
        href ? "motion-safe:group-hover:scale-110" : ""
      } ${toneSolidClasses[tone]}`}
    >
      <Icon name={icon} className={compact ? "size-5 xl:size-4" : "size-5"} />
    </span>
  );

  const body = (
    <>
      {iconPill}
      <p className={`${compact ? "text-[13px] xl:text-[12px]" : "text-[13px]"} font-semibold text-muted-foreground`}>
        {label}
      </p>
      <p
        className={`${compact ? "mt-1.5 text-[28px] xl:mt-1 xl:text-[18px]" : "mt-1.5 text-[28px]"} whitespace-nowrap font-black leading-none tracking-tight text-foreground tabular-nums`}
      >
        {value}
      </p>
      {hint ? <p className="mt-2 text-xs font-medium text-muted-foreground tabular-nums">{hint}</p> : null}
    </>
  );

  const paddingClasses = compact ? "p-5 pt-6 xl:p-4 xl:pt-5" : "p-5 pt-6";

  if (href) {
    return (
      <Link
        href={href}
        className={`group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface ${paddingClasses} shadow-elevated outline-offset-2 transition-[border-color,box-shadow,transform] duration-200 ease-out-strong hover:shadow-elevated-lg motion-safe:hover:-translate-y-0.5 focus-visible:outline-2 ${toneAccentClasses[tone]}`}
      >
        <span className={`absolute inset-x-0 top-0 h-[3px] ${toneBarClasses[tone]}`} aria-hidden="true" />
        {body}
        <span className="mt-auto flex items-center gap-1 pt-3 text-xs font-semibold text-muted-foreground transition-colors duration-200 group-hover:text-primary">
          Voir le détail
          <Icon
            name="arrow-up-right"
            className="size-3 transition-transform duration-200 ease-out-strong motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5"
          />
        </span>
      </Link>
    );
  }

  return (
    <div className={`relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface ${paddingClasses} shadow-elevated`}>
      <span className={`absolute inset-x-0 top-0 h-[3px] ${toneBarClasses[tone]}`} aria-hidden="true" />
      {body}
    </div>
  );
}
