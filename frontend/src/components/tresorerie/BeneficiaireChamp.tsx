"use client";

import { Input, Select } from "@/components/ui";
import type { SaisieBeneficiaire } from "backend/client";

const OPTIONS: { value: SaisieBeneficiaire["mode"]; label: string }[] = [
  { value: "MOI", label: "Moi-même" },
  { value: "COMPTE", label: "Un autre compte du portail" },
  { value: "NOM", label: "Un nom libre (fournisseur, entreprise…)" },
];

/**
 * Champ « Bénéficiaire » (moi-même, un autre compte ou un nom libre), contrôlé : sert au bloc « Détails communs »
 * et aux « Détails de l'article » du formulaire de demande et de correction.
 */
export function BeneficiaireChamp({
  value,
  onChange,
  comptes,
  error,
  label = "Bénéficiaire",
}: {
  value: SaisieBeneficiaire;
  onChange: (v: SaisieBeneficiaire) => void;
  comptes: { value: string; label: string }[];
  error?: string;
  label?: string;
}) {
  return (
    <div className="space-y-2" data-beneficiaire-champ>
      <Select
        label={label}
        options={OPTIONS}
        value={value.mode}
        onChange={(e) => onChange({ ...value, mode: e.target.value as SaisieBeneficiaire["mode"] })}
        error={value.mode === "MOI" ? error : undefined}
      />
      {value.mode === "COMPTE" ? (
        <Select
          label="Compte bénéficiaire"
          placeholder="Sélectionner un compte..."
          options={comptes}
          value={value.userId}
          onChange={(e) => onChange({ ...value, userId: e.target.value })}
          error={error}
        />
      ) : null}
      {value.mode === "NOM" ? (
        <Input
          label="Nom du bénéficiaire"
          hint="Fournisseur, prestataire ou « SIM Assurances CI »."
          value={value.nom}
          onChange={(e) => onChange({ ...value, nom: e.target.value })}
          error={error}
        />
      ) : null}
    </div>
  );
}
