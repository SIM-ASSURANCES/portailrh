"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input, Textarea } from "@/components/ui";
import { PieceJointeUpload } from "@/components/tresorerie/PieceJointeUpload";

import {
  creerRetourExceptionnelAction,
  rejeterRetourExceptionnelAction,
  validerRetourExceptionnelAction,
} from "./retourExceptionnelActions";

/** Bouton + formulaire "Enregistrer un retour exceptionnel" (Assistant Finance / Responsable). */
export function RetourExceptionnelForm({ demandeId, disabled }: { demandeId: string; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [montant, setMontant] = useState("");
  const [motif, setMotif] = useState("");
  const [pieceUrl, setPieceUrl] = useState<string | undefined>();
  const [erreur, setErreur] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button type="button" disabled={disabled} onClick={() => setOpen(true)}>
        Enregistrer un retour exceptionnel
      </Button>
    );
  }

  function handleSubmit() {
    const m = Number(montant);
    if (!m || m <= 0) return setErreur("Le montant doit être supérieur à 0.");
    if (motif.trim().length < 10) return setErreur("Le motif est obligatoire (10 caractères minimum).");
    setErreur(undefined);
    startTransition(async () => {
      const result = await creerRetourExceptionnelAction(demandeId, m, motif, pieceUrl);
      if (result.status === "success") {
        toast.success(result.message);
        setOpen(false);
        setMontant("");
        setMotif("");
        setPieceUrl(undefined);
      } else toast.error(result.message);
    });
  }

  return (
    <div className="animate-fade-in-up w-full space-y-3 rounded-md border border-border p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Montant rendu (FCFA)"
          type="number"
          inputMode="decimal"
          min="0"
          step="1"
          required
          value={montant}
          onChange={(e) => setMontant(e.target.value)}
        />
      </div>
      <Textarea
        label="Motif"
        rows={2}
        required
        hint="10 caractères minimum."
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
      />
      <PieceJointeUpload label="Justificatif du versement (facultatif)" onChange={(url) => setPieceUrl(url ?? undefined)} />
      {erreur ? <p className="text-sm text-danger">{erreur}</p> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="button" loading={isPending} onClick={handleSubmit}>
          Enregistrer
        </Button>
        <Button type="button" variant="secondary" disabled={isPending} onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

/** Valider / rejeter un retour exceptionnel en attente (Responsable Finance, jamais sur sa propre saisie). */
export function RetourExceptionnelDecision({ retourId, disabled }: { retourId: string; disabled: boolean }) {
  const [rejet, setRejet] = useState(false);
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function valider() {
    startTransition(async () => {
      const r = await validerRetourExceptionnelAction(retourId);
      if (r.status === "success") toast.success(r.message);
      else toast.error(r.message);
    });
  }
  function rejeter() {
    if (motif.trim().length < 3) return setErreur("Le motif de rejet est obligatoire (3 caractères minimum).");
    setErreur(undefined);
    startTransition(async () => {
      const r = await rejeterRetourExceptionnelAction(retourId, motif);
      if (r.status === "success") {
        toast.success(r.message);
        setRejet(false);
      } else toast.error(r.message);
    });
  }

  if (rejet) {
    return (
      <div className="w-full space-y-2">
        <Textarea label="Motif du rejet" rows={2} required value={motif} onChange={(e) => setMotif(e.target.value)} />
        {erreur ? <p className="text-sm text-danger">{erreur}</p> : null}
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="danger" loading={isPending} onClick={rejeter}>
            Confirmer le rejet
          </Button>
          <Button type="button" variant="secondary" disabled={isPending} onClick={() => setRejet(false)}>
            Annuler
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-3">
      <Button type="button" loading={isPending} disabled={disabled} onClick={valider}>
        Valider
      </Button>
      <Button type="button" variant="danger" disabled={disabled || isPending} onClick={() => setRejet(true)}>
        Rejeter
      </Button>
    </div>
  );
}
