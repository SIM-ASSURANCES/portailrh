"use client";

import { useActionState, useEffect } from "react";
import { updateHorairesAction } from "./actions";
import { Button, Input } from "@/components/ui";
import { toast } from "sonner";
import type { ParametrageHoraire } from "@/generated/prisma/client";

export function HorairesForm({ config }: { config: ParametrageHoraire | null }) {
  const [state, formAction, isPending] = useActionState(updateHorairesAction, {
    success: false,
    message: "",
  });

  useEffect(() => {
    if (state.message) {
      if (state.success) {
        toast.success(state.message);
      } else {
        toast.error(state.message);
      }
    }
  }, [state]);

  // Si on n'a pas de config (cas rare en théorie), on initialise à vide
  const defMatinDeb = config?.heureDebutMatin || "";
  const defMatinFin = config?.heureFinMatin || "";
  const defApremDeb = config?.heureDebutApresMidi || "";
  const defApremFin = config?.heureFinApresMidi || "";

  return (
    <form action={formAction} className="space-y-8 max-w-2xl bg-card p-6 rounded-lg border shadow-sm">
      <div className="space-y-4">
        <h3 className="text-lg font-medium border-b pb-2">Matinée</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Heure de début (Matin)"
            name="heureDebutMatin"
            type="time"
            defaultValue={defMatinDeb}
            required
            error={state.fieldErrors?.heureDebutMatin?.[0]}
          />
          <Input
            label="Heure de fin (Matin)"
            name="heureFinMatin"
            type="time"
            defaultValue={defMatinFin}
            required
            error={state.fieldErrors?.heureFinMatin?.[0]}
          />
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-medium border-b pb-2">Après-midi</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Heure de début (Après-midi)"
            name="heureDebutApresMidi"
            type="time"
            defaultValue={defApremDeb}
            required
            error={state.fieldErrors?.heureDebutApresMidi?.[0]}
          />
          <Input
            label="Heure de fin (Après-midi)"
            name="heureFinApresMidi"
            type="time"
            defaultValue={defApremFin}
            required
            error={state.fieldErrors?.heureFinApresMidi?.[0]}
          />
        </div>
      </div>

      <div className="pt-4 border-t flex justify-end">
        <Button type="submit" loading={isPending}>
          Enregistrer les horaires
        </Button>
      </div>
    </form>
  );
}
