"use server";

import { unlink } from "node:fs/promises";
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
} from "backend";

type Resultat = { status: "success" | "error"; message: string; decompte?: Record<string, number> };

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

const RAPPEL_SYSTEM_START_DATE =
  "Pensez à régler SYSTEM_START_DATE sur la date de bascule en production avant la mise en production (.env en local ; docker-compose.raw.yml ou variable Dokploy en production) : le cron d'absences ignore tout ce qui est antérieur.";

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
  let supprimes = 0;
  let echecs = 0;
  for (const url of resultat.urlsFichiers) {
    const chemin = path.resolve(UPLOAD_DIR, url);
    if (!chemin.startsWith(UPLOAD_DIR + path.sep)) {
      echecs++;
      continue;
    }
    try {
      await unlink(chemin);
      supprimes++;
    } catch {
      echecs++;
    }
  }
  await enregistrerNettoyageFichiers(resultat.id, supprimes, echecs);

  revalidatePath("/", "layout");
  publishDataChanged();

  const total = Object.values(resultat.decompte).reduce((a, b) => a + b, 0);
  return {
    status: "success",
    message: `Réinitialisation effectuée : ${total} ligne(s) supprimée(s), ${supprimes} fichier(s) supprimé(s)${
      echecs > 0 ? ` (${echecs} fichier(s) non supprimé(s), à nettoyer à la main)` : ""
    }. ${RAPPEL_SYSTEM_START_DATE}`,
    decompte: resultat.decompte,
  };
}
