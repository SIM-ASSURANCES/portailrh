"use client";

import { useState } from "react";

import { Badge, Button } from "@/components/ui";

import { RetourCaisseForm } from "./RetourCaisseForm";

export interface RetourCaisseRowData {
  reglementId: string;
  montant: number;
  retour: { estReceptionne: boolean } | null;
  /** Masque le bouton de déclaration une fois la demande clôturée (Ticket 7). */
  peutDeclarer: boolean;
}

/**
 * Une ligne "règlement Caisse éligible" de la section Retours de caisse.
 *
 * Le bouton de déclaration disparaît dès qu'un retour existe pour ce
 * règlement (`retour !== null`), quel que soit son statut de réception —
 * V1 volontairement simple : un seul retour déclaré par règlement (choix
 * documenté dans CLAUDE.md).
 *
 * `formOpen` (état local) est toujours vérifié EN PREMIER dans les deux
 * blocs JSX ci-dessous, avant `retour` : la requête d'une Server Action
 * renvoie son nouvel état ET le payload RSC rafraîchi (donc un `retour`
 * non nul) dans le même aller-retour, donc les deux arrivent dans la même
 * transition React. Si le rendu du formulaire dépendait de `!retour`, le
 * composant `RetourCaisseForm` serait démonté par ce même rafraîchissement
 * avant même que son état interne ne commette la valeur "success" —
 * constaté en vérification manuelle : le retour était bien créé en base,
 * mais le toast de succès n'apparaissait jamais, et le `useEffect` de
 * `RetourCaisseForm` ne voyait jamais l'état "success". En ne conditionnant
 * la présence du formulaire qu'à l'état local `formOpen`, celui-ci reste
 * monté le temps de committer son propre état "success" (toast +
 * `onSuccess()` qui referme le formulaire au rendu suivant) — même
 * principe que `ReglementForm.tsx`, où le formulaire ne se démonte jamais
 * de l'extérieur.
 */
export function RetourCaisseRow({ reglementId, montant, retour, peutDeclarer }: RetourCaisseRowData) {
  const [formOpen, setFormOpen] = useState(false);

  return (
    <li className="space-y-3 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium text-foreground">{montant.toLocaleString("fr-FR")} FCFA — Caisse</p>
        {formOpen ? null : retour ? (
          <Badge variant={retour.estReceptionne ? "success" : "warning"}>
            {retour.estReceptionne ? "Réceptionné" : "En attente de réception"}
          </Badge>
        ) : peutDeclarer ? (
          <Button type="button" variant="secondary" onClick={() => setFormOpen(true)}>
            Déclarer un retour de caisse
          </Button>
        ) : (
          <Badge variant="neutral">Non déclaré</Badge>
        )}
      </div>

      {formOpen ? (
        <RetourCaisseForm
          reglementId={reglementId}
          onCancel={() => setFormOpen(false)}
          onSuccess={() => setFormOpen(false)}
        />
      ) : null}
    </li>
  );
}
