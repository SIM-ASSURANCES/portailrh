import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { getSession, hasPermission } from "@/lib/auth";
import { cheminFichierUpload, EncPieceJointeError } from "@/lib/encaissements/pieceJointe";
import { prisma } from "backend";

/**
 * Téléchargement d'une pièce jointe du module Encaissements (`EncPieceJointe`) — jamais d'accès public à `uploads/`.
 * Toute pièce du module est consultable avec `enc.consulter` (le cahier donne la consultation à tous les profils du
 * module, y compris l'audit). Une pièce de la Trésorerie n'est jamais servie ici (autre table, autre route).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await getSession();
  if (!session) {
    return new NextResponse("Non authentifié.", { status: 401 });
  }
  if (!hasPermission(session, "enc.consulter")) {
    return new NextResponse("Accès refusé.", { status: 403 });
  }

  const piece = await prisma.encPieceJointe.findUnique({ where: { id } });
  if (!piece) {
    return new NextResponse("Pièce jointe introuvable.", { status: 404 });
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
