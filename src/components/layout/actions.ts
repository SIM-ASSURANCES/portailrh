"use server";

import { signOut } from "@/lib/auth";

/**
 * Déconnecte l'utilisateur puis renvoie vers /login. Utilisé par le bouton
 * « Déconnexion » de la sidebar (formulaire server action).
 */
export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
