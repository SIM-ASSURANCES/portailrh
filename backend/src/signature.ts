// Lot L (2026-10-27) — validation PURE de l'image d'une signature manuscrite (PNG) et rapprochement avec l'historique.
// Rien n'est jamais cru du client : on décode réellement le PNG, on refuse tout ce qui n'est pas une image de signature raisonnable
// (format, taille, dimensions, tracé vide) et on reconstruit un PNG propre (IHDR + IDAT + IEND, sans métadonnées).

import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import {
  SIGNATURE_ENCRE_MIN,
  SIGNATURE_ETENDUE_HAUTEUR_MIN,
  SIGNATURE_ETENDUE_LARGEUR_MIN,
  SIGNATURE_HAUTEUR_MAX,
  SIGNATURE_HAUTEUR_MIN,
  SIGNATURE_LARGEUR_MAX,
  SIGNATURE_LARGEUR_MIN,
  SIGNATURE_TAILLE_MAX,
} from "./signatureConstantes";

export * from "./signatureConstantes";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PREFIXE_DATA_URL = "data:image/png;base64,";

export type ResultatImageSignature =
  | { ok: true; png: Buffer; largeur: number; hauteur: number; empreinte: string; pixelsEncres: number }
  | { ok: false; message: string };

const refus = (message: string): { ok: false; message: string } => ({ ok: false, message });

const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(...parts: Buffer[]): number {
  let c = 0xffffffff;
  for (const part of parts) for (let i = 0; i < part.length; i++) c = TABLE_CRC[(c ^ part[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, "ascii");
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  t.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(t, data), 8 + data.length);
  return out;
}

/** Décode une data URL `data:image/png;base64,...` ; la taille est contrôlée AVANT le décodage. */
export function decoderDataUrlPng(valeur: unknown): { ok: true; octets: Buffer } | { ok: false; message: string } {
  if (typeof valeur !== "string" || !valeur.startsWith(PREFIXE_DATA_URL)) return refus("La signature doit être une image PNG.");
  const base64 = valeur.slice(PREFIXE_DATA_URL.length);
  if (Math.ceil((base64.length * 3) / 4) > SIGNATURE_TAILLE_MAX + 4) {
    return refus(`L'image de la signature est trop volumineuse (${Math.round(SIGNATURE_TAILLE_MAX / 1024)} Ko maximum).`);
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return refus("L'image de la signature est illisible.");
  return { ok: true, octets: Buffer.from(base64, "base64") };
}

/** Valide l'image d'une signature et renvoie un PNG reconstruit. Types pris en charge : 8 bits, gris / gris+alpha / RVB / RVBA, sans entrelacement. */
export function validerImageSignature(octets: Buffer): ResultatImageSignature {
  if (octets.length === 0) return refus("L'image de la signature est vide.");
  if (octets.length > SIGNATURE_TAILLE_MAX) {
    return refus(`L'image de la signature est trop volumineuse (${Math.round(SIGNATURE_TAILLE_MAX / 1024)} Ko maximum).`);
  }
  if (octets.length < 8 + 25 || !octets.subarray(0, 8).equals(PNG_SIGNATURE)) return refus("La signature doit être une image PNG.");

  let pos = 8;
  let ihdr: Buffer | null = null;
  const idat: Buffer[] = [];
  let fin = false;
  while (pos + 12 <= octets.length) {
    const longueur = octets.readUInt32BE(pos);
    const type = octets.toString("ascii", pos + 4, pos + 8);
    const debut = pos + 8;
    if (longueur > octets.length || debut + longueur + 4 > octets.length) return refus("L'image de la signature est corrompue.");
    const data = octets.subarray(debut, debut + longueur);
    if (octets.readUInt32BE(debut + longueur) !== crc32(Buffer.from(type, "ascii"), data)) return refus("L'image de la signature est corrompue.");
    if (pos === 8) {
      if (type !== "IHDR" || longueur !== 13) return refus("L'image de la signature est corrompue.");
      ihdr = data;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      fin = true;
      break;
    }
    pos = debut + longueur + 4;
  }
  if (!ihdr || !fin || idat.length === 0) return refus("L'image de la signature est corrompue.");

  const largeur = ihdr.readUInt32BE(0);
  const hauteur = ihdr.readUInt32BE(4);
  const profondeur = ihdr[8];
  const typeCouleur = ihdr[9];
  if (ihdr[10] !== 0 || ihdr[11] !== 0) return refus("L'image de la signature est corrompue.");
  if (ihdr[12] !== 0) return refus("L'image de la signature doit être non entrelacée.");
  if (largeur < SIGNATURE_LARGEUR_MIN || largeur > SIGNATURE_LARGEUR_MAX || hauteur < SIGNATURE_HAUTEUR_MIN || hauteur > SIGNATURE_HAUTEUR_MAX) {
    return refus(
      `Dimensions de l'image refusées (${largeur}×${hauteur}) : entre ${SIGNATURE_LARGEUR_MIN}×${SIGNATURE_HAUTEUR_MIN} et ${SIGNATURE_LARGEUR_MAX}×${SIGNATURE_HAUTEUR_MAX}.`
    );
  }
  const octetsParPixel = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[typeCouleur];
  if (profondeur !== 8 || !octetsParPixel) return refus("Format d'image non pris en charge (PNG 8 bits attendu).");

  const stride = largeur * octetsParPixel;
  const attendu = hauteur * (stride + 1);
  let brut: Buffer;
  try {
    brut = inflateSync(Buffer.concat(idat), { maxOutputLength: attendu + 1 });
  } catch {
    return refus("L'image de la signature est corrompue.");
  }
  if (brut.length !== attendu) return refus("L'image de la signature est corrompue.");

  // Défiltrage ligne par ligne (filtres PNG 0 à 4), puis comptage des pixels « encrés » et étendue du tracé.
  let precedente = Buffer.alloc(stride);
  let pixelsEncres = 0;
  let minX = largeur, maxX = -1, minY = hauteur, maxY = -1;
  for (let y = 0; y < hauteur; y++) {
    const filtre = brut[y * (stride + 1)];
    const ligne = Buffer.from(brut.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    if (filtre > 4) return refus("L'image de la signature est corrompue.");
    for (let i = 0; i < stride; i++) {
      const a = i >= octetsParPixel ? ligne[i - octetsParPixel] : 0;
      const b = precedente[i];
      const c = i >= octetsParPixel ? precedente[i - octetsParPixel] : 0;
      let v = ligne[i];
      if (filtre === 1) v += a;
      else if (filtre === 2) v += b;
      else if (filtre === 3) v += (a + b) >> 1;
      else if (filtre === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      ligne[i] = v & 0xff;
    }
    for (let x = 0; x < largeur; x++) {
      const o = x * octetsParPixel;
      let encre: boolean;
      if (typeCouleur === 6) encre = ligne[o + 3] > 32;
      else if (typeCouleur === 4) encre = ligne[o + 1] > 32;
      else if (typeCouleur === 2) encre = (ligne[o] + ligne[o + 1] + ligne[o + 2]) / 3 < 128;
      else encre = ligne[o] < 128;
      if (encre) {
        pixelsEncres++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    precedente = ligne;
  }
  if (pixelsEncres < SIGNATURE_ENCRE_MIN || maxX - minX + 1 < SIGNATURE_ETENDUE_LARGEUR_MIN || maxY - minY + 1 < SIGNATURE_ETENDUE_HAUTEUR_MIN) {
    return refus("La signature est vide ou trop courte : dessinez votre signature dans le cadre.");
  }

  const png = Buffer.concat([PNG_SIGNATURE, chunk("IHDR", Buffer.from(ihdr)), chunk("IDAT", Buffer.concat(idat)), chunk("IEND", Buffer.alloc(0))]);
  return { ok: true, png, largeur, hauteur, empreinte: createHash("sha256").update(png).digest("hex"), pixelsEncres };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Lien entre l'historique d'une demande et les signatures (lot L bis : PAR IDENTIFIANT, plus de fenêtre de temps).
// ---------------------------------------------------------------------------------------------------------------------------

export interface EntreeHistoriqueSignable {
  id: string;
  createdAt: Date;
  action: string;
  /** Action signée dont la ligne est une conséquence (`HistoriqueEntry.actionSigneeId`). */
  actionSigneeId: string | null;
}

export interface SignatureEnregistree {
  id: string;
}

export type EtatSignatureEntree<S> =
  | { etat: "SIGNEE"; signature: S }
  | { etat: "ANTERIEURE" }
  /** Après la mise en service mais sans lien : action du lot L dont le rattachement était ambigu (voir la reprise de données). */
  | { etat: "NON_RATTACHEE" };

/**
 * Pour chaque entrée d'historique d'une action SIGNABLE : sa signature (par l'identifiant de l'action signée), « Antérieure à la
 * signature » si elle précède la mise en service, sinon « NON_RATTACHEE ». Une entrée dont l'action n'est pas signable est absente
 * du résultat.
 */
export function lierSignatures<S extends SignatureEnregistree>(
  entrees: readonly EntreeHistoriqueSignable[],
  signaturesParId: ReadonlyMap<string, S>,
  miseEnService: Date | null,
  actionsSignables: ReadonlySet<string>
): Map<string, EtatSignatureEntree<S>> {
  const resultat = new Map<string, EtatSignatureEntree<S>>();
  for (const e of entrees) {
    if (!actionsSignables.has(e.action)) continue;
    const signature = e.actionSigneeId ? signaturesParId.get(e.actionSigneeId) : undefined;
    if (signature) resultat.set(e.id, { etat: "SIGNEE", signature });
    else if (miseEnService && e.createdAt.getTime() < miseEnService.getTime()) resultat.set(e.id, { etat: "ANTERIEURE" });
    else resultat.set(e.id, { etat: "NON_RATTACHEE" });
  }
  return resultat;
}

/** Une action doit être signée : refus si le compte n'a aucune signature enrôlée. */
export function refusSansSignature(versionCourante: number | null | undefined): string | null {
  return versionCourante ? null : "Vous devez d'abord enregistrer votre signature (menu « Mon profil ») avant de signer cette action.";
}
