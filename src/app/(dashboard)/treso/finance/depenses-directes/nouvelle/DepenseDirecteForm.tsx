"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { BENEFICIAIRE_TYPE_OPTIONS } from "@/components/tresorerie/beneficiaire";
import { NATURE_DEPENSE_DIRECTE_OPTIONS } from "@/components/tresorerie/depenseDirecte";
import { PieceJointeUpload } from "@/components/tresorerie/PieceJointeUpload";
import { Button, Input, Select, Textarea } from "@/components/ui";
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
  const [pieceJointeUrl, setPieceJointeUrl] = useState<string | null>(null);
  const [demandeCreeeId, setDemandeCreeeId] = useState<string | null>(null);

  useEffect(() => {
    if (state.status === "success") {
      // Reste sur place pour proposer les deux redirections possibles
      // (voir la demande créée, ou revenir à la liste des demandes à
      // traiter) plutôt qu'une navigation automatique unique.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- réaction ponctuelle à un ActionState de succès, pas un état dérivé du rendu
      setDemandeCreeeId(state.data?.demandeId ?? null);
    }
  }, [state]);

  if (demandeCreeeId) {
    return (
      <div className="animate-fade-in-up space-y-4 rounded-lg border border-success/30 bg-success-bg p-6 text-center">
        <p className="text-sm font-medium text-success">Dépense directe créée avec succès.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href={`/treso/finance/demandes/${demandeCreeeId}`}>
            <Button type="button">Voir la demande</Button>
          </Link>
          <Button type="button" variant="secondary" onClick={() => router.push("/treso/finance/demandes")}>
            Retour à la liste
          </Button>
        </div>
      </div>
    );
  }

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
        <div className="animate-fade-in-up">
          <Select
            key={`user-${beneficiaireType}`}
            name="beneficiaireUserId"
            label={beneficiaireType === "STAGIAIRE" ? "Compte existant (si le stagiaire en a un)" : "Collaborateur"}
            placeholder="Sélectionner un utilisateur..."
            required={beneficiaireType === "COLLABORATEUR"}
            options={users.map((u) => ({ value: u.id, label: u.label }))}
            error={state.status === "error" ? state.fieldErrors?.beneficiaireUserId : undefined}
          />
        </div>
      ) : null}

      {afficheNomLibre ? (
        <div className="animate-fade-in-up">
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
        </div>
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

      <input type="hidden" name="pieceJointeUrl" value={pieceJointeUrl ?? ""} />
      <PieceJointeUpload onChange={setPieceJointeUrl} />

      <Button type="submit" loading={isPending} className="w-full sm:w-auto">
        Créer la dépense directe
      </Button>
    </form>
  );
}
