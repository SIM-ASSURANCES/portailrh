import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { getSession, hasPermission } from "@/lib/auth";

/**
 * Dépôt du fichier de production (module Encaissements, F1) — route DÉDIÉE, jamais la route commune de la Trésorerie
 * (`/api/treso/pieces-jointes/upload`, réservée à PDF/JPG/PNG) : élargir cette dernière aux tableurs donnerait le
 * droit d'en déposer à TOUS ses utilisateurs (Trésorerie comprise), bien au-delà de `enc.importer_production`
 * (décision explicite du 2026-09-30).
 *
 * Ne crée AUCUNE ligne `EncPieceJointe` — même principe que la route commune (voir son commentaire) : dépose
 * seulement le fichier sur disque et renvoie son nom généré. `enregistrerEncPieceJointe`
 * (`lib/encaissements/pieceJointe.ts`) crée la ligne ensuite, dans la transaction de l'import, après sa propre
 * revérification de permission.
 */

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const MAX_SIZE = 10 * 1024 * 1024; // 10 Mo — même plafond que `encImportLecture.ts` (TAILLE_MAX_OCTETS)

/**
 * Dérive l'extension de stockage (xls/xlsx/csv) à partir du type MIME ET du nom de fichier — jamais l'un sans
 * l'autre pour `.xls`/`.xlsx` (repli sur le seul nom si le navigateur/l'OS annonce un type générique, ex.
 * `application/octet-stream`, fréquent pour `.xls`). La validation RÉELLE du contenu reste `lireTableur()`
 * (encImportLecture.ts), qui refuse tout contenu qui n'est pas un vrai tableur quel que soit ce qui est annoncé ici.
 */
function extensionAutorisee(file: File): "xls" | "xlsx" | "csv" | null {
  const nom = file.name.toLowerCase();
  if (file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" && nom.endsWith(".xlsx")) return "xlsx";
  if (file.type === "application/vnd.ms-excel" && nom.endsWith(".xls")) return "xls";
  if ((file.type === "text/csv" || file.type === "application/csv" || file.type === "text/plain" || file.type === "") && nom.endsWith(".csv")) {
    return "csv";
  }
  if (nom.endsWith(".xlsx")) return "xlsx";
  if (nom.endsWith(".xls")) return "xls";
  if (nom.endsWith(".csv")) return "csv";
  return null;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }
  if (!hasPermission(session, "enc.importer_production")) {
    return NextResponse.json({ error: "Action non autorisée." }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Le fichier dépasse la taille maximale autorisée (10 Mo)." }, { status: 400 });
  }

  const extension = extensionAutorisee(file);
  if (!extension) {
    return NextResponse.json({ error: "Type de fichier non autorisé (.xls, .xlsx ou .csv uniquement)." }, { status: 400 });
  }

  await mkdir(UPLOAD_DIR, { recursive: true });

  // Nom entièrement généré côté serveur (jamais dérivé du nom original) — même principe que la route commune :
  // élimine par construction toute collision et tout risque de traversée de chemin ou de caractère dangereux.
  const filename = `${randomUUID()}.${extension}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(UPLOAD_DIR, filename), bytes);

  return NextResponse.json({ url: filename });
}
