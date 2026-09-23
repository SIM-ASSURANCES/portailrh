"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input } from "@/components/ui";

import { creerRetourCaisseAction, modifierRetourCaisseAction } from "./retourActions";

/**
 * Formulaire de déclaration/modification d'un retour de caisse, associé à
 * un règlement précis (`reglementId` — jamais un formulaire libre
 * indépendant, conformément à la règle impérative du cahier des charges).
 *
 * **Uniquement date + montant retourné** — voir CLAUDE.md "Retirer la
 * saisie de justification par le Collaborateur" : le formulaire "détaillé"
 * (plusieurs lignes de dépense avec objet/justification/commentaire/pièce
 * jointe saisis par le Collaborateur lui-même) a été retiré ENTIÈREMENT,
 * pas seulement masqué — `creerRetourCaisseAction`/`modifierRetourCaisseAction`
 * n'acceptent d'ailleurs plus ce genre de payload au niveau du type (voir
 * `retourActions.ts`). Le Collaborateur ne doit JAMAIS saisir lui-même de
 * justification, de motif ou de pièce jointe sur un retour de caisse :
 * cette classification reste exclusivement l'action de l'Assistant Finance
 * (`declarerRetourAssistantAction`/`marquerDepenseNonJustifieeAction`),
 * qu'un retour Collaborateur existe ou non.
 *
 * La portion NON retournée (`montantReglement - montantRetourne`) est
 * transmise au serveur comme un simple NOMBRE — c'est la Server Action qui
 * construit, si besoin, l'unique ligne `DepenseLigne` synthétique
 * (`SANS_PIECE`, commentaire fixe) qui la représente, jamais le client.
 * Si `montantRetourne` égale le montant du règlement (rien dépensé),
 * aucune ligne n'est créée.
 *
 * Sert aussi bien la **déclaration** (`mode="create"`, défaut) que la
 * **modification** d'un retour existant, pas encore réceptionné
 * (`mode="edit"`, `retourId` requis, `montantRetourneInitial`/`dateRetourInitiale`
 * pour préremplir les deux champs) — même formulaire, seule l'action
 * appelée à la soumission diffère.
 */
export function RetourCaisseForm({
  mode = "create",
  reglementId,
  retourId,
  montantReglement,
  montantRetourneInitial,
  dateRetourInitiale,
  dateMin,
  onCancel,
  onSuccess,
}: {
  mode?: "create" | "edit";
  reglementId: string;
  /** Requis si `mode === "edit"`. */
  retourId?: string;
  montantReglement: number;
  /** Requis si `mode === "edit"` : montant déjà retourné par la déclaration existante. */
  montantRetourneInitial?: number;
  /** Requis si `mode === "edit"` : date déjà enregistrée (`YYYY-MM-DD`), le cas échéant. */
  dateRetourInitiale?: string;
  /** Date du dernier règlement confirmé sur la demande (`YYYY-MM-DD`), le
   * cas échéant — voir CLAUDE.md "Libellés et validations sur le
   * formulaire de retour" : contrainte `min` du champ "Date du retour",
   * revérifiée de toute façon côté serveur. */
  dateMin?: string;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [dateRetour, setDateRetour] = useState(() => dateRetourInitiale ?? new Date().toISOString().slice(0, 10));
  const [montantRetourne, setMontantRetourne] = useState(String(montantRetourneInitial ?? montantReglement));
  const [erreur, setErreur] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    const montant = Number(montantRetourne);
    if (!dateRetour) {
      setErreur("La date du retour est obligatoire.");
      return;
    }
    if (dateMin && dateRetour < dateMin) {
      setErreur(`La date du retour ne peut pas être antérieure au ${new Date(dateMin).toLocaleDateString("fr-FR")}.`);
      return;
    }
    if (Number.isNaN(montant) || montant < 0) {
      setErreur("Le montant retourné doit être un nombre positif ou nul.");
      return;
    }
    if (montant > montantReglement) {
      setErreur(`Le montant retourné ne peut pas dépasser le montant du règlement (${montantReglement.toLocaleString("fr-FR")} FCFA).`);
      return;
    }
    setErreur(undefined);

    startTransition(async () => {
      const result =
        mode === "edit" && retourId
          ? await modifierRetourCaisseAction(retourId, montant, dateRetour)
          : await creerRetourCaisseAction(reglementId, montant, dateRetour);
      if (result.status === "success") {
        toast.success(result.message);
        onSuccess();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="animate-fade-in-up space-y-4 border-t border-border pt-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Date du retour"
          type="date"
          required
          min={dateMin}
          hint={dateMin ? `Ne peut pas être antérieure au ${new Date(dateMin).toLocaleDateString("fr-FR")}.` : undefined}
          value={dateRetour}
          onChange={(e) => setDateRetour(e.target.value)}
        />
        <Input
          label="Montant à retourner"
          type="number"
          inputMode="decimal"
          min="0"
          max={montantReglement}
          step="1"
          required
          hint={`Montant du règlement : ${montantReglement.toLocaleString("fr-FR")} FCFA`}
          value={montantRetourne}
          onChange={(e) => setMontantRetourne(e.target.value)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Le solde éventuellement dépensé (
        {Math.max(0, montantReglement - (Number(montantRetourne) || 0)).toLocaleString("fr-FR")} FCFA) sera transmis
        à l&apos;équipe Finance, qui se chargera elle-même de le classer (justifié ou non, pièce jointe, motif).
      </p>

      {erreur ? <p className="text-sm text-danger">{erreur}</p> : null}

      <div className="flex flex-wrap gap-3">
        <Button type="button" loading={isPending} onClick={handleSubmit}>
          {mode === "edit" ? "Enregistrer les modifications" : "Déclarer le retour"}
        </Button>
        <Button type="button" variant="secondary" disabled={isPending} onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </div>
  );
}
