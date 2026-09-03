import { BRAND_ICON_PATHS, BRAND_ICON_VIEWBOX } from "./brandIcon";

export interface BrandBackdropProps {
  className?: string;
}

/**
 * Fond "papier à en-tête" institutionnel SIM Assurances — fidèle au papier
 * à en-tête officiel de la charte graphique, pas un dégradé bleu pleine
 * page (premier essai refusé explicitement : "j'ai pas aimé, laisse le
 * blanc avec le logo en arrière-plan"). Trois éléments, tous discrets :
 *
 * 1. Un filigrane du **pictogramme seul** du logo (jamais le texte "SIM
 *    ASSURANCES" à côté — voir `brandIcon.ts`), en gris très pâle, agrandi
 *    et calé sur le bord gauche de façon à déborder du cadre (pas centré,
 *    coupé par le bord — comme sur le vrai papier à en-tête).
 * 2. Un filet dégradé fin (bleu clair → bleu foncé) en bas de page — un
 *    trait décoratif, jamais une zone colorée dominante.
 * 3. La bordure bleue autour de la page N'EST PAS ici : elle se pose comme
 *    une classe `border` directement sur le conteneur appelant (propriété
 *    de mise en page, pas un détail du fond) — voir l'exemple ci-dessous.
 *
 * Le fond reste BLANC (porté par le conteneur appelant, `bg-surface`) :
 * ce composant ne pose qu'un calque décoratif par-dessus, jamais un aplat
 * de couleur. Purement décoratif — `aria-hidden`, jamais de contenu
 * informatif dedans, jamais posé derrière une zone de travail dense
 * (tableaux/formulaires métier, voir CLAUDE.md "Rehaussement visuel").
 *
 * Exemple :
 *   <div className="relative overflow-hidden border-[3px] border-primary bg-surface">
 *     <BrandBackdrop className="absolute inset-0" />
 *     <div className="relative">...contenu...</div>
 *   </div>
 */
export function BrandBackdrop({ className = "" }: BrandBackdropProps) {
  return (
    <div aria-hidden="true" className={`pointer-events-none overflow-hidden ${className}`}>
      {/* Filigrane : pictogramme seul, très agrandi, calé sur le bord
          gauche et volontairement coupé par le cadre (pas centré). Gris
          très pâle (~9% d'opacité, dans la fourchette 8-15% demandée) via
          le token neutre existant (`text-muted-foreground`), jamais une
          teinte bleue — le bleu reste réservé à la bordure et au filet du
          bas, pour que le filigrane ne rivalise jamais avec le texte. */}
      <svg
        viewBox={BRAND_ICON_VIEWBOX}
        className="absolute left-[-55%] top-1/2 h-[62%] w-auto -translate-y-1/2 text-muted-foreground opacity-[0.09] sm:left-[-24%] sm:h-[105%]"
      >
        {BRAND_ICON_PATHS.map((d) => (
          <path key={d} d={d} fill="currentColor" />
        ))}
      </svg>

      {/* Filet décoratif en bas de page : dégradé fin bleu clair -> bleu
          foncé, quelques pixels de haut seulement — jamais une bande large. */}
      <div className="absolute inset-x-0 bottom-0 h-[5px] bg-[linear-gradient(100deg,var(--color-sim-blue-light)_0%,var(--color-sim-blue-dark)_100%)]" />
    </div>
  );
}
