"use client";

import { useMemo, useState } from "react";

import { Button, Input, Select } from "@/components/ui";

interface Option {
  id: string;
  label: string;
}

interface ObjetOption extends Option {
  categorieId: string;
}

// REFONTE V1 (temporaire, voir CLAUDE.md "Refonte V1 en cours") : valeurs
// alignées sur le nouvel enum StatutDemande (11 valeurs), mais ce filtre
// n'expose encore que les statuts produits par la logique applicative
// actuelle (EN_ATTENTE -> EN_ATTENTE_VALIDATION, CLOTUREE_TOTALE/
// CLOTUREE_PARTIELLE -> CLOTUREE) — à enrichir phase par phase.
const STATUT_OPTIONS = [
  { value: "EN_ATTENTE_VALIDATION", label: "En attente de validation" },
  { value: "VALIDEE", label: "Validée" },
  { value: "REJETEE", label: "Rejetée" },
  { value: "CLOTUREE", label: "Clôturée" },
];

const MODE_OPTIONS = [
  { value: "CAISSE", label: "Caisse" },
  { value: "BANQUE", label: "Banque" },
];

export interface ReportingFiltersInitial {
  du?: string;
  au?: string;
  demandeurId?: string;
  service?: string;
  categorieId?: string;
  objetId?: string;
  mode?: string;
  statut?: string;
}

/**
 * Formulaire de filtres du reporting (Ticket 10) : soumission en GET native
 * (`method="get"`, pas de Server Action) — l'URL résultante reste
 * partageable et rechargeable telle quelle, conformément à la demande.
 *
 * Le filtrage Catégorie -> Objet reprend le pattern de `CategorisationForm.tsx`
 * (Ticket 2) : filtrage en mémoire côté client, sans requête réseau. Contrairement
 * à ce formulaire de catégorisation, l'Objet n'est pas verrouillé tant qu'aucune
 * catégorie n'est choisie — c'est un filtre, pas une saisie : on peut vouloir
 * filtrer directement par objet sans présélectionner sa catégorie.
 */
export function ReportingFiltersForm({
  categories,
  objets,
  users,
  services,
  initial,
}: {
  categories: Option[];
  objets: ObjetOption[];
  users: Option[];
  services: string[];
  initial: ReportingFiltersInitial;
}) {
  const [categorieId, setCategorieId] = useState(initial.categorieId ?? "");

  const objetsFiltres = useMemo(
    () => (categorieId ? objets.filter((o) => o.categorieId === categorieId) : objets),
    [objets, categorieId]
  );

  return (
    <form
      method="get"
      className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3 sm:p-6"
    >
      <Input type="date" name="du" label="Du" defaultValue={initial.du} />
      <Input type="date" name="au" label="Au" defaultValue={initial.au} />
      <Select
        name="demandeurId"
        label="Demandeur"
        placeholder="Tous"
        defaultValue={initial.demandeurId ?? ""}
        options={users.map((u) => ({ value: u.id, label: u.label }))}
      />
      {services.length > 0 ? (
        <Select
          name="service"
          label="Service"
          placeholder="Tous"
          defaultValue={initial.service ?? ""}
          options={services.map((s) => ({ value: s, label: s }))}
        />
      ) : null}
      <Select
        name="categorieId"
        label="Catégorie"
        placeholder="Toutes"
        defaultValue={initial.categorieId ?? ""}
        onChange={(e) => setCategorieId(e.target.value)}
        options={categories.map((c) => ({ value: c.id, label: c.label }))}
      />
      <Select
        key={categorieId}
        name="objetId"
        label="Objet"
        placeholder="Tous"
        defaultValue={categorieId === (initial.categorieId ?? "") ? (initial.objetId ?? "") : ""}
        options={objetsFiltres.map((o) => ({ value: o.id, label: o.label }))}
      />
      <Select
        name="mode"
        label="Mode de règlement"
        placeholder="Tous"
        defaultValue={initial.mode ?? ""}
        options={MODE_OPTIONS}
      />
      <Select
        name="statut"
        label="Statut de la demande"
        placeholder="Tous"
        defaultValue={initial.statut ?? ""}
        options={STATUT_OPTIONS}
      />
      <div className="flex items-end gap-3 sm:col-span-3">
        <Button type="submit">Filtrer</Button>
        <a href="/treso/finance/reporting">
          <Button type="button" variant="secondary">
            Réinitialiser
          </Button>
        </a>
      </div>
    </form>
  );
}
