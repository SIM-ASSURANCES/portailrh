import { forwardRef, useId } from "react";
import type { SelectHTMLAttributes } from "react";

import { FormField } from "./FormField";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options: SelectOption[];
  /** Texte affiché comme première option désactivée (ex: "Sélectionner..."). */
  placeholder?: string;
}

/**
 * Liste déroulante standard, avec label/erreur intégrés via FormField.
 *
 * Exemple :
 *   <Select
 *     label="Catégorie"
 *     placeholder="Choisir une catégorie"
 *     options={categories.map((c) => ({ value: c.id, label: c.label }))}
 *     error={errors.categorieId}
 *   />
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, hint, id, required, className = "", options, placeholder, ...props }, ref) => {
    const generatedId = useId();
    const selectId = id ?? generatedId;

    return (
      <FormField label={label} htmlFor={selectId} required={required} error={error} hint={hint}>
        <select
          ref={ref}
          id={selectId}
          required={required}
          aria-invalid={Boolean(error)}
          defaultValue={props.defaultValue ?? (placeholder ? "" : undefined)}
          className={`block w-full rounded-md border bg-surface px-3 py-2 text-sm text-foreground transition-colors duration-150 ease-out-strong hover:border-muted-foreground/60 focus:outline-2 focus:outline-offset-2 focus:outline-primary disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:hover:border-border ${
            error ? "border-danger" : "border-border"
          } ${className}`}
          {...props}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </FormField>
    );
  }
);

Select.displayName = "Select";
