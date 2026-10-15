import { access } from "node:fs/promises";
import path from "node:path";
import { cheminPieceConge, type PieceEntree } from "backend";

export const DOSSIER_PIECES_CONGES = path.join(process.cwd(), "uploads", "conges");

/** Vérifie que chaque pièce annoncée existe réellement dans le dossier (déposée par la route d'upload). */
export async function piecesExistent(pieces: readonly PieceEntree[] | undefined): Promise<boolean> {
  for (const p of pieces ?? []) {
    const chemin = cheminPieceConge(DOSSIER_PIECES_CONGES, p.url);
    if (!chemin) return false;
    try {
      await access(chemin);
    } catch {
      return false;
    }
  }
  return true;
}
