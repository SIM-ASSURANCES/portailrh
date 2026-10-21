"use server";

import path from "node:path";

import { revalidatePath } from "next/cache";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import {
  CONFIRMATION_REINITIALISATION,
  ReinitialisationError,
  enregistrerNettoyageFichiers,
  executerReinitialisation,
  reinitialisationEffectuee,
  supprimerFichiersUploads,
} from "backend";

type Resultat = { status: "success" | "error"; message: string; decompte?: Record<string, number> };

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

/**
 * Réinitialisation À USAGE UNIQUE (voir CLAUDE.md "Réinitialisation avant mise en production") : `systeme.reinitialiser`
 * (DG seul), mot exact de confirmation, empreinte de la sauvegarde téléchargée, une seule transaction. Les fichiers
 * de uploads/ ne sont supprimés qu'APRÈS le commit (hors transaction) ; un échec de fichier n'annule rien.
 */
export async function reinitialiserAction(confirmation: string, sauvegardeSha256: string): Promise<Resultat> {
  const session = await getSession();
  if (!session || !hasPermission(session, "systeme.reinitialiser")) {
    return { status: "error", message: "Action non autorisée." };
  }
  if (confirmation !== CONFIRMATION_REINITIALISATION) {
    return { status: "error", message: `Tapez exactement « ${CONFIRMATION_REINITIALISATION} » pour confirmer.` };
  }
  if (!sauvegardeSha256 || !/^[0-9a-f]{64}$/.test(sauvegardeSha256)) {
    return { status: "error", message: "Générez et téléchargez d'abord la sauvegarde." };
  }
  if (await reinitialisationEffectuee()) {
    return {
      status: "error",
      message: "La réinitialisation a déjà été effectuée : elle ne peut être exécutée qu'une seule fois.",
    };
  }

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
    message: `Réinitialisation effectuée : ${total} ligne(s) supprimée(s), ${supprimes} fichier(s) supprimé(s)${
      echecs > 0 ? ` (${echecs} fichier(s) non supprimé(s), à nettoyer à la main)` : ""
    }. La date de cette purge est enregistrée : la détection des absences ne remontera jamais avant elle.`,
    decompte: resultat.decompte,
  };
}
