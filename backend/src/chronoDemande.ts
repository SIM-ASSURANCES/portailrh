// Chronomètre de rappel d'une demande (lot C, 2026-10-20) : UN SEUL chrono par demande (`Demande.etapeCircuitDepuis`), remis à
// zéro à chaque événement d'un article — décision (déjà fait par `circuitDemandeDb.ts`), mais aussi règlement, retour de
// caisse, dépenses détaillées, régularisation. Le rappel des 48 h repart donc de l'événement le plus récent de la demande.
//
// Ne lève jamais : l'événement est déjà enregistré, un échec de cette remise à zéro ne doit pas le faire échouer.

import type { Prisma } from "./generated/prisma/client";
import { prisma } from "./prisma";

type DbChrono = Pick<Prisma.TransactionClient, "demande">;

export async function remettreChronoDemande(demandeId: string | null | undefined, db: DbChrono = prisma): Promise<void> {
  if (!demandeId) return;
  try {
    await db.demande.updateMany({ where: { id: demandeId }, data: { etapeCircuitDepuis: new Date() } });
  } catch (e) {
    console.error(`[Circuit] Chronomètre de la demande ${demandeId} non remis à zéro :`, e);
  }
}
