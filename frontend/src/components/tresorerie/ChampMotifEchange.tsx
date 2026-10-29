"use client";

import { aideMotifEchange, motifEchangeValide, refusMotifEchange } from "backend/client";

import { Textarea } from "@/components/ui";

/**
 * Champ « Motif » d'un échange entre la Finance et le DG (lot M) : tout envoi de la Finance au DG et toute réponse du DG portent
 * un motif de 10 à 300 caractères. Le champ est TOUJOURS visible à côté du bouton (jamais caché derrière une confirmation) ; le
 * bouton reste grisé tant que `motifEchangeValide(motif)` est faux. Le serveur revérifie toujours (appel direct sans motif refusé).
 */
export function ChampMotifEchange({
  value,
  onChange,
  label = "Motif",
  hint,
  disabled = false,
  rows = 2,
  name,
  id,
}: {
  value: string;
  onChange: (motif: string) => void;
  label?: string;
  /** Précision affichée avant le compteur (ex. « Transmis au DG avec la soumission. »). */
  hint?: string;
  disabled?: boolean;
  rows?: number;
  name?: string;
  id?: string;
}) {
  const erreur = value.length > 0 ? refusMotifEchange(value) : null;
  return (
    <Textarea
      id={id}
      name={name}
      data-motif-echange
      label={label}
      required
      rows={rows}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      hint={`${hint ? `${hint} ` : ""}${aideMotifEchange(value)}`}
      error={erreur ?? undefined}
    />
  );
}

export { motifEchangeValide };
