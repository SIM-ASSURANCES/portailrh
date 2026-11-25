"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input } from "@/components/ui";

import { declarerMoisTcaAction, enregistrerPaiementTcaAction, rattraperTaxesManquantesAction, taxerEncaissementAction, type ResultatTcaAction } from "./actions";

function useAction() {
  const router = useRouter();
  const [enCours, startTransition] = useTransition();
  function lancer(appel: () => Promise<ResultatTcaAction>, surResultat?: (r: ResultatTcaAction) => void) {
    startTransition(async () => {
      const r = await appel();
      if (r.status === "error") toast.error(r.message);
      else toast.success(r.message);
      surResultat?.(r);
      router.refresh();
    });
  }
  return { enCours, lancer };
}

/** « Déclarer le mois » : fige le calcul et verrouille les lignes (cpt.declarer_tca). */
export function DeclarerMoisBouton({ mois, raison }: { mois: string; raison: string | null }) {
  const { enCours, lancer } = useAction();
  return (
    <div>
      <Button type="button" data-declarer-mois onClick={() => lancer(() => declarerMoisTcaAction(mois))} loading={enCours} disabled={enCours || raison !== null}>
        Déclarer le mois
      </Button>
      {raison && (
        <p data-declaration-impossible className="mt-2 text-sm text-foreground">
          {raison}
        </p>
      )}
    </div>
  );
}

/** Paiement et quittance d'une déclaration (cpt.payer_tca). */
export function PaiementForm({ declarationId, montantAPayer, aujourdhui }: { declarationId: string; montantAPayer: string; aujourdhui: string }) {
  const { enCours, lancer } = useAction();
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  function envoyer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const saisie = Object.fromEntries(["quittanceNumero", "quittanceDate", "quittanceMontant", "datePaiement", "pieceOdoo"].map((k) => [k, String(f.get(k) ?? "")]));
    lancer(
      () => enregistrerPaiementTcaAction(declarationId, saisie),
      (r) => setErreurs(r.status === "error" ? (r.erreurs ?? {}) : {}),
    );
  }
  return (
    <form onSubmit={envoyer} data-paiement-tca className="grid gap-3 sm:grid-cols-2">
      <Input name="quittanceNumero" label="Numéro de la quittance" required error={erreurs.quittanceNumero} />
      <Input name="quittanceDate" label="Date de la quittance" type="date" max={aujourdhui} defaultValue={aujourdhui} required error={erreurs.quittanceDate} />
      <Input name="quittanceMontant" label="Montant payé (FCFA)" inputMode="decimal" defaultValue={montantAPayer} required error={erreurs.quittanceMontant} />
      <Input name="datePaiement" label="Date du paiement" type="date" max={aujourdhui} defaultValue={aujourdhui} required error={erreurs.datePaiement} />
      <Input name="pieceOdoo" label="Pièce comptable (Odoo, facultatif)" />
      <div className="flex items-end">
        <Button type="submit" loading={enCours} disabled={enCours}>
          Enregistrer le paiement
        </Button>
      </div>
    </form>
  );
}

/** Rejoue la taxe des rattachements validés sans taux (une fois le taux saisi dans les référentiels). */
export function RattraperBouton() {
  const { enCours, lancer } = useAction();
  return (
    <Button type="button" variant="secondary" data-rattraper-taxes onClick={() => lancer(() => rattraperTaxesManquantesAction())} loading={enCours} disabled={enCours}>
      Recalculer les taxes manquantes
    </Button>
  );
}

/** Avance de taxe sur un encaissement : par produit (sans contrat) ou par numéro de police (contrat pas encore rattaché). */
export function AvanceForm() {
  const { enCours, lancer } = useAction();
  function envoyer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const texte = (k: string) => String(f.get(k) ?? "");
    lancer(() => taxerEncaissementAction({ reference: texte("reference"), numPolice: texte("numPolice"), produitCode: texte("produitCode"), natureContrat: texte("natureContrat") }));
  }
  return (
    <form onSubmit={envoyer} data-avance-taxe className="grid gap-3 sm:grid-cols-2">
      <Input name="reference" label="Référence de l'encaissement" placeholder="CPE-2026-000123" required />
      <Input name="produitCode" label="Produit (sans contrat)" placeholder="INDIVIDUELLE-CONDUCTEUR" />
      <Input name="numPolice" label="OU numéro de police (contrat pas encore rattaché)" />
      <div>
        <label className="mb-1 block text-sm font-semibold text-foreground" htmlFor="natureContrat">
          Nature du contrat (si le taux en dépend)
        </label>
        <select id="natureContrat" name="natureContrat" defaultValue="" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          <option value="">—</option>
          <option value="INDIVIDUEL">Individuel</option>
          <option value="GROUPE">Groupe</option>
        </select>
      </div>
      <div className="flex items-end">
        <Button type="submit" loading={enCours} disabled={enCours}>
          Calculer la taxe
        </Button>
      </div>
    </form>
  );
}
