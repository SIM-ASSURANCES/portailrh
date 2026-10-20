"use client";

import { forwardRef, useCallback, useRef } from "react";
import type { ButtonHTMLAttributes, MouseEvent } from "react";

import { RAPPEL_SIGNATURE_PAR_DEFAUT } from "backend/client";

import { useSignature } from "@/components/signature/contexteBase";

export type ButtonVariant = "primary" | "secondary" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  /**
   * Lot L : l'action déclenchée par ce bouton est SIGNÉE (signature manuscrite enrôlée dans le profil). Le bouton porte une plume et un rappel
   * (infobulle) ; si le compte n'a pas encore de signature, le clic ouvre la création de la signature avant de continuer. Le serveur, lui,
   * refuse de toute façon une action signée sans signature enrôlée.
   */
  signe?: boolean;
  /** Texte du rappel de ce qui est signé (infobulle). */
  signeRappel?: string;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:outline-primary",
  secondary:
    "bg-secondary text-secondary-foreground hover:bg-secondary-hover focus-visible:outline-primary border border-border",
  danger:
    "bg-danger text-danger-foreground hover:bg-danger-hover focus-visible:outline-danger",
};

/**
 * Bouton standard du portail. Utiliser `variant="danger"` uniquement pour
 * les actions destructrices ou irréversibles (rejet, annulation...).
 *
 * Exemple :
 *   <Button variant="primary" loading={isPending}>Enregistrer</Button>
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", loading = false, signe = false, signeRappel, disabled, className = "", children, onClick, title, ...props }, ref) => {
    const { aSignature, demanderSignature } = useSignature();
    const interne = useRef<HTMLButtonElement | null>(null);
    const fusionner = useCallback(
      (el: HTMLButtonElement | null) => {
        interne.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      },
      [ref]
    );
    function gererClic(e: MouseEvent<HTMLButtonElement>) {
      if (signe && !aSignature) {
        // Pas encore de signature : on la crée d'abord, puis l'action reprend (nouveau clic automatique).
        e.preventDefault();
        e.stopPropagation();
        void demanderSignature().then((ok) => {
          if (ok) setTimeout(() => interne.current?.click(), 0);
        });
        return;
      }
      onClick?.(e);
    }
    return (
      <button
        ref={fusionner}
        onClick={gererClic}
        title={signe ? (signeRappel ?? RAPPEL_SIGNATURE_PAR_DEFAUT) : title}
        data-signe={signe ? "true" : undefined}
        disabled={disabled || loading}
        aria-busy={loading}
        className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-[background-color,color,transform] duration-150 ease-out-strong focus-visible:outline-2 focus-visible:outline-offset-2 motion-safe:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 ${variantClasses[variant]} ${className}`}
        {...props}
      >
        {loading ? (
          <svg
            className="h-4 w-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
        ) : null}
        {signe && !loading ? (
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        ) : null}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
