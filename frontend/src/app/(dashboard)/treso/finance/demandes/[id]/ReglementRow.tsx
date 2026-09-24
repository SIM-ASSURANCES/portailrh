"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge, Button, Input, Select, Textarea } from "@/components/ui";

import { AllocationCategorieFields, type CategorieAllocationOption } from "./AllocationCategorieFields";
import { annulerReglementAction, confirmerReglementAction, modifierReglementAction } from "./reglementActions";

export interface ReglementAllocationData {
  categorieId: string;
  categorieLabel: string;
  montant: number;
}

export interface ReglementRowData {
  id: string;
  montant: number;
  mode: "CAISSE" | "BANQUE";
  estConfirme: boolean;
  estAnnule: boolean;
  motifAnnulation: string | null;
  auteurNom: string;
  createdAt: Date;
  /** Voir CLAUDE.md "Allocation budgétaire explicite par règlement" —
   * toujours au moins une entrée dès que la demande est catégorisée
   * (même une seule catégorie crée une allocation à 100%, transparente
   * pour Finance), vide seulement si la demande n'est pas catégorisée. */
  allocations: ReglementAllocationData[];
}

const MODE_LABEL: Record<"CAISSE" | "BANQUE", string> = { CAISSE: "Caisse", BANQUE: "Banque" };

function ReglementStatutBadge({ reglement }: { reglement: ReglementRowData }) {
  if (reglement.estAnnule) return <Badge variant="danger">Annulé</Badge>;
  if (reglement.estConfirme) return <Badge variant="success">Confirmé</Badge>;
  return <Badge variant="neutral">Brouillon</Badge>;
}

/**
 * Une ligne de la liste des règlements, avec ses actions propres :
 * - Brouillon (ni confirmé ni annulé) : Modifier (montant/mode/répartition) + Confirmer.
 * - Confirmé (non annulé) : Annuler (motif obligatoire) — plus aucune édition.
 * - Annulé : lecture seule, grisé/barré, motif visible.
 *
 * `canEffectuerReglement` désactive (visible mais non cliquable, jamais
 * absent — Tâche "Séparation Responsable Finance / Assistant Finance",
 * voir CLAUDE.md) les boutons Modifier/Confirmer pour un utilisateur qui
 * partage l'espace Finance sans avoir cette permission précise (ex: le DG,
 * ou le Responsable Finance lui-même, qui a `treso.valider_demande` mais
 * plus `treso.effectuer_reglement`). Le bouton "Annuler" d'un règlement
 * déjà CONFIRMÉ suit désormais une garde SÉPARÉE,
 * `canAnnulerReglementConfirme` (Tâche "Annulation d'un règlement après
 * reçu réservée au Responsable", voir CLAUDE.md) — l'Assistant Finance
 * garde `canEffectuerReglement` pour Modifier/Confirmer un règlement encore
 * en cours, mais ne peut plus annuler un règlement déjà confirmé (reçu déjà
 * généré), réservé au Responsable Finance. Les Server Actions revérifient
 * de toute façon chaque permission côté serveur : ce grisage est une
 * question de clarté d'interface, pas la seule ligne de défense.
 *
 * Le formulaire d'édition reste non contrôlé (`defaultValue` + `FormData`
 * au submit) pour montant/mode — passer `value` à `Select` entrerait en
 * conflit avec son `defaultValue` interne (voir CLAUDE.md, piège déjà
 * rencontré au Ticket 2). Les champs de répartition (voir CLAUDE.md
 * "Allocation budgétaire explicite par règlement"), eux, restent
 * CONTRÔLÉS (état local `allocValues`) — nécessaire pour afficher le total
 * réparti en direct — mais portent tout de même un `name`, donc le
 * `FormData` construit à la soumission les lit normalement, exactement
 * comme `montant`/`mode`.
 *
 * "Télécharger le reçu" (Ticket 9) apparaît sur tout règlement confirmé et
 * non annulé, **sans condition sur `canEffectuerReglement`** : la Route
 * Handler qui génère le PDF autorise déjà n'importe quelle permission
 * Finance/DG (pas seulement `treso.effectuer_reglement`), donc tout
 * utilisateur qui voit cette page (garde du layout Finance partagé) a de
 * toute façon le droit de télécharger — masquer le lien pour le DG serait
 * incohérent avec ce que le serveur accepterait réellement. "Télécharger le
 * bon de caisse" (Phase E) apparaît à côté, en plus, uniquement si
 * `mode === "CAISSE"` — un bon de caisse n'a pas de sens pour un règlement
 * Banque, la Route Handler le refuserait de toute façon (400).
 */
export function ReglementRow({
  reglement,
  categoriesConcernees,
  canEffectuerReglement,
  canAnnulerReglementConfirme,
}: {
  reglement: ReglementRowData;
  categoriesConcernees: CategorieAllocationOption[];
  canEffectuerReglement: boolean;
  /** Tâche "Annulation d'un règlement après reçu réservée au Responsable"
   * (voir CLAUDE.md) — contrôle UNIQUEMENT le bouton "Annuler" d'un
   * règlement déjà confirmé (Responsable Finance), jamais
   * Modifier/Confirmer (restés sur `canEffectuerReglement`, Assistant
   * Finance, inchangés). */
  canAnnulerReglementConfirme: boolean;
}) {
  const [uiMode, setUiMode] = useState<"view" | "edit" | "annuler">("view");
  const [montantError, setMontantError] = useState<string | undefined>();
  const [montantEdit, setMontantEdit] = useState(String(reglement.montant));
  const [allocValues, setAllocValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(reglement.allocations.map((a) => [a.categorieId, String(a.montant)]))
  );
  const [motif, setMotif] = useState("");
  const [motifError, setMotifError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  const multiCategories = categoriesConcernees.length >= 2;
  const sommeAllocations = categoriesConcernees.reduce(
    (total, c) => total + (Number(allocValues[c.categorieId]) || 0),
    0
  );
  const allocationValide =
    !multiCategories || Math.round(sommeAllocations * 100) === Math.round((Number(montantEdit) || 0) * 100);

  function handleConfirmer() {
    startTransition(async () => {
      const result = await confirmerReglementAction(reglement.id);
      if (result.status === "success") toast.success(result.message);
      else toast.error(result.message);
    });
  }

  function handleSubmitEdition(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const montantValue = Number(formData.get("montant"));
    const modeValue = formData.get("mode") as "CAISSE" | "BANQUE";

    if (!montantValue || montantValue <= 0) {
      setMontantError("Montant invalide.");
      return;
    }
    setMontantError(undefined);

    startTransition(async () => {
      const result = await modifierReglementAction(reglement.id, montantValue, modeValue, formData);
      if (result.status === "success") {
        toast.success(result.message);
        setUiMode("view");
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleAnnuler() {
    if (motif.trim().length < 3) {
      setMotifError("Le motif est obligatoire (3 caractères minimum).");
      return;
    }
    setMotifError(undefined);
    startTransition(async () => {
      const result = await annulerReglementAction(reglement.id, motif);
      if (result.status === "success") {
        toast.success(result.message);
        setUiMode("view");
        setMotif("");
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <li className={`space-y-3 rounded-md border border-border p-4 ${reglement.estAnnule ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={`font-medium text-foreground ${reglement.estAnnule ? "line-through" : ""}`}>
            {reglement.montant.toLocaleString("fr-FR")} FCFA — {MODE_LABEL[reglement.mode]}
          </p>
          <p className="text-xs text-muted-foreground">
            {reglement.auteurNom} — {reglement.createdAt.toLocaleString("fr-FR")}
          </p>
          {/* Répartition par catégorie (voir CLAUDE.md "Allocation
              budgétaire explicite par règlement") — affichée seulement si
              plus d'une catégorie est concernée : pour une seule catégorie,
              l'allocation à 100% n'apporte aucune information que le
              montant total n'ait déjà donnée, jamais une ligne redondante. */}
          {reglement.allocations.length > 1 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Répartition :{" "}
              {reglement.allocations
                .map((a) => `${a.categorieLabel} ${a.montant.toLocaleString("fr-FR")} FCFA`)
                .join(", ")}
            </p>
          ) : null}
          {reglement.estAnnule && reglement.motifAnnulation ? (
            <p className="mt-1 text-sm text-danger">
              Motif d&apos;annulation : {reglement.motifAnnulation}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ReglementStatutBadge reglement={reglement} />
          {reglement.estConfirme && !reglement.estAnnule ? (
            <a href={`/api/treso/reglements/${reglement.id}/recu`}>
              <Button type="button" variant="secondary">
                Télécharger le reçu
              </Button>
            </a>
          ) : null}
          {reglement.estConfirme && !reglement.estAnnule && reglement.mode === "CAISSE" ? (
            <a href={`/api/treso/reglements/${reglement.id}/bon-de-caisse`}>
              <Button type="button" variant="secondary">
                Télécharger le bon de caisse
              </Button>
            </a>
          ) : null}
          {!reglement.estConfirme && !reglement.estAnnule && uiMode === "view" ? (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={!canEffectuerReglement}
                onClick={() => setUiMode("edit")}
              >
                Modifier
              </Button>
              <Button type="button" loading={isPending} disabled={!canEffectuerReglement} onClick={handleConfirmer}>
                Confirmer
              </Button>
            </>
          ) : null}
          {reglement.estConfirme && !reglement.estAnnule && uiMode === "view" ? (
            <Button
              type="button"
              variant="danger"
              disabled={!canAnnulerReglementConfirme}
              onClick={() => setUiMode("annuler")}
            >
              Annuler
            </Button>
          ) : null}
        </div>
      </div>

      {uiMode === "edit" ? (
        <form onSubmit={handleSubmitEdition} className="animate-fade-in-up space-y-3 border-t border-border pt-3">
          <Input
            name="montant"
            label="Montant"
            type="number"
            inputMode="decimal"
            min="1"
            step="1"
            value={montantEdit}
            onChange={(e) => setMontantEdit(e.target.value)}
            error={montantError}
          />
          <Select
            name="mode"
            label="Mode"
            defaultValue={reglement.mode}
            options={[
              { value: "CAISSE", label: "Caisse" },
              { value: "BANQUE", label: "Banque" },
            ]}
          />
          {multiCategories ? (
            <AllocationCategorieFields
              categories={categoriesConcernees}
              montantTotal={Number(montantEdit) || 0}
              values={allocValues}
              onChange={(categorieId, valeur) => setAllocValues((prev) => ({ ...prev, [categorieId]: valeur }))}
            />
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={isPending} disabled={!allocationValide}>
              Enregistrer
            </Button>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => setUiMode("view")}>
              Annuler
            </Button>
          </div>
        </form>
      ) : null}

      {uiMode === "annuler" ? (
        <div className="animate-fade-in-up space-y-3 border-t border-border pt-3">
          <Textarea
            label="Motif de l'annulation"
            required
            rows={2}
            value={motif}
            onChange={(e) => {
              setMotif(e.target.value);
              if (motifError) setMotifError(undefined);
            }}
            error={motifError}
          />
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="danger" loading={isPending} onClick={handleAnnuler}>
              Confirmer l&apos;annulation
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => {
                setUiMode("view");
                setMotif("");
                setMotifError(undefined);
              }}
            >
              Annuler
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
