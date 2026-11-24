import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getSession, hasPermission } from "@/lib/auth";

/**
 * Garde de tout l'espace /compta : `cpt.consulter` obligatoire (voir docs/compta-conception.md §4).
 * Chaque page et chaque action du module revérifient en plus leur propre permission (jamais ce layout seul).
 * Module INDÉPENDANT : aucun import d'un autre module métier (cptIndependance.test.ts le vérifie).
 */
export default async function ComptaLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "cpt.consulter")) {
    redirect("/?error=acces_refuse_compta");
  }
  return <>{children}</>;
}
