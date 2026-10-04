import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { RechercheContrats } from "@/components/encaissements/RechercheContrats";
import { getSession, hasPermission } from "@/lib/auth";

/**
 * Garde de tout l'espace /encaissements : `enc.consulter` obligatoire (voir docs/encaissements-conception.md §4).
 * Chaque page et chaque action du module revérifient en plus leur propre permission (jamais ce layout seul).
 * Porte aussi la barre de recherche du module (F2, commit 5a) — jamais dans l'en-tête global du portail.
 */
export default async function EncaissementsLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "enc.consulter")) {
    redirect("/?error=acces_refuse_encaissements");
  }
  return (
    <>
      <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
        <RechercheContrats />
      </div>
      {children}
    </>
  );
}
