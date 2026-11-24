"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge, Button } from "@/components/ui";

import { basculerFormatActifAction, definirFormatParDefautAction, type ResultatSimpleFormat } from "./actions";

export interface FormatRow {
  id: string;
  typeLibelle: string;
  nom: string;
  ligneEntete: number;
  nbColonnes: number;
  parDefaut: boolean;
  actif: boolean;
}

/**
 * Formats d'import existants. Tout le monde qui consulte le module les voit ; les boutons n'apparaissent que pour `cpt.parametrer`
 * (chaque action revérifie le droit côté serveur). Le format par défaut ne se désactive pas : le serveur le refuse avec sa raison.
 */
export function FormatsImport({ rows, peutEcrire }: { rows: FormatRow[]; peutEcrire: boolean }) {
  const router = useRouter();
  const [enCours, startTransition] = useTransition();
  const [idEnCours, setIdEnCours] = useState<string | null>(null);

  function lancer(id: string, action: (formatId: string) => Promise<ResultatSimpleFormat>) {
    setIdEnCours(id);
    startTransition(async () => {
      const r = await action(id);
      if (r.status === "error") toast.error(r.message);
      else {
        toast.success(r.message);
        router.refresh();
      }
      setIdEnCours(null);
    });
  }

  if (rows.length === 0) {
    return <p className="rounded-lg border border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">Aucun format d&apos;import.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-elevated" data-formats-import>
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Nom</th>
            <th className="px-3 py-2">Type de fichier</th>
            <th className="px-3 py-2 text-right">Ligne des en-têtes</th>
            <th className="px-3 py-2 text-right">Colonnes</th>
            <th className="px-3 py-2">État</th>
            {peutEcrire && <th className="px-3 py-2 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.id} className="border-b border-border last:border-0" data-format-nom={f.nom}>
              <td className="px-3 py-2 font-semibold text-foreground">{f.nom}</td>
              <td className="px-3 py-2">{f.typeLibelle}</td>
              <td className="px-3 py-2 text-right tabular-nums">{f.ligneEntete}</td>
              <td className="px-3 py-2 text-right tabular-nums">{f.nbColonnes}</td>
              <td className="space-x-2 whitespace-nowrap px-3 py-2">
                {f.parDefaut && <Badge variant="info">Par défaut</Badge>}
                <Badge variant={f.actif ? "success" : "neutral"}>{f.actif ? "Actif" : "Inactif"}</Badge>
              </td>
              {peutEcrire && (
                <td className="space-x-2 whitespace-nowrap px-3 py-2 text-right">
                  {!f.parDefaut && f.actif && (
                    <Button variant="secondary" type="button" disabled={enCours} loading={enCours && idEnCours === f.id} data-format-defaut onClick={() => lancer(f.id, definirFormatParDefautAction)}>
                      Définir par défaut
                    </Button>
                  )}
                  <Button variant="secondary" type="button" disabled={enCours} data-format-bascule onClick={() => lancer(f.id, basculerFormatActifAction)}>
                    {f.actif ? "Désactiver" : "Réactiver"}
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
