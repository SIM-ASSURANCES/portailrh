"use server";

import { revalidatePath } from "next/cache";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import {
  CONFIRMATION_MISE_EN_SERVICE_POINTAGE,
  CONFIRMATION_REINITIALISATION_POINTAGE,
  PERMISSION_REINITIALISER_POINTAGE,
  ReinitialisationPointageError,
  executerReinitialisationPointage,
  mettreEnServicePointage,
  pointageEnService,
} from "backend";

type Resultat = { status: "success" | "error"; message: string; decompte?: Record<string, number> };

const INFO_ABSENCES_APRES_PURGE =
  "La date de cette purge est enregistrée : le planificateur ne recrée aucune absence antérieure au lendemain de la purge (SYSTEM_START_DATE reste un plancher, sans réglage à faire).";

/**
 * Purge du Pointage SEUL (voir CLAUDE.md « Réinitialisation du Pointage ») : `pointage.reinitialiser` (jamais le
 * contournement estAdmin), mot exact revérifié ici, empreinte de la sauvegarde téléchargée, une seule transaction.
 */
export async function reinitialiserPointageAction(confirmation: string, sauvegardeSha256: string): Promise<Resultat> {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSION_REINITIALISER_POINTAGE)) {
    return { status: "error", message: "Action non autorisée." };
  }
  if (confirmation !== CONFIRMATION_REINITIALISATION_POINTAGE) {
    return { status: "error", message: `Tapez exactement « ${CONFIRMATION_REINITIALISATION_POINTAGE} » pour confirmer.` };
  }
  if (!sauvegardeSha256 || !/^[0-9a-f]{64}$/.test(sauvegardeSha256)) {
    return { status: "error", message: "Générez et téléchargez d'abord la sauvegarde." };
  }
  if (await pointageEnService()) {
    return { status: "error", message: "Le Pointage est en service : sa purge est définitivement refusée." };
  }

  try {
    const r = await executerReinitialisationPointage({ userId: session.user.id, sauvegardeSha256 });
    revalidatePath("/", "layout");
    publishDataChanged();
    const total = Object.values(r.decompte).reduce((a, b) => a + b, 0);
    return {
      status: "success",
      message: `Purge du Pointage effectuée : ${total} ligne(s) supprimée(s). ${INFO_ABSENCES_APRES_PURGE}`,
      decompte: r.decompte,
    };
  } catch (e) {
    if (e instanceof ReinitialisationPointageError) return { status: "error", message: e.message };
    // P2002 / P2034 = exécution concurrente (conflit d'écriture sérialisable) ; sinon erreur inattendue. Transaction annulée.
    const code = typeof e === "object" && e !== null && "code" in e ? (e as { code?: string }).code : undefined;
    return {
      status: "error",
      message:
        code === "P2002" || code === "P2034"
          ? "Une autre purge du Pointage est en cours ou vient d'aboutir : cette tentative n'a rien supprimé (transaction annulée)."
          : "Erreur pendant la purge : aucune donnée n'a été supprimée (transaction annulée).",
    };
  }
}

/** « Mettre le Pointage en service » : marqueur définitif, confirmation forte, même permission. */
export async function mettreEnServicePointageAction(confirmation: string): Promise<Resultat> {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSION_REINITIALISER_POINTAGE)) {
    return { status: "error", message: "Action non autorisée." };
  }
  if (confirmation !== CONFIRMATION_MISE_EN_SERVICE_POINTAGE) {
    return { status: "error", message: `Tapez exactement « ${CONFIRMATION_MISE_EN_SERVICE_POINTAGE} » pour confirmer.` };
  }
  try {
    await mettreEnServicePointage(session.user.id);
  } catch (e) {
    if (e instanceof ReinitialisationPointageError) return { status: "error", message: e.message };
    return { status: "error", message: "Erreur pendant la mise en service : rien n'a été enregistré." };
  }
  revalidatePath("/", "layout");
  publishDataChanged();
  return { status: "success", message: "Le Pointage est en service : sa purge est désormais définitivement refusée." };
}
