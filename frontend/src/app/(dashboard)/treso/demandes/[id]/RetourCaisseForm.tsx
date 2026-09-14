"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, Input, Select, Textarea } from "@/components/ui";
import { JUSTIFICATION_OPTIONS } from "@/components/tresorerie/justification";
import { PieceJointeUpload } from "@/components/tresorerie/PieceJointeUpload";

import { creerRetourCaisseAction, modifierRetourCaisseAction, type LigneDepenseInput } from "./retourActions";

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
 * Appelle directement `creerRetourCaisseAction`/`modifierRetourCaisseAction`
 * (arguments simples, comme `validerComplementaireAction`/
 * `confirmerReglementAction`), pas via `<form action={...}>` : un tableau
 * de lignes ne se prête pas nativement à `FormData`, contrairement à un
 * formulaire à champs plats.
 *
 * Sert aussi bien la **déclaration** (`mode="create"`, défaut) que la
 * **modification** d'un retour existant, pas encore réceptionné
 * (`mode="edit"`, `retourId` + `lignesInitiales` requis) — même formulaire,
 * seule l'action appelée à la soumission diffère. `lignesInitiales`
 * conserve l'`id` de chaque ligne déjà en base : c'est ce qui permet à
 * `modifierRetourCaisseAction` de mettre à jour les lignes conservées EN
 * PLACE plutôt que tout recréer (préserve une éventuelle pièce jointe déjà
 * attachée à une ligne inchangée).
 *
 * **Retour simplifié** (Tâche "Retour de caisse optionnel", voir
 * CLAUDE.md) — uniquement en `mode="create"` : deux champs, date + montant
 * retourné, plutôt que le formulaire détaillé complet, pour le cas courant
 * "rien à détailler". La portion NON retournée (`montantReglement -
 * montantRetourne`) est transmise comme UNE SEULE `DepenseLigne` synthétique
 * (`justification: SANS_PIECE`) — jamais silencieusement perdue de la
 * comptabilité : elle apparaît honnêtement comme "non justifiée" pour
 * Finance (voir CLAUDE.md pour la tension documentée entre cette
 * simplification et le détail par ligne). Si `montantRetourne` égale le
 * montant du règlement (rien dépensé), aucune ligne n'est envoyée —
 * `creerRetourCaisseAction` accepte désormais un tableau vide. Le
 * formulaire détaillé reste disponible via un lien, pour qui a réellement
 * des dépenses à justifier précisément.
 */
export function RetourCaisseForm({
  mode = "create",
  reglementId,
  retourId,
  montantReglement,
  lignesInitiales,
  onCancel,
  onSuccess,
}: {
  mode?: "create" | "edit";
  reglementId: string;
  /** Requis si `mode === "edit"`. */
  retourId?: string;
  montantReglement: number;
  /** Requis si `mode === "edit"` : lignes déjà en base, avec leur `id`. */
  lignesInitiales?: (LigneDepenseInput & { id: string })[];
  onCancel: () => void;
  onSuccess: () => void;
}) {
  // Le mode "édition" reste toujours détaillé (chaque ligne existante porte
  // déjà sa propre date) — le choix simple/détaillé ne concerne que la
  // déclaration initiale.
  const [formeSimple, setFormeSimple] = useState(mode === "create");
  const [dateRetourSimple, setDateRetourSimple] = useState(() => new Date().toISOString().slice(0, 10));
  const [montantRetourneSimple, setMontantRetourneSimple] = useState(String(montantReglement));

  const [lignes, setLignes] = useState<LigneEdit[]>(() =>
    lignesInitiales && lignesInitiales.length > 0
      ? lignesInitiales.map((l) => ({ ...l, key: l.id }))
      : [nouvelleLigne()]
  );
  const [erreur, setErreur] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  const totalDeclare = lignes.reduce((sum, l) => sum + (Number(l.montant) || 0), 0);
  const montantARetourner = Math.max(0, montantReglement - totalDeclare);

  function handleSubmitSimple() {
    const montantRetourne = Number(montantRetourneSimple);
    if (!dateRetourSimple) {
      setErreur("La date du retour est obligatoire.");
      return;
    }
    if (Number.isNaN(montantRetourne) || montantRetourne < 0) {
      setErreur("Le montant retourné doit être un nombre positif ou nul.");
      return;
    }
    if (montantRetourne > montantReglement) {
      setErreur(`Le montant retourné ne peut pas dépasser le montant du règlement (${montantReglement.toLocaleString("fr-FR")} FCFA).`);
      return;
    }
    setErreur(undefined);

    const montantDepense = Math.max(0, montantReglement - montantRetourne);
    const lignesPayload: LigneDepenseInput[] =
      montantDepense > 0
        ? [
            {
              montant: montantDepense,
              objet: "Dépenses non détaillées",
              date: dateRetourSimple,
              justification: "SANS_PIECE",
              commentaire: "Déclaration simplifiée (date + montant) : dépenses non détaillées par le collaborateur.",
            },
          ]
        : [];

    startTransition(async () => {
      const result = await creerRetourCaisseAction(reglementId, lignesPayload, dateRetourSimple);
      if (result.status === "success") {
        toast.success(result.message);
        onSuccess();
      } else {
        toast.error(result.message);
      }
    });
  }

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
      const lignesPayload = lignes.map((l) => ({
        id: mode === "edit" ? l.id : undefined,
        montant: l.montant,
        objet: l.objet,
        date: l.date,
        nature: l.nature,
        justification: l.justification,
        commentaire: l.commentaire,
        pieceJointeUrl: l.pieceJointeUrl,
      }));
      const result =
        mode === "edit" && retourId
          ? await modifierRetourCaisseAction(retourId, lignesPayload)
          : await creerRetourCaisseAction(reglementId, lignesPayload);
      if (result.status === "success") {
        toast.success(result.message);
        onSuccess();
      } else {
        toast.error(result.message);
      }
    });
  }

  if (formeSimple) {
    return (
      <div className="animate-fade-in-up space-y-4 border-t border-border pt-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Date du retour"
            type="date"
            required
            value={dateRetourSimple}
            onChange={(e) => setDateRetourSimple(e.target.value)}
          />
          <Input
            label="Montant retourné"
            type="number"
            inputMode="decimal"
            min="0"
            max={montantReglement}
            step="1"
            required
            hint={`Montant du règlement : ${montantReglement.toLocaleString("fr-FR")} FCFA`}
            value={montantRetourneSimple}
            onChange={(e) => setMontantRetourneSimple(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Le solde éventuellement dépensé ({Math.max(0, montantReglement - (Number(montantRetourneSimple) || 0)).toLocaleString("fr-FR")} FCFA)
          sera enregistré comme une dépense non détaillée. Pour justifier précisément vos dépenses ligne par
          ligne (montant, objet, pièce jointe), utilisez plutôt le{" "}
          <button
            type="button"
            className="text-info underline-offset-4 hover:text-primary hover:underline"
            onClick={() => setFormeSimple(false)}
          >
            formulaire détaillé
          </button>
          .
        </p>

        {erreur ? <p className="text-sm text-danger">{erreur}</p> : null}

        <div className="flex flex-wrap gap-3">
          <Button type="button" loading={isPending} onClick={handleSubmitSimple}>
            Déclarer le retour
          </Button>
          <Button type="button" variant="secondary" disabled={isPending} onClick={onCancel}>
            Annuler
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up space-y-4 border-t border-border pt-4">
      {mode === "create" ? (
        <button
          type="button"
          className="text-xs text-info underline-offset-4 hover:text-primary hover:underline"
          onClick={() => setFormeSimple(true)}
        >
          ← Revenir au formulaire simple (date + montant)
        </button>
      ) : null}
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
            {/* Pièce jointe : uniquement pour une ligne réellement NOUVELLE
                (pas encore en base, `ligne.id` absent) — modifier la pièce
                jointe d'une ligne déjà déclarée n'est pas dans le périmètre
                de la modification d'un retour (seuls montant/objet/date/
                nature/justification/commentaire le sont) ; afficher ce
                champ dessus aurait laissé croire à tort qu'il agit. */}
            {!ligne.id ? (
              <PieceJointeUpload
                label="Pièce jointe (facultatif)"
                onChange={(url) => updateLigne(ligne.key, { pieceJointeUrl: url ?? undefined })}
              />
            ) : null}
          </div>
        ))}
      </div>

      <Button type="button" variant="secondary" onClick={ajouterLigne}>
        Ajouter une ligne de dépense
      </Button>

      <div className="grid grid-cols-1 gap-4 rounded-md bg-muted p-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Total des dépenses effectuées
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
          {mode === "edit" ? "Enregistrer les modifications" : "Déclarer le retour"}
        </Button>
        <Button type="button" variant="secondary" disabled={isPending} onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </div>
  );
}
