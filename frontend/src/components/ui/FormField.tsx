import type { ReactNode } from "react";

export interface FormFieldProps {
  label?: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}

/**
 * Associe un label, un champ quelconque et un message d'erreur de façon
 * cohérente. `Input`, `Textarea` et `Select` l'utilisent déjà en interne
 * (via leur prop `label`/`error`) : ne composer directement avec `FormField`
 * que pour un champ personnalisé (ex: un composant tiers, un groupe de
 * cases à cocher).
 *
 * Exemple :
 *   <FormField label="Justificatif" htmlFor="piece" required error={error}>
 *     <CustomFileInput id="piece" />
 *   </FormField>
 */
export function FormField({ label, htmlFor, required, error, hint, children }: FormFieldProps) {
  return (
    <div className="space-y-1">
      {label ? (
        <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">
          {label}
          {required ? <span className="text-danger"> *</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : hint ? (
        <p className="text-sm text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
