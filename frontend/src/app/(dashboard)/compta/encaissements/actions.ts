"use server";

// Server Actions de la rubrique « Encaissements » de Gestion Compta (lot GC-4e ; docs/PLAN_GESTION_COMPTA.md, GC-4).
//
// Le relevé a déjà été déposé par `POST /api/compta/import/upload` (qui enregistre la `CptPieceJointe` et en recalcule la taille et
// l'empreinte). `importerReleveCptAction` : revérifie la permission (jamais seulement le layout `/compta`), déduit le type de relevé du
// TYPE DU COMPTE choisi, relit le fichier, contrôle que son contenu est celui enregistré, le lit selon le format par défaut de ce type,
// puis applique l'import dans UNE transaction (`appliquerImportReleveCpt`) : tout ou rien.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import {
  appliquerImportReleveCpt,
  chargerParametresCpt,
  CptImportLectureError,
  CptImportReleveError,
  getTrustedClientIp,
  lireReleveCpt,
  prisma,
  traiterAnomaliesCpt,
  TYPE_RELEVE_PAR_TYPE_COMPTE,
  validerDefinitionFormat,
  type BilanImportReleve,
} from "backend";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { cheminFichierCpt, CptPieceJointeError } from "@/lib/compta/pieceJointe";

export type ResultatImportReleveCpt =
  | { status: "success"; message: string; importId: string; bilan: BilanImportReleve }
  | { status: "error"; message: string };

export type ResultatTraitementAnomaliesReleveCpt = { status: "success"; message: string } | { status: "error"; message: string };

const OCTETS_PAR_MO = 1024 * 1024;
/** Une transaction d'import de plusieurs milliers de lignes dépasse largement le délai par défaut de Prisma (5 s). */
const DELAI_TRANSACTION_MS = 300_000;

/**
 * Marque des anomalies d'un relevé « traitées » : qui, quand, avec quelle conclusion. Elle ne corrige aucune donnée. Droit : importer
 * les relevés OU identifier un encaissement (aucune permission nouvelle) ; revérifié ici, le bouton masqué n'est qu'un confort.
 */
export async function traiterAnomaliesReleveCptAction(ids: string[], resolution?: string): Promise<ResultatTraitementAnomaliesReleveCpt> {
  const session = await getSession();
  if (!session || !(hasPermission(session, "cpt.importer_releves") || hasPermission(session, "cpt.identifier_encaissement"))) {
    return { status: "error", message: "Action non autorisée." };
  }
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) return { status: "error", message: "Sélection invalide." };

  const ip = getTrustedClientIp(await headers());
  const resultat = await prisma.$transaction((tx) => traiterAnomaliesCpt(tx, ids, { userId: session.user.id, resolution, ip }));
  if (!resultat.ok) return { status: "error", message: resultat.message };

  revalidatePath("/compta", "layout");
  publishDataChanged();
  const { traitees, dejaTraitees } = resultat.bilan;
  if (traitees === 0) return { status: "error", message: "Ces anomalies avaient déjà été traitées." };
  return {
    status: "success",
    message: `${traitees} anomalie(s) marquée(s) traitée(s)${dejaTraitees > 0 ? ` (${dejaTraitees} l'étai(en)t déjà)` : ""}.`,
  };
}

export async function importerReleveCptAction(compteId: string, pieceJointeId: string): Promise<ResultatImportReleveCpt> {
  const session = await getSession();
  if (!session || !hasPermission(session, "cpt.importer_releves")) return { status: "error", message: "Action non autorisée." };
  if (typeof compteId !== "string" || typeof pieceJointeId !== "string") return { status: "error", message: "Demande invalide." };

  const compte = await prisma.cptCompte.findUnique({ where: { id: compteId }, select: { id: true, libelle: true, type: true, actif: true } });
  if (!compte) return { status: "error", message: "Compte d'encaissement introuvable." };
  if (!compte.actif) return { status: "error", message: `Le compte « ${compte.libelle} » est désactivé.` };
  const type = TYPE_RELEVE_PAR_TYPE_COMPTE[compte.type] ?? null;
  if (!type) return { status: "error", message: `Le compte « ${compte.libelle} » n'a pas de relevé importable (les espèces se saisissent).` };

  const piece = await prisma.cptPieceJointe.findUnique({ where: { id: pieceJointeId }, include: { import: { select: { id: true } } } });
  if (!piece) return { status: "error", message: "Fichier introuvable : déposez-le de nouveau." };
  if (piece.import) return { status: "error", message: "Ce fichier a déjà été importé." };

  let contenu: Buffer;
  try {
    contenu = await readFile(cheminFichierCpt(piece.url));
  } catch (erreur) {
    if (erreur instanceof CptPieceJointeError) return { status: "error", message: erreur.message };
    return { status: "error", message: "Fichier introuvable sur le serveur : déposez-le de nouveau." };
  }
  const empreinte = createHash("sha256").update(contenu).digest("hex");
  if (empreinte !== piece.sha256) return { status: "error", message: "Le fichier a été modifié depuis son dépôt : déposez-le de nouveau." };

  const format = await prisma.cptFormatImport.findFirst({ where: { type, actif: true, parDefaut: true } });
  if (!format) {
    return { status: "error", message: "Aucun format par défaut n'est configuré pour ce type de relevé (Paramètres > Formats de relevé)." };
  }
  const definition = validerDefinitionFormat({ ligneEntete: format.ligneEntete, colonnes: format.colonnes });
  if (!definition.ok) return { status: "error", message: `Le format « ${format.nom} » est invalide : ${definition.erreurs[0]}` };

  const parametres = await chargerParametresCpt(prisma);
  let lecture;
  try {
    lecture = lireReleveCpt(contenu, definition.definition, {
      tailleMaxOctets: parametres["import.limite_taille_mo"] * OCTETS_PAR_MO,
      lignesMax: parametres["import.limite_lignes"],
    });
  } catch (erreur) {
    if (erreur instanceof CptImportLectureError) return { status: "error", message: erreur.message };
    throw erreur;
  }

  const ip = getTrustedClientIp(await headers());
  try {
    const resultat = await prisma.$transaction(
      (tx) =>
        appliquerImportReleveCpt(tx, {
          type,
          compteId: compte.id,
          lecture: lecture.lecture,
          lignes: lecture.lignes,
          formatId: format.id,
          fichierId: piece.id,
          empreinte,
          userId: session.user.id,
          ip,
        }),
      { timeout: DELAI_TRANSACTION_MS, maxWait: 10_000 }
    );
    revalidatePath("/compta", "layout");
    publishDataChanged();
    const b = resultat.bilan;
    return {
      status: "success",
      importId: resultat.importId,
      bilan: b,
      message: `Relevé importé : ${b.encaissementsCrees} ligne(s) créée(s), ${b.lignesDejaImportees} déjà connue(s), ${b.lignesRejetees} rejetée(s), ${b.virementsApparies} virement(s) interne(s) reconnu(s).`,
    };
  } catch (erreur) {
    if (erreur instanceof CptImportReleveError || erreur instanceof CptPieceJointeError) return { status: "error", message: erreur.message };
    throw erreur;
  }
}
