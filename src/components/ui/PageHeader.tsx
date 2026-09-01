import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
}

/**
 * En-tête de page standard : titre + description optionnelle à gauche,
 * zone d'actions (bouton principal, filtres...) à droite. À placer en haut
 * de chaque page d'écran (liste de demandes, dashboard Finance...).
 *
 * Exemple :
 *   <PageHeader
 *     title="Demandes"
 *     description="Suivi des demandes de dépense en cours"
 *     actions={<Button>Nouvelle demande</Button>}
 *   />
 */
export function PageHeader({ title, description, actions, backHref, backLabel }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        {backHref && (
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 mb-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {backLabel || "Retour"}
          </Link>
        )}
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
