"use server";

// Server Action d'import du bordereau de production de Gestion Compta (lot GC-3c ; docs/PLAN_GESTION_COMPTA.md, GC-3).
//
// Le fichier a déjà été déposé par `POST /api/compta/import/upload` (qui enregistre la `CptPieceJointe` et en recalcule la taille
// et l'empreinte). Cette action : revérifie la permission (jamais seulement le layout `/compta`), relit le fichier sur disque,
// contrôle que son contenu est bien celui enregistré, le lit selon le format PRODUCTION (défaut ou choisi), puis applique
// l'import dans UNE transaction (`appliquerImportProductionCpt`) : tout ou rien.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import {
  appliquerImportProductionCpt,
  chargerParametresCpt,
  CptImportLectureError,
  CptImportProductionError,
  getTrustedClientIp,
  lireTableurSelonFormat,
  prisma,
  traiterAnomaliesCpt,
  validerDefinitionFormat,
  type BilanImportProduction,
} from "backend";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { cheminFichierCpt, CptPieceJointeError } from "@/lib/compta/pieceJointe";

export type ResultatImportProductionCpt =
  | { status: "success"; message: string; importId: string; bilan: BilanImportProduction }
  | { status: "error"; message: string };

const OCTETS_PAR_MO = 1024 * 1024;
/** Une transaction d'import de plusieurs milliers de lignes dépasse largement le délai par défaut de Prisma (5 s). */
const DELAI_TRANSACTION_MS = 300_000;

export type ResultatTraitementAnomaliesCpt = { status: "success"; message: string } | { status: "error"; message: string };

/**
 * Marque des anomalies de l'import « traitées » (lot GC-3h) : qui, quand et avec quelle conclusion. Elle ne corrige aucune donnée.
 * Droit : celui de la production — importer le bordereau OU saisir un contrat (aucune permission nouvelle) ; revérifié ici, le bouton
 * masqué n'est qu'un confort.
 */
export async function traiterAnomaliesCptAction(ids: string[], resolution?: string): Promise<ResultatTraitementAnomaliesCpt> {
  const session = await getSession();
  if (!session || !(hasPermission(session, "cpt.importer_production") || hasPermission(session, "cpt.saisir_contrat"))) {
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

export async function importerProductionCptAction(pieceJointeId: string, formatId?: string | null): Promise<ResultatImportProductionCpt> {
  const session = await getSession();
  if (!session || !hasPermission(session, "cpt.importer_production")) return { status: "error", message: "Action non autorisée." };

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

  const format = await prisma.cptFormatImport.findFirst({
    where: formatId ? { id: formatId, type: "PRODUCTION", actif: true } : { type: "PRODUCTION", actif: true, parDefaut: true },
  });
  if (!format) {
    return { status: "error", message: formatId ? "Format d'import introuvable ou inactif." : "Aucun format d'import de production par défaut n'est configuré (Paramètres > Formats d'import)." };
  }
  const definition = validerDefinitionFormat({ ligneEntete: format.ligneEntete, colonnes: format.colonnes });
  if (!definition.ok) return { status: "error", message: `Le format « ${format.nom} » est invalide : ${definition.erreurs[0]}` };

  const parametres = await chargerParametresCpt(prisma);
  let lecture;
  try {
    lecture = lireTableurSelonFormat(contenu, definition.definition, {
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
      (tx) => appliquerImportProductionCpt(tx, { lecture, formatId: format.id, fichierId: piece.id, empreinte, userId: session.user.id, ip }),
      { timeout: DELAI_TRANSACTION_MS, maxWait: 10_000 }
    );
    revalidatePath("/compta", "layout");
    publishDataChanged();
    const b = resultat.bilan;
    return {
      status: "success",
      importId: resultat.importId,
      bilan: b,
      message: `Import terminé : ${b.contratsCrees} contrat(s) créé(s), ${b.lignesRejetees} ligne(s) rejetée(s), ${b.anomaliesCreees} anomalie(s) à traiter.`,
    };
  } catch (erreur) {
    if (erreur instanceof CptImportProductionError || erreur instanceof CptPieceJointeError) return { status: "error", message: erreur.message };
    throw erreur;
  }
}
