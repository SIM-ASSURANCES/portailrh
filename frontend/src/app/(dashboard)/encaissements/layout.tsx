import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getSession, hasPermission } from "@/lib/auth";

/**
 * Garde de tout l'espace /encaissements : `enc.consulter` obligatoire (voir docs/encaissements-conception.md §4).
 * Chaque page et chaque action du module revérifient en plus leur propre permission (jamais ce layout seul).
 */
export default async function EncaissementsLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "enc.consulter")) {
    redirect("/?error=acces_refuse_encaissements");
  }
  return children;
}
