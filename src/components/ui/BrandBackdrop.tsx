import { BRAND_ICON_PATHS, BRAND_ICON_VIEWBOX } from "./brandIcon";

export interface BrandBackdropProps {
  className?: string;
  /**
   * Classe Tailwind d'opacité du filigrane. Par défaut, l'intensité déjà
   * utilisée sur `/login` (~9%). Abaissée explicitement pour l'AppShell
   * (voir CLAUDE.md "Fond de marque étendu à toute l'application") : des
   * écrans consultés des dizaines de fois par jour, denses en tableaux/
   * formulaires, tolèrent une intensité bien plus faible que l'écran de
   * connexion (vu une fois, sans contenu à lire par-dessus).
   */
  watermarkOpacityClassName?: string;
  /**
   * Filet dégradé décoratif en bas du cadre. Par défaut `true` (comportement
   * historique de `/login`). À désactiver explicitement quand le conteneur
   * appelant est en position `fixed` pleine page (AppShell) : ce filet
   * resterait alors collé en permanence au bas du VIEWPORT (jamais au bas
   * du contenu réel), un artefact visuel non demandé — voir CLAUDE.md.
   */
  showBottomAccent?: boolean;
  /**
   * Position du filigrane dans son conteneur :
   * - `"bleed-left"` (défaut) — bord gauche, décalage en POURCENTAGE du
   *   conteneur. Pensé pour un conteneur étroit (`/login`, carte ~384px) :
   *   ce même pourcentage, réutilisé tel quel sur un conteneur pleine
   *   largeur (AppShell, ~1400px), pousserait l'icône entièrement hors
   *   champ — vérifié explicitement par capture d'écran (voir CLAUDE.md
   *   "Fond de marque étendu à toute l'application").
   * - `"corner-br"` — coin BAS-DROIT, pensé pour l'AppShell : la Sidebar
   *   (pleine hauteur) et la Topbar (pleine largeur du contenu) occupent
   *   déjà les coins haut-gauche/haut-droit/bas-gauche, ne laissant que le
   *   coin bas-droit du viewport structurellement libre de tout composant
   *   opaque de la coquille.
   */
  watermarkPosition?: "bleed-left" | "corner-br";
}

/**
 * Fond "papier à en-tête" institutionnel SIM Assurances — fidèle au papier
 * à en-tête officiel de la charte graphique, pas un dégradé bleu pleine
 * page (premier essai refusé explicitement : "j'ai pas aimé, laisse le
 * blanc avec le logo en arrière-plan"). Deux éléments, tous discrets :
 *
 * 1. Un filigrane du **pictogramme seul** du logo (jamais le texte "SIM
 *    ASSURANCES" à côté — voir `brandIcon.ts`), en gris très pâle, agrandi
 *    et calé sur le bord gauche de façon à déborder du cadre (pas centré,
 *    coupé par le bord — comme sur le vrai papier à en-tête).
 * 2. Un filet dégradé fin (bleu clair → bleu foncé) en bas de page — un
 *    trait décoratif, jamais une zone colorée dominante ; désactivable
 *    (`showBottomAccent`), voir ci-dessus.
 *
 * La bordure bleue autour de la page N'EST PAS ici : elle se pose comme
 * une classe `border` directement sur le conteneur appelant (propriété de
 * mise en page, pas un détail du fond) — voir les deux exemples ci-dessous.
 *
 * Le fond reste BLANC/CLAIR (porté par le conteneur appelant, `bg-surface`
 * ou `bg-app-bg`) : ce composant ne pose qu'un calque décoratif par-dessus,
 * jamais un aplat de couleur. Purement décoratif — `aria-hidden`, jamais de
 * contenu informatif dedans, jamais posé derrière une zone de travail dense
 * sans réduire fortement son opacité (tableaux/formulaires métier, voir
 * CLAUDE.md "Rehaussement visuel" et "Fond de marque étendu à toute
 * l'application").
 *
 * Exemple `/login` (conteneur de la hauteur d'un seul écran) :
 *   <div className="relative overflow-hidden border-[3px] border-primary bg-surface">
 *     <BrandBackdrop className="absolute inset-0" />
 *     <div className="relative">...contenu...</div>
 *   </div>
 *
 * Exemple AppShell (conteneur dont la hauteur suit un contenu potentiellement
 * très long — tableau, formulaire) : `fixed` plutôt que `absolute`, pour
 * rester épinglé au viewport et ne jamais réapparaître au défilement, avec
 * une opacité abaissée et le filet du bas désactivé :
 *   <BrandBackdrop
 *     className="fixed inset-0 -z-10"
 *     watermarkOpacityClassName="opacity-[0.035]"
 *     showBottomAccent={false}
 *   />
 */
const WATERMARK_POSITION_CLASSES: Record<NonNullable<BrandBackdropProps["watermarkPosition"]>, string> = {
  "bleed-left": "left-[-55%] top-1/2 h-[62%] w-auto -translate-y-1/2 sm:left-[-24%] sm:h-[105%]",
  // Mobile (< sm) délibérément plus petit/plus mordu par le bord que
  // desktop : à taille égale en % du conteneur, un petit viewport (375px)
  // rendrait le triangle proportionnellement BEAUCOUP plus présent — vérifié
  // explicitement par capture d'écran (voir CLAUDE.md "Fond de marque
  // étendu à toute l'application").
  "corner-br": "bottom-[-22%] right-[-22%] h-[38%] w-auto sm:bottom-[-12%] sm:right-[-12%] sm:h-[48%]",
};

export function BrandBackdrop({
  className = "",
  watermarkOpacityClassName = "opacity-[0.09]",
  showBottomAccent = true,
  watermarkPosition = "bleed-left",
}: BrandBackdropProps) {
  return (
    <div aria-hidden="true" className={`pointer-events-none overflow-hidden ${className}`}>
      {/* Filigrane : pictogramme seul, très agrandi, calé sur un bord et
          volontairement coupé par le cadre (pas centré). Gris très pâle via
          le token neutre existant (`text-muted-foreground`), jamais une
          teinte bleue — le bleu reste réservé à la bordure et au filet du
          bas, pour que le filigrane ne rivalise jamais avec le texte. */}
      <svg
        viewBox={BRAND_ICON_VIEWBOX}
        className={`absolute text-muted-foreground ${WATERMARK_POSITION_CLASSES[watermarkPosition]} ${watermarkOpacityClassName}`}
      >
        {BRAND_ICON_PATHS.map((d) => (
          <path key={d} d={d} fill="currentColor" />
        ))}
      </svg>

      {/* Filet décoratif en bas de page : dégradé fin bleu clair -> bleu
          foncé, quelques pixels de haut seulement — jamais une bande large. */}
      {showBottomAccent ? (
        <div className="absolute inset-x-0 bottom-0 h-[5px] bg-[linear-gradient(100deg,var(--color-sim-blue-light)_0%,var(--color-sim-blue-dark)_100%)]" />
      ) : null}
    </div>
  );
}
