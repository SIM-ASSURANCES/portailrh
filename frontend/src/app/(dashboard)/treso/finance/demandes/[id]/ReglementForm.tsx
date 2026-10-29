"use client";

import { useActionState, useEffect, useState } from "react";

import { Button, InputMontant, Select, Textarea } from "@/components/ui";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE, MOTIF_REGLEMENT_MIN, refusMotifReglement } from "backend/client";

import { creerReglementAction } from "./reglementActions";

/**
 * Formulaire "Ajouter un règlement" — repliable, affiché dès que le reste
 * à régler > 0 (vérifié par la page appelante). Le montant maximal (`max`)
 * donne un premier refus côté client via la validation native du
 * navigateur ; l'autorité reste la Server Action, qui revérifie le reste à
 * régler côté serveur.
 *
 * **`disabled`** (Tâche "Séparation Responsable Finance / Assistant
 * Finance") — le bouton d'entrée reste VISIBLE mais désactivé pour un
 * compte sans `treso.effectuer_reglement` (ex: le Responsable Finance),
 * jamais absent : empêche d'ouvrir le formulaire plutôt que de le
 * masquer, même principe que `ValidationActions`.
 *
 * **`ligneDemandeId`** (lot D, « un règlement = un article ») — l'article réglé, transmis en champ caché ; absent pour une
 * demande sans article (dépense directe). Le budget est alloué à 100 % à la catégorie de l'article, côté serveur.
 */
export function ReglementForm({
  demandeId,
  ligneDemandeId,
  libelleArticle,
  resteARegler,
  disabled = false,
  raisonIndisponible = null,
}: {
  demandeId: string;
  /** Article réglé (lot D) ; absent pour une demande sans article. */
  ligneDemandeId?: string;
  libelleArticle?: string;
  resteARegler: number;
  disabled?: boolean;
  /** Phrase affichée sous le bouton grisé à la place du message de rôle (conflit d'intérêts). */
  raisonIndisponible?: string | null;
}) {
  const [state, formAction, isPending] = useActionState(creerReglementAction, IDLE_ACTION_STATE);
  const [open, setOpen] = useState(false);
  const [montant, setMontant] = useState("");
  // Lot I : motif / nature du règlement, obligatoire ; le bouton reste grisé tant qu'il est trop court (revérifié serveur).
  const [motif, setMotif] = useState("");
  const motifRefuse = refusMotifReglement(motif);
  useActionFeedback(state);

  useEffect(() => {
    if (state.status === "success") {
      // Referme le formulaire après une création réussie : réaction à un
      // résultat de Server Action (via useActionState), pas un état dérivé
      // au rendu — même cas que le pattern déjà justifié dans AppShell.tsx.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- réaction ponctuelle à un ActionState de succès, pas un état dérivé du rendu
      setOpen(false);
      setMontant("");
      setMotif("");
    }
  }, [state]);

  if (!open) {
    // Couleur primaire (Tâche navigation/UX) : c'est la seule action
    // proposée par cette section tant qu'aucun règlement n'existe encore
    // — mérite la même visibilité que "Confirmer" une fois le formulaire
    // ouvert, pas un gris secondaire pour l'action qui déclenche tout le
    // reste du cycle de règlement.
    return (
      <div className="space-y-1">
        <Button type="button" disabled={disabled} onClick={() => setOpen(true)}>
          Ajouter un règlement
        </Button>
        {disabled ? (
          <p className="text-xs text-muted-foreground">
            {raisonIndisponible ?? "Votre rôle ne permet pas d'effectuer de règlement."}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form action={formAction} className="animate-fade-in-up space-y-4 rounded-md border border-border p-4">
      <input type="hidden" name="demandeId" value={demandeId} />
      {ligneDemandeId ? <input type="hidden" name="ligneDemandeId" value={ligneDemandeId} /> : null}
      {libelleArticle ? <p className="text-sm text-muted-foreground">Article : {libelleArticle}</p> : null}
      <InputMontant
        name="montant"
        label="Montant"
        required
        hint={`Reste à régler : ${resteARegler.toLocaleString("fr-FR")} FCFA`}
        value={montant}
        onValueChange={setMontant}
        error={state.status === "error" ? state.fieldErrors?.montant : undefined}
      />
      <Textarea
        name="motif"
        label="Motif / nature du règlement"
        required
        rows={2}
        hint={`Obligatoire (${MOTIF_REGLEMENT_MIN} caractères minimum), pour la caisse comme pour la banque.`}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        error={state.status === "error" ? state.fieldErrors?.motif : undefined}
      />
      <Select
        name="mode"
        label="Mode de règlement"
        required
        options={[
          { value: "CAISSE", label: "Caisse" },
          { value: "BANQUE", label: "Banque" },
        ]}
        error={state.status === "error" ? state.fieldErrors?.mode : undefined}
      />

      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={isPending} disabled={motifRefuse !== null}>
          Créer le règlement
        </Button>
        <Button type="button" variant="secondary" disabled={isPending} onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
