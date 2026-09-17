"use client";

import { Button, Input, Select } from "@/components/ui";

interface FeedbackFiltersProps {
  initial: {
    du?: string;
    au?: string;
    statut?: string;
    source?: string;
    search?: string;
  };
}

export function FeedbackFilters({ initial }: FeedbackFiltersProps) {
  return (
    <form
      method="get"
      className="grid grid-cols-1 gap-4 rounded-xl border border-border bg-surface p-4 shadow-sm sm:grid-cols-2 md:grid-cols-5"
    >
      <div className="md:col-span-2">
        <Input
          name="search"
          label="Mots-clés"
          placeholder="Rechercher dans les messages..."
          defaultValue={initial.search ?? ""}
        />
      </div>
      <div>
        <Input type="date" name="du" label="Du" defaultValue={initial.du ?? ""} />
      </div>
      <div>
        <Input type="date" name="au" label="Au" defaultValue={initial.au ?? ""} />
      </div>
      <div>
        <Select
          name="statut"
          label="Statut"
          placeholder="Tous les statuts"
          defaultValue={initial.statut ?? "tous"}
          options={[
            { value: "tous", label: "Tous" },
            { value: "actifs", label: "Actifs uniquement" },
            { value: "moderes", label: "Modérés uniquement" },
          ]}
        />
      </div>
      <div>
        <Select
          name="source"
          label="Origine"
          placeholder="Toutes les origines"
          defaultValue={initial.source ?? "tous"}
          options={[
            { value: "tous", label: "Toutes" },
            { value: "PUBLIC", label: "Public uniquement" },
            { value: "INTERNAL", label: "Interne uniquement" },
          ]}
        />
      </div>
      <div className="flex items-end gap-2 sm:col-span-2 md:col-span-6">
        <Button type="submit">Filtrer</Button>
        <a href="/feedback/admin">
          <Button type="button" variant="secondary">
            Réinitialiser
          </Button>
        </a>
      </div>
    </form>
  );
}
