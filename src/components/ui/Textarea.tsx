import { forwardRef, useId } from "react";
import type { TextareaHTMLAttributes } from "react";

import { FormField } from "./FormField";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

/**
 * Zone de texte multi-lignes, avec label/erreur intégrés via FormField.
 *
 * Exemple :
 *   <Textarea label="Commentaire" rows={4} error={errors.commentaire} />
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, hint, id, required, className = "", ...props }, ref) => {
    const generatedId = useId();
    const textareaId = id ?? generatedId;

    return (
      <FormField label={label} htmlFor={textareaId} required={required} error={error} hint={hint}>
        <textarea
          ref={ref}
          id={textareaId}
          required={required}
          aria-invalid={Boolean(error)}
          className={`block w-full rounded-md border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-2 focus:outline-offset-2 focus:outline-primary disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground ${
            error ? "border-danger" : "border-border"
          } ${className}`}
          {...props}
        />
      </FormField>
    );
  }
);

Textarea.displayName = "Textarea";
