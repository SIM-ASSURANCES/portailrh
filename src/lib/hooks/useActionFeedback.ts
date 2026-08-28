"use client";

import { useEffect } from "react";
import { toast } from "sonner";

import type { ActionState } from "@/lib/validation";

/**
 * Relie le retour d'une Server Action (typé `ActionState`, voir
 * `@/lib/validation`) obtenu via `useActionState` à un toast sonner.
 * À appeler dans le Client Component qui pilote le formulaire.
 *
 * Exemple :
 *   "use client";
 *   const [state, formAction, isPending] = useActionState(creerDemandeAction, IDLE_ACTION_STATE);
 *   useActionFeedback(state);
 *
 *   return (
 *     <form action={formAction}>
 *       <Input name="description" label="Description" error={state.status === "error" ? state.fieldErrors?.description : undefined} />
 *       <Button type="submit" loading={isPending}>Créer</Button>
 *     </form>
 *   );
 */
export function useActionFeedback(state: ActionState<unknown>) {
  useEffect(() => {
    if (state.status === "success" && state.message) {
      toast.success(state.message);
    } else if (state.status === "error") {
      toast.error(state.message);
    }
  }, [state]);
}
