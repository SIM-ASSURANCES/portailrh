"use client";

// Ancrage sur les tokens sémantiques déjà existants (danger/warning/success,
// voir globals.css) plutôt que des couleurs brutes hors charte — un
// dégradé rouge→orange→vert reste un repère de notation universellement
// compris (NPS), appliqué UNIQUEMENT à ce sélecteur 1-10 : le reste de
// l'interface FeedbackApp garde la palette SIM Assurances (bleu) sans
// exception, voir CLAUDE.md.
const DANGER: [number, number, number] = [218, 1, 1]; // --color-danger
const WARNING: [number, number, number] = [191, 71, 12]; // --color-warning
const SUCCESS: [number, number, number] = [22, 163, 74]; // --color-success

function lerp(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}

function colorForPosition(n: number): string {
  // 1..10 -> 0..1
  const t = (n - 1) / 9;
  const [from, to] = t <= 0.5 ? [DANGER, WARNING] : [WARNING, SUCCESS];
  const localT = t <= 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  const [r, g, b] = [
    lerp(from[0], to[0], localT),
    lerp(from[1], to[1], localT),
    lerp(from[2], to[2], localT),
  ];
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Échelle numérique 1-10 (note globale) — jamais de saisie de texte.
 * `value` est `undefined` tant qu'aucun nombre n'a été cliqué. La case
 * sélectionnée se colore selon sa position (rouge → orange → vert doux) :
 * un repère visuel immédiat de la note choisie, en plus du chiffre.
 */
export function NumberScale({
  value,
  onChange,
  label,
}: {
  value?: number;
  onChange: (value: number) => void;
  label?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-5 gap-2 sm:grid-cols-10" role="radiogroup" aria-label={label}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
          const selected = value === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              aria-pressed={selected}
              style={selected ? { backgroundColor: colorForPosition(n), borderColor: colorForPosition(n) } : undefined}
              className={`flex size-10 items-center justify-center rounded-xl border-2 text-sm font-bold tabular-nums transition-all duration-150 ease-out-strong motion-safe:active:scale-90 ${
                selected
                  ? "text-white shadow-[0_4px_10px_-2px_rgba(0,0,0,0.35)]"
                  : "border-border bg-surface text-foreground hover:border-primary/60 hover:bg-primary-bg"
              }`}
            >
              <span key={selected ? `sel-${n}` : `idle-${n}`} className={selected ? "animate-select-pop" : ""}>
                {n}
              </span>
            </button>
          );
        })}
      </div>
      {value !== undefined ? (
        <p className="text-xs font-medium text-muted-foreground">
          Note choisie : <span className="font-bold" style={{ color: colorForPosition(value) }}>{value}/10</span>
        </p>
      ) : null}
    </div>
  );
}
