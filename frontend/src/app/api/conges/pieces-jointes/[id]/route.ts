import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { cheminPieceConge, peutConsulterAbsence, prisma } from "backend";
import { getSession } from "@/lib/auth";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "conges");

const MIME_PAR_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

/**
 * Téléchargement d'une pièce jointe de congé : le demandeur, le responsable ACTUEL de son service, la RH
 * (`conges.valider_rh`) et ceux qui consultent tout (`conges.consulter_tous`). Le chemin lu est recalculé et vérifié
 * dans le dossier des pièces (`cheminPieceConge`) : un nom enregistré qui ne serait pas un nom produit par la route
 * d'upload n'est jamais ouvert (B1).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return new NextResponse("Non authentifié.", { status: 401 });

  const piece = await prisma.pieceJointeConge.findUnique({
    where: { id },
    include: { demandeConge: { select: { userId: true, user: { select: { service: { select: { responsableId: true } } } } } } },
  });
  if (!piece) return new NextResponse("Pièce jointe introuvable.", { status: 404 });

  const autorise = peutConsulterAbsence({
    nature: "CONGE",
    acteurId: session.user.id,
    demandeurId: piece.demandeConge.userId,
    responsableDuServiceId: piece.demandeConge.user.service?.responsableId ?? null,
    permissions: session.permissions,
  });
  if (!autorise) return new NextResponse("Accès refusé à ce document.", { status: 403 });

  const chemin = cheminPieceConge(UPLOAD_DIR, piece.url);
  if (!chemin) return new NextResponse("Pièce jointe introuvable.", { status: 404 });

  try {
    const buffer = await readFile(chemin);
    const extension = piece.url.split(".").pop()?.toLowerCase() ?? "";
    const headers = new Headers();
    headers.set("Content-Type", MIME_PAR_EXTENSION[extension] ?? "application/octet-stream");
    headers.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(piece.nomFichier ?? piece.url)}`);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", "private, no-store");
    return new NextResponse(buffer, { status: 200, headers });
  } catch {
    return new NextResponse("Fichier introuvable sur le serveur.", { status: 404 });
  }
}
