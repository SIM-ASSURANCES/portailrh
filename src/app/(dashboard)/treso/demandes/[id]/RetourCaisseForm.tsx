"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input, Select, Textarea } from "@/components/ui";
import { JUSTIFICATION_OPTIONS } from "@/components/tresorerie/justification";

import { creerRetourCaisseAction, type LigneDepenseInput } from "./retourActions";

type LigneEdit = LigneDepenseInput & { key: string };

function nouvelleLigne(): LigneEdit {
  return {
    key: `ligne-${Math.random().toString(36).slice(2)}`,
    montant: 0,
    objet: "",
    date: new Date().toISOString().slice(0, 10),
    nature: "",
    justification: "FACTURE",
    commentaire: "",
  };
}

/**
 * Formulaire de déclaration d'un retour de caisse, associé à un règlement
 * précis (`reglementId` — jamais un formulaire libre indépendant,
 * conformément à la règle impérative du cahier des charges).
 *
 * REFONTE V1 / Phase D ("fonds remis", cahier des charges sections 8-9) :
 * remplace l'ancien formulaire à un seul montant dépensé agrégé (Ticket 5)
 * par une liste dynamique de lignes de dépenses détaillées
 * (montant/objet/date/nature/justificatif/commentaire), avec au moins une
 * ligne obligatoire. Le total déclaré et le montant à retourner qui en
 * résulte sont affichés EN LECTURE SEULE, recalculés à chaque changement —
 * **jamais saisis** : `montantARetourner` est calculé côté serveur (voir
 * `creerRetourCaisseAction`), ce calcul côté client n'est qu'un aperçu.
 *
 * Appelle directement `creerRetourCaisseAction` (arguments simples, comme
 * `validerComplementaireAction`/`confirmerReglementAction`), pas via
 * `<form action={...}>` : un tableau de lignes ne se prête pas nativement à
 * `FormData`, contrairement à un formulaire à champs plats.
 */
export function RetourCaisseForm({
  reglementId,
  montantReglement,
  onCancel,
  onSuccess,
}: {
  reglementId: string;
  montantReglement: number;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [lignes, setLignes] = useState<LigneEdit[]>([nouvelleLigne()]);
  const [erreur, setErreur] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  const totalDeclare = lignes.reduce((sum, l) => sum + (Number(l.montant) || 0), 0);
  const montantARetourner = Math.max(0, montantReglement - totalDeclare);

  function updateLigne(key: string, patch: Partial<LigneEdit>) {
    setLignes((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function ajouterLigne() {
    setLignes((prev) => [...prev, nouvelleLigne()]);
  }

  function retirerLigne(key: string) {
    setLignes((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  function handleSubmit() {
    for (const l of lignes) {
      if (!l.montant || l.montant <= 0) {
        setErreur("Chaque ligne doit avoir un montant supérieur à 0.");
        return;
      }
      if (!l.objet.trim()) {
        setErreur("Chaque ligne doit avoir un objet renseigné.");
        return;
      }
      if (!l.date) {
        setErreur("Chaque ligne doit avoir une date.");
        return;
      }
      if (l.justification === "SANS_PIECE" && !l.commentaire?.trim()) {
        setErreur("Un commentaire est obligatoire pour une ligne sans pièce formelle.");
        return;
      }
    }
    setErreur(undefined);

    startTransition(async () => {
      const result = await creerRetourCaisseAction(
        reglementId,
        lignes.map((l) => ({
          montant: l.montant,
          objet: l.objet,
          date: l.date,
          nature: l.nature,
          justification: l.justification,
          commentaire: l.commentaire,
        }))
      );
      if (result.status === "success") {
        toast.success(result.message);
        onSuccess();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="animate-fade-in-up space-y-4 border-t border-border pt-4">
      <div className="space-y-4">
        {lignes.map((ligne, index) => (
          <div key={ligne.key} className="animate-fade-in-up space-y-3 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Dépense {index + 1}
              </p>
              {lignes.length > 1 ? (
                <Button type="button" variant="secondary" onClick={() => retirerLigne(ligne.key)}>
                  Retirer
                </Button>
              ) : null}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                label="Montant"
                type="number"
                inputMode="decimal"
                min="0"
                step="1"
                required
                value={ligne.montant || ""}
                onChange={(e) => updateLigne(ligne.key, { montant: Number(e.target.value) })}
              />
              <Input
                label="Objet"
                required
                value={ligne.objet}
                onChange={(e) => updateLigne(ligne.key, { objet: e.target.value })}
              />
              <Input
                label="Date"
                type="date"
                required
                value={ligne.date}
                onChange={(e) => updateLigne(ligne.key, { date: e.target.value })}
              />
              <Input
                label="Nature"
                hint="Optionnel"
                value={ligne.nature ?? ""}
                onChange={(e) => updateLigne(ligne.key, { nature: e.target.value })}
              />
              {/* defaultValue, pas value : Select fixe déjà `defaultValue` en
                  interne (voir CLAUDE.md, piège du Ticket 2) — `ligne.key`
                  reste stable pour la durée de vie de cette ligne, donc pas
                  besoin de remonter le Select pour refléter les changements,
                  seul le premier rendu importe. */}
              <Select
                label="Justification"
                required
                options={JUSTIFICATION_OPTIONS}
                defaultValue={ligne.justification}
                onChange={(e) =>
                  updateLigne(ligne.key, {
                    justification: e.target.value as LigneDepenseInput["justification"],
                  })
                }
              />
            </div>
            <Textarea
              label="Commentaire"
              rows={2}
              hint="Obligatoire si la justification est « Dépense sans pièce formelle »."
              value={ligne.commentaire ?? ""}
              onChange={(e) => updateLigne(ligne.key, { commentaire: e.target.value })}
            />
          </div>
        ))}
      </div>

      <Button type="button" variant="secondary" onClick={ajouterLigne}>
        Ajouter une ligne de dépense
      </Button>

      <div className="grid grid-cols-1 gap-4 rounded-md bg-muted p-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Total des dépenses déclarées
          </p>
          <p className="text-sm font-semibold text-foreground">{totalDeclare.toLocaleString("fr-FR")} FCFA</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Montant à retourner (calculé)
          </p>
          <p className="text-sm font-semibold text-foreground">{montantARetourner.toLocaleString("fr-FR")} FCFA</p>
        </div>
      </div>

      {erreur ? <p className="text-sm text-danger">{erreur}</p> : null}

      <div className="flex flex-wrap gap-3">
        <Button type="button" loading={isPending} onClick={handleSubmit}>
          Déclarer le retour
        </Button>
        <Button type="button" variant="secondary" disabled={isPending} onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </div>
  );
}
