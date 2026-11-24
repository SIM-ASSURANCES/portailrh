"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input, InputMontant, Select, Textarea } from "@/components/ui";
import { CANAUX_RELANCE_CPT, LIBELLE_CANAL_RELANCE_CPT } from "backend/client";

import { enregistrerRelanceCptAction, evaluerPromessesCptAction } from "./actions";

/** Formulaire « J'ai relancé ce client » : la relance se fait hors de l'application, ici on la consigne (et la promesse obtenue). Rien n'est envoyé. */
export function FormulaireRelance({ clientId, aujourdhui }: { clientId: string; aujourdhui: string }) {
  const router = useRouter();
  const [enCours, startTransition] = useTransition();
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [promesse, setPromesse] = useState(false);

  function envoyer(formData: FormData) {
    startTransition(async () => {
      const r = await enregistrerRelanceCptAction(clientId, {
        canal: formData.get("canal"),
        faiteLe: formData.get("faiteLe"),
        commentaire: formData.get("commentaire"),
        promesseMontant: promesse ? formData.get("promesseMontant") : "",
        promesseDate: promesse ? formData.get("promesseDate") : "",
      });
      if (r.status === "error") {
        setErreurs(r.erreurs ?? {});
        toast.error(r.message);
        return;
      }
      setErreurs({});
      toast.success(r.message);
      router.refresh();
    });
  }

  return (
    <form action={envoyer} className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-elevated" data-formulaire-relance>
      <p className="text-sm text-muted-foreground">Consignez une relance faite hors de l&apos;application. L&apos;application n&apos;envoie ni SMS ni e-mail.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Select label="Canal" name="canal" required placeholder="Choisir…" options={CANAUX_RELANCE_CPT.map((c) => ({ value: c, label: LIBELLE_CANAL_RELANCE_CPT[c] }))} error={erreurs.canal} />
        <Input label="Date de la relance" name="faiteLe" type="date" defaultValue={aujourdhui} max={aujourdhui} required error={erreurs.faiteLe} />
      </div>
      <Textarea label="Commentaire" name="commentaire" rows={2} hint="Facultatif, 500 caractères au plus." error={erreurs.commentaire} />
      <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <input type="checkbox" checked={promesse} onChange={(e) => setPromesse(e.target.checked)} data-promesse-case /> Le client a promis de payer
      </label>
      {promesse && (
        <div className="grid gap-3 sm:grid-cols-3" data-promesse-champs>
          <InputMontant label="Montant promis (FCFA)" name="promesseMontant" required error={erreurs.promesseMontant} />
          <Input label="Date promise" name="promesseDate" type="date" min={aujourdhui} required error={erreurs.promesseDate} />
        </div>
      )}
      <Button type="submit" loading={enCours} disabled={enCours}>
        Enregistrer la relance
      </Button>
    </form>
  );
}

/** Applique la règle d'évaluation aux promesses échues. Ne choisit jamais un statut à la main. */
export function EvaluerPromessesBouton({ clientId }: { clientId?: string }) {
  const router = useRouter();
  const [enCours, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="secondary"
      loading={enCours}
      disabled={enCours}
      data-evaluer-promesses
      onClick={() =>
        startTransition(async () => {
          const r = await evaluerPromessesCptAction(clientId);
          if (r.status === "error") toast.error(r.message);
          else toast.success(r.message);
          router.refresh();
        })
      }
    >
      Évaluer les promesses échues
    </Button>
  );
}
