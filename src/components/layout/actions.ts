"use server";

import { signOut } from "@/lib/auth";

/**
 * Déconnecte l'utilisateur puis renvoie vers /login. Utilisé par le bouton
 * « Déconnexion » de la sidebar (formulaire server action).
 */
export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}

/**
 * Déconnecte l'utilisateur après une période d'inactivité détectée
 * côté client (voir CLAUDE.md "Déconnexion automatique après inactivité" et
 * `InactivityLogout.tsx`) — même mécanisme que `signOutAction` ci-dessus
 * (`signOut()` server-side de `@/lib/auth`), appelé directement depuis un
 * Client Component via une simple fonction async (pas de `<form>`, comme
 * `validerTotalementAction`/`confirmerReglementAction` ailleurs dans le
 * projet) plutôt que `signOut()` de `next-auth/react` : évite toute
 * dépendance à `NEXTAUTH_URL`/`SessionProvider` côté client (aucun des deux
 * n'est configuré dans ce projet, qui n'utilise `next-auth/react` nulle
 * part ailleurs) pour un comportement strictement identique.
 */
export async function logoutForInactivityAction() {
  await signOut({ redirectTo: "/login?error=inactivite" });
}
