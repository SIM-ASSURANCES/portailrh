/**
 * Instantané structuré avant/après d'une correction du détail d'un retour de
 * caisse (Tâche "Conserver la trace complète des corrections", voir
 * CLAUDE.md), stocké en JSON dans `HistoriqueEntry.detail` (colonne texte,
 * aucune migration) pour les actions `detaillage_retour` et
 * `correction_signalement_retour`. Les anciennes entrées (simple phrase)
 * restent lisibles : `parseCorrectionDetail` renvoie `null` pour elles.
 */
export interface LigneSnapshot {
  libelle: string;
  montant: number;
  type: "justifiee" | "sans_piece";
  motif: string | null;
  /** `id` d'une `PieceJointe` (téléchargeable via `/api/treso/pieces-jointes/[id]`,
   * y compris après détachement de sa ligne) + nom du fichier stocké. */
  pieceJointe: { id: string; fichier: string } | null;
}

export interface CorrectionDetail {
  v: 1;
  resume: string;
  signalement: string | null;
  avant: LigneSnapshot[];
  apres: LigneSnapshot[];
}

export function parseCorrectionDetail(detail: string | null): CorrectionDetail | null {
  if (!detail || !detail.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(detail) as CorrectionDetail;
    return parsed && parsed.v === 1 && Array.isArray(parsed.avant) && Array.isArray(parsed.apres) ? parsed : null;
  } catch {
    return null;
  }
}

export function snapshotLigne(l: {
  objet: string;
  montant: unknown;
  justification: string;
  motifNonJustifie: string | null;
  pieceJointe: { id: string; url: string } | null;
}): LigneSnapshot {
  return {
    libelle: l.objet,
    montant: Number(l.montant),
    type: l.justification === "SANS_PIECE" ? "sans_piece" : "justifiee",
    motif: l.motifNonJustifie,
    pieceJointe: l.pieceJointe ? { id: l.pieceJointe.id, fichier: l.pieceJointe.url } : null,
  };
}
