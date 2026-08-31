"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui";

/**
 * Bouton de soumission avec état de chargement visuel (spinner + désactivation
 * pendant la Server Action `authenticate`). Purement présentationnel :
 * `useFormStatus` lit l'état natif du <form> parent, aucune logique d'auth
 * n'est dupliquée ici.
 */
export function LoginSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full" loading={pending}>
      Se connecter
    </Button>
  );
}
