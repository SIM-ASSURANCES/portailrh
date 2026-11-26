"use client";

const LABELS: Record<number, string> = {
  1: "Pas du tout",
  2: "Peu",
  3: "Moyennement",
  4: "Plutôt",
  5: "Tout à fait",
};

/**
 * Curseur 1-5 — jamais de saisie de texte. Initialisé à 3 (valeur médiane)
 * par le parent : un curseur n'a pas d'état "vide" visuellement cohérent,
 * contrairement aux étoiles/choix. La piste se remplit progressivement
 * (dégradé bleu marque calculé en `%`, posé en `background` inline — voir
 * `.feedback-slider`, globals.css, pour pourquoi ce n'est pas faisable en
 * pure classe Tailwind sur un `<input type="range">`) et la valeur/le
 * libellé courants sont affichés en évidence au-dessus du curseur.
 */
export function RatingSlider({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label?: string;
}) {
  const percent = ((value - 1) / 4) * 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{LABELS[value]}</span>
        <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold tabular-nums text-primary-foreground">
          {value}
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={5}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="feedback-slider w-full"
        style={{
          background: `linear-gradient(to right, var(--color-primary) 0%, var(--color-primary) ${percent}%, var(--color-border) ${percent}%, var(--color-border) 100%)`,
        }}
      />
      <div className="flex justify-between px-0.5 text-[11px] text-muted-foreground">
        <span>1</span>
        <span>2</span>
        <span>3</span>
        <span>4</span>
        <span>5</span>
      </div>
    </div>
  );
}
