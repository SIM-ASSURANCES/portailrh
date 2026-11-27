"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  CASE_AUCUN_VERSEMENT_CPT,
  LIBELLE_MODE_PAIEMENT_PARTENAIRE_CPT,
  LIBELLE_MODE_REGLEMENT_CPT,
  LIBELLE_NATURE_REMUNERATION_CPT,
  MODES_PAIEMENT_PARTENAIRE_CPT,
  MODES_REGLEMENT_CPT,
  NATURES_REMUNERATION_CPT,
  type TypeOperationRemunerationCpt,
} from "backend/client";

import { Button, Input, InputMontant, Select, Textarea } from "@/components/ui";

import {
  annulerOperationRemunerationAction,
  compenserRemunerationAction,
  deciderModeRemunerationAction,
  enregistrerReglementPartenaireAction,
  type ResultatRemunerationAction,
} from "./actions";

export const RAISON_SANS_PERMISSION_REGLEMENT = "Votre rôle ne permet pas de régler un partenaire.";
export const RAISON_SANS_PERMISSION_COMPENSATION = "Votre rôle ne permet pas de compenser entre natures.";

function useAction() {
  const router = useRouter();
  const [enCours, startTransition] = useTransition();
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  function lancer(appel: () => Promise<ResultatRemunerationAction>, apresSucces?: () => void) {
    startTransition(async () => {
      const r = await appel();
      if (r.status === "error") {
        toast.error(r.message);
        setErreurs(r.erreurs ?? {});
        setMessage(r.message);
      } else {
        toast.success(r.message);
        setErreurs({});
        setMessage(null);
        apresSucces?.();
      }
      router.refresh();
    });
  }
  return { enCours, erreurs, message, lancer };
}

const valeurs = (f: HTMLFormElement) => Object.fromEntries([...new FormData(f).entries()].map(([k, v]) => [k, String(v)]));
const optionsNatures = NATURES_REMUNERATION_CPT.map((n) => ({ value: n, label: LIBELLE_NATURE_REMUNERATION_CPT[n] }));

/** Nouveau règlement (cpt.regler_partenaire). Sans la permission, le formulaire reste visible, bouton grisé avec la raison. */
export function ReglementPartenaireForm({ partenaireId, aujourdhui, autorise }: { partenaireId: string; aujourdhui: string; autorise: boolean }) {
  const { enCours, erreurs, message, lancer } = useAction();
  const [version, setVersion] = useState(0);
  function envoyer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const saisie = { ...valeurs(e.currentTarget), partenaireId };
    lancer(
      () => enregistrerReglementPartenaireAction(saisie),
      () => setVersion((v) => v + 1),
    );
  }
  return (
    <form key={version} onSubmit={envoyer} data-form-reglement className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Select name="nature" label="Nature" required placeholder="Choisir..." options={optionsNatures} error={erreurs.nature} />
      <InputMontant name="montant" label="Montant (FCFA)" required error={erreurs.montant} />
      <Input name="date" label="Date du règlement" type="date" required max={aujourdhui} defaultValue={aujourdhui} error={erreurs.date} />
      <Select
        name="mode"
        label="Moyen de paiement"
        required
        placeholder="Choisir..."
        options={MODES_PAIEMENT_PARTENAIRE_CPT.map((m) => ({ value: m, label: LIBELLE_MODE_PAIEMENT_PARTENAIRE_CPT[m] }))}
        error={erreurs.mode}
      />
      <Input name="referenceReglement" label="Référence du règlement" required error={erreurs.referenceReglement} />
      <Input name="pieceOdoo" label="Pièce comptable (Odoo, facultatif)" error={erreurs.pieceOdoo} />
      <Select
        name="modeDerogation"
        label="En une fois / au prorata"
        options={[{ value: "", label: "Règle de chaque contrat" }, ...MODES_REGLEMENT_CPT.map((m) => ({ value: m, label: `Pour ce règlement : ${LIBELLE_MODE_REGLEMENT_CPT[m].toLowerCase()}` }))]}
        error={erreurs.modeDerogation}
      />
      <div className="sm:col-span-2">
        <Textarea name="motif" label="Motif" rows={2} hint="Obligatoire (10 caractères) pour un choix « en une fois / au prorata »." error={erreurs.motif} />
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <Button type="submit" loading={enCours} disabled={enCours || !autorise}>
          Enregistrer le règlement
        </Button>
        {!autorise && <p className="mt-2 text-sm text-foreground">{RAISON_SANS_PERMISSION_REGLEMENT}</p>}
        {message && (
          <p role="alert" data-message-reglement className="mt-2 text-sm text-danger">
            {message}
          </p>
        )}
      </div>
    </form>
  );
}

export interface ContratDecision {
  contratId: string;
  numPolice: string;
}

/** Décision « en une fois / au prorata » sur un contrat (cpt.regler_partenaire), avec motif. */
export function DecisionModeForm({ partenaireId, contrats, autorise }: { partenaireId: string; contrats: ContratDecision[]; autorise: boolean }) {
  const { enCours, message, lancer } = useAction();
  const [version, setVersion] = useState(0);
  function envoyer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const saisie = { ...valeurs(e.currentTarget), partenaireId };
    lancer(
      () => deciderModeRemunerationAction(saisie),
      () => setVersion((v) => v + 1),
    );
  }
  return (
    <form key={version} onSubmit={envoyer} data-form-decision className="grid gap-3 sm:grid-cols-3">
      <Select name="contratId" label="Contrat" required placeholder="Choisir..." options={contrats.map((c) => ({ value: c.contratId, label: c.numPolice }))} />
      <Select name="nature" label="Nature" required placeholder="Choisir..." options={optionsNatures} />
      <Select name="mode" label="Mode de règlement" required placeholder="Choisir..." options={MODES_REGLEMENT_CPT.map((m) => ({ value: m, label: LIBELLE_MODE_REGLEMENT_CPT[m] }))} />
      <div className="sm:col-span-3">
        <Textarea name="motif" label="Motif" required rows={2} hint="10 caractères au moins." />
      </div>
      <div className="sm:col-span-3">
        <Button type="submit" variant="secondary" loading={enCours} disabled={enCours || !autorise}>
          Enregistrer la décision
        </Button>
        {!autorise && <p className="mt-2 text-sm text-foreground">{RAISON_SANS_PERMISSION_REGLEMENT}</p>}
        {message && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {message}
          </p>
        )}
      </div>
    </form>
  );
}

/** Compensation entre deux natures (cpt.compenser). `raison` : pourquoi elle est impossible pour l'instant (bouton grisé). */
export function CompensationForm({ partenaireId, autorise, raison }: { partenaireId: string; autorise: boolean; raison: string | null }) {
  const { enCours, erreurs, message, lancer } = useAction();
  const [version, setVersion] = useState(0);
  const blocage = autorise ? raison : RAISON_SANS_PERMISSION_COMPENSATION;
  function envoyer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const saisie = { ...valeurs(e.currentTarget), partenaireId };
    lancer(
      () => compenserRemunerationAction(saisie),
      () => setVersion((v) => v + 1),
    );
  }
  return (
    <form key={version} onSubmit={envoyer} data-form-compensation className="grid gap-3 sm:grid-cols-3">
      <Select name="natureSource" label="Reprendre l'avance de" required placeholder="Choisir..." options={optionsNatures} error={erreurs.natureSource} />
      <Select name="natureCible" label="Imputer sur" required placeholder="Choisir..." options={optionsNatures} error={erreurs.natureCible} />
      <InputMontant name="montant" label="Montant (FCFA)" required error={erreurs.montant} />
      <div className="sm:col-span-3">
        <Textarea name="motif" label="Motif" required rows={2} hint="10 caractères au moins." error={erreurs.motif} />
      </div>
      <div className="sm:col-span-3">
        <Button type="submit" variant="secondary" loading={enCours} disabled={enCours || blocage !== null}>
          Compenser
        </Button>
        {blocage && (
          <p data-raison-compensation className="mt-2 text-sm text-foreground">
            {blocage}
          </p>
        )}
        {message && (
          <p role="alert" data-message-compensation className="mt-2 text-sm text-danger">
            {message}
          </p>
        )}
      </div>
    </form>
  );
}

/**
 * Annulation d'une opération : bouton toujours visible sur une opération active, grisé avec la raison du serveur quand elle est
 * impossible. Le motif, puis la confirmation, se font dans le panneau ouvert par le bouton.
 */
export function AnnulationOperation({ type, operationId, raison }: { type: TypeOperationRemunerationCpt; operationId: string; raison: string | null }) {
  const { enCours, erreurs, message, lancer } = useAction();
  const [ouvert, setOuvert] = useState(false);
  function envoyer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const saisie = { ...valeurs(e.currentTarget), type, operationId };
    lancer(
      () => annulerOperationRemunerationAction(saisie),
      () => setOuvert(false),
    );
  }
  if (!ouvert) {
    return (
      <div className="space-y-1" data-annulation={type}>
        <Button type="button" variant="secondary" disabled={raison !== null} onClick={() => setOuvert(true)} data-bouton-annuler>
          Annuler
        </Button>
        {raison && (
          <p className="max-w-xs text-xs text-foreground" data-raison-annulation>
            {raison}
          </p>
        )}
      </div>
    );
  }
  return (
    <form onSubmit={envoyer} className="min-w-64 space-y-2 rounded-lg border border-border p-3 text-left" data-form-annulation={type}>
      <Textarea name="motif" label="Motif de l'annulation" required rows={2} hint="10 caractères au moins." error={erreurs.motif} />
      <Input name="pieceOdoo" label="Pièce de contre-passation (Odoo, facultatif)" error={erreurs.pieceOdoo} />
      {type === "REGLEMENT" && (
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input type="checkbox" name="sansVersement" value="true" className="mt-1" />
          <span>{CASE_AUCUN_VERSEMENT_CPT}</span>
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" loading={enCours} disabled={enCours}>
          Confirmer l&apos;annulation
        </Button>
        <Button type="button" variant="secondary" disabled={enCours} onClick={() => setOuvert(false)}>
          Fermer
        </Button>
      </div>
      {message && (
        <p role="alert" data-message-annulation className="text-sm text-danger">
          {message}
        </p>
      )}
    </form>
  );
}
