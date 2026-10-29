"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui";

import { desactiverComptesDeTestAction } from "./actions";

export interface CompteTestAffiche {
  id: string;
  fullName: string;
  email: string;
  roleName: string;
  /** `null` : peut être désactivé ; sinon la raison pour laquelle il ne peut pas l'être. */
  refus: string | null;
}

/**
 * Après la remise à zéro : liste des comptes de test encore actifs et bouton « Désactiver les comptes de test » (Admin ou
 * DG). Liste et confirmation avant d'agir ; on désactive, on ne supprime jamais. Le serveur recalcule ce qui est permis.
 */
export function ComptesDeTestPanel({ comptes }: { comptes: CompteTestAffiche[] }) {
  const router = useRouter();
  const desactivables = comptes.filter((c) => c.refus === null);
  const [choisis, setChoisis] = useState<Set<string>>(() => new Set(desactivables.map((c) => c.id)));
  const [confirmation, setConfirmation] = useState(false);
  const [refusServeur, setRefusServeur] = useState<Array<{ email: string; raison: string }>>([]);
  const [isPending, startTransition] = useTransition();

  function basculer(id: string) {
    setChoisis((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    setConfirmation(false);
  }

  function desactiver() {
    startTransition(async () => {
      const r = await desactiverComptesDeTestAction([...choisis], true);
      setRefusServeur(r.refuses ?? []);
      if (r.status === "success") toast.success(r.message);
      else toast.error(r.message);
      setConfirmation(false);
      router.refresh();
    });
  }

  if (comptes.length === 0) {
    return (
      <p className="rounded-md bg-success-bg px-3 py-3 text-sm text-success" data-aucun-compte-test>
        Aucun compte de test actif (<code>*@simassurances.test</code>).
      </p>
    );
  }

  const selection = comptes.filter((c) => choisis.has(c.id));

  return (
    <div className="space-y-3" data-comptes-test>
      <p className="text-sm text-muted-foreground">
        Comptes de test encore <strong>actifs</strong> (<code>*@simassurances.test</code>). Ils sont <strong>désactivés</strong>, jamais supprimés :
        la connexion devient impossible et les sessions en cours sont coupées. Le compte avec lequel vous êtes connecté, un responsable de
        service et le dernier compte qui porte la remise à zéro ne peuvent pas être désactivés.
      </p>
      <ul className="divide-y divide-border rounded-md border border-border">
        {comptes.map((c) => (
          <li key={c.id} className="flex flex-wrap items-start gap-3 px-3 py-2 text-sm" data-compte-test={c.email}>
            <input
              type="checkbox"
              className="mt-1 size-4"
              checked={choisis.has(c.id)}
              disabled={c.refus !== null || isPending}
              onChange={() => basculer(c.id)}
              aria-label={`Désactiver ${c.email}`}
            />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">
                {c.fullName} <span className="font-normal text-muted-foreground">— {c.email} ({c.roleName})</span>
              </p>
              {c.refus ? (
                <p className="text-xs text-warning" data-refus-compte={c.email}>
                  Ne peut pas être désactivé maintenant : {c.refus}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {!confirmation ? (
        <Button type="button" variant="danger" disabled={selection.length === 0 || isPending} onClick={() => setConfirmation(true)} data-action="desactiver-comptes-test">
          Désactiver les comptes de test
        </Button>
      ) : (
        <div className="space-y-2 rounded-md border border-danger/40 bg-danger-bg p-3 text-sm text-danger" data-confirmation-desactivation>
          <p className="font-semibold">Confirmer la désactivation de {selection.length} compte(s) ?</p>
          <ul className="list-disc pl-5 text-xs">
            {selection.map((c) => (
              <li key={c.id}>{c.email}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button type="button" variant="danger" loading={isPending} onClick={desactiver} data-action="confirmer-desactivation">
              Oui, désactiver ces comptes
            </Button>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => setConfirmation(false)}>
              Annuler
            </Button>
          </div>
        </div>
      )}

      {refusServeur.length > 0 ? (
        <ul className="space-y-1 text-xs text-warning" data-refus-serveur>
          {refusServeur.map((r) => (
            <li key={r.email}>
              {r.email} : {r.raison}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
