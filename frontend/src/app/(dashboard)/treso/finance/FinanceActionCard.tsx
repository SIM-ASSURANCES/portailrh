import type { ReactNode } from "react";
import Link from "next/link";

import { Icon, type IconName } from "@/components/icons";
import type { StatTone } from "@/components/ui";

export interface FinanceActionCardProps {
  icon: IconName;
  label: string;
  value: ReactNode;
  /** Ligne secondaire optionnelle sous la valeur (ex: montant associé). */
  hint?: string;
  tone: StatTone;
  /** Rend la carte cliquable (`next/link`) — sinon un bloc statique. */
  href?: string;
}

/** Badge d'icône teinté par `tone` — voir CLAUDE.md "Refonte visuelle du
 * dashboard Finance / cartes À traiter" : contrairement à `StatCard`
 * (aplat bleu uniforme sur toutes les cartes, choix délibéré documenté
 * dans ce fichier), ce composant colore le badge selon la teinte
 * sémantique de chaque indicateur — une différenciation demandée
 * explicitement pour cette seule section, jamais reportée sur `StatCard`
 * lui-même ni sur les autres dashboards qui le partagent. */
const BADGE_CLASSES: Record<StatTone, string> = {
  info: "bg-info-bg text-info",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  neutral: "bg-neutral-bg text-neutral",
  danger: "bg-danger-bg text-danger",
  primary: "bg-primary-bg text-primary",
};

/** Barre d'accent verticale sur le bord gauche — même teinte que le badge,
 * jamais la barre horizontale en tête utilisée par `StatCard` : une
 * silhouette distincte pour que cette section se reconnaisse d'un coup
 * d'œil comme une zone d'action, pas une simple répétition du reste du
 * portail. */
const ACCENT_BAR_CLASSES: Record<StatTone, string> = {
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  neutral: "bg-border",
  danger: "bg-danger",
  primary: "bg-primary",
};

/** Léger changement de teinte de fond au survol — les jetons `*-bg` sont
 * déjà des teintes pâles conçues pour un fond (badges, encarts), pleine
 * opacité directement (même usage que partout ailleurs dans le projet),
 * jamais une opacité fractionnelle non éprouvée sur ces tokens. */
const HOVER_TINT_CLASSES: Record<StatTone, string> = {
  info: "hover:bg-info-bg",
  success: "hover:bg-success-bg",
  warning: "hover:bg-warning-bg",
  neutral: "hover:bg-muted",
  danger: "hover:bg-danger-bg",
  primary: "hover:bg-primary-bg",
};

/**
 * Carte d'indicateur de la section "À traiter" du dashboard Finance —
 * volontairement DISTINCTE de `StatCard` (composant partagé par les
 * autres dashboards — Collaborateur, DG — jamais modifié ici) : badge
 * d'icône teinté, barre d'accent verticale, chiffre principal plus
 * affirmé, survol combinant élévation ET léger changement de teinte de
 * fond. Utilisée UNIQUEMENT par `treso/finance/page.tsx`.
 */
export function FinanceActionCard({ icon, label, value, hint, tone, href }: FinanceActionCardProps) {
  const body = (
    <>
      <span className={`inline-grid size-12 shrink-0 place-items-center rounded-xl ${BADGE_CLASSES[tone]}`}>
        <Icon name={icon} className="size-6" />
      </span>
      <p className="mt-4 text-[13px] font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-[32px] font-black leading-none tracking-tight text-foreground tabular-nums">
        {value}
      </p>
      {hint ? <p className="mt-2 text-xs font-medium text-muted-foreground tabular-nums">{hint}</p> : null}
    </>
  );

  const accentBar = (
    <span className={`absolute inset-y-0 left-0 w-1.5 ${ACCENT_BAR_CLASSES[tone]}`} aria-hidden="true" />
  );

  const sharedClasses = `group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface py-5 pl-6 pr-5 shadow-elevated transition-[box-shadow,background-color,transform] duration-200 ease-out-strong ${HOVER_TINT_CLASSES[tone]}`;

  if (href) {
    return (
      <Link
        href={href}
        // `hover:shadow-elevated-lg` (et même `hover:` sur un `@utility`
        // maison) ne génère AUCUN CSS sur ce projet — voir `.card-shadow-hover`
        // (globals.css), une classe ordinaire avec son propre `:hover` écrit
        // à la main, appliquée ici SANS préfixe `hover:` (le survol est déjà
        // dans le sélecteur CSS lui-même).
        className={`${sharedClasses} outline-offset-2 card-shadow-hover motion-safe:hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-primary`}
      >
        {accentBar}
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
    <div className={sharedClasses}>
      {accentBar}
      {body}
    </div>
  );
}
