"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { creerTypeCongeAction, modifierTypeCongeAction, toggleTypeCongeAction } from "../actions";

export interface TypeCongeGestion {
  id: string;
  code: string;
  label: string;
  categorie: "CONGE_STANDARD" | "PERMISSION_EXCEPTIONNELLE";
  nbJoursDefaut: number;
  decompteType: "CALENDAIRE" | "OUVRABLE";
  justificatifObligatoire: boolean;
  nonDeductibleSolde: boolean;
  ancienneteMinimumMois: number;
  isActive: boolean;
}

const VIDE: Omit<TypeCongeGestion, "id" | "isActive"> = {
  code: "",
  label: "",
  categorie: "CONGE_STANDARD",
  nbJoursDefaut: 0,
  decompteType: "OUVRABLE",
  justificatifObligatoire: false,
  nonDeductibleSolde: false,
  ancienneteMinimumMois: 0,
};

const LIBELLE_CATEGORIE = { CONGE_STANDARD: "Congé", PERMISSION_EXCEPTIONNELLE: "Permission exceptionnelle (article 13)" } as const;

function FormulaireType({ id, valeurs, onTermine }: { id: string | null; valeurs: Omit<TypeCongeGestion, "id" | "isActive">; onTermine: () => void }) {
  const [v, setV] = useState(valeurs);
  const [erreurs, setErreurs] = useState<Partial<Record<string, string>>>({});
  const [enCours, demarrer] = useTransition();
  const router = useRouter();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setErreurs({});
        demarrer(async () => {
          const r = id ? await modifierTypeCongeAction(id, v) : await creerTypeCongeAction(v);
          if (r.status === "success") {
            toast.success(r.message ?? "Enregistré.");
            onTermine();
            router.refresh();
          } else if (r.status === "error") {
            setErreurs(r.fieldErrors ?? {});
            toast.error(r.message);
          }
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Libellé" required value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} error={erreurs.label} />
        <Input label="Code" required value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} hint="Identifiant stable, en majuscules." error={erreurs.code} />
        <Select
          label="Catégorie"
          options={[
            { value: "CONGE_STANDARD", label: LIBELLE_CATEGORIE.CONGE_STANDARD },
            { value: "PERMISSION_EXCEPTIONNELLE", label: LIBELLE_CATEGORIE.PERMISSION_EXCEPTIONNELLE },
          ]}
          value={v.categorie}
          onChange={(e) => setV({ ...v, categorie: e.target.value as typeof v.categorie })}
          hint={v.categorie === "PERMISSION_EXCEPTIONNELLE" ? "Durée fixée par le type, pièce justificative obligatoire." : undefined}
        />
        <Select
          label="Décompte"
          options={[
            { value: "OUVRABLE", label: "Jours ouvrés" },
            { value: "CALENDAIRE", label: "Jours calendaires" },
          ]}
          value={v.decompteType}
          onChange={(e) => setV({ ...v, decompteType: e.target.value as typeof v.decompteType })}
        />
        <Input label="Jours accordés par défaut" type="number" min={0} max={366} value={v.nbJoursDefaut} onChange={(e) => setV({ ...v, nbJoursDefaut: Number(e.target.value) })} error={erreurs.nbJoursDefaut} />
        <Input label="Ancienneté minimale (mois)" type="number" min={0} max={120} value={v.ancienneteMinimumMois} onChange={(e) => setV({ ...v, ancienneteMinimumMois: Number(e.target.value) })} error={erreurs.ancienneteMinimumMois} />
      </div>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={v.nonDeductibleSolde} onChange={(e) => setV({ ...v, nonDeductibleSolde: e.target.checked })} />
        Non déduit du solde de congé annuel
      </label>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={v.justificatifObligatoire} onChange={(e) => setV({ ...v, justificatifObligatoire: e.target.checked })} />
        Pièce justificative obligatoire
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" variant="primary" loading={enCours}>
          {id ? "Enregistrer" : "Créer le type"}
        </Button>
        <Button type="button" variant="secondary" disabled={enCours} onClick={onTermine}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

function CarteType({ type }: { type: TypeCongeGestion }) {
  const [edition, setEdition] = useState(false);
  const [enCours, demarrer] = useTransition();
  const router = useRouter();

  if (edition) {
    const { id, isActive: _actif, ...valeurs } = type;
    void _actif;
    return (
      <Card className="p-4 sm:p-5">
        <FormulaireType id={id} valeurs={valeurs} onTermine={() => setEdition(false)} />
      </Card>
    );
  }

  return (
    <Card className="space-y-2 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-foreground">{type.label}</p>
          <p className="text-xs text-muted-foreground">
            {type.code} · {LIBELLE_CATEGORIE[type.categorie]}
          </p>
        </div>
        <Badge variant={type.isActive ? "success" : "neutral"}>{type.isActive ? "Actif" : "Inactif"}</Badge>
      </div>
      <p className="text-sm text-foreground">
        {type.nbJoursDefaut} jour(s) · {type.decompteType === "OUVRABLE" ? "jours ouvrés" : "jours calendaires"}
        {type.nonDeductibleSolde ? " · non déduit du solde" : ""}
        {type.ancienneteMinimumMois > 0 ? ` · ancienneté ${type.ancienneteMinimumMois} mois` : ""}
        {type.justificatifObligatoire ? " · pièce obligatoire" : ""}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="secondary" onClick={() => setEdition(true)}>
          Modifier
        </Button>
        <Button
          variant="secondary"
          loading={enCours}
          onClick={() =>
            demarrer(async () => {
              const r = await toggleTypeCongeAction(type.id);
              if (r.status === "success") {
                toast.success(r.message ?? "Type mis à jour.");
                router.refresh();
              } else if (r.status === "error") toast.error(r.message);
            })
          }
        >
          {type.isActive ? "Désactiver" : "Activer"}
        </Button>
      </div>
    </Card>
  );
}

export function TypesCongeGestion({ types }: { types: TypeCongeGestion[] }) {
  const [creation, setCreation] = useState(false);
  return (
    <div className="space-y-4">
      {creation ? (
        <Card className="p-4 sm:p-5">
          <FormulaireType id={null} valeurs={VIDE} onTermine={() => setCreation(false)} />
        </Card>
      ) : (
        <Button variant="primary" onClick={() => setCreation(true)}>
          Nouveau type
        </Button>
      )}
      <ul className="space-y-3">
        {types.map((t) => (
          <li key={t.id}>
            <CarteType type={t} />
          </li>
        ))}
      </ul>
    </div>
  );
}
