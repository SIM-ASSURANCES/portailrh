import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { getSession, hasPermission } from "@/lib/auth";
import { cheminFichierUpload, EncPieceJointeError } from "@/lib/encaissements/pieceJointe";
import { prisma } from "backend";

/**
 * Téléchargement d'une pièce jointe du module Encaissements (`EncPieceJointe`) — jamais d'accès public à `uploads/`.
 * Une pièce de la Trésorerie n'est jamais servie ici (autre table, autre route).
 *
 * Permission selon l'origine de la pièce :
 * - fichier de production d'un import `PRODUCTION` (F1, D6 : « téléchargement Finance + Technique seulement ») →
 *   `enc.importer_production` (Équipe technique + Finance uniquement, jamais Consultation — voir `encPermissions.ts`) ;
 * - toute autre pièce (aucun `EncImport` lié, ou un import d'un autre `type` à venir) → repli sur `enc.consulter`
 *   (le cahier donne la consultation à tous les profils du module, y compris l'audit).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await getSession();
  if (!session) {
    return new NextResponse("Non authentifié.", { status: 401 });
  }

  const piece = await prisma.encPieceJointe.findUnique({ where: { id }, include: { encImport: true } });
  if (!piece) {
    return new NextResponse("Pièce jointe introuvable.", { status: 404 });
  }

  const permissionRequise = piece.encImport?.type === "PRODUCTION" ? "enc.importer_production" : "enc.consulter";
  if (!hasPermission(session, permissionRequise)) {
    return new NextResponse("Accès refusé.", { status: 403 });
  }

  let chemin: string;
  try {
    chemin = cheminFichierUpload(piece.url);
  } catch (e) {
    if (e instanceof EncPieceJointeError) return new NextResponse("Chemin de fichier invalide.", { status: 400 });
    throw e;
  }

  try {
    const bytes = await readFile(chemin);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": piece.mime,
        // Nom généré (UUID) : jamais le nom d'origine fourni par le client, pour ne rien injecter dans l'en-tête.
        "Content-Disposition": `attachment; filename="${piece.url}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Fichier introuvable sur le disque.", { status: 404 });
  }
}
