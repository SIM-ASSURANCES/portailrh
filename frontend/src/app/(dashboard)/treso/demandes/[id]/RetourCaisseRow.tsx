"use client";

import { useState } from "react";

import { Badge, Button } from "@/components/ui";
import type { TypeJustification } from "backend";

import { RetourCaisseForm } from "./RetourCaisseForm";
import { SignalerErreurRetour } from "./SignalerErreurRetour";

export interface DepenseLigneData {
  id: string;
  montant: number;
  objet: string;
  date: Date;
  nature: string | null;
  justification: TypeJustification;
  commentaire: string | null;
  pieceJointeId: string | null;
  /** Motif Finance si la ligne est marquée non justifiée — voir CLAUDE.md
   * "Le Collaborateur voit le détail réel, pas le générique" : jamais
   * affiché avant cette tâche côté Collaborateur. */
  motifNonJustifie: string | null;
  motifNonJustifiePar: string | null;
}

export interface RetourData {
  id: string;
  estReceptionne: boolean;
  montantARetourner: number;
  /** Renseignée uniquement pour une déclaration via le formulaire
   * simplifié ("date + montant") — `null` pour une déclaration
   * détaillée, où chaque `DepenseLigne` porte déjà sa propre date. */
  dateRetour: Date | null;
  /** `true` si créé par l'Assistant Finance plutôt que par le
   * collaborateur — voir CLAUDE.md "L'Assistant Finance déclare les
   * dépenses...". Affiché comme une simple précision, jamais comme un
   * blocage : ses pièces jointes restent consultables comme n'importe
   * quel autre retour. */
  creeParAssistant: boolean;
  /** Non réceptionné, demande non clôturée, ET utilisateur connecté = déclarant original. */
  peutModifier: boolean;
  depenses: DepenseLigneData[];
  /** Signalement d'erreur ACTIF (non résolu) sur ce retour, le cas échéant
   * — voir CLAUDE.md "Signalement d'erreur par le Collaborateur". */
  signalementActif: { commentaire: string } | null;
}

export interface RetourCaisseRowData {
  reglementId: string;
  montant: number;
  /** Tous les retours déjà créés sur ce règlement (voir CLAUDE.md "Retours
   * multiples autorisés sur une même demande") — un règlement peut
   * désormais en porter plusieurs, jamais un seul figé. */
  retours: RetourData[];
  /** Masque le bouton de déclaration une fois la demande clôturée (Ticket 7). */
  peutDeclarer: boolean;
  /** Date plancher (`YYYY-MM-DD`) pour le champ "Date du retour" du
   * formulaire simplifié — voir CLAUDE.md "Libellés et validations sur le
   * formulaire de retour". */
  dateMin?: string;
}

/**
 * Détail des lignes de dépenses d'un retour déjà déclaré (Phase D, "fonds
 * remis") — remplace l'ancien affichage à un seul montant/justification
 * (Ticket 5). Le montant non justifié (lignes `SANS_PIECE`) est mis en
 * évidence avec les couleurs d'alerte de la charte (`text-warning`), même
 * convention que le reste du projet (reste à régler, écart de
 * régularisation...).
 *
 * **Détail réel, pas le générique** (voir CLAUDE.md "Le Collaborateur voit
 * le détail réel, pas le générique") — affiche pour chaque ligne, en
 * LECTURE SEULE : son libellé réel (`objet`, déjà le cas — reste "Dépenses
 * non détaillées" tant que l'Assistant n'a pas encore détaillé), sa pièce
 * jointe téléchargeable OU la mention EXPLICITE "Aucune pièce jointe
 * fournie." (jamais un silence muet), et son statut justifié/non justifié
 * avec motif Finance si applicable (`motifNonJustifie`, jamais affiché
 * avant cette tâche côté Collaborateur).
 */
function DetailDepenses({
  depenses,
  montantARetourner,
  dateRetour,
}: {
  depenses: DepenseLigneData[];
  montantARetourner: number;
  dateRetour: Date | null;
}) {
  const totalDeclare = depenses.reduce((sum, d) => sum + d.montant, 0);
  const montantNonJustifie = depenses
    .filter((d) => d.justification === "SANS_PIECE")
    .reduce((sum, d) => sum + d.montant, 0);

  return (
    <div className="animate-fade-in-up space-y-3 border-t border-border pt-3">
      {dateRetour ? (
        <p className="text-xs text-muted-foreground">
          Déclaration simplifiée — retour du {dateRetour.toLocaleDateString("fr-FR")}.
        </p>
      ) : null}
      <ul className="space-y-2">
        {depenses.map((d) => (
          <li key={d.id} className="rounded-md bg-muted p-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-foreground">
                {d.objet} — {d.montant.toLocaleString("fr-FR")} FCFA
              </span>
              <span className="text-xs text-muted-foreground">{d.date.toLocaleDateString("fr-FR")}</span>
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
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">Aucune pièce jointe fournie.</p>
            )}
            {d.justification !== "SANS_PIECE" ? (
              <p className="mt-1 text-xs text-success">Justifiée.</p>
            ) : d.motifNonJustifie ? (
              <p className="mt-1 text-xs text-warning">
                Non justifiée{d.motifNonJustifiePar ? ` (${d.motifNonJustifiePar})` : ""} : {d.motifNonJustifie}
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">Détail non encore renseigné par l&apos;équipe Finance.</p>
            )}
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total dépensé</dt>
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
 * Un retour déjà déclaré sur ce règlement — badge de statut + détail des
 * dépenses, avec un bouton "Modifier" réservé au déclarant original tant
 * qu'il n'est pas réceptionné.
 */
function RetourExistant({
  retour,
  reglementId,
  montant,
}: {
  retour: RetourData;
  reglementId: string;
  montant: number;
}) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <li className="space-y-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={retour.estReceptionne ? "success" : "warning"}>
            {retour.estReceptionne ? "Réceptionné" : "En attente de réception"}
          </Badge>
          {retour.creeParAssistant ? <Badge variant="info">Déclaré par l&apos;Assistant Finance</Badge> : null}
        </div>
        {retour.peutModifier && !editOpen ? (
          <Button type="button" variant="secondary" onClick={() => setEditOpen(true)}>
            Modifier
          </Button>
        ) : null}
      </div>
      {editOpen ? (
        <RetourCaisseForm
          mode="edit"
          reglementId={reglementId}
          retourId={retour.id}
          montantReglement={montant}
          montantRetourneInitial={retour.montantARetourner}
          dateRetourInitiale={retour.dateRetour ? retour.dateRetour.toISOString().slice(0, 10) : undefined}
          onCancel={() => setEditOpen(false)}
          onSuccess={() => setEditOpen(false)}
        />
      ) : (
        <>
          <DetailDepenses
            depenses={retour.depenses}
            montantARetourner={retour.montantARetourner}
            dateRetour={retour.dateRetour}
          />
          <div className="border-t border-border pt-2">
            <SignalerErreurRetour
              retourId={retour.id}
              signalementActifCommentaire={retour.signalementActif?.commentaire ?? null}
            />
          </div>
        </>
      )}
    </li>
  );
}

/**
 * Une ligne "règlement Caisse éligible" de la section Retours de caisse.
 *
 * **Retours multiples** (voir CLAUDE.md "Retours multiples autorisés sur
 * une même demande") — affiche désormais la liste COMPLÈTE des retours déjà
 * créés sur ce règlement (`retours`, jamais un seul figé), puis le bouton
 * "Déclarer un nouveau retour de caisse" tant qu'AUCUN d'entre eux n'est
 * encore en attente de réception (`aUnRetourEnAttente`) — même règle que
 * `creerRetourCaisseAction` côté serveur : jamais deux retours "en vol"
 * simultanément sur le même règlement, mais un nouveau redevient possible
 * dès que le précédent est réceptionné.
 */
export function RetourCaisseRow({ reglementId, montant, retours, peutDeclarer, dateMin }: RetourCaisseRowData) {
  const [formOpen, setFormOpen] = useState(false);

  const aUnRetourEnAttente = retours.some((r) => !r.estReceptionne);

  return (
    <li className="space-y-3 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium text-foreground">{montant.toLocaleString("fr-FR")} FCFA — Caisse</p>
        {formOpen || aUnRetourEnAttente ? null : peutDeclarer ? (
          <Button type="button" onClick={() => setFormOpen(true)}>
            {retours.length === 0 ? "Déclarer un retour de caisse" : "Déclarer un nouveau retour de caisse"}
          </Button>
        ) : retours.length === 0 ? (
          <Badge variant="neutral">Non déclaré</Badge>
        ) : null}
      </div>

      {retours.length > 0 ? (
        <ul className="space-y-3">
          {retours.map((retour) => (
            <RetourExistant key={retour.id} retour={retour} reglementId={reglementId} montant={montant} />
          ))}
        </ul>
      ) : null}

      {formOpen ? (
        <RetourCaisseForm
          reglementId={reglementId}
          montantReglement={montant}
          dateMin={dateMin}
          onCancel={() => setFormOpen(false)}
          onSuccess={() => setFormOpen(false)}
        />
      ) : null}
    </li>
  );
}
