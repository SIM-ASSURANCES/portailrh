"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input } from "@/components/ui";

import { classerPasUnePrimeCptAction, identifierManuellementCptAction } from "./actions";

export interface EncaissementSansPropositionCpt {
  id: string;
  reference: string;
  dateValeur: string;
  payeur: string;
  telephone: string;
  montant: string;
  /** Reste à rattacher, au format d'affichage et en FCFA entiers (pour pré-remplir les formulaires). */
  reste: string;
  resteBrut: string;
}

type Mode = "identifier" | "pasUnePrime";

/**
 * Encaissements qui attendent encore un contrat (lot GC-5d) : identification manuelle (commercial) ou classement « pas une prime » avec
 * motif écrit (RFCRH). Chaque formulaire n'apparaît que pour le profil qui peut agir ; l'action serveur revérifie le droit.
 */
export function EncaissementsSansProposition({
  rows,
  peutIdentifier,
  peutClasser,
}: {
  rows: EncaissementSansPropositionCpt[];
  peutIdentifier: boolean;
  peutClasser: boolean;
}) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState<{ id: string; mode: Mode } | null>(null);
  const [champs, setChamps] = useState({ police: "", rang: "", montant: "", justification: "", recu: "", motif: "" });
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, startTransition] = useTransition();

  function ouvrir(row: EncaissementSansPropositionCpt, mode: Mode) {
    setErreur(null);
    setChamps({ police: "", rang: "", montant: row.resteBrut, justification: "", recu: "", motif: "" });
    setOuvert(ouvert?.id === row.id && ouvert.mode === mode ? null : { id: row.id, mode });
  }

  function envoyer(row: EncaissementSansPropositionCpt, mode: Mode) {
    setErreur(null);
    startTransition(async () => {
      const r =
        mode === "identifier"
          ? await identifierManuellementCptAction({
              encaissementId: row.id,
              numPolice: champs.police,
              rang: champs.rang,
              montant: champs.montant,
              justification: champs.justification,
              recuReference: champs.recu,
            })
          : await classerPasUnePrimeCptAction(row.id, champs.montant, champs.motif);
      if (r.status === "error") {
        setErreur(r.message);
        toast.error(r.message);
        return;
      }
      toast.success(r.message);
      setOuvert(null);
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return <p className="rounded-lg border border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">Tous les encaissements ont une proposition.</p>;
  }

  const maj = (cle: keyof typeof champs) => (e: React.ChangeEvent<HTMLInputElement>) => setChamps((c) => ({ ...c, [cle]: e.target.value }));
  return (
    <div className="space-y-2" data-sans-proposition>
      {rows.map((r) => (
        <div key={r.id} className="rounded-xl border border-border bg-card p-3 shadow-elevated" data-encaissement-ref={r.reference}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-foreground">
                {r.reference} · <span className="tabular-nums">{r.reste}</span> à rattacher
                {r.reste !== r.montant ? <span className="text-xs font-normal text-muted-foreground"> (sur {r.montant})</span> : null}
              </div>
              <div className="text-xs text-muted-foreground">
                {r.dateValeur} · {r.payeur}
                {r.telephone ? ` · ${r.telephone}` : ""}
              </div>
            </div>
            <div className="flex gap-2">
              {peutIdentifier && (
                <Button type="button" variant="secondary" onClick={() => ouvrir(r, "identifier")} data-identifier-ouvrir>
                  Identifier
                </Button>
              )}
              {peutClasser && (
                <Button type="button" variant="secondary" onClick={() => ouvrir(r, "pasUnePrime")} data-pas-une-prime-ouvrir>
                  Pas une prime
                </Button>
              )}
            </div>
          </div>

          {ouvert?.id === r.id && ouvert.mode === "identifier" && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2" data-identifier-formulaire>
              <Input name="police" label="N° de police" value={champs.police} onChange={maj("police")} disabled={enCours} />
              <Input name="rang" label="Échéance (rang, vide = la plus ancienne ouverte)" value={champs.rang} onChange={maj("rang")} disabled={enCours} />
              <Input name="montant" label="Montant à rattacher (FCFA)" inputMode="numeric" value={champs.montant} onChange={maj("montant")} disabled={enCours} />
              <Input name="recu" label="Référence du reçu (obligatoire)" value={champs.recu} onChange={maj("recu")} disabled={enCours} />
              <div className="sm:col-span-2">
                <Input name="justification" label="Justification (10 caractères au moins)" value={champs.justification} onChange={maj("justification")} disabled={enCours} maxLength={500} />
              </div>
              <div className="sm:col-span-2">
                <Button type="button" loading={enCours} disabled={enCours || champs.police.trim() === "" || champs.recu.trim() === "" || champs.justification.trim().length < 10} onClick={() => envoyer(r, "identifier")} data-identifier-envoyer>
                  Identifier et confirmer
                </Button>
              </div>
            </div>
          )}

          {ouvert?.id === r.id && ouvert.mode === "pasUnePrime" && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2" data-pas-une-prime-formulaire>
              <Input name="montant" label="Montant « pas une prime » (FCFA)" inputMode="numeric" value={champs.montant} onChange={maj("montant")} disabled={enCours} />
              <Input name="motif" label="Motif (obligatoire)" value={champs.motif} onChange={maj("motif")} disabled={enCours} maxLength={300} />
              <div className="sm:col-span-2">
                <Button type="button" loading={enCours} disabled={enCours || champs.motif.trim().length < 5} onClick={() => envoyer(r, "pasUnePrime")} data-pas-une-prime-envoyer>
                  Classer « pas une prime »
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
      {erreur && (
        <p role="alert" data-sans-proposition-erreur className="text-sm text-danger">
          {erreur}
        </p>
      )}
    </div>
  );
}
