"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge, Button, Card } from "@/components/ui";

import { creerFormatReleveProposeAction } from "./actions";

export interface TypeReleveRow {
  type: string;
  libelle: string;
  /** Nombre de formats déjà enregistrés pour ce type (actifs ou non). */
  nbFormats: number;
}

/**
 * Formats de relevé : un relevé ne s'importe qu'avec un format par défaut. Aucun vrai relevé n'a encore été fourni (question Q6) :
 * la Finance peut enregistrer un MODÈLE PROPOSÉ par type, bâti sur les colonnes décrites par le plan, puis le corriger. Le bouton
 * n'apparaît que pour un type sans aucun format ; l'action serveur revérifie le droit et refuse d'écraser un format existant.
 */
export function FormatsRelevesProposes({ types, peutEcrire }: { types: TypeReleveRow[]; peutEcrire: boolean }) {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, startTransition] = useTransition();
  const [type, setType] = useState<string | null>(null);

  function creer(t: string) {
    setErreur(null);
    setType(t);
    startTransition(async () => {
      const r = await creerFormatReleveProposeAction(t);
      if (r.status === "error") {
        setErreur(r.message);
        toast.error(r.message);
        return;
      }
      toast.success(r.message);
      router.refresh();
    });
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 data-formats-releves className="text-base font-bold text-foreground">
          Formats de relevé
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Chaque type de relevé a besoin d&apos;un format par défaut pour être importé. Le modèle proposé est <strong>provisoire</strong> : il repose sur les colonnes
          décrites par le plan, pas sur un vrai relevé. Vérifiez-le avec un relevé réel avant la mise en service.
        </p>
      </div>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {types.map((t) => (
          <li key={t.type} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-format-releve-type={t.type}>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-foreground">{t.libelle}</span>
              {t.nbFormats > 0 ? <Badge variant="success">Format enregistré</Badge> : <Badge variant="warning">Aucun format</Badge>}
            </div>
            {t.nbFormats === 0 && peutEcrire && (
              <Button type="button" variant="secondary" onClick={() => creer(t.type)} disabled={enCours} loading={enCours && type === t.type} data-format-releve-creer>
                Créer le format proposé
              </Button>
            )}
          </li>
        ))}
      </ul>
      {erreur && (
        <p role="alert" data-formats-releves-erreur className="text-sm text-danger">
          {erreur}
        </p>
      )}
    </Card>
  );
}
