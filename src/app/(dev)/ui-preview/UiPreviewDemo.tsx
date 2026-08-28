"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";

import { Badge, Button, DataTable, Input, Select, Textarea } from "@/components/ui";
import type { BadgeVariant } from "@/components/ui";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE } from "@/lib/validation";

import { demoFormAction } from "./actions";

type StatutDemo = "EN_ATTENTE" | "VALIDEE" | "REJETEE" | "CLOTUREE_TOTALE" | "CLOTUREE_PARTIELLE";

/**
 * Convention : un enum métier (ici StatutDemande) se mappe vers une variante
 * de Badge via un objet local au composant qui l'affiche - Badge lui-même
 * reste générique. Voir CLAUDE.md > "Badges de statut métier".
 */
const statutBadgeVariant: Record<StatutDemo, BadgeVariant> = {
  EN_ATTENTE: "warning",
  VALIDEE: "success",
  REJETEE: "danger",
  CLOTUREE_TOTALE: "neutral",
  CLOTUREE_PARTIELLE: "info",
};

interface DemoDemande {
  id: string;
  reference: string;
  description: string;
  montant: number;
  statut: StatutDemo;
}

const demoData: DemoDemande[] = [
  { id: "1", reference: "DEM-0001", description: "Déplacement équipe commerciale", montant: 150000, statut: "EN_ATTENTE" },
  { id: "2", reference: "DEM-0002", description: "Carburant véhicule de liaison", montant: 45000, statut: "VALIDEE" },
  { id: "3", reference: "DEM-0003", description: "Fournitures de bureau", montant: 32000, statut: "REJETEE" },
  { id: "4", reference: "DEM-0004", description: "Mission terrain régionale", montant: 210000, statut: "CLOTUREE_TOTALE" },
  { id: "5", reference: "DEM-0005", description: "Prestation externe", montant: 98000, statut: "CLOTUREE_PARTIELLE" },
];

export function UiPreviewDemo() {
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [state, formAction, isPending] = useActionState(demoFormAction, IDLE_ACTION_STATE);
  useActionFeedback(state);

  function simulateLoading() {
    setLoadingDemo(true);
    setTimeout(() => setLoadingDemo(false), 1500);
  }

  return (
    <div className="space-y-12">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">
          Charte graphique — couleurs officielles
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {(
            [
              { name: "sim-blue-dark", label: "Bleu foncé (principal)", className: "bg-sim-blue-dark" },
              { name: "sim-blue-light", label: "Bleu clair (secondaire)", className: "bg-sim-blue-light" },
              { name: "sim-red", label: "Dommage / erreur", className: "bg-sim-red" },
              { name: "sim-yellow", label: "Santé / attention", className: "bg-sim-yellow" },
              { name: "sim-orange", label: "Accident / avertissement", className: "bg-sim-orange" },
            ] as const
          ).map((swatch) => (
            <div key={swatch.name} className="space-y-1">
              <div className={`h-16 rounded-md border border-border ${swatch.className}`} />
              <p className="text-xs font-medium text-foreground">{swatch.name}</p>
              <p className="text-xs text-muted-foreground">{swatch.label}</p>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          Tokens sémantiques dérivés (assombris pour rester WCAG AA en texte/fond plein) :
        </p>
        <div className="flex flex-wrap gap-3">
          <span className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">primary</span>
          <span className="rounded-md bg-danger px-3 py-1.5 text-sm text-danger-foreground">danger</span>
          <span className="rounded-md bg-warning-bg px-3 py-1.5 text-sm text-warning border border-warning-border">warning</span>
          <span className="rounded-md bg-info-bg px-3 py-1.5 text-sm text-info border border-info-border">info</span>
          <span className="rounded-md bg-success-bg px-3 py-1.5 text-sm text-success border border-success-border">success</span>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Typographie — Montserrat</h2>
        <div className="space-y-2">
          <p className="text-3xl font-black text-foreground">Black 900 — Gros titre</p>
          <p className="text-xl font-bold text-foreground">Bold 700 — Titre de section</p>
          <p className="text-base font-normal text-foreground">
            Regular 400 — Texte courant du portail, utilisé pour le contenu, les formulaires et les tableaux.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Button</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="primary" loading={loadingDemo} onClick={simulateLoading}>
            {loadingDemo ? "Chargement..." : "Cliquer (loading 1.5s)"}
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Badge — statuts métier</h2>
        <div className="flex flex-wrap gap-2">
          {(Object.entries(statutBadgeVariant) as [StatutDemo, BadgeVariant][]).map(([statut, variant]) => (
            <Badge key={statut} variant={variant}>
              {statut}
            </Badge>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="info">CAISSE</Badge>
          <Badge variant="neutral">BANQUE</Badge>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">DataTable</h2>
        <DataTable
          rowKey={(row) => row.id}
          emptyMessage="Aucune demande."
          columns={[
            { key: "reference", header: "Référence", sortable: true, accessor: (r) => r.reference },
            { key: "description", header: "Description", accessor: (r) => r.description },
            {
              key: "montant",
              header: "Montant",
              sortable: true,
              accessor: (r) => r.montant,
              render: (r) => `${r.montant.toLocaleString("fr-FR")} XOF`,
            },
            {
              key: "statut",
              header: "Statut",
              render: (r) => <Badge variant={statutBadgeVariant[r.statut]}>{r.statut}</Badge>,
            },
          ]}
          data={demoData}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Toasts</h2>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => toast.success("Opération réussie.")}>
            Toast succès
          </Button>
          <Button variant="secondary" onClick={() => toast.error("Une erreur est survenue.")}>
            Toast erreur
          </Button>
          <Button variant="secondary" onClick={() => toast.info("Information.")}>
            Toast info
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">
          Formulaire complet — Server Action + Zod + toast
        </h2>
        <form action={formAction} className="max-w-md space-y-4 rounded-md border border-border p-4">
          <Input
            name="titre"
            label="Titre"
            required
            placeholder="Ex: Déplacement client"
            error={state.status === "error" ? state.fieldErrors?.titre : undefined}
          />
          <Input
            name="montant"
            label="Montant"
            type="number"
            required
            placeholder="Ex: 50000"
            error={state.status === "error" ? state.fieldErrors?.montant : undefined}
          />
          <Textarea
            name="commentaire"
            label="Commentaire"
            hint="Champ optionnel, non validé dans cette démo."
            rows={3}
          />
          <Select
            name="categorie"
            label="Catégorie"
            placeholder="Sélectionner..."
            options={[
              { value: "deplacements", label: "Déplacements" },
              { value: "carburant", label: "Carburant" },
              { value: "fournitures", label: "Fournitures" },
            ]}
          />
          <Button type="submit" loading={isPending}>
            Soumettre
          </Button>
        </form>
      </section>
    </div>
  );
}
