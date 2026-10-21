"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, InputHTMLAttributes } from "react";
import { analyserMontant, libelleMontant, reformaterSaisieMontant } from "backend/client";
import type { ResultatMontant } from "backend/client";

import { FormField } from "./FormField";

export interface InputMontantProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type" | "min" | "max" | "step"> {
  label?: string;
  error?: string;
  hint?: string;
  /** Devise du montant (défaut : FCFA). Une devise à décimales admet « 1 500,50 », le FCFA seulement des entiers. */
  devise?: string | null;
  /** Admet les décimales quelle que soit la devise (ex. Encaissements, qui gardent les centimes). */
  decimales?: boolean;
  /** Mode contrôlé : texte affiché. Sans `value`, le champ garde son propre état (formulaire non contrôlé, `name`). */
  value?: string;
  defaultValue?: string;
  /** Appelé à chaque frappe avec le texte affiché et son analyse (`ok: true` : `valeur`, `centimes`, `canonique`). */
  onValueChange?: (texte: string, resultat: ResultatMontant) => void;
  /** Écho « = 1 500 000 FCFA » sous le champ (défaut : oui). */
  echo?: boolean;
}

/**
 * Champ de montant (lot M) : accepte `1500000`, `1 500 000`, `1.500.000`, `1.500.000,50`, `1500000,5`… (règle unique :
 * `backend/src/montant.ts`). Pendant la frappe : milliers séparés par une espace, virgule décimale, curseur conservé ;
 * le collage depuis Excel est reformaté ; une saisie invalide est laissée telle quelle avec son message (jamais corrigée
 * en silence) et bloque l'envoi du formulaire (`setCustomValidity`). Le serveur réanalyse TOUJOURS le texte reçu : ce
 * champ poste le texte affiché (« 1 500 000,5 »), jamais un nombre de confiance.
 */
export function InputMontant({
  label,
  error,
  hint,
  devise,
  decimales,
  value,
  defaultValue = "",
  onValueChange,
  echo = true,
  id,
  required,
  className = "",
  onBlur,
  ...props
}: InputMontantProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const ref = useRef<HTMLInputElement>(null);
  const [interne, setInterne] = useState(defaultValue);
  const [touche, setTouche] = useState(false);
  const curseurARestaurer = useRef<number | null>(null);
  const texte = value ?? interne;

  const vide = texte.trim() === "";
  const analyse: ResultatMontant = vide ? { ok: false, message: "Saisissez un montant." } : analyserMontant(texte, { devise, decimales });
  const messageInvalide = !vide && !analyse.ok ? analyse.message : null;

  // Bloque l'envoi natif du formulaire tant que la saisie est invalide (le message s'affiche à la validation).
  useEffect(() => {
    ref.current?.setCustomValidity(messageInvalide ?? "");
  }, [messageInvalide]);

  // Un formulaire réinitialisé (React 19 remet les champs à zéro après une Server Action) remet aussi le texte affiché.
  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const surReset = () => {
      setInterne(defaultValue);
      setTouche(false);
    };
    form.addEventListener("reset", surReset);
    return () => form.removeEventListener("reset", surReset);
  }, [defaultValue]);

  useLayoutEffect(() => {
    if (curseurARestaurer.current !== null && ref.current) {
      ref.current.setSelectionRange(curseurARestaurer.current, curseurARestaurer.current);
      curseurARestaurer.current = null;
    }
  });

  function surChangement(e: ChangeEvent<HTMLInputElement>) {
    const brut = e.target.value;
    const { texte: formate, curseur } = reformaterSaisieMontant(brut, e.target.selectionStart ?? brut.length, { devise, decimales });
    curseurARestaurer.current = curseur;
    setInterne(formate);
    onValueChange?.(formate, formate.trim() === "" ? { ok: false, message: "Saisissez un montant." } : analyserMontant(formate, { devise, decimales }));
  }

  const erreurAffichee = error ?? (messageInvalide && (touche || !messageInvalide.startsWith("Montant incomplet")) ? messageInvalide : undefined);

  return (
    <FormField label={label} htmlFor={inputId} required={required} error={erreurAffichee} hint={hint}>
      <input
        ref={ref}
        id={inputId}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        required={required}
        aria-invalid={Boolean(erreurAffichee)}
        data-input-montant
        value={texte}
        onChange={surChangement}
        onBlur={(e) => {
          setTouche(true);
          onBlur?.(e);
        }}
        className={`block w-full rounded-lg border px-3 py-2 text-sm tabular-nums text-foreground placeholder:text-muted-foreground transition-colors duration-150 ease-out-strong hover:border-muted-foreground/60 focus:outline-2 focus:outline-offset-2 focus:outline-primary disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:hover:border-border ${
          erreurAffichee ? "border-danger" : "border-border"
        } ${className}`}
        {...props}
      />
      {echo && analyse.ok ? (
        <p data-echo-montant className="text-sm font-medium text-primary">
          = {libelleMontant(analyse.valeur, devise)}
        </p>
      ) : null}
    </FormField>
  );
}
