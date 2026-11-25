import Link from "next/link";

/** Risque R1 (plan GC, registre C-23) : les deux modules calculent la taxe ; en tête de CHAQUE écran de taxe, jusqu'à la décision. */
export const MESSAGE_AVERTISSEMENT_R1 =
  "Le module Encaissements calcule aussi la taxe. Avant la mise en service, un seul des deux doit faire foi (décision à prendre).";

export function AvertissementTaxe() {
  return (
    <div role="note" data-avertissement-r1 className="mb-4 rounded-lg border border-warning/40 bg-warning-bg px-4 py-3 text-sm text-warning">
      <strong className="font-bold">Attention.</strong> {MESSAGE_AVERTISSEMENT_R1}
    </div>
  );
}

const ONGLETS = [
  { href: "/compta/tca", cle: "calcul", label: "Calcul du mois et déclaration" },
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
