"use client";

import { Icon } from "@/components/icons";

/**
 * Choix unique parmi une liste fermée d'options (2 à 4 choix) — jamais de
 * saisie de texte. `value` est `undefined` tant qu'aucune option n'a été
 * cliquée. État sélectionné volontairement fort (fond plein + icône de
 * validation), jamais une simple bordure fine.
 */
export function ChoiceButtons({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: string; label: string }[];
  value?: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            className={`inline-flex items-center gap-1.5 rounded-xl border-2 px-4 py-2 text-sm font-semibold transition-all duration-150 ease-out-strong motion-safe:active:scale-95 ${
              selected
                ? "border-primary bg-primary text-primary-foreground shadow-[0_4px_12px_-2px_rgba(0,75,156,0.45)]"
                : "border-border bg-surface text-foreground hover:border-primary/60 hover:bg-primary-bg"
            }`}
          >
            {selected ? (
              <span key={option.value} className="inline-flex animate-select-pop">
                <Icon name="circle-check" className="size-4" />
              </span>
            ) : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
