"use client";

import { useState } from "react";

import { Badge, Button } from "@/components/ui";
import { JUSTIFICATION_LABEL } from "@/components/tresorerie/justification";
import type { TypeJustification } from "@/generated/prisma/client";

import { RetourCaisseForm } from "./RetourCaisseForm";

export interface DepenseLigneData {
  id: string;
  montant: number;
  objet: string;
  date: Date;
  nature: string | null;
  justification: TypeJustification;
  commentaire: string | null;
  pieceJointeId: string | null;
}

export interface RetourCaisseRowData {
  reglementId: string;
  montant: number;
  retour:
    | {
        id: string;
        estReceptionne: boolean;
        montantARetourner: number;
        /** Non réceptionné, demande non clôturée, ET utilisateur connecté = déclarant original. */
        peutModifier: boolean;
        depenses: DepenseLigneData[];
      }
    | null;
  /** Masque le bouton de déclaration une fois la demande clôturée (Ticket 7). */
  peutDeclarer: boolean;
}

/**
 * Détail des lignes de dépenses d'un retour déjà déclaré (Phase D, "fonds
 * remis") — remplace l'ancien affichage à un seul montant/justification
 * (Ticket 5). Le montant non justifié (lignes `SANS_PIECE`) est mis en
 * évidence avec les couleurs d'alerte de la charte (`text-warning`), même
 * convention que le reste du projet (reste à régler, écart de
 * régularisation...).
 */
function DetailDepenses({ depenses, montantARetourner }: { depenses: DepenseLigneData[]; montantARetourner: number }) {
  const totalDeclare = depenses.reduce((sum, d) => sum + d.montant, 0);
  const montantNonJustifie = depenses
    .filter((d) => d.justification === "SANS_PIECE")
    .reduce((sum, d) => sum + d.montant, 0);

  return (
    <div className="animate-fade-in-up space-y-3 border-t border-border pt-3">
      <ul className="space-y-2">
        {depenses.map((d) => (
          <li key={d.id} className="rounded-md bg-muted p-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-foreground">
                {d.objet} — {d.montant.toLocaleString("fr-FR")} FCFA
              </span>
              <span className="text-xs text-muted-foreground">
                {d.date.toLocaleDateString("fr-FR")} — {JUSTIFICATION_LABEL[d.justification]}
              </span>
            </div>
            {d.nature ? <p className="mt-1 text-xs text-muted-foreground">{d.nature}</p> : null}
            {d.commentaire ? <p className="mt-1 text-xs text-foreground">{d.commentaire}</p> : null}
            {d.pieceJointeId ? (
              <a
                href={`/api/treso/pieces-jointes/${d.pieceJointeId}`}
                className="mt-1 inline-block text-xs text-info underline-offset-4 hover:text-primary hover:underline"
              >
                Télécharger la pièce jointe
              </a>
            ) : null}
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total déclaré</dt>
          <dd className="text-sm font-semibold text-foreground">{totalDeclare.toLocaleString("fr-FR")} FCFA</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">À retourner</dt>
          <dd className="text-sm font-semibold text-foreground">{montantARetourner.toLocaleString("fr-FR")} FCFA</dd>
        </div>
        {montantNonJustifie > 0 ? (
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Non justifié</dt>
            <dd className="text-sm font-semibold text-warning">{montantNonJustifie.toLocaleString("fr-FR")} FCFA</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
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
 * mais le toast de succès n'apparaissait jamais. En ne conditionnant la
 * présence du formulaire qu'à l'état local `formOpen`, celui-ci reste
 * monté le temps de committer son propre état "success" (toast +
 * `onSuccess()` qui referme le formulaire au rendu suivant) — même
 * principe que `ReglementForm.tsx`, où le formulaire ne se démonte jamais
 * de l'extérieur.
 */
export function RetourCaisseRow({ reglementId, montant, retour, peutDeclarer }: RetourCaisseRowData) {
  const [formOpen, setFormOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);

  return (
    <li className="space-y-3 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium text-foreground">{montant.toLocaleString("fr-FR")} FCFA — Caisse</p>
        {formOpen ? null : retour ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={retour.estReceptionne ? "success" : "warning"}>
              {retour.estReceptionne ? "Réceptionné" : "En attente de réception"}
            </Badge>
            {retour.peutModifier ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditMode(true);
                  setFormOpen(true);
                }}
              >
                Modifier
              </Button>
            ) : null}
          </div>
        ) : peutDeclarer ? (
          // Couleur primaire (Tâche navigation/UX) : seule action possible
          // sur ce règlement tant qu'aucun retour n'est déclaré — même
          // principe que "Ajouter un règlement".
          <Button
            type="button"
            onClick={() => {
              setEditMode(false);
              setFormOpen(true);
            }}
          >
            Déclarer un retour de caisse
          </Button>
        ) : (
          <Badge variant="neutral">Non déclaré</Badge>
        )}
      </div>

      {formOpen && editMode && retour ? (
        <RetourCaisseForm
          mode="edit"
          reglementId={reglementId}
          retourId={retour.id}
          montantReglement={montant}
          lignesInitiales={retour.depenses.map((d) => ({
            id: d.id,
            montant: d.montant,
            objet: d.objet,
            date: d.date.toISOString().slice(0, 10),
            nature: d.nature ?? "",
            justification: d.justification,
            commentaire: d.commentaire ?? "",
          }))}
          onCancel={() => setFormOpen(false)}
          onSuccess={() => setFormOpen(false)}
        />
      ) : formOpen ? (
        <RetourCaisseForm
          reglementId={reglementId}
          montantReglement={montant}
          onCancel={() => setFormOpen(false)}
          onSuccess={() => setFormOpen(false)}
        />
      ) : retour ? (
        <DetailDepenses depenses={retour.depenses} montantARetourner={retour.montantARetourner} />
      ) : null}
    </li>
  );
}
