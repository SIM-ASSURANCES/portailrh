import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import fs from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

// SEC-02 : Whitelist MIME stricte — l'extension est dérivée du type MIME
// déclaré par le navigateur, jamais du nom de fichier fourni par le client
// (évite qu'un fichier .html/.svg renommé en .jpg ne soit uploadé et servi
// comme HTML depuis /public/uploads/profiles/).
const MIME_WHITELIST: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// 5 Mo — cohérent avec une photo de profil recadrée
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "profiles");

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Aucun fichier trouvé" }, { status: 400 });
    }

    // SEC-02 : Limite de taille
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: "Le fichier dépasse la taille maximale autorisée (5 Mo)." },
        { status: 400 }
      );
    }

    // SEC-02 : Validation MIME — extension dérivée de la whitelist, jamais du nom client
    const extension = MIME_WHITELIST[file.type];
    if (!extension) {
      return NextResponse.json(
        { error: "Type de fichier non autorisé (JPEG, PNG ou WebP uniquement)." },
        { status: 400 }
      );
    }

    // Nom entièrement généré côté serveur — jamais dérivé du nom original
    const fileName = `${session.user.id}-${randomBytes(8).toString("hex")}.${extension}`;

    // SEC-02 : Vérification path traversal — le chemin résolu doit rester
    // strictement sous UPLOAD_DIR (protection défensive supplémentaire)
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const filePath = path.join(UPLOAD_DIR, fileName);
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(UPLOAD_DIR))) {
      return NextResponse.json({ error: "Chemin de fichier invalide." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);

    const fileUrl = `/uploads/profiles/${fileName}`;
    return NextResponse.json({ success: true, url: fileUrl });
  } catch (error) {
    console.error("Erreur d'upload:", error);
    return NextResponse.json({ error: "Erreur lors de l'upload du fichier" }, { status: 500 });
  }
}

