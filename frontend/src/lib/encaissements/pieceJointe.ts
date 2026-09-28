import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { PrismaClient } from "backend";

/**
 * Pièces jointes du module Encaissements (docs/encaissements-conception.md §5.1, modèle `EncPieceJointe`).
 *
 * Le fichier est déposé par la route d'upload COMMUNE (`POST /api/treso/pieces-jointes/upload`, même dossier
 * `uploads/`), qui ne renvoie que son nom généré. L'action serveur du module appelle ensuite
 * `enregistrerEncPieceJointe`, dans sa propre transaction et après avoir vérifié sa propre permission : les
 * métadonnées (taille, SHA-256, type) sont RECALCULÉES ici depuis le fichier sur disque, jamais reçues du client.
 * Le téléchargement passe par `GET /api/encaissements/pieces-jointes/[id]`, gardé par `enc.consulter`.
 */

export const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

/** Nom produit par la route d'upload : UUID v4 + extension autorisée, rien d'autre. */
const NOM_FICHIER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png)$/;

export const MIME_PAR_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  png: "image/png",
};

export class EncPieceJointeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncPieceJointeError";
  }
}

/** Chemin absolu d'un fichier de `uploads/`, refusé s'il sortirait du dossier (défense contre la traversée). */
export function cheminFichierUpload(url: string): string {
  if (!NOM_FICHIER.test(url)) throw new EncPieceJointeError("Nom de fichier de pièce jointe invalide.");
  const chemin = path.resolve(UPLOAD_DIR, url);
  if (!chemin.startsWith(UPLOAD_DIR + path.sep)) throw new EncPieceJointeError("Chemin de pièce jointe invalide.");
  return chemin;
}

/** Nom d'origine affiché : caractères de contrôle retirés, longueur bornée (information non fiable, jamais un chemin). */
export function nettoyerNomOrigine(nom: string | null | undefined): string | null {
  if (!nom) return null;
  const propre = nom.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
  return propre || null;
}

type EncPieceJointeDb = Pick<PrismaClient, "encPieceJointe" | "pieceJointe">;

/**
 * Enregistre un fichier déjà déposé comme `EncPieceJointe`. À appeler dans la transaction de l'action qui rattache la
 * pièce (après sa propre vérification de permission). Refuse un fichier absent, déjà rattaché au module, ou déjà
 * rattaché à la Trésorerie (une même pièce ne relève jamais de deux règles d'accès).
 */
export async function enregistrerEncPieceJointe(
  db: EncPieceJointeDb,
  params: { url: string; nomOrigine?: string | null; userId: string }
) {
  const chemin = cheminFichierUpload(params.url);

  const [dejaEnc, dejaTreso] = await Promise.all([
    db.encPieceJointe.count({ where: { url: params.url } }),
    db.pieceJointe.count({ where: { url: params.url } }),
  ]);
  if (dejaEnc > 0 || dejaTreso > 0) throw new EncPieceJointeError("Cette pièce jointe est déjà rattachée à un autre enregistrement.");

  let contenu: Buffer;
  try {
    contenu = await readFile(chemin);
  } catch {
    throw new EncPieceJointeError("Fichier de pièce jointe introuvable : téléversez-le de nouveau.");
  }

  const extension = params.url.split(".").pop() as string;
  return db.encPieceJointe.create({
    data: {
      url: params.url,
      nomOrigine: nettoyerNomOrigine(params.nomOrigine),
      mime: MIME_PAR_EXTENSION[extension],
      taille: contenu.length,
      sha256: createHash("sha256").update(contenu).digest("hex"),
      deposeeParId: params.userId,
    },
  });
}
