"use server";

import path from "node:path";

import { revalidatePath } from "next/cache";

import { getSession, hasPermission, isAdmin } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import {
  ACTION_SIMULATION,
  ReinitialisationError,
  desactiverComptesDeTest,
  enregistrerNettoyageFichiers,
  executerReinitialisation,
  leverVerrouReinitialisation,
  listerReinitialisations,
  lireEtatEtapes,
  refusLeveeVerrou,
  refusPurge,
  simulerReinitialisationDetaillee,
  supprimerFichiersUploads,
  tracerEtapeReinitialisation,
  type SimulationDetaillee,
} from "backend";

type Resultat = { status: "success" | "error"; message: string; decompte?: Record<string, number> };

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

const NON_AUTORISE = { status: "error" as const, message: "Action non autorisée." };

/**
 * Étape 1 — SIMULATION (aucune suppression) : décompte de ce qui sera supprimé et conservé, table par table, avec
 * l'avertissement de caisse. Tracée dans l'audit (qui, quand) : c'est elle qui ouvre l'étape suivante. `systeme.reinitialiser`.
 */
export async function simulerAction(): Promise<
  { status: "success"; simulation: SimulationDetaillee } | { status: "error"; message: string }
> {
  const session = await getSession();
  if (!session || !hasPermission(session, "systeme.reinitialiser")) return NON_AUTORISE;
  const simulation = await simulerReinitialisationDetaillee();
  await tracerEtapeReinitialisation(
    session.user.id,
    ACTION_SIMULATION,
    `Simulation de la remise à zéro : ${simulation.totalSupprime} ligne(s) à supprimer, ${simulation.fichiers} fichier(s), ${simulation.caisse.lignes} écriture(s) de caisse (solde ${simulation.caisse.solde}).`
  );
  revalidatePath("/systeme/reinitialisation");
  return { status: "success", simulation };
}

/**
 * Étape 3 — LEVÉE DU VERROU (seulement s'il existe) : sauvegarde téléchargée, phrase exacte et motif obligatoires.
 * UPDATE qui garde la ligne d'audit (jamais DELETE), tracé.
 */
export async function leverVerrouAction(phrase: string, motif: string): Promise<Resultat> {
  const session = await getSession();
  if (!session || !hasPermission(session, "systeme.reinitialiser")) return NON_AUTORISE;
  const { etat } = await lireEtatEtapes(session.user.id);
  const refus = refusLeveeVerrou(etat, { phrase, motif });
  if (refus) return { status: "error", message: refus };
  try {
    const { leves } = await leverVerrouReinitialisation({ userId: session.user.id, motif });
    revalidatePath("/", "layout");
    publishDataChanged();
    return { status: "success", message: `Verrou levé (${leves} ligne d'audit conservée). Vous pouvez maintenant exécuter la remise à zéro (étape 4).` };
  } catch (e) {
    if (e instanceof ReinitialisationError) return { status: "error", message: e.message };
    return { status: "error", message: "Erreur pendant la levée du verrou : rien n'a été modifié." };
  }
}

/**
 * Étape 4 — REMISE À ZÉRO : mêmes gardes que la ligne de commande (`executerReinitialisation`, une seule transaction) plus
 * l'ordre des étapes (simulation, sauvegarde téléchargée par ce compte, verrou levé), lu dans l'audit. Les fichiers de
 * uploads/ ne sont supprimés qu'APRÈS le commit ; un échec de fichier n'annule rien. Le verrou est reposé par la purge.
 */
export async function reinitialiserAction(confirmation: string, sauvegardeSha256: string): Promise<Resultat> {
  const session = await getSession();
  if (!session || !hasPermission(session, "systeme.reinitialiser")) return NON_AUTORISE;
  const { etat, empreinteSauvegarde } = await lireEtatEtapes(session.user.id);
  const refus = refusPurge(etat, { phrase: confirmation, empreinte: sauvegardeSha256, empreinteSauvegardee: empreinteSauvegarde });
  if (refus) return { status: "error", message: refus };

  let resultat;
  try {
    resultat = await executerReinitialisation({ userId: session.user.id, sauvegardeSha256 });
  } catch (e) {
    if (e instanceof ReinitialisationError) {
      return { status: "error", message: e.message };
    }
    // P2002 (verrou unique) / P2034 (conflit d'écriture sérialisable) = exécution concurrente ; sinon erreur inattendue.
    // Dans tous les cas la transaction est annulée : rien n'a été supprimé par CETTE tentative.
    const code = typeof e === "object" && e !== null && "code" in e ? (e as { code?: string }).code : undefined;
    const message =
      code === "P2002" || code === "P2034"
        ? "Une autre exécution de la réinitialisation est en cours ou vient d'aboutir : cette tentative n'a rien supprimé (transaction annulée)."
        : "Erreur pendant la réinitialisation : aucune donnée n'a été supprimée (transaction annulée).";
    return { status: "error", message };
  }

  // Après le commit : fichiers référencés par les PieceJointe supprimées (garde anti path traversal).
  const { supprimes, echecs } = await supprimerFichiersUploads(resultat.urlsFichiers, UPLOAD_DIR);
  await enregistrerNettoyageFichiers(resultat.id, supprimes, echecs);

  revalidatePath("/", "layout");
  publishDataChanged();

  const total = Object.values(resultat.decompte).reduce((a, b) => a + b, 0);
  return {
    status: "success",
    message: `Remise à zéro effectuée : ${total} ligne(s) supprimée(s), ${supprimes} fichier(s) supprimé(s)${
      echecs > 0 ? ` (${echecs} fichier(s) non supprimé(s), à nettoyer à la main)` : ""
    }. Le verrou est reposé. Étapes suivantes : désactiver les comptes de test et saisir le solde d'ouverture de caisse.`,
    decompte: resultat.decompte,
  };
}

/**
 * Après la remise à zéro : DÉSACTIVE (jamais ne supprime) les comptes de test choisis. Admin ou DG ; une remise à zéro doit
 * avoir été enregistrée. Jamais le compte connecté, ni un responsable de service, ni le dernier compte qui porte
 * `systeme.reinitialiser` : le plan est recalculé côté serveur à partir de l'état courant, jamais de la liste affichée.
 */
export async function desactiverComptesDeTestAction(
  ids: string[],
  confirme: boolean
): Promise<Resultat & { refuses?: Array<{ email: string; raison: string }> }> {
  const session = await getSession();
  if (!session || !(isAdmin(session) || hasPermission(session, "systeme.reinitialiser"))) return NON_AUTORISE;
  if ((await listerReinitialisations()).length === 0) {
    return { status: "error", message: "Aucune remise à zéro n'a été enregistrée : ce panneau n'est disponible qu'après la remise à zéro." };
  }
  if (!confirme) return { status: "error", message: "Confirmez la désactivation des comptes listés." };
  if (!Array.isArray(ids) || ids.length === 0) return { status: "error", message: "Sélectionnez au moins un compte." };

  const r = await desactiverComptesDeTest({ acteurId: session.user.id, ids });
  revalidatePath("/systeme/reinitialisation");
  revalidatePath("/admin/users");
  publishDataChanged();
  const refuses = r.refuses.map((x) => ({ email: x.compte.email, raison: x.raison }));
  if (r.desactives.length === 0) {
    return { status: "error", message: "Aucun compte n'a pu être désactivé.", refuses };
  }
  return {
    status: "success",
    message: `${r.desactives.length} compte(s) de test désactivé(s)${refuses.length ? `, ${refuses.length} non désactivé(s) (voir la liste)` : ""}.`,
    refuses,
  };
}
