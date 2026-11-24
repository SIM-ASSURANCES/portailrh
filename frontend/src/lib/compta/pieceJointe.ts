import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PrismaClient } from "backend";

/**
 * Pièces jointes du module Gestion Compta (docs/compta-conception.md §5.1, modèle `CptPieceJointe`).
 *
 * Copié de frontend/src/lib/encaissements/pieceJointe.ts le 2026-10-26 — Gestion Compta est indépendant : toute correction
 * se reporte à la main. Deux différences avec l'original : (1) ce module sait aussi DÉPOSER le fichier (`deposerFichierCpt`),
 * pour que les routes d'upload n'écrivent jamais elles-mêmes sur le disque ; (2) aucun contrôle croisé avec les pièces
 * jointes d'un autre module (l'unicité de `CptPieceJointe.url` suffit : une pièce ne se rattache qu'une fois).
 *
 * Le fichier va dans `uploads/` (le volume Docker), sous un nom ENTIÈREMENT généré (UUID + extension) : jamais dérivé du
 * nom d'origine, donc ni collision ni traversée de chemin. Les métadonnées (taille, SHA-256, type) sont RECALCULÉES
 * depuis le fichier sur disque, jamais reçues du client.
 */

export const UPLOAD_DIR_CPT = path.resolve(process.cwd(), "uploads");

/** Nom produit par ce module : UUID v4 + extension autorisée, rien d'autre. */
const NOM_FICHIER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|xls|xlsx|csv)$/;

export type ExtensionCpt = "pdf" | "jpg" | "png" | "xls" | "xlsx" | "csv";

export const MIME_PAR_EXTENSION_CPT: Record<ExtensionCpt, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  png: "image/png",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
};

export class CptPieceJointeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CptPieceJointeError";
  }
}

/** Chemin absolu d'un fichier de `uploads/`, refusé s'il sortirait du dossier (défense contre la traversée). */
export function cheminFichierCpt(url: string): string {
  if (!NOM_FICHIER.test(url)) throw new CptPieceJointeError("Nom de fichier de pièce jointe invalide.");
  const chemin = path.resolve(UPLOAD_DIR_CPT, url);
  if (!chemin.startsWith(UPLOAD_DIR_CPT + path.sep)) throw new CptPieceJointeError("Chemin de pièce jointe invalide.");
  return chemin;
}

/** Nom d'origine affiché : caractères de contrôle retirés, longueur bornée (information non fiable, jamais un chemin). */
export function nettoyerNomOrigineCpt(nom: string | null | undefined): string | null {
  if (!nom) return null;
  const propre = nom.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
  return propre || null;
}

/** Écrit le fichier dans `uploads/` sous un nom généré et renvoie ce nom (la future `url` de la pièce jointe). */
export async function deposerFichierCpt(contenu: Buffer, extension: ExtensionCpt): Promise<string> {
  await mkdir(UPLOAD_DIR_CPT, { recursive: true });
  const url = `${randomUUID()}.${extension}`;
  await writeFile(cheminFichierCpt(url), contenu);
  return url;
}

/** Supprime un fichier déposé dont l'enregistrement a échoué (jamais d'erreur : c'est un nettoyage au mieux). */
export async function retirerFichierCpt(url: string): Promise<void> {
  try {
    await unlink(cheminFichierCpt(url));
  } catch {
    /* fichier déjà absent ou nom invalide : rien à nettoyer */
  }
}

type CptPieceJointeDb = Pick<PrismaClient, "cptPieceJointe">;

/**
 * Enregistre un fichier déjà déposé comme `CptPieceJointe`. À appeler dans la transaction de l'action qui rattache la
 * pièce, après sa propre vérification de permission. Refuse un fichier absent ou déjà enregistré.
 */
export async function enregistrerCptPieceJointe(
  db: CptPieceJointeDb,
  params: { url: string; nomOrigine?: string | null; userId: string }
) {
  const chemin = cheminFichierCpt(params.url);

  if ((await db.cptPieceJointe.count({ where: { url: params.url } })) > 0) {
    throw new CptPieceJointeError("Cette pièce jointe est déjà enregistrée.");
  }

  let contenu: Buffer;
  try {
    contenu = await readFile(chemin);
  } catch {
    throw new CptPieceJointeError("Fichier de pièce jointe introuvable : téléversez-le de nouveau.");
  }

  const extension = params.url.split(".").pop() as ExtensionCpt;
  return db.cptPieceJointe.create({
    data: {
      url: params.url,
      nomOrigine: nettoyerNomOrigineCpt(params.nomOrigine),
      mime: MIME_PAR_EXTENSION_CPT[extension],
      taille: contenu.length,
      sha256: createHash("sha256").update(contenu).digest("hex"),
      deposeeParId: params.userId,
    },
  });
}
