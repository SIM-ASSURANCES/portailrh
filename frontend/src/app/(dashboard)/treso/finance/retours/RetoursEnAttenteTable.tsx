"use client";

import Link from "next/link";

import { Badge, Button, DataTable } from "@/components/ui";
import { JUSTIFICATION_LABEL } from "@/components/tresorerie/justification";
import type { ModeReglement, TypeJustification } from "backend";

interface DepenseLigneRow {
  id: string;
  montant: number;
  objet: string;
  date: Date;
  nature: string | null;
  justification: TypeJustification;
  commentaire: string | null;
  pieceJointeId: string | null;
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
  creeParAssistant: boolean;
  depenses: DepenseLigneRow[];
  createdAt: Date;
}

/**
 * Wrapper Client Component autour de DataTable — voir MesDemandesTable.tsx
 * (Ticket 1) pour l'explication (colonnes avec accessor/render : fonctions
 * non sérialisables entre Server et Client Component).
 *
 * **"Voir" avant "Réceptionner"** (Tâche "Écran 'Voir' avant 'Réceptionner'",
 * voir CLAUDE.md) — cette liste ne propose plus qu'UNE SEULE action directe
 * par ligne : "Voir", menant au détail complet
 * (`/treso/finance/retours/[id]`). Ni "Réceptionner" ni "Marquer non
 * justifiée" ne sont plus actionnables depuis cette liste — les deux ont
 * été déplacées sur l'écran de détail, après consultation. La colonne
 * "Détail des dépenses" reste un simple résumé de LECTURE (objet, montant,
 * justification, pièce jointe), jamais une action.
 */
export function RetoursEnAttenteTable({ retours }: { retours: RetourRow[] }) {
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
              <ul className="space-y-1 text-xs">
                {r.depenses.map((d) => (
                  <li key={d.id}>
                    {d.objet} — {d.montant.toLocaleString("fr-FR")} FCFA ({JUSTIFICATION_LABEL[d.justification]})
                  </li>
                ))}
              </ul>
            ),
        },
        {
          key: "totalDeclare",
          header: "Total dépensé",
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
          key: "origine",
          header: "Origine",
          render: (r) =>
            r.creeParAssistant ? (
              <Badge variant="info">Assistant Finance</Badge>
            ) : (
              <span className="text-xs text-muted-foreground">Collaborateur</span>
            ),
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
            <Link href={`/treso/finance/retours/${r.id}`}>
              <Button type="button" variant="secondary">
                Voir
              </Button>
            </Link>
          ),
        },
      ]}
      data={retours}
    />
  );
}
