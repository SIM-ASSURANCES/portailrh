"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input } from "@/components/ui";

import { confirmerRattachementsCptAction, rejeterRattachementsCptAction, validerRattachementsCptAction } from "./actions";

export interface LigneRattachementCpt {
  id: string;
  groupe: string | null;
  encaissement: string;
  dateValeur: string;
  payeur: string;
  police: string;
  client: string;
  rang: number;
  montant: string;
  methode: string;
  niveau: string;
  justification: string;
  /** Reçu et auteur de la confirmation (étape 2 seulement). */
  recu: string | null;
  confirmePar: string | null;
}

/**
 * Rattachements à traiter (lot GC-5d). Mode « confirmer » : le commercial joint le reçu (étape 1). Mode « valider » : le RFCRH valide ou
 * rejette avec motif (étape 2). Un groupe (méthode 4) se traite d'un bloc : cocher un de ses membres suffit. Les boutons n'apparaissent
 * que pour qui a le droit ; les actions serveur le revérifient.
 */
export function TableRattachements({ mode, rows, peutAgir }: { mode: "confirmer" | "valider"; rows: LigneRattachementCpt[]; peutAgir: boolean }) {
  const router = useRouter();
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [recu, setRecu] = useState("");
  const [commentaire, setCommentaire] = useState("");
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, startTransition] = useTransition();

  const toutes = rows.length > 0 && rows.every((r) => selection.has(r.id));

  function basculer(id: string) {
    setSelection((precedente) => {
      const suivante = new Set(precedente);
      if (suivante.has(id)) suivante.delete(id);
      else suivante.add(id);
      return suivante;
    });
  }

  function executer(action: () => Promise<{ status: "success" | "error"; message: string }>, apres: () => void = () => {}) {
    setErreur(null);
    startTransition(async () => {
      const r = await action();
      if (r.status === "error") {
        setErreur(r.message);
        toast.error(r.message);
        return;
      }
      toast.success(r.message);
      setSelection(new Set());
      apres();
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground" data-rattachements-vide={mode}>
        {mode === "confirmer" ? "Aucune proposition à confirmer." : "Aucun rattachement à valider."}
      </p>
    );
  }

  const ids = [...selection];
  return (
    <div className="space-y-3" data-rattachements-table={mode}>
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-elevated">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {peutAgir && (
                <th className="w-10 px-3 py-2">
                  <input type="checkbox" aria-label="Tout sélectionner" checked={toutes} onChange={() => setSelection(toutes ? new Set() : new Set(rows.map((r) => r.id)))} />
                </th>
              )}
              <th className="px-3 py-2">Encaissement</th>
              <th className="px-3 py-2">Contrat</th>
              <th className="px-3 py-2 text-right">Montant</th>
              <th className="px-3 py-2">Méthode</th>
              <th className="px-3 py-2">Pourquoi</th>
              {mode === "valider" && <th className="px-3 py-2">Confirmé par</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border align-top last:border-0" data-rattachement-id={r.id} data-rattachement-police={r.police}>
                {peutAgir && (
                  <td className="px-3 py-2">
                    <input type="checkbox" aria-label={`Sélectionner le rattachement ${r.encaissement} vers ${r.police}`} checked={selection.has(r.id)} onChange={() => basculer(r.id)} />
                  </td>
                )}
                <td className="px-3 py-2">
                  <div className="font-semibold text-foreground">{r.encaissement}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.dateValeur} · {r.payeur}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="whitespace-nowrap font-semibold text-foreground">{r.police}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.client} · échéance {r.rang}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{r.montant}</td>
                <td className="px-3 py-2">
                  <div>{r.methode}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.niveau}
                    {r.groupe ? " · groupe" : ""}
                  </div>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{r.justification}</td>
                {mode === "valider" && (
                  <td className="px-3 py-2 text-xs">
                    {r.confirmePar ? (
                      <>
                        <div>{r.confirmePar}</div>
                        <div className="text-muted-foreground">Reçu : {r.recu}</div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Preuve : pas de confirmation requise</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {peutAgir && mode === "confirmer" && (
        <div className="flex flex-wrap items-end gap-3" data-rattachements-confirmer>
          <div className="min-w-56 flex-1">
            <Input name="recu" label="Référence du reçu (obligatoire)" placeholder="Ex. REÇU-0042" maxLength={120} value={recu} onChange={(e) => setRecu(e.target.value)} disabled={enCours} />
          </div>
          <div className="min-w-56 flex-1">
            <Input name="commentaire" label="Commentaire (facultatif)" maxLength={500} value={commentaire} onChange={(e) => setCommentaire(e.target.value)} disabled={enCours} />
          </div>
          <Button
            type="button"
            loading={enCours}
            disabled={ids.length === 0 || recu.trim() === "" || enCours}
            data-rattachements-bouton-confirmer
            onClick={() =>
              executer(
                () => confirmerRattachementsCptAction(ids, recu, commentaire),
                () => {
                  setRecu("");
                  setCommentaire("");
                },
              )
            }
          >
            {ids.length === 0 ? "Confirmer" : `Confirmer (${ids.length})`}
          </Button>
        </div>
      )}

      {peutAgir && mode === "valider" && (
        <div className="flex flex-wrap items-end gap-3" data-rattachements-valider>
          <Button type="button" loading={enCours} disabled={ids.length === 0 || enCours} data-rattachements-bouton-valider onClick={() => executer(() => validerRattachementsCptAction(ids))}>
            {ids.length === 0 ? "Valider" : `Valider (${ids.length})`}
          </Button>
          <div className="min-w-56 flex-1">
            <Input name="motif" label="Motif du rejet (obligatoire pour rejeter)" maxLength={300} value={motif} onChange={(e) => setMotif(e.target.value)} disabled={enCours} />
          </div>
          <Button
            type="button"
            variant="secondary"
            loading={enCours}
            disabled={ids.length === 0 || motif.trim().length < 3 || enCours}
            data-rattachements-bouton-rejeter
            onClick={() => executer(() => rejeterRattachementsCptAction(ids, motif), () => setMotif(""))}
          >
            {ids.length === 0 ? "Rejeter" : `Rejeter (${ids.length})`}
          </Button>
        </div>
      )}
      {erreur && (
        <p role="alert" data-rattachements-erreur className="text-sm text-danger">
          {erreur}
        </p>
      )}
    </div>
  );
}
