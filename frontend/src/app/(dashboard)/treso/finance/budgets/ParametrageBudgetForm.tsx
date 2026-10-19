"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input, Select } from "@/components/ui";

import { soumettreParametrageBudgetAction } from "./actions";

type ModeSeuil = "AUCUN" | "POURCENTAGE" | "MONTANT";

/**
 * Paramétrage d'un budget (lot J) : global ou d'une catégorie, montant, date d'effet (début, fin facultative) et seuils d'alerte
 * (pourcentage restant OU montant restant, orange puis rouge plus bas). Le paramétrage est SOUMIS au DG : il n'est pris en
 * compte qu'une fois validé, et ne modifie jamais le budget en vigueur (il le remplace à sa date d'effet).
 */
export function ParametrageBudgetForm({ categories, aujourdhui }: { categories: { id: string; label: string }[]; aujourdhui: string }) {
  const [portee, setPortee] = useState<"GLOBAL" | "CATEGORIE">("CATEGORIE");
  const [categorieId, setCategorieId] = useState("");
  const [montant, setMontant] = useState("");
  const [dateDebut, setDateDebut] = useState(aujourdhui);
  const [dateFin, setDateFin] = useState("");
  const [mode, setMode] = useState<ModeSeuil>("POURCENTAGE");
  const [orange, setOrange] = useState("20");
  const [rouge, setRouge] = useState("10");
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  function soumettre() {
    setErreurs({});
    startTransition(async () => {
      const r = await soumettreParametrageBudgetAction({
        portee,
        categorieId: portee === "CATEGORIE" ? categorieId : null,
        montant: Number(montant),
        dateDebut,
        dateFin: dateFin || null,
        seuil: mode === "AUCUN" ? null : { mode, orange: Number(orange), rouge: Number(rouge) },
      });
      if (r.status === "success") {
        toast.success(r.message);
        setMontant("");
        setDateFin("");
      } else {
        setErreurs(r.erreurs ?? {});
        toast.error(r.message);
      }
    });
  }

  const unite = mode === "POURCENTAGE" ? "%" : "FCFA";

  return (
    <form
      data-parametrage-budget-form
      onSubmit={(e) => {
        e.preventDefault();
        soumettre();
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          name="portee"
          label="Budget concerné"
          value={portee}
          onChange={(e) => setPortee(e.target.value as "GLOBAL" | "CATEGORIE")}
          options={[
            { value: "CATEGORIE", label: "Une catégorie" },
            { value: "GLOBAL", label: "Budget global (toutes les dépenses)" },
          ]}
          error={erreurs.portee}
        />
        {portee === "CATEGORIE" ? (
          <Select
            name="categorieId"
            label="Catégorie"
            placeholder="Choisir une catégorie…"
            value={categorieId}
            onChange={(e) => setCategorieId(e.target.value)}
            options={categories.map((c) => ({ value: c.id, label: c.label }))}
            error={erreurs.categorieId}
          />
        ) : null}
        <Input name="montant" label="Montant du budget (FCFA)" type="number" min={0} step="0.01" required value={montant} onChange={(e) => setMontant(e.target.value)} error={erreurs.montant} />
        <div />
        <Input name="dateDebut" label="Date d'effet (début)" type="date" required min={aujourdhui} value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} error={erreurs.dateDebut} hint="Jamais dans le passé : le nouveau budget remplace l'ancien à cette date." />
        <Input name="dateFin" label="Date de fin (facultative)" type="date" min={dateDebut} value={dateFin} onChange={(e) => setDateFin(e.target.value)} error={erreurs.dateFin} hint="Vide : sans date de fin." />
      </div>

      <fieldset className="space-y-3 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-semibold text-foreground">Seuils d&apos;alerte</legend>
        <Select
          name="modeSeuil"
          label="Mesurer le reste en…"
          value={mode}
          onChange={(e) => setMode(e.target.value as ModeSeuil)}
          options={[
            { value: "POURCENTAGE", label: "Pourcentage restant" },
            { value: "MONTANT", label: "Montant restant" },
            { value: "AUCUN", label: "Aucune alerte pour ce budget" },
          ]}
          error={erreurs.seuilMode}
        />
        {mode !== "AUCUN" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input name="seuilOrange" label={`Alerte ORANGE quand il reste ${unite === "%" ? "(%)" : "(FCFA)"} au plus`} type="number" min={0} step="0.01" value={orange} onChange={(e) => setOrange(e.target.value)} error={erreurs.seuilOrange} />
            <Input name="seuilRouge" label={`Alerte ROUGE (bloquante) quand il reste ${unite === "%" ? "(%)" : "(FCFA)"} au plus`} type="number" min={0} step="0.01" value={rouge} onChange={(e) => setRouge(e.target.value)} error={erreurs.seuilRouge} hint="Strictement plus bas que l'orange. Rouge : la validation exige l'accord du DG." />
          </div>
        ) : null}
      </fieldset>

      <Button type="submit" loading={isPending}>
        Soumettre au DG
      </Button>
    </form>
  );
}
