"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input } from "@/components/ui";

import { definirDateCategorisationAction } from "./parametreActions";

/**
 * Date à partir de laquelle la catégorisation est obligatoire pour valider (lot I). Vide = jamais obligatoire. Avant la
 * date (ou sans date), on peut valider une demande ou un article sans catégorie ; à partir de la date, la validation
 * d'une ligne sans catégorie est refusée (règle d'origine). Enregistrement explicite (bouton), revérifié côté serveur.
 */
export function CategorisationObligatoireDate({ dateActuelle, phrase }: { dateActuelle: string | null; phrase: string }) {
  const [valeur, setValeur] = useState(dateActuelle ?? "");
  const [isPending, startTransition] = useTransition();

  function enregistrer(saisie: string) {
    startTransition(async () => {
      const result = await definirDateCategorisationAction(saisie);
      if (result.status === "success") toast.success(result.message);
      else toast.error(result.message);
    });
  }

  return (
    <div data-parametre-categorisation className="space-y-3">
      <p data-regle-categorisation className="text-sm text-foreground">
        {phrase}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Input
            name="dateCategorisation"
            label="Catégorisation obligatoire à partir du"
            type="date"
            hint="Laisser vide : jamais obligatoire."
            value={valeur}
            onChange={(e) => setValeur(e.target.value)}
          />
        </div>
        <Button type="button" loading={isPending} onClick={() => enregistrer(valeur)}>
          Enregistrer
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={isPending || (dateActuelle == null && valeur === "")}
          onClick={() => {
            setValeur("");
            enregistrer("");
          }}
        >
          Ne jamais exiger
        </Button>
      </div>
    </div>
  );
}
