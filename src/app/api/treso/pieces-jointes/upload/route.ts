import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { getSession, hasPermission } from "@/lib/auth";

/**
 * Upload d'une pièce jointe (Demande, ligne de dépense d'un retour de
 * caisse, ou dépense directe) — stockage local sur disque, jamais
 * d'accès public direct (voir `[id]/route.ts` pour le téléchargement,
 * protégé). Dossier `./uploads/` à la racine du projet (`process.cwd()`,
 * toujours la racine pour `next dev`/`next start` — même précaution que
 * `src/lib/pdf/registerFonts.ts`, Ticket 9), volontairement **pas**
 * `./storage/uploads/` : correspond exactement au volume Docker nommé
 * "uploads" déjà monté sur `/app/uploads` (voir docker-compose.yml,
 * Dockerfile, DEPLOIEMENT.md — préparé depuis le Ticket 1, jamais utilisé
 * jusqu'ici), pour ne nécessiter aucun changement de configuration Docker.
 *
 * **Ne crée aucune ligne `PieceJointe` en base** — cette route ne fait que
 * déposer le fichier sur disque et renvoyer son nom généré (`url`). C'est
 * la Server Action qui crée ensuite la Demande/DepenseLigne (ou modifie un
 * retour) qui associe ce nom à l'entité réellement créée, dans la même
 * transaction que sa propre écriture — le fichier n'est pas orphelin de
 * façon durable dans le flux normal, mais peut le rester sur disque si
 * l'utilisateur uploade puis abandonne le formulaire sans le soumettre
 * (V1 volontairement simple : pas de tâche de nettoyage des fichiers
 * jamais rattachés).
 *
 * Accès : n'importe quel utilisateur authentifié ayant au moins une des
 * permissions qui mènent à un formulaire avec pièce jointe
 * (`treso.creer_demande`, `treso.declarer_retour`,
 * `treso.saisir_depense_directe`) — l'association réelle à une ressource
 * précise est, elle, revérifiée par la Server Action appelée ensuite (qui
 * a ses propres gardes complètes, ex: propriété de la demande).
 */

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const MAX_SIZE = 10 * 1024 * 1024; // 10 Mo

const EXTENSION_PAR_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  const peutUploader =
    hasPermission(session, "treso.creer_demande") ||
    hasPermission(session, "treso.declarer_retour") ||
    hasPermission(session, "treso.saisir_depense_directe");
  if (!peutUploader) {
    return NextResponse.json({ error: "Action non autorisée." }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "Le fichier dépasse la taille maximale autorisée (10 Mo)." },
      { status: 400 }
    );
  }

  // L'extension est dérivée du type MIME AUTORISÉ, jamais du nom de
  // fichier fourni par le client (évite tout risque lié à un nom de
  // fichier arbitraire — le nom original n'est d'ailleurs jamais
  // conservé, voir plus bas).
  const extension = EXTENSION_PAR_TYPE[file.type];
  if (!extension) {
    return NextResponse.json(
      { error: "Type de fichier non autorisé (PDF, JPG ou PNG uniquement)." },
      { status: 400 }
    );
  }

  await mkdir(UPLOAD_DIR, { recursive: true });

  // Nom entièrement généré côté serveur (jamais dérivé du nom original) :
  // élimine par construction toute collision et tout risque de traversée
  // de chemin ou de caractère dangereux.
  const filename = `${randomUUID()}.${extension}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(UPLOAD_DIR, filename), bytes);

  return NextResponse.json({ url: filename });
}
