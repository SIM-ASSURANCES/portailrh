import Link from "next/link";

/** Phrase unique : écran Services, accueil de l'administration et alerte de l'accueil du portail. */
export function explicationServicesSansResponsable(noms: string[]): string {
  const pluriel = noms.length > 1;
  return `${pluriel ? "Services sans responsable" : "Service sans responsable"} : ${noms.join(", ")}. Les demandes de ${
    pluriel ? "leurs" : "ses"
  } membres sont bloquées à l'étape Service (personne ne peut les valider) et ils ne peuvent pas en créer de nouvelles tant qu'un responsable n'est pas désigné.`;
}

/**
 * Bannière d'alerte « services sans responsable » (comptes qui gèrent les services). Rien si tous les services ont un
 * responsable. `lienServices` : ajoute le lien vers l'écran Services (inutile sur cet écran lui-même).
 */
export function ServicesSansResponsableBanniere({
  services,
  lienServices = false,
}: {
  services: { id: string; name: string }[];
  lienServices?: boolean;
}) {
  if (services.length === 0) return null;
  return (
    <div role="alert" data-services-sans-responsable className="space-y-1 rounded-md border border-danger bg-danger-bg px-4 py-3 text-sm text-danger">
      <p>{explicationServicesSansResponsable(services.map((s) => s.name))}</p>
      {lienServices ? (
        <Link href="/admin/services" className="font-semibold underline underline-offset-4">
          Désigner un responsable
        </Link>
      ) : null}
    </div>
  );
}
