"use server";

// Import mensuel du fichier de production (module Encaissements, CDC V2.6 F1, commits 4c/4d) — utilisées par l'écran
// `/encaissements/import` (`ImportProductionForm.tsx`).
//
// Réservée à `enc.importer_production`, revérifiée ICI (jamais seulement via le layout `/encaissements`, qui ne garde
// que `enc.consulter`) : lit le fichier déjà déposé par `POST /api/encaissements/import/upload` (jamais reçu en
// base64 dans l'action elle-même — un fichier de 10 Mo en base64 gonflerait chaque appel de ~33 %), l'enregistre comme
// `EncPieceJointe`, puis applique l'import (`appliquerImportProduction`, encImportApplication.ts) dans UNE transaction.
//
// Timeout de transaction EXPLICITE (300 s, largement au-dessus de l'objectif de performance « 5 000 lignes < 2 min ») :
// le défaut de Prisma (5 s) ne tiendrait pas la boucle ligne par ligne d'un import volumineux — décision du 2026-09-30.

import { readFile } from "node:fs/promises";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, hasPermission } from "@/lib/auth";
import { publishDataChanged } from "@/lib/eventBus";
import { getClientIp } from "@/lib/auditLog";
import { cheminFichierUpload, enregistrerEncPieceJointe, nettoyerNomOrigine, EncPieceJointeError } from "@/lib/encaissements/pieceJointe";
import { prisma } from "backend";
import {
  lireTableur,
  EncImportLectureError,
  appliquerImportProduction,
  EncImportApplicationError,
  normaliserCodeBranche,
  chargerParametresEnc,
  EncReferentielError,
} from "backend";

type ImporterProductionResult =
  | {
      status: "success";
      message: string;
      importId: string;
      nbContratsCrees: number;
      nbContratsMaj: number;
      nbPaiementsAConfirmer: number;
      nbATraiter: number;
    }
  | { status: "error"; message: string };

const schema = z.object({
  url: z.string().trim().min(1, "Fichier manquant."),
  nomOrigine: z.string().nullable(),
  /** Choisie par l'utilisateur SEULEMENT si le fichier n'a aucune colonne « Branche » (CDC §7.1) — ignorée sinon. */
  brancheParDefaut: z.string().nullable(),
});

/** Convertit et catégorise les erreurs métier connues de ce parcours en message affichable ; relance toute autre erreur. */
function messageErreurMetier(e: unknown): string | null {
  if (e instanceof EncImportLectureError) return e.message;
  if (e instanceof EncImportApplicationError) return e.message;
  if (e instanceof EncReferentielError) return e.message;
  if (e instanceof EncPieceJointeError) return e.message;
  return null;
}

type InspecterFichierResult =
  | { status: "success"; nbLignes: number; brancheColonnePresente: boolean }
  | { status: "error"; message: string };

/**
 * Lecture seule du fichier déposé, AVANT l'import : nombre de lignes et présence d'une colonne « Branche » — l'écran
 * ne demande une branche par défaut que si le fichier n'en porte pas. N'écrit rien ; l'import revérifie tout.
 */
export async function inspecterFichierProductionAction(url: string): Promise<InspecterFichierResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "enc.importer_production")) {
    return { status: "error", message: "Action non autorisée." };
  }
  try {
    const lecture = lireTableur(await readFile(cheminFichierUpload(url)));
    return { status: "success", nbLignes: lecture.lignes.length, brancheColonnePresente: lecture.brancheColonnePresente };
  } catch (e) {
    const message = messageErreurMetier(e);
    if (message) return { status: "error", message };
    if (e instanceof Error && "code" in e && e.code === "ENOENT") {
      return { status: "error", message: "Fichier introuvable sur le serveur : téléversez-le de nouveau." };
    }
    throw e;
  }
}

export async function importerProductionAction(input: {
  url: string;
  nomOrigine: string | null;
  brancheParDefaut: string | null;
}): Promise<ImporterProductionResult> {
  const session = await getSession();
  if (!session || !hasPermission(session, "enc.importer_production")) {
    return { status: "error", message: "Action non autorisée." };
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  }

  let chemin: string;
  try {
    chemin = cheminFichierUpload(parsed.data.url);
  } catch (e) {
    const message = messageErreurMetier(e);
    if (!message) throw e;
    return { status: "error", message };
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(chemin);
  } catch {
    return { status: "error", message: "Fichier introuvable sur le serveur : téléversez-le de nouveau." };
  }

  let lecture: ReturnType<typeof lireTableur>;
  try {
    lecture = lireTableur(buffer);
  } catch (e) {
    const message = messageErreurMetier(e);
    if (!message) throw e;
    return { status: "error", message };
  }

  let brancheParDefaut: string | null = null;
  if (!lecture.brancheColonnePresente) {
    if (!parsed.data.brancheParDefaut || !parsed.data.brancheParDefaut.trim()) {
      return {
        status: "error",
        message: "Ce fichier ne porte aucune colonne « Branche » : précisez la branche par défaut à appliquer à toutes ses lignes.",
      };
    }
    try {
      brancheParDefaut = normaliserCodeBranche(parsed.data.brancheParDefaut);
    } catch (e) {
      const message = messageErreurMetier(e);
      if (!message) throw e;
      return { status: "error", message };
    }
  }

  const ip = await getClientIp();
  const maintenant = new Date();

  // V2-A14/D14 : la règle du CDC est « l'annulation est réservée à qui peut annuler » — jamais liée à un rôle Finance/
  // Technique en tant que tel. `enc.annuler_contrat` (exclusive à l'Équipe technique, encPermissions.ts) est donc le
  // seul critère : qui la détient voit une ligne annulée prise en compte (contrat importé, signalement « en attente
  // L4 ») ; qui ne l'a pas (Finance) voit la ligne rejetée entièrement. Correction du 2026-09-30 : un premier essai
  // dérivait ceci de `enc.marquer_paye` (exclusive à Finance), un raccourci qui accidentellement pointait dans le bon
  // sens ICI (les deux seuls rôles avec `enc.importer_production` se répartissent exactement à l'identique sur les
  // deux permissions) mais reposait sur la mauvaise permission conceptuellement.
  const origineImport: "FINANCE" | "EQUIPE_TECHNIQUE" = hasPermission(session, "enc.annuler_contrat")
    ? "EQUIPE_TECHNIQUE"
    : "FINANCE";

  try {
    const resultat = await prisma.$transaction(
      async (tx) => {
        const piece = await enregistrerEncPieceJointe(tx, {
          url: parsed.data.url,
          nomOrigine: parsed.data.nomOrigine,
          userId: session.user.id,
        });

        const parametres = await chargerParametresEnc(tx);

        return appliquerImportProduction(tx, lecture.lignes, {
          // Nom affiché (D6, "conservé comme preuve") : le nom d'origine nettoyé si fourni, sinon le nom généré par
          // l'upload (jamais vide) — jamais le nom d'origine BRUT, non fiable (voir `nettoyerNomOrigine`).
          nomFichier: nettoyerNomOrigine(parsed.data.nomOrigine) ?? parsed.data.url,
          sha256: piece.sha256,
          fichierId: piece.id,
          brancheParDefaut,
          origineImport,
          importeParId: session.user.id,
          maintenant,
          toleranceIncoherenceFcfa: parametres["controle.tolerance_fcfa"].toFixed(2),
          ip,
        });
      },
      { timeout: 300_000, maxWait: 10_000 }
    );

    revalidatePath("/encaissements", "layout");
    publishDataChanged();

    return {
      status: "success",
      message:
        `Import terminé : ${resultat.nbContratsCrees} contrat(s) créé(s), ${resultat.nbContratsMaj} mis à jour, ` +
        `${resultat.nbPaiementsAConfirmer} paiement(s) à confirmer, ${resultat.nbATraiter} signalement(s) à traiter.`,
      importId: resultat.importId,
      nbContratsCrees: resultat.nbContratsCrees,
      nbContratsMaj: resultat.nbContratsMaj,
      nbPaiementsAConfirmer: resultat.nbPaiementsAConfirmer,
      nbATraiter: resultat.nbATraiter,
    };
  } catch (e) {
    const message = messageErreurMetier(e);
    if (!message) throw e;
    return { status: "error", message };
  }
}
