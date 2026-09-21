"use client";

import Link from "next/link";

import { Button, Input, Select } from "@/components/ui";
import { STATUT_DEMANDE_LABEL } from "@/components/tresorerie/demandeStatut";

const STATUT_OPTIONS = Object.entries(STATUT_DEMANDE_LABEL).map(([value, label]) => ({ value, label }));

interface Option {
  id: string;
  label: string;
}

/**
 * Filtres de l'écran "Toutes les demandes" — soumission en GET native
 * (même pattern que `ReportingFiltersForm.tsx`) : l'URL résultante reste
 * partageable/rechargeable telle quelle. Volontairement simple (référence
 * en texte libre, créateur et statut en liste) : ce n'est pas un écran
 * d'analyse (voir `/treso/finance/reporting` pour ça), seulement un moyen
 * rapide de retrouver UNE demande précise au quotidien.
 */
export function ToutesLesDemandesFiltersForm({
  createurs,
  initial,
}: {
  createurs: Option[];
  initial: { reference?: string; createurId?: string; statut?: string };
}) {
  return (
    <form
      method="get"
      className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-4 sm:p-6"
    >
      <Input
        name="reference"
        label="Référence"
        placeholder="Ex : DEM-2026-000123"
        defaultValue={initial.reference}
      />
      <Select
        name="createurId"
        label="Créateur"
        placeholder="Tous"
        defaultValue={initial.createurId ?? ""}
        options={createurs.map((c) => ({ value: c.id, label: c.label }))}
      />
      <Select
        name="statut"
        label="Statut"
        placeholder="Tous"
        defaultValue={initial.statut ?? ""}
        options={STATUT_OPTIONS}
      />
      <div className="flex items-end gap-3">
        <Button type="submit">Filtrer</Button>
        <Link href="/treso/finance/demandes/toutes">
          <Button type="button" variant="secondary">
            Réinitialiser
          </Button>
        </Link>
      </div>
    </form>
  );
}
