// Gestion Compta, lot GC-3h : traitement des anomalies (`CptAnomalie`) signalées par l'import de production.
//
// Une anomalie est « à traiter » tant que personne ne l'a regardée ; la marquer « traitée » ne corrige rien dans les données (un
// contrat reste ce qu'il est) : elle enregistre QUI l'a examinée, QUAND et avec quelle conclusion, pour que la liste des anomalies
// à traiter ne grossisse pas sans fin. Une anomalie traitée ne revient jamais à « à traiter » (l'historique reste lisible).
// Toujours dans la transaction de l'appelant ; copié d'esprit des signalements d'Encaissements, sans aucun import d'`enc*`.

import type { PrismaClient } from "./generated/prisma/client";
import { ecrireAudit } from "./cptAudit";

export type CptAnomaliesDb = Pick<PrismaClient, "cptAnomalie" | "cptAudit">;

export const RESOLUTION_MAX_CPT = 500;
export const RESOLUTION_PAR_DEFAUT_CPT = "Marquée traitée";
/** Au plus 200 anomalies par appel : la liste affichée en compte 50, un lot plus grand ne peut venir que d'un appel direct. */
export const ANOMALIES_PAR_LOT_MAX_CPT = 200;
export const MESSAGE_ANOMALIE_INTROUVABLE_CPT = "Anomalie introuvable.";
export const MESSAGE_ANOMALIE_DEJA_TRAITEE_CPT = "Cette anomalie a déjà été traitée.";

export type ResolutionCpt = { ok: true; resolution: string } | { ok: false; message: string };

/** Conclusion saisie : espaces réduits, facultative (« Marquée traitée » à défaut), 500 caractères au plus. */
export function nettoyerResolutionCpt(texte: unknown): ResolutionCpt {
  if (texte === undefined || texte === null) return { ok: true, resolution: RESOLUTION_PAR_DEFAUT_CPT };
  if (typeof texte !== "string") return { ok: false, message: "Commentaire invalide." };
  const propre = texte.replace(/\s+/g, " ").trim();
  if (propre.length > RESOLUTION_MAX_CPT) return { ok: false, message: `Le commentaire dépasse ${RESOLUTION_MAX_CPT} caractères.` };
  return { ok: true, resolution: propre === "" ? RESOLUTION_PAR_DEFAUT_CPT : propre };
}

export interface ParametresTraitementAnomalie {
  userId: string;
  /** Conclusion saisie (voir `nettoyerResolutionCpt`). */
  resolution?: unknown;
  maintenant?: Date;
  ip?: string | null;
}

export type ResultatTraitementAnomalie = { ok: true } | { ok: false; message: string };

/**
 * Marque UNE anomalie traitée. La mise à jour est conditionnée au statut (`updateMany`) : deux personnes qui la traitent en même
 * temps ne la traitent qu'une fois, la seconde reçoit « déjà traitée ». L'audit est écrit seulement si la mise à jour a réussi.
 */
export async function traiterAnomalieCpt(db: CptAnomaliesDb, anomalieId: string, p: ParametresTraitementAnomalie): Promise<ResultatTraitementAnomalie> {
  const conclusion = nettoyerResolutionCpt(p.resolution);
  if (!conclusion.ok) return conclusion;

  const existante = await db.cptAnomalie.findUnique({ where: { id: anomalieId }, select: { id: true, type: true } });
  if (!existante) return { ok: false, message: MESSAGE_ANOMALIE_INTROUVABLE_CPT };

  const maj = await db.cptAnomalie.updateMany({
    where: { id: anomalieId, statut: "A_TRAITER" },
    data: { statut: "TRAITEE", traiteeParId: p.userId, traiteeAt: p.maintenant ?? new Date(), resolution: conclusion.resolution },
  });
  if (maj.count === 0) return { ok: false, message: MESSAGE_ANOMALIE_DEJA_TRAITEE_CPT };

  await ecrireAudit(db, {
    entite: "CptAnomalie",
    entiteId: anomalieId,
    action: "traitement",
    avant: { statut: "A_TRAITER" },
    apres: { statut: "TRAITEE", type: existante.type },
    motif: conclusion.resolution,
    userId: p.userId,
    ip: p.ip,
  });
  return { ok: true };
}

export interface BilanTraitementLot {
  traitees: number;
  dejaTraitees: number;
  introuvables: number;
}

/** Marque plusieurs anomalies traitées avec la même conclusion ; une anomalie déjà traitée ou inconnue est comptée, jamais bloquante. */
export async function traiterAnomaliesCpt(
  db: CptAnomaliesDb,
  ids: readonly string[],
  p: ParametresTraitementAnomalie
): Promise<{ ok: true; bilan: BilanTraitementLot } | { ok: false; message: string }> {
  const conclusion = nettoyerResolutionCpt(p.resolution);
  if (!conclusion.ok) return conclusion;
  const uniques = [...new Set(ids)];
  if (uniques.length === 0) return { ok: false, message: "Aucune anomalie sélectionnée." };
  if (uniques.length > ANOMALIES_PAR_LOT_MAX_CPT) return { ok: false, message: `Au plus ${ANOMALIES_PAR_LOT_MAX_CPT} anomalies à la fois.` };

  const bilan: BilanTraitementLot = { traitees: 0, dejaTraitees: 0, introuvables: 0 };
  for (const id of uniques) {
    const r = await traiterAnomalieCpt(db, id, { ...p, resolution: conclusion.resolution });
    if (r.ok) bilan.traitees += 1;
    else if (r.message === MESSAGE_ANOMALIE_INTROUVABLE_CPT) bilan.introuvables += 1;
    else bilan.dejaTraitees += 1;
  }
  return { ok: true, bilan };
}
