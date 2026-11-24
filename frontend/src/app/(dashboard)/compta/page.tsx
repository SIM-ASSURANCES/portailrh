import { redirect } from "next/navigation";

import { getSession, hasPermission } from "@/lib/auth";

/**
 * Le module Gestion Compta n'a plus de page d'accueil : toutes ses rubriques sont dans la barre latérale (voir `navCompta.ts`).
 * `/compta` reste une adresse valide (carte du portail, anciens liens) et mène à la première rubrique construite.
 * Garde revérifiée ici, indépendamment du layout.
 */
export default async function ComptaPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, "cpt.consulter")) {
    redirect("/?error=acces_refuse_compta");
  }
  redirect("/compta/referentiels");
}
