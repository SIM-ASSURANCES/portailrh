"use client";

import { useActionState } from "react";
import { toast } from "sonner";

import { Button, Input, Select } from "@/components/ui";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE } from "@/lib/validation";

import { creerInvitationAction } from "./actions";

/**
 * Deuxième méthode de création de compte, complémentaire à
 * `UserCreateForm` (jamais un remplacement) — voir CLAUDE.md "Invitation
 * par lien". Pas de mot de passe saisi ici : le lien généré est affiché
 * après succès, à l'Admin de le transmettre lui-même (aucun envoi
 * automatique d'email dans le projet).
 */
export function InvitationCreateForm({ roles }: { roles: { id: string; name: string }[] }) {
  const [state, formAction, isPending] = useActionState(creerInvitationAction, IDLE_ACTION_STATE);
  useActionFeedback(state);

  const invitationUrl = state.status === "success" ? state.data?.invitationUrl : undefined;

  function handleCopy() {
    if (!invitationUrl) return;
    navigator.clipboard.writeText(invitationUrl).then(
      () => toast.success("Lien copié dans le presse-papiers."),
      () => toast.error("Impossible de copier le lien — sélectionnez-le manuellement.")
    );
  }

  return (
    <div className="space-y-4">
      <form
        action={formAction}
        className="grid grid-cols-1 gap-4 rounded-md border border-border p-4 sm:grid-cols-2"
      >
        <Input
          name="fullName"
          label="Nom complet"
          required
          error={state.status === "error" ? state.fieldErrors?.fullName : undefined}
        />
        <Input
          name="email"
          label="Email"
          type="email"
          required
          error={state.status === "error" ? state.fieldErrors?.email : undefined}
        />
        <Select
          name="roleId"
          label="Rôle"
          placeholder="Sélectionner..."
          required
          options={roles.map((role) => ({ value: role.id, label: role.name }))}
          error={state.status === "error" ? state.fieldErrors?.roleId : undefined}
        />
        <div className="sm:col-span-2">
          <Button type="submit" loading={isPending}>
            Générer le lien d&apos;invitation
          </Button>
        </div>
      </form>

      {invitationUrl ? (
        <div className="animate-fade-in-up space-y-2 rounded-md border border-success-border bg-success-bg p-4">
          <p className="text-sm font-medium text-success">
            Invitation créée — transmettez ce lien vous-même (email personnel, WhatsApp...) :
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1.5 text-xs text-foreground">
              {invitationUrl}
            </code>
            <Button type="button" variant="secondary" onClick={handleCopy}>
              Copier le lien
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Ce lien expire dans 7 jours.</p>
        </div>
      ) : null}
    </div>
  );
}
