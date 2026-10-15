// Pièces jointes des congés (Lot 3, correction B1 du plan de fusion). Fonctions PURES.
//
// Un nom de pièce n'est JAMAIS une valeur libre du client : seule la route d'upload en produit (UUID + extension),
// et seul un nom de cette forme est accepté par les actions et relu par la route de téléchargement. Sinon un
// collaborateur déposerait « ../../../proc/self/environ » comme pièce, puis la téléchargerait.

import path from "node:path";

export const NOM_PIECE_CONGE_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$/;

export const MESSAGE_PIECE_INVALIDE = "Pièce jointe invalide : déposez le fichier avec le bouton prévu à cet effet.";

export const MAX_PIECES_PAR_DEMANDE = 5;

export function estNomPieceCongeValide(nom: unknown): nom is string {
  return typeof nom === "string" && NOM_PIECE_CONGE_REGEX.test(nom);
}

/**
 * Chemin absolu de la pièce DANS `dossier`, ou `null` si le nom est invalide ou si le chemin résolu en sortirait
 * (défense en profondeur : la regex l'interdit déjà).
 */
export function cheminPieceConge(dossier: string, nom: unknown): string | null {
  if (!estNomPieceCongeValide(nom)) return null;
  const base = path.resolve(dossier);
  const complet = path.resolve(base, nom);
  return complet.startsWith(base + path.sep) ? complet : null;
}

export interface PieceEntree {
  url: string;
  nomFichier?: string;
}

/** Nom d'affichage : sans chemin ni caractère de contrôle, 120 caractères au plus. */
export function nomAffichagePiece(nomFichier: unknown): string {
  const brut = typeof nomFichier === "string" ? nomFichier : "";
  const propre = path.basename(brut.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f"]/g, "").trim();
  return (propre || "Justificatif").slice(0, 120);
}

/** Contrôle la liste de pièces d'une demande (nombre, forme des noms, doublons) ; les noms sont dédoublonnés. */
export function validerPieces(pieces: readonly PieceEntree[] | undefined): { ok: true; pieces: PieceEntree[] } | { ok: false; erreur: string } {
  const liste = pieces ?? [];
  if (liste.length > MAX_PIECES_PAR_DEMANDE) {
    return { ok: false, erreur: `Au plus ${MAX_PIECES_PAR_DEMANDE} pièces jointes par demande.` };
  }
  const vues = new Set<string>();
  const sortie: PieceEntree[] = [];
  for (const p of liste) {
    if (!p || !estNomPieceCongeValide(p.url)) return { ok: false, erreur: MESSAGE_PIECE_INVALIDE };
    if (vues.has(p.url)) continue;
    vues.add(p.url);
    sortie.push({ url: p.url, nomFichier: nomAffichagePiece(p.nomFichier) });
  }
  return { ok: true, pieces: sortie };
}
