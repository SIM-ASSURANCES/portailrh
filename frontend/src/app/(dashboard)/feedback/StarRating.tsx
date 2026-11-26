"use client";

import { Icon } from "@/components/icons";

/**
 * Sélecteur 1-5 étoiles — jamais de saisie de texte (voir CLAUDE.md
 * "FeedbackApp — notation structurée"). `value` est `undefined` tant
 * qu'aucune étoile n'a été cliquée. Chaque étoile pleine rejoue un petit
 * "pop" au clic (`key={value}`, voir `.animate-select-pop`, globals.css) —
 * retour visuel immédiat, jamais une icône statique.
 */
export function StarRating({
  value,
  onChange,
  label,
}: {
  value?: number;
  onChange: (value: number) => void;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = value !== undefined && value >= n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={`${n} étoile${n > 1 ? "s" : ""} sur 5`}
            aria-pressed={filled}
            className="group rounded-lg p-1 transition-transform duration-150 ease-out-strong hover:scale-[1.15] focus:outline-2 focus:outline-offset-2 focus:outline-primary motion-safe:active:scale-95"
          >
            <span key={filled ? `f-${n}-${value}` : `e-${n}`} className={filled ? "inline-flex animate-select-pop" : "inline-flex"}>
              <Icon
                name="star"
                fill={filled ? "currentColor" : "none"}
                className={`size-8 transition-colors duration-150 ${
                  filled ? "text-primary drop-shadow-[0_1px_2px_rgba(0,75,156,0.35)]" : "text-border group-hover:text-primary/40"
                }`}
              />
            </span>
          </button>
        );
      })}
      {value !== undefined ? (
        <span className="ml-2 text-sm font-bold tabular-nums text-primary">{value}/5</span>
      ) : null}
    </div>
  );
}
