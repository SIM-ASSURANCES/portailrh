import { Icon, type IconName } from "@/components/icons";

export interface EmptyStateProps {
  icon: IconName;
  message: string;
  /** Réduit le padding (zones secondaires, encarts courts). */
  compact?: boolean;
  /** Bordure + fond `bg-muted` — désactiver quand le conteneur parent (ex:
   * une cellule de tableau) porte déjà son propre fond. */
  bordered?: boolean;
}

/**
 * État vide générique : icône dans une pastille neutre + message, plutôt
 * qu'un simple texte gris centré. Réutilisé partout où une liste ou une
 * section peut être vide ("Aucune demande", "Aucune notification"...),
 * sans ajouter d'action ni de sur-décoration — voir CLAUDE.md (polish
 * visuel global, zone "États vides").
 *
 * Exemple :
 *   <EmptyState icon="inbox" message="Aucune demande pour le moment." />
 */
export function EmptyState({ icon, message, compact = false, bordered = true }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground ${
        bordered ? "rounded-md border border-border bg-muted" : ""
      } ${compact ? "px-4 py-8" : "px-8 py-10"}`}
    >
      <span className="grid size-10 place-items-center rounded-full bg-neutral-bg text-neutral">
        <Icon name={icon} className="size-5" />
      </span>
      <p>{message}</p>
    </div>
  );
}
