import { NextResponse } from "next/server";

import { chargerParametresCpt, detecterTypeTableurCpt, ecrireAuditCpt, getTrustedClientIp, prisma } from "backend";

import { getSession, hasPermission } from "@/lib/auth";
import {
  CptPieceJointeError,
  deposerFichierCpt,
  enregistrerCptPieceJointe,
  retirerFichierCpt,
} from "@/lib/compta/pieceJointe";

/**
 * Dépôt d'un fichier d'import de Gestion Compta (production, relevés, bordereaux) — lot GC-1f.
 *
 * Route DÉDIÉE au module (jamais la route de la Trésorerie ni celle d'Encaissements : chacune a sa permission).
 * Accessible à qui peut importer la production OU des relevés ; la nature exacte du fichier (production ou relevé) et son
 * format sont décidés ensuite par l'action d'import, qui revérifie sa propre permission.
 *
 * Contrairement à la route d'Encaissements, la pièce jointe est enregistrée ICI (`CptPieceJointe` + audit, dans une seule
 * transaction) : le fichier de production est la preuve d'une écriture comptable (RG d'audit), il ne doit jamais exister
 * sans trace. Le type du fichier est déduit de son CONTENU (en-têtes binaires), jamais du nom ni du type MIME annoncés par le
 * navigateur ; la lecture réelle du tableur reste de toute façon `lireTableurSelonFormat`.
 */

const OCTETS_PAR_MO = 1024 * 1024;

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  // `cpt.parametrer` dépose le fichier d'EXEMPLE d'un nouveau format d'import (écran Paramètres, GC-3i) : il ne peut rien importer.
  if (!hasPermission(session, "cpt.importer_production") && !hasPermission(session, "cpt.importer_releves") && !hasPermission(session, "cpt.parametrer")) {
    return NextResponse.json({ error: "Action non autorisée." }, { status: 403 });
  }

  const parametres = await chargerParametresCpt(prisma);
  const tailleMaxMo = parametres["import.limite_taille_mo"];
  const messageTropGros = `Le fichier dépasse la taille maximale autorisée (${tailleMaxMo} Mo).`;

  // Refus AVANT de lire le corps : la requête annonce déjà plus que le plafond (marge d'un Mo pour l'enveloppe multipart).
  const annonce = Number(request.headers.get("content-length"));
  if (Number.isFinite(annonce) && annonce > (tailleMaxMo + 1) * OCTETS_PAR_MO) {
    return NextResponse.json({ error: messageTropGros }, { status: 400 });
  }

  // Limite technique de Next : dès qu'un proxy existe (`proxy.ts`), il ne garde en mémoire que les 10 premiers Mo du corps
  // (`experimental.proxyClientMaxBodySize`) et tronque le reste SANS erreur ; `formData()` échoue alors sur le multipart
  // coupé. Ce n'est pas une panne du serveur : un fichier de cette taille est simplement trop gros, jamais un 500.
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: `Fichier illisible, ou plus gros que la taille maximale autorisée (${tailleMaxMo} Mo).` }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });

  if (file.size > tailleMaxMo * OCTETS_PAR_MO) return NextResponse.json({ error: messageTropGros }, { status: 400 });

  const contenu = Buffer.from(await file.arrayBuffer());
  const type = detecterTypeTableurCpt(contenu);
  if (!type) {
    return NextResponse.json({ error: "Type de fichier non reconnu (.xls, .xlsx ou .csv uniquement)." }, { status: 400 });
  }

  const url = await deposerFichierCpt(contenu, type);
  try {
    const piece = await prisma.$transaction(async (tx) => {
      const creee = await enregistrerCptPieceJointe(tx, { url, nomOrigine: file.name, userId: session.user.id });
      await ecrireAuditCpt(tx, {
        entite: "CptPieceJointe",
        entiteId: creee.id,
        action: "depot_fichier_import",
        apres: { nomOrigine: creee.nomOrigine, type, taille: creee.taille, sha256: creee.sha256 },
        userId: session.user.id,
        ip: getTrustedClientIp(request.headers),
      });
      return creee;
    });
    return NextResponse.json({ pieceJointeId: piece.id, url: piece.url, nomOrigine: piece.nomOrigine, taille: piece.taille, type });
  } catch (erreur) {
    // L'enregistrement a échoué : le fichier orphelin ne doit pas rester sur le disque.
    await retirerFichierCpt(url);
    if (erreur instanceof CptPieceJointeError) return NextResponse.json({ error: erreur.message }, { status: 400 });
    throw erreur;
  }
}
