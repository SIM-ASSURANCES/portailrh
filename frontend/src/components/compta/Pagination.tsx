import Link from "next/link";

/** Pagination en GET (liens précédent / suivant) des listes de Gestion Compta : 50 lignes par page, jamais de défilement infini. */
export function PaginationCpt({
  nom,
  total,
  page,
  nbPages,
  precedent,
  suivant,
}: {
  nom: string;
  total: number;
  page: number;
  nbPages: number;
  precedent: string | null;
  suivant: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <span data-pagination-total>
        {total.toLocaleString("fr-FR")} {nom} · page {page} sur {nbPages}
      </span>
      <span className="flex gap-3">
        {precedent && (
          <Link href={precedent} className="font-semibold text-primary hover:underline">
            ← Précédente
          </Link>
        )}
        {suivant && (
          <Link href={suivant} className="font-semibold text-primary hover:underline">
            Suivante →
          </Link>
        )}
      </span>
    </div>
  );
}
