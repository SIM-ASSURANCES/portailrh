"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input } from "@/components/ui";

import { traiterAnomaliesCptAction } from "./actions";

export interface AnomalieRow {
  id: string;
  type: string;
  libelle: string;
  numPolice: string;
  ligne: string;
  message: string;
  date: string;
}

/**
 * Anomalies à traiter de l'import de production (lot GC-3h). Marquer « traitée » enregistre qui l'a examinée, quand et avec quelle
 * conclusion (facultative) : cela ne corrige aucune donnée. Les cases et le bouton n'apparaissent que pour qui peut traiter ; l'action
 * serveur revérifie le droit.
 */
export function AnomaliesProduction({ rows, peutTraiter }: { rows: AnomalieRow[]; peutTraiter: boolean }) {
  const router = useRouter();
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [commentaire, setCommentaire] = useState("");
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

  function traiter() {
    setErreur(null);
    const ids = [...selection];
    startTransition(async () => {
      const r = await traiterAnomaliesCptAction(ids, commentaire);
      if (r.status === "error") {
        setErreur(r.message);
        toast.error(r.message);
        return;
      }
      toast.success(r.message);
      setSelection(new Set());
      setCommentaire("");
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return <p className="rounded-lg border border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">Aucune anomalie à traiter.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-elevated">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {peutTraiter && (
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Tout sélectionner"
                    data-anomalies-tout
                    checked={toutes}
                    onChange={() => setSelection(toutes ? new Set() : new Set(rows.map((r) => r.id)))}
                  />
                </th>
              )}
              <th className="px-3 py-2">Anomalie</th>
              <th className="px-3 py-2">Police</th>
              <th className="px-3 py-2">Ligne</th>
              <th className="px-3 py-2">Détail</th>
              <th className="px-3 py-2">Signalée le</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-b border-border last:border-0" data-anomalie-type={a.type}>
                {peutTraiter && (
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Sélectionner l'anomalie ${a.libelle} de la police ${a.numPolice}`}
                      data-anomalie-case
                      checked={selection.has(a.id)}
                      onChange={() => basculer(a.id)}
                    />
                  </td>
                )}
                <td className="px-3 py-2 font-semibold text-foreground">{a.libelle}</td>
                <td className="whitespace-nowrap px-3 py-2">{a.numPolice}</td>
                <td className="whitespace-nowrap px-3 py-2">{a.ligne}</td>
                <td className="px-3 py-2 text-muted-foreground">{a.message}</td>
                <td className="whitespace-nowrap px-3 py-2">{a.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {peutTraiter && (
        <div className="flex flex-wrap items-end gap-3" data-anomalies-traiter>
          <div className="min-w-64 flex-1">
            <Input
              name="commentaire"
              label="Commentaire (facultatif)"
              placeholder="Ex. partenaire créé depuis, ligne corrigée dans le prochain bordereau…"
              maxLength={500}
              value={commentaire}
              onChange={(e) => setCommentaire(e.target.value)}
              disabled={enCours}
            />
          </div>
          <Button type="button" onClick={traiter} disabled={selection.size === 0 || enCours} loading={enCours} data-anomalies-bouton>
            {selection.size === 0 ? "Marquer traitées" : `Marquer traitées (${selection.size})`}
          </Button>
        </div>
      )}
      {erreur && (
        <p role="alert" data-anomalies-erreur className="text-sm text-danger">
          {erreur}
        </p>
      )}
    </div>
  );
}
