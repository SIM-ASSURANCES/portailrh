import Link from "next/link";

/** R1 tranché le 2026-11-27 (registre C-41) : mention en tête de CHAQUE écran de taxe. */
export const MESSAGE_REFERENCE_TAXE = "Gestion Compta est la référence pour la taxe sur les contrats d'assurance.";

export function AvertissementTaxe() {
  return (
    <p data-reference-compta className="mb-4 rounded-lg border border-border bg-info-bg px-4 py-3 text-sm text-info">
      {MESSAGE_REFERENCE_TAXE}
    </p>
  );
}

const ONGLETS = [
  { href: "/compta/tca", cle: "calcul", label: "Calcul du mois et déclaration" },
  { href: "/compta/tca/etat", cle: "etat", label: "État par taux" },
  { href: "/compta/tca/suivi", cle: "suivi", label: "Suivi par contrat" },
] as const;

/** Navigation entre les trois écrans de taxe (ils partagent le mois choisi). */
export function OngletsTaxe({ actif, mois }: { actif: (typeof ONGLETS)[number]["cle"]; mois?: string }) {
  return (
    <nav className="mb-4 flex flex-wrap gap-2" aria-label="Écrans de la taxe">
      {ONGLETS.map((o) => (
        <Link
          key={o.cle}
          href={mois ? `${o.href}?mois=${mois.slice(0, 7)}` : o.href}
          aria-current={o.cle === actif ? "page" : undefined}
          className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${o.cle === actif ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-foreground hover:bg-primary-bg"}`}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}
