import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { nomAffichagePiece } from "backend";
import { getSession, hasPermission } from "@/lib/auth";

/**
 * Dépôt d'une pièce jointe de congé. Dossier `uploads/conges/` (le volume Docker `uploads`, comme la Trésorerie).
 * Le nom du fichier est ENTIÈREMENT généré ici (UUID + extension tirée du type MIME autorisé) : c'est la seule source
 * d'un nom de pièce valide (`estNomPieceCongeValide`), les actions refusent tout autre nom (correction B1). La route ne
 * crée aucune ligne en base : l'action de soumission rattache ensuite le nom à la demande.
 */
const UPLOAD_DIR = path.join(process.cwd(), "uploads", "conges");
const MAX_SIZE = 10 * 1024 * 1024; // 10 Mo

const EXTENSION_PAR_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  // Le congé d'office (RH) joint des pièces comme une demande : la permission d'étape RH se lit sur le rôle.
  const peutDeposer = hasPermission(session, "conges.soumettre") || session.rolePermissions.includes("conges.valider_rh");
  if (!peutDeposer) return NextResponse.json({ error: "Action non autorisée." }, { status: 403 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Le fichier dépasse la taille maximale autorisée (10 Mo)." }, { status: 400 });
  }
  const extension = EXTENSION_PAR_TYPE[file.type];
  if (!extension) {
    return NextResponse.json({ error: "Type de fichier non autorisé (PDF, JPG ou PNG uniquement)." }, { status: 400 });
  }

  await mkdir(UPLOAD_DIR, { recursive: true });
  const nom = `${randomUUID()}.${extension}`;
  await writeFile(path.join(UPLOAD_DIR, nom), Buffer.from(await file.arrayBuffer()));

  return NextResponse.json({ url: nom, nomFichier: nomAffichagePiece(file.name) });
}
