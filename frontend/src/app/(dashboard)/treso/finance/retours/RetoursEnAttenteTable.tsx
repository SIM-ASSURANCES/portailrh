"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, DataTable } from "@/components/ui";
import { JUSTIFICATION_LABEL } from "@/components/tresorerie/justification";
import { MarquerNonJustifiee } from "@/components/tresorerie/MarquerNonJustifiee";
import type { ModeReglement, TypeJustification } from "backend";

import { receptionnerRetourAction } from "./retourActions";

interface DepenseLigneRow {
  id: string;
  montant: number;
  objet: string;
  date: Date;
  nature: string | null;
  justification: TypeJustification;
  commentaire: string | null;
  pieceJointeId: string | null;
  /** Voir CLAUDE.md "Motif Finance sur dépense non justifiée" — `null` tant
   * que Finance n'est jamais intervenue sur cette ligne précise. */
  motifNonJustifie: string | null;
  motifNonJustifiePar: string | null;
}

interface RetourRow {
  id: string;
  demandeReference: string;
  declarantNom: string;
  reglementMontant: number;
  reglementMode: ModeReglement;
  totalDeclare: number;
  montantARetourner: number;
  montantNonJustifie: number;
  /** Renseignée uniquement pour une déclaration via le formulaire
   * simplifié ("date + montant") — voir CLAUDE.md "Retour de caisse
   * optionnel — formulaire simplifié". */
  dateRetour: Date | null;
  depenses: DepenseLigneRow[];
  createdAt: Date;
}

/**
 * Wrapper Client Component autour de DataTable — voir MesDemandesTable.tsx
 * (Ticket 1) pour l'explication (colonnes avec accessor/render : fonctions
 * non sérialisables entre Server et Client Component).
 *
 * REFONTE V1 / Phase D (voir CLAUDE.md "Refonte V1 en cours") : remplace
 * les anciennes colonnes "Montant dépensé"/"Justification"/"Commentaire"
 * (un seul montant agrégé, Ticket 5) par une colonne "Détail des dépenses"
 * listant chaque `DepenseLigne`, et une colonne "Non justifié" mise en
 * évidence (`text-warning`) quand une part de la dépense n'a aucune pièce
 * (justification `SANS_PIECE`).
 *
 * `receptionnerRetourAction` est appelée directement (comme
 * `confirmerReglementAction` au Ticket 4), pas via `<form action={...}>` :
 * pas de champ à valider, juste un identifiant. La ligne réceptionnée
 * disparaît immédiatement de cette liste après succès, puisqu'elle n'est
 * plus `estReceptionne: false` (revalidatePath sur cette page).
 */
export function RetoursEnAttenteTable({ retours }: { retours: RetourRow[] }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleReceptionner(id: string) {
    setPendingId(id);
    startTransition(async () => {
      const result = await receptionnerRetourAction(id);
      if (result.status === "success") {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
      setPendingId(null);
    });
  }

  return (
    <DataTable
      rowKey={(r) => r.id}
      emptyMessage="Aucun retour de caisse en attente de réception."
      columns={[
        { key: "demandeReference", header: "Demande", sortable: true, accessor: (r) => r.demandeReference },
        { key: "declarantNom", header: "Collaborateur", sortable: true, accessor: (r) => r.declarantNom },
        {
          key: "reglement",
          header: "Règlement d'origine",
          render: (r) => `${r.reglementMontant.toLocaleString("fr-FR")} FCFA (${r.reglementMode})`,
        },
        {
          key: "depenses",
          header: "Détail des dépenses",
          render: (r) =>
            r.depenses.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                Retour intégral — rien dépensé
                {r.dateRetour ? ` (déclaré pour le ${r.dateRetour.toLocaleDateString("fr-FR")})` : ""}
              </span>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {r.depenses.map((d) => (
                  <li key={d.id} className="space-y-0.5">
                    <div>
                      {d.objet} — {d.montant.toLocaleString("fr-FR")} FCFA ({JUSTIFICATION_LABEL[d.justification]})
                      {d.pieceJointeId ? (
                        <>
                          {" — "}
                          <a
                            href={`/api/treso/pieces-jointes/${d.pieceJointeId}`}
                            className="text-info underline-offset-4 hover:text-primary hover:underline"
                          >
                            Pièce jointe
                          </a>
                        </>
                      ) : null}
                    </div>
                    <MarquerNonJustifiee depense={d} />
                  </li>
                ))}
              </ul>
            ),
        },
        {
          key: "totalDeclare",
          header: "Total déclaré",
          sortable: true,
          accessor: (r) => r.totalDeclare,
          render: (r) => `${r.totalDeclare.toLocaleString("fr-FR")} FCFA`,
        },
        {
          key: "montantNonJustifie",
          header: "Non justifié",
          sortable: true,
          accessor: (r) => r.montantNonJustifie,
          render: (r) =>
            r.montantNonJustifie > 0 ? (
              <span className="font-semibold text-warning">{r.montantNonJustifie.toLocaleString("fr-FR")} FCFA</span>
            ) : (
              "—"
            ),
        },
        {
          key: "montantARetourner",
          header: "À retourner",
          sortable: true,
          accessor: (r) => r.montantARetourner,
          render: (r) => `${r.montantARetourner.toLocaleString("fr-FR")} FCFA`,
        },
        {
          key: "createdAt",
          header: "Déclaré le",
          sortable: true,
          accessor: (r) => r.createdAt,
          render: (r) => r.createdAt.toLocaleDateString("fr-FR"),
        },
        {
          key: "actions",
          header: "Actions",
          render: (r) => (
            <Button
              type="button"
              loading={pendingId === r.id}
              onClick={() => handleReceptionner(r.id)}
            >
              Réceptionner
            </Button>
          ),
        },
      ]}
      data={retours}
    />
  );
}
