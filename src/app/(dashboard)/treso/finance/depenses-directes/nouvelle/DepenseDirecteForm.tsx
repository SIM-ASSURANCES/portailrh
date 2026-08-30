"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { BENEFICIAIRE_TYPE_OPTIONS } from "@/components/tresorerie/beneficiaire";
import { NATURE_DEPENSE_DIRECTE_OPTIONS } from "@/components/tresorerie/depenseDirecte";
import { Button, FormField, Input, Select, Textarea } from "@/components/ui";
import type { BeneficiaireType } from "@/generated/prisma/client";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE } from "@/lib/validation";

import { creerDepenseDirecteAction } from "./actions";

interface UserOption {
  id: string;
  label: string;
}

/**
 * Formulaire de saisie directe (Phase F, cahier des charges section 11).
 * Le champ bénéficiaire s'adapte au type choisi (`beneficiaireType`, suivi
 * en état local pour le rendu conditionnel — même pattern que
 * `CategorisationForm.tsx`, Ticket 2, `defaultValue`/`onChange` plutôt que
 * `value` pour ne jamais entrer en conflit avec le `defaultValue` interne
 * de `Select`) :
 *
 * - COLLABORATEUR — un compte existe toujours : sélecteur d'utilisateur
 *   uniquement.
 * - STAGIAIRE — peut avoir un compte ou non : les deux champs sont
 *   proposés (sélecteur ET nom libre), l'utilisateur choisit celui qui
 *   s'applique ; la cohérence (au moins l'un des deux) est revérifiée côté
 *   serveur (`creerDepenseDirecteAction`).
 * - FOURNISSEUR — jamais de compte : nom libre uniquement.
 * - ENTREPRISE — nom libre, pré-rempli "SIM ASSURANCES CI" (éditable).
 */
export function DepenseDirecteForm({ users }: { users: UserOption[] }) {
  const [state, formAction, isPending] = useActionState(creerDepenseDirecteAction, IDLE_ACTION_STATE);
  const router = useRouter();
  useActionFeedback(state);
  const [beneficiaireType, setBeneficiaireType] = useState<BeneficiaireType>("COLLABORATEUR");

  useEffect(() => {
    if (state.status === "success") {
      router.push("/treso/finance/demandes");
    }
  }, [state, router]);

  const afficheSelecteurUtilisateur = beneficiaireType === "COLLABORATEUR" || beneficiaireType === "STAGIAIRE";
  const afficheNomLibre =
    beneficiaireType === "STAGIAIRE" || beneficiaireType === "FOURNISSEUR" || beneficiaireType === "ENTREPRISE";

  return (
    <form action={formAction} className="space-y-5 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <Select
        name="nature"
        label="Nature de la dépense"
        placeholder="Sélectionner..."
        required
        options={NATURE_DEPENSE_DIRECTE_OPTIONS}
        error={state.status === "error" ? state.fieldErrors?.nature : undefined}
      />

      <Select
        name="beneficiaireType"
        label="Type de bénéficiaire"
        required
        defaultValue={beneficiaireType}
        onChange={(e) => setBeneficiaireType(e.target.value as BeneficiaireType)}
        options={BENEFICIAIRE_TYPE_OPTIONS}
        error={state.status === "error" ? state.fieldErrors?.beneficiaireType : undefined}
      />

      {afficheSelecteurUtilisateur ? (
        <Select
          key={`user-${beneficiaireType}`}
          name="beneficiaireUserId"
          label={beneficiaireType === "STAGIAIRE" ? "Compte existant (si le stagiaire en a un)" : "Collaborateur"}
          placeholder="Sélectionner un utilisateur..."
          required={beneficiaireType === "COLLABORATEUR"}
          options={users.map((u) => ({ value: u.id, label: u.label }))}
          error={state.status === "error" ? state.fieldErrors?.beneficiaireUserId : undefined}
        />
      ) : null}

      {afficheNomLibre ? (
        <Input
          key={`nom-${beneficiaireType}`}
          name="beneficiaireNom"
          label={
            beneficiaireType === "STAGIAIRE"
              ? "Ou nom du stagiaire (s'il n'a pas de compte)"
              : beneficiaireType === "ENTREPRISE"
                ? "Nom de l'entreprise"
                : "Nom du fournisseur / prestataire"
          }
          required={beneficiaireType === "FOURNISSEUR" || beneficiaireType === "ENTREPRISE"}
          defaultValue={beneficiaireType === "ENTREPRISE" ? "SIM ASSURANCES CI" : undefined}
          error={state.status === "error" ? state.fieldErrors?.beneficiaireNom : undefined}
        />
      ) : null}

      <Textarea
        name="description"
        label="Description de la dépense"
        required
        rows={4}
        placeholder="Décrivez précisément cette dépense..."
        error={state.status === "error" ? state.fieldErrors?.description : undefined}
      />

      <Input
        name="montant"
        label="Montant (FCFA)"
        type="number"
        inputMode="decimal"
        min="1"
        step="1"
        required
        placeholder="Ex: 50000"
        error={state.status === "error" ? state.fieldErrors?.montant : undefined}
      />

      <Textarea
        name="commentaire"
        label="Commentaire"
        rows={3}
        hint="Optionnel"
        error={state.status === "error" ? state.fieldErrors?.commentaire : undefined}
      />

      <FormField
        label="Pièce jointe"
        hint="Import de fichiers à venir — le stockage de fichiers n'est pas encore configuré dans le projet."
      >
        <input
          type="file"
          disabled
          aria-disabled="true"
          className="block w-full cursor-not-allowed rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
        />
      </FormField>

      <Button type="submit" loading={isPending} className="w-full sm:w-auto">
        Créer la dépense directe
      </Button>
    </form>
  );
}
