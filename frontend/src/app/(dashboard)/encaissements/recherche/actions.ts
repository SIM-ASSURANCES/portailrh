"use server";

import { getSession, hasPermission } from "@/lib/auth";
import { rechercherResumesContrats, type ResumeContrat } from "@/lib/encaissements/resumesContrats";

/** Nombre de suggestions sous la barre de recherche ; la page de résultats en montre davantage. */
const SUGGESTIONS_MAX = 8;
const SAISIE_MAX = 200;

/** Suggestions de la barre de recherche (F2) — lecture seule, `enc.consulter` (Finance, Technique, Consultation). */
export async function suggererContratsAction(saisie: string): Promise<ResumeContrat[]> {
  const session = await getSession();
  if (!session || !hasPermission(session, "enc.consulter")) return [];
  if (typeof saisie !== "string") return [];
  return rechercherResumesContrats(saisie.slice(0, SAISIE_MAX), SUGGESTIONS_MAX);
}
