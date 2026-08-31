"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge, Button, Input, Select, Textarea } from "@/components/ui";

import { annulerReglementAction, confirmerReglementAction, modifierReglementAction } from "./reglementActions";

export interface ReglementRowData {
  id: string;
  montant: number;
  mode: "CAISSE" | "BANQUE";
  estConfirme: boolean;
  estAnnule: boolean;
  motifAnnulation: string | null;
  auteurNom: string;
  createdAt: Date;
}

const MODE_LABEL: Record<"CAISSE" | "BANQUE", string> = { CAISSE: "Caisse", BANQUE: "Banque" };

function ReglementStatutBadge({ reglement }: { reglement: ReglementRowData }) {
  if (reglement.estAnnule) return <Badge variant="danger">Annulé</Badge>;
  if (reglement.estConfirme) return <Badge variant="success">Confirmé</Badge>;
  return <Badge variant="neutral">Brouillon</Badge>;
}

/**
 * Une ligne de la liste des règlements, avec ses actions propres :
 * - Brouillon (ni confirmé ni annulé) : Modifier (montant/mode) + Confirmer.
 * - Confirmé (non annulé) : Annuler (motif obligatoire) — plus aucune édition.
 * - Annulé : lecture seule, grisé/barré, motif visible.
 *
 * `canEffectuerReglement` masque les boutons d'action pour un utilisateur
 * qui partage l'espace Finance sans avoir cette permission précise (ex: le
 * DG, qui a `treso.valider_demande` mais pas `treso.effectuer_reglement`) —
 * même principe que Finance/DG sur la catégorisation au Ticket 3. Les
 * Server Actions revérifient de toute façon la permission côté serveur :
 * ce masquage est une question de clarté d'interface, pas la seule ligne
 * de défense.
 *
 * Le formulaire d'édition reste non contrôlé (`defaultValue` + `FormData`
 * au submit) : passer `value` à `Select` entrerait en conflit avec son
 * `defaultValue` interne (voir CLAUDE.md, piège déjà rencontré au Ticket 2).
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
  canEffectuerReglement,
}: {
  reglement: ReglementRowData;
  canEffectuerReglement: boolean;
}) {
  const [uiMode, setUiMode] = useState<"view" | "edit" | "annuler">("view");
  const [montantError, setMontantError] = useState<string | undefined>();
  const [motif, setMotif] = useState("");
  const [motifError, setMotifError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

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
      const result = await modifierReglementAction(reglement.id, montantValue, modeValue);
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
          {canEffectuerReglement && !reglement.estConfirme && !reglement.estAnnule && uiMode === "view" ? (
            <>
              <Button type="button" variant="secondary" onClick={() => setUiMode("edit")}>
                Modifier
              </Button>
              <Button type="button" loading={isPending} onClick={handleConfirmer}>
                Confirmer
              </Button>
            </>
          ) : null}
          {canEffectuerReglement && reglement.estConfirme && !reglement.estAnnule && uiMode === "view" ? (
            <Button type="button" variant="danger" onClick={() => setUiMode("annuler")}>
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
            defaultValue={reglement.montant}
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
          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={isPending}>
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
