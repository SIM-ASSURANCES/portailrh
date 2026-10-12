"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { OPTIONS_MODE } from "@/components/encaissements/libelles";
import { Button, Input, Select } from "@/components/ui";

import { saisirVersementAction } from "./actions";

type Alerte = { type: "reference" | "trop"; message: string } | null;

/**
 * « Ajouter un versement » (F3, commit 6c) : date, mode, référence, montant (le reste dû est proposé). Enregistré ET
 * confirmé en une fois. Référence déjà utilisée ou trop-perçu : alerte à confirmer explicitement, rien n'est écrit
 * avant. Mise en page en une colonne sous la largeur d'une tablette.
 */
export function AjouterVersement({ contratId, resteDu, aujourdHui }: { contratId: string; resteDu: string; aujourdHui: string }) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [datePaiement, setDatePaiement] = useState(aujourdHui);
  const [mode, setMode] = useState("");
  const [reference, setReference] = useState("");
  const [montant, setMontant] = useState(resteDu);
  const [erreurs, setErreurs] = useState<Record<string, string | undefined>>({});
  const [alerte, setAlerte] = useState<Alerte>(null);
  const [confirmations, setConfirmations] = useState<{ referenceDejaUtilisee?: boolean; tropPercu?: boolean }>({});
  const [isPending, startTransition] = useTransition();

  // Un champ modifié après une alerte : l'accord donné ne vaut plus pour la nouvelle saisie.
  const changer = (fixer: (v: string) => void) => (e: { target: { value: string } }) => {
    fixer(e.target.value);
    setAlerte(null);
    setConfirmations({});
  };

  function fermer() {
    setOuvert(false);
    setErreurs({});
    setAlerte(null);
    setConfirmations({});
  }

  function enregistrer(acc: typeof confirmations) {
    startTransition(async () => {
      const r = await saisirVersementAction(contratId, { datePaiement, mode, reference, montant }, acc);
      if (r.status === "erreurs") {
        setErreurs(r.erreurs);
        setAlerte(null);
      } else if (r.status === "reference_deja_utilisee") {
        setConfirmations(acc);
        setAlerte({ type: "reference", message: r.message });
      } else if (r.status === "trop_percu") {
        setConfirmations(acc);
        setAlerte({ type: "trop", message: r.message });
      } else if (r.status === "error") toast.error(r.message);
      else {
        toast.success(r.message);
        setReference("");
        fermer();
        router.refresh();
      }
    });
  }

  if (!ouvert) {
    return (
      <Button type="button" onClick={() => setOuvert(true)}>
        Ajouter un versement
      </Button>
    );
  }

  return (
    <div data-ajout-versement className="space-y-3 rounded-xl border border-border bg-surface p-4 shadow-elevated">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          label="Date du paiement"
          type="date"
          max={aujourdHui}
          required
          value={datePaiement}
          onChange={changer(setDatePaiement)}
          error={erreurs.datePaiement}
        />
        <Select
          label="Mode"
          required
          placeholder="Choisir…"
          options={OPTIONS_MODE}
          value={mode}
          onChange={changer(setMode)}
          error={erreurs.mode}
        />
        <Input
          label="Référence"
          required
          hint={mode === "WAVE" ? "Identifiant de transaction Wave : T_ suivi d'au moins 10 lettres ou chiffres." : "N° de chèque, de transaction…"}
          value={reference}
          onChange={changer(setReference)}
          error={erreurs.reference}
        />
        <Input
          label="Montant (FCFA)"
          inputMode="decimal"
          required
          hint="Le reste dû est proposé."
          value={montant}
          onChange={changer(setMontant)}
          error={erreurs.montant}
        />
      </div>

      {alerte ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md bg-warning-bg p-3 text-sm text-warning">
          <p className="min-w-[220px] flex-1">{alerte.message}</p>
          <Button
            type="button"
            loading={isPending}
            onClick={() => enregistrer(alerte.type === "reference" ? { ...confirmations, referenceDejaUtilisee: true } : { ...confirmations, tropPercu: true })}
          >
            {alerte.type === "reference" ? "Enregistrer quand même" : "Confirmer le trop-perçu"}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" loading={isPending && !alerte} disabled={!!alerte} onClick={() => enregistrer({})}>
          Enregistrer et confirmer
        </Button>
        <Button type="button" variant="secondary" disabled={isPending} onClick={fermer}>
          Annuler
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Le versement est confirmé dès l&apos;enregistrement : ses montants sont calculés et figés, la taxe est exigible selon la
        date de paiement et celle d&apos;aujourd&apos;hui.
      </p>
    </div>
  );
}
