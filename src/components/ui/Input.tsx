import { forwardRef, useId } from "react";
import type { InputHTMLAttributes } from "react";

import { FormField } from "./FormField";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

/**
 * Champ texte standard, avec label/erreur intégrés via FormField.
 *
 * Exemple :
 *   <Input label="Email" type="email" required error={errors.email} {...register} />
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, id, required, className = "", ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;

    return (
      <FormField label={label} htmlFor={inputId} required={required} error={error} hint={hint}>
        <input
          ref={ref}
          id={inputId}
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

Input.displayName = "Input";
