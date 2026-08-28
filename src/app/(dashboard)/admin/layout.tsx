import { redirect } from "next/navigation";

import { getSession, isAdmin } from "@/lib/auth";

/**
 * Garde d'accès de toute la console d'administration : réservée au rôle
 * Admin (bypass isAdmin(), pas une permission — voir src/lib/auth.ts).
 * Un utilisateur non-Admin est renvoyé au dashboard avec un toast
 * d'erreur (déclenché depuis (dashboard)/page.tsx via ?error=).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!isAdmin(session)) {
    redirect("/?error=acces_refuse_admin");
  }

  return <>{children}</>;
}
