/**
 * Forme de retour des Server Actions du Module Pointage RH
 * (`{ success, message, fieldErrors? }`), pilotées côté client par
 * `useActionState` + un toast sonner.
 *
 * NOTE : distincte de `ActionState` de `@/lib/validation` (contrat du
 * Module Trésorerie / Socle, basé sur un champ `status`). Les deux
 * coexistent — ne pas mélanger : un composant Pointage RH importe ce
 * type-ci, un composant Trésorerie celui de `@/lib/validation`.
 *
 * Ce fichier faisait partie de la fusion du Module Pointage RH mais
 * n'avait pas été commité avec les écrans qui en dépendent
 * (`pointage/rh/horaires/*`) — recréé ici à l'identique de ce que ces
 * fichiers attendent, pour que `next build` passe.
 */
export interface ActionState {
  success: boolean;
  message: string;
  /** Erreurs par champ, telles que renvoyées par `zodError.flatten().fieldErrors`. */
  fieldErrors?: Record<string, string[] | undefined>;
}

/** État initial, avant toute soumission. */
export const IDLE_ACTION_STATE: ActionState = { success: false, message: "" };
