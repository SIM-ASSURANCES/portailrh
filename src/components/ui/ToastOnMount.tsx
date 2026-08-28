"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

export interface ToastOnMountProps {
  message: string;
  variant?: "success" | "error" | "info";
}

/**
 * Déclenche un toast une seule fois au montage, puis ne rend rien. Utile
 * pour signaler côté client le résultat d'une redirection décidée côté
 * serveur (ex: accès refusé) sans avoir à transformer toute la page en
 * Client Component.
 *
 * Exemple :
 *   // Server Component, après lecture de searchParams
 *   {error === "acces_refuse_admin" && (
 *     <ToastOnMount variant="error" message="Accès réservé aux administrateurs." />
 *   )}
 */
export function ToastOnMount({ message, variant = "info" }: ToastOnMountProps) {
  const hasFired = useRef(false);

  useEffect(() => {
    if (hasFired.current) return;
    hasFired.current = true;
    toast[variant](message);
  }, [message, variant]);

  return null;
}
