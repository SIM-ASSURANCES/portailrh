"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge, Button, Card, Input } from "@/components/ui";
import { creerTypePermissionAction, modifierTypePermissionAction, toggleTypePermissionAction } from "../actions";

export interface TypePermissionGestion {
  id: string;
  label: string;
  dureeMaxHeures: number;
  plafondMensuel: number;
  justificatifRecommande: boolean;
  isActive: boolean;
}

const VIDE: Omit<TypePermissionGestion, "id" | "isActive"> = { label: "", dureeMaxHeures: 3, plafondMensuel: 1, justificatifRecommande: false };

function FormulaireType({ id, valeurs, onTermine }: { id: string | null; valeurs: Omit<TypePermissionGestion, "id" | "isActive">; onTermine: () => void }) {
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
          const r = id ? await modifierTypePermissionAction(id, v) : await creerTypePermissionAction(v);
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
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label="Libellé" required value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} error={erreurs.label} />
        <Input label="Durée maximale (heures)" type="number" min={1} max={24} value={v.dureeMaxHeures} onChange={(e) => setV({ ...v, dureeMaxHeures: Number(e.target.value) })} error={erreurs.dureeMaxHeures} />
        <Input
          label="Plafond mensuel"
          type="number"
          min={1}
          max={60}
          value={v.plafondMensuel}
          onChange={(e) => setV({ ...v, plafondMensuel: Number(e.target.value) })}
          hint="Permissions de ce type par collaborateur et par mois."
          error={erreurs.plafondMensuel}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={v.justificatifRecommande} onChange={(e) => setV({ ...v, justificatifRecommande: e.target.checked })} />
        Justificatif recommandé (à présenter à la RH)
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

function CarteType({ type }: { type: TypePermissionGestion }) {
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
        <p className="font-bold text-foreground">{type.label}</p>
        <Badge variant={type.isActive ? "success" : "neutral"}>{type.isActive ? "Actif" : "Inactif"}</Badge>
      </div>
      <p className="text-sm text-foreground">
        {type.dureeMaxHeures} h au plus · {type.plafondMensuel} par mois et par collaborateur{type.justificatifRecommande ? " · justificatif recommandé" : ""}
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
              const r = await toggleTypePermissionAction(type.id);
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

export function TypesPermissionGestion({ types }: { types: TypePermissionGestion[] }) {
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
