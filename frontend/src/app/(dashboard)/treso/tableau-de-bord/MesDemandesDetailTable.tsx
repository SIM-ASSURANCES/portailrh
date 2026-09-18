"use client";

import Link from "next/link";

import { Badge, Button, DataTable } from "@/components/ui";
import { Icon } from "@/components/icons";
import { STATUT_DEMANDE_BADGE_VARIANT, STATUT_DEMANDE_LABEL } from "@/components/tresorerie/demandeStatut";
import type { StatutDemande } from "backend";

interface MaDemandeDetailRow {
  id: string;
  reference: string;
  statut: StatutDemande;
  montant: number;
  montantValide: number | null;
  montantRecu: number;
  soldeARegulariser: number;
  createdAt: Date;
}

/** Icônes ajoutées à la présentation existante uniquement (voir CLAUDE.md
 * "Modernisation du dashboard Collaborateur") — contenu et seuils
 * strictement inchangés, `DataTable` porte déjà le survol de ligne et
 * `Badge`/`STATUT_DEMANDE_BADGE_VARIANT` la coloration de statut. */
function EtatRegularisation({ montantRecu, soldeARegulariser }: { montantRecu: number; soldeARegulariser: number }) {
  if (montantRecu === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon name="clock" className="size-3.5" />
        Rien reçu pour l&apos;instant
      </span>
    );
  }
  if (soldeARegulariser === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success">
        <Icon name="circle-check" className="size-3.5" />
        Régularisée
      </span>
    );
  }
  if (soldeARegulariser < 0) {
    // Signale une anomalie réelle (voir CLAUDE.md `getSoldeARegulariser` /
    // `getEcart`, jamais plafonné à 0) : plus justifié/retourné que reçu.
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-danger">
        <Icon name="alert-triangle" className="size-3.5 shrink-0" />
        Anomalie : {Math.abs(soldeARegulariser).toLocaleString("fr-FR")} FCFA en trop justifiés/retournés
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-warning">
      <Icon name="rotate-ccw" className="size-3.5 shrink-0" />
      À régulariser : {soldeARegulariser.toLocaleString("fr-FR")} FCFA
    </span>
  );
}

/**
 * Wrapper Client Component autour de DataTable — voir MesDemandesTable.tsx
 * (Ticket 1) pour l'explication (colonnes avec accessor/render : fonctions
 * non sérialisables entre Server et Client Component).
 *
 * Voir CLAUDE.md "Tableau de bord collaborateur détaillé" : chaque demande
 * listée séparément (jamais agrégée), avec son propre montant reçu (fonds
 * remis) et son propre état de régularisation — jamais mélangés entre
 * demandes, contrairement aux 5 indicateurs globaux au-dessus sur cette
 * même page.
 */
export function MesDemandesDetailTable({ demandes }: { demandes: MaDemandeDetailRow[] }) {
  return (
    <DataTable
      rowKey={(d) => d.id}
      emptyMessage="Vous n'avez encore créé aucune demande."
      columns={[
        { key: "reference", header: "Référence", sortable: true, accessor: (d) => d.reference },
        {
          key: "statut",
          header: "Statut",
          render: (d) => <Badge variant={STATUT_DEMANDE_BADGE_VARIANT[d.statut]}>{STATUT_DEMANDE_LABEL[d.statut]}</Badge>,
        },
        {
          key: "montant",
          header: "Montant demandé",
          sortable: true,
          accessor: (d) => d.montant,
          render: (d) => `${d.montant.toLocaleString("fr-FR")} FCFA`,
        },
        {
          key: "montantRecu",
          header: "Montant reçu (fonds remis)",
          sortable: true,
          accessor: (d) => d.montantRecu,
          render: (d) =>
            d.montantRecu > 0 ? (
              <span className="font-semibold text-foreground tabular-nums">
                {d.montantRecu.toLocaleString("fr-FR")} FCFA
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
        },
        {
          key: "regularisation",
          header: "État de régularisation",
          render: (d) => <EtatRegularisation montantRecu={d.montantRecu} soldeARegulariser={d.soldeARegulariser} />,
        },
        {
          key: "createdAt",
          header: "Créée le",
          sortable: true,
          accessor: (d) => d.createdAt,
          render: (d) => d.createdAt.toLocaleDateString("fr-FR"),
        },
        {
          key: "actions",
          header: "Actions",
          render: (d) => (
            <Link href={`/treso/demandes/${d.id}`}>
              <Button variant="secondary">Voir</Button>
            </Link>
          ),
        },
      ]}
      data={demandes}
    />
  );
}
