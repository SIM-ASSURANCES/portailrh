import type { ZodError } from "zod";

/**
 * Forme standard du retour d'une Server Action de formulaire, à utiliser
 * partout dans le portail (création de demande, règlement, retour de
 * caisse...) pour que le client sache toujours quoi afficher.
 *
 * - `idle` : état initial, avant toute soumission.
 * - `success` : action réussie, `message` optionnel pour le toast.
 * - `error` : échec. `message` est l'erreur générale (toast), `fieldErrors`
 *   les erreurs par champ (à afficher via la prop `error` de Input/Select/Textarea).
 */
export type ActionState<TData = undefined> =
  | { status: "idle" }
  | { status: "success"; message?: string; data?: TData }
  | { status: "error"; message: string; fieldErrors?: Partial<Record<string, string>> };

export const IDLE_ACTION_STATE: ActionState = { status: "idle" };

/**
 * Convertit les erreurs Zod en `fieldErrors` exploitables par `ActionState`
 * (un seul message par champ, le premier retourné par Zod).
 *
 * Exemple, dans une Server Action :
 *   const parsed = demandeSchema.safeParse(raw);
 *   if (!parsed.success) {
 *     return { status: "error", message: "Formulaire invalide", fieldErrors: fieldErrorsFromZod(parsed.error) };
 *   }
 */
export function fieldErrorsFromZod(error: ZodError): Partial<Record<string, string>> {
  const flattened = error.flatten().fieldErrors as Record<string, string[] | undefined>;
  const fieldErrors: Partial<Record<string, string>> = {};
  for (const [field, messages] of Object.entries(flattened)) {
    if (messages && messages.length > 0) {
      fieldErrors[field] = messages[0];
    }
  }
  return fieldErrors;
}
