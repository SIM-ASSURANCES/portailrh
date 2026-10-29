"use client";

import { createContext, useContext } from "react";

export interface ValeurSignature {
  /** Le compte connecté a-t-il déjà une signature enrôlée ? */
  aSignature: boolean;
  /** Ouvre la fenêtre de création ; résout `true` si la signature a été enregistrée. */
  demanderSignature: () => Promise<boolean>;
}

// Hors fournisseur (pages sans coquille) : rien n'est bloqué côté écran ; le serveur, lui, refuse toujours une action signée sans signature.
export const ContexteParDefaut: ValeurSignature = { aSignature: true, demanderSignature: async () => true };
export const Contexte = createContext<ValeurSignature>(ContexteParDefaut);

export function useSignature(): ValeurSignature {
  return useContext(Contexte);
}
