"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button, Input } from "@/components/ui";
import { ajusterSoldeAction, initialiserSoldesAction, modifierDateEmbaucheAction } from "../actions";

/** Crée les soldes de l'exercice en cours pour tous les comptes dont la date d'embauche est connue. */
export function InitialiserSoldesBouton() {
  const [enCours, demarrer] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      loading={enCours}
      onClick={() =>
        demarrer(async () => {
          const r = await initialiserSoldesAction();
          if (r.status === "success") {
            toast.success(r.message ?? "Soldes initialisés.");
            router.refresh();
          } else if (r.status === "error") toast.error(r.message);
        })
      }
    >
      Initialiser les soldes de l&apos;exercice
    </Button>
  );
}

/** Saisie de la date d'embauche d'un compte (point de départ de son exercice de congé). */
export function DateEmbaucheForm({ userId, valeur }: { userId: string; valeur: string }) {
  const [date, setDate] = useState(valeur);
  const [erreur, setErreur] = useState<string | undefined>();
  const [enCours, demarrer] = useTransition();
  const router = useRouter();
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        setErreur(undefined);
        demarrer(async () => {
          const r = await modifierDateEmbaucheAction(userId, date === "" ? null : date);
          if (r.status === "success") {
            toast.success(r.message ?? "Date enregistrée.");
            router.refresh();
          } else if (r.status === "error") {
            setErreur(r.fieldErrors?.date ?? r.message);
            toast.error(r.message);
          }
        });
      }}
    >
      <Input label="Date d'embauche" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={erreur} />
      <Button type="submit" variant="primary" loading={enCours} disabled={date === valeur}>
        Enregistrer
      </Button>
    </form>
  );
}

/** Ajustement manuel d'un solde (positif = ajout, négatif = retrait), motif obligatoire et tracé. */
export function AjustementSoldeForm({ soldeCongeId }: { soldeCongeId: string }) {
  const [ouvert, setOuvert] = useState(false);
  const [montant, setMontant] = useState("");
  const [motif, setMotif] = useState("");
  const [erreurs, setErreurs] = useState<Partial<Record<string, string>>>({});
  const [enCours, demarrer] = useTransition();
  const router = useRouter();

  if (!ouvert) {
    return (
      <Button variant="secondary" onClick={() => setOuvert(true)}>
        Ajuster le solde
      </Button>
    );
  }

  const valeur = Number(montant);
  const valide = montant.trim() !== "" && Number.isInteger(valeur) && valeur !== 0 && motif.trim().length >= 5;

  return (
    <form
      className="space-y-3 border-t border-border pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        setErreurs({});
        demarrer(async () => {
          const r = await ajusterSoldeAction({ soldeCongeId, montant: valeur, motif });
          if (r.status === "success") {
            toast.success(r.message ?? "Solde ajusté.");
            setOuvert(false);
            setMontant("");
            setMotif("");
            router.refresh();
          } else if (r.status === "error") {
            setErreurs(r.fieldErrors ?? {});
            toast.error(r.message);
          }
        });
      }}
    >
      <Input label="Ajustement (jours)" type="number" step={1} value={montant} onChange={(e) => setMontant(e.target.value)} hint="Positif pour ajouter, négatif pour retirer." error={erreurs.montant} />
      <Input label="Motif" value={motif} onChange={(e) => setMotif(e.target.value)} hint="5 caractères minimum, conservé dans l'historique." error={erreurs.motif} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" variant="primary" loading={enCours} disabled={!valide}>
          Enregistrer l&apos;ajustement
        </Button>
        <Button type="button" variant="secondary" disabled={enCours} onClick={() => setOuvert(false)}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
