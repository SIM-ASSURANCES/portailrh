import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { getSession, hasPermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

const MIME_PAR_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  png: "image/png",
};

/**
 * Téléchargement d'une pièce jointe — jamais d'accès public direct au
 * dossier `./uploads/` (aucune route statique ne l'expose), toujours via
 * cette route protégée qui vérifie l'accès avant de lire le fichier.
 *
 * `PieceJointe.demandeId` est TOUJOURS renseigné (voir schema.prisma),
 * même quand la pièce est en réalité attachée à une `DepenseLigne`
 * précise plutôt qu'à la demande elle-même — dérivé au moment de l'upload
 * (`retourCaisse.reglement.demandeId`). Un seul `include` suffit donc pour
 * retrouver la demande propriétaire, quel que soit le parent direct.
 *
 * Mêmes règles d'accès que les autres ressources liées à une demande
 * (reçu, bon de caisse) — élargies ici au **bénéficiaire** de la demande
 * en plus du créateur (demande explicite de cette tâche) : Finance/DG
 * (n'importe laquelle des permissions Trésorerie du dashboard Finance),
 * OU le créateur de la demande, OU son bénéficiaire (s'il a un compte).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await getSession();
  if (!session) {
    return new NextResponse("Non authentifié.", { status: 401 });
  }

  const piece = await prisma.pieceJointe.findUnique({
    where: { id },
    include: { demande: { select: { createurId: true, beneficiaireUserId: true } } },
  });

  if (!piece) {
    return new NextResponse("Pièce jointe introuvable.", { status: 404 });
  }

  const estFinanceOuDG =
    hasPermission(session, "treso.effectuer_reglement") ||
    hasPermission(session, "treso.categoriser_demande") ||
    hasPermission(session, "treso.valider_demande") ||
    hasPermission(session, "treso.receptionner_retour") ||
    hasPermission(session, "treso.voir_dashboard_finance");
  const estCreateurOuBeneficiaire =
    piece.demande.createurId === session.user.id || piece.demande.beneficiaireUserId === session.user.id;

  if (!estFinanceOuDG && !estCreateurOuBeneficiaire) {
    return new NextResponse("Accès refusé.", { status: 403 });
  }

  const extension = piece.url.split(".").pop() ?? "";
  const contentType = MIME_PAR_EXTENSION[extension] ?? "application/octet-stream";

  try {
    const bytes = await readFile(path.join(UPLOAD_DIR, piece.url));
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${piece.url}"`,
      },
    });
  } catch {
    return new NextResponse("Fichier introuvable sur le disque.", { status: 404 });
  }
}
