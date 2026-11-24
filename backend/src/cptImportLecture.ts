// Lecture d'un tableur selon un format paramétrable (Gestion Compta, lot GC-1f ; docs/compta-conception.md §7).
//
// Inspiré d'`encImportLecture.ts` (lecture par POSITION fixe, colonnes A à AH) mais indépendant de lui : ici les colonnes
// sont retrouvées PAR LEUR EN-TÊTE, dans n'importe quel ordre, d'après un `DefinitionFormatCpt`. PUR : aucun accès base ;
// l'appelant fournit le format et les limites (paramètres `import.limite_lignes` et `import.limite_taille_mo`).
//
// Lecture PERMISSIVE : une cellule illisible devient `null` et produit une anomalie ; seules les erreurs STRUCTURELLES
// (fichier vide, trop gros, illisible, ligne d'en-têtes introuvable, colonne obligatoire absente) arrêtent la lecture.
//
// Trois pièges mesurés sur SheetJS 0.20.3 et neutralisés ici (voir cptImportLecture.test.ts) :
//  1. un CSV lu « normalement » transforme « 03/04/2026 » en 4 mars (inférence américaine) → les fichiers texte sont lus
//     avec `raw: true` et les dates écrites en texte sont interprétées selon le format DÉCLARÉ, jamais devinées ;
//  2. un CSV UTF-8 lu en tampon donne « CafÃ© » → le texte est décodé ici (UTF-8 strict, repli Windows-1252) ;
//  3. une cellule date d'un classeur est une `Date` dont les composantes LOCALES sont la date affichée dans Excel, quel que
//     soit le fuseau de la machine (les composantes UTC se trompent d'un jour à l'est de Greenwich) → `getFullYear/Month/Date`.
//
// Bibliothèque : SheetJS CE 0.20.3 vendue (`backend/vendor/xlsx-0.20.3.tgz`), lecture UNIQUEMENT côté serveur, formules,
// HTML et styles désactivés.

import * as XLSX from "xlsx";

import {
  normaliserEnteteCpt,
  type ColonneFormatCpt,
  type DefinitionFormatCpt,
  type FormatDateCpt,
} from "./cptFormatImport";
import { analyserMontant, MONTANT_CHIFFRES_ENTIERS_MAX } from "./montant";

export class CptImportLectureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CptImportLectureError";
  }
}

/** Mêmes défauts que les paramètres du module (`CptParametre`) : l'appelant les remplace par les valeurs lues en base. */
export const CPT_IMPORT_TAILLE_MAX_OCTETS_DEFAUT = 10 * 1024 * 1024;
export const CPT_IMPORT_LIGNES_MAX_DEFAUT = 50_000;
/** Au-delà, les anomalies suivantes sont comptées mais plus détaillées (une colonne entière illisible = 50 000 anomalies). */
export const CPT_IMPORT_ANOMALIES_DETAILLEES_MAX = 1000;

export interface LimitesImportCpt {
  tailleMaxOctets: number;
  lignesMax: number;
}

export type TypeTableurCpt = "xlsx" | "xls" | "csv";

/** Début de fichier des formats connus pour ne PAS être un tableur : un PDF « texte » ne contient pas forcément d'octet nul. */
const SIGNATURES_NON_TABLEUR: readonly (readonly number[])[] = [
  [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0x47, 0x49, 0x46, 0x38], // GIF
  [0x7b, 0x5c, 0x72, 0x74, 0x66], // {\rtf
];

/**
 * Type réel d'un fichier d'après son CONTENU (jamais son nom ni le type annoncé par le navigateur) : `.xlsx` est une
 * archive ZIP, `.xls` un document OLE2, tout le reste est du texte (CSV) à condition de ne contenir aucun octet nul et de
 * ne pas commencer comme un format connu qui n'est pas un tableur (PDF, image, RTF).
 */
export function detecterTypeTableurCpt(contenu: Uint8Array): TypeTableurCpt | null {
  if (contenu.length === 0) return null;
  if (contenu.length >= 4 && contenu[0] === 0x50 && contenu[1] === 0x4b && (contenu[2] === 0x03 || contenu[2] === 0x05)) return "xlsx";
  if (contenu.length >= 8 && contenu[0] === 0xd0 && contenu[1] === 0xcf && contenu[2] === 0x11 && contenu[3] === 0xe0) return "xls";
  if (SIGNATURES_NON_TABLEUR.some((signature) => signature.every((octet, i) => contenu[i] === octet))) return null;
  const echantillon = contenu.subarray(0, 8192);
  return echantillon.includes(0) ? null : "csv";
}

export interface AnomalieLectureCpt {
  /** Numéro de ligne tel que l'affiche le tableur (la première ligne du fichier est la ligne 1). */
  numeroLigne: number;
  champ: string;
  entete: string;
  /** Valeur de la cellule, tronquée à 60 caractères. */
  valeurBrute: string;
  motif: string;
}

export interface LigneLueCpt {
  /** Numéro de ligne tel que l'affiche le tableur. */
  numeroLigne: number;
  /** Texte nettoyé ; date `AAAA-MM-JJ` ; montant décimal à deux chiffres (« -1398.60 ») ; `null` si absent ou illisible. */
  valeurs: Record<string, string | null>;
}

export interface ResultatLectureCpt {
  typeTableur: TypeTableurCpt;
  lignes: LigneLueCpt[];
  /** Anomalies détaillées (au plus `CPT_IMPORT_ANOMALIES_DETAILLEES_MAX`) ; le total exact est `nbAnomalies`. */
  anomalies: AnomalieLectureCpt[];
  nbAnomalies: number;
  nbLignesVidesIgnorees: number;
  /** En-têtes du fichier qu'aucune colonne du format n'utilise (information, jamais une erreur). */
  enTetesNonUtilises: string[];
  /** Colonnes facultatives du format absentes du fichier (leurs champs valent `null`). */
  colonnesFacultativesAbsentes: string[];
}

type Cellule = string | number | boolean | Date | null | undefined;

// ---------- Valeurs ----------

const TXT_MAX_AFFICHE = 60;
const tronquer = (s: string) => (s.length > TXT_MAX_AFFICHE ? `${s.slice(0, TXT_MAX_AFFICHE)}…` : s);
const cellulePourAffichage = (v: Cellule): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : tronquer(String(v ?? ""));

const vide = (v: Cellule): boolean => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

const deuxChiffres = (n: number) => String(n).padStart(2, "0");

/** Date du calendrier valide, `AAAA-MM-JJ`, ou `null`. Années plausibles seulement (1900 à 2200). */
function jourCivil(a: number, m: number, j: number): string | null {
  if (!Number.isInteger(a) || a < 1900 || a > 2200 || m < 1 || m > 12 || j < 1) return null;
  const joursDuMois = new Date(Date.UTC(a, m, 0)).getUTCDate();
  if (j > joursDuMois) return null;
  return `${String(a).padStart(4, "0")}-${deuxChiffres(m)}-${deuxChiffres(j)}`;
}

/** Heure facultative en fin de date texte : « 2026-10-25 14:03:11 », « 25/10/2026 14:03 », « …T14:03:11Z ». */
const MOTIF_HEURE = "(?:[ T]\\d{1,2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})?)?";
const MOTIFS_DATE: Record<FormatDateCpt, { re: RegExp; ordre: [number, number, number] }> = {
  "AAAA-MM-JJ": { re: new RegExp(`^(\\d{4})-(\\d{1,2})-(\\d{1,2})${MOTIF_HEURE}$`), ordre: [1, 2, 3] },
  "JJ/MM/AAAA": { re: new RegExp(`^(\\d{1,2})/(\\d{1,2})/(\\d{4})${MOTIF_HEURE}$`), ordre: [3, 2, 1] },
  "JJ-MM-AAAA": { re: new RegExp(`^(\\d{1,2})-(\\d{1,2})-(\\d{4})${MOTIF_HEURE}$`), ordre: [3, 2, 1] },
  "MM/JJ/AAAA": { re: new RegExp(`^(\\d{1,2})/(\\d{1,2})/(\\d{4})${MOTIF_HEURE}$`), ordre: [3, 1, 2] },
};

type Lecture = { ok: true; valeur: string } | { ok: false; motif: string };

function lireDate(v: Cellule, format: FormatDateCpt | undefined): Lecture {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { ok: false, motif: "date illisible" };
    const jour = jourCivil(v.getFullYear(), v.getMonth() + 1, v.getDate());
    return jour ? { ok: true, valeur: jour } : { ok: false, motif: "date hors de la plage 1900-2200" };
  }
  if (typeof v === "number") return { ok: false, motif: "nombre au lieu d'une date (cellule non formatée en date)" };
  if (typeof v !== "string") return { ok: false, motif: "date attendue" };
  const texte = v.replace(/ /g, " ").trim();
  // Sans format déclaré, seul l'ISO est sans ambiguïté : on ne devine jamais l'ordre jour/mois.
  const retenu = format ?? "AAAA-MM-JJ";
  const { re, ordre } = MOTIFS_DATE[retenu];
  const m = re.exec(texte);
  if (!m) {
    return {
      ok: false,
      motif: format ? `date non conforme au format ${format}` : "date non ISO (AAAA-MM-JJ) et aucun format de date n'est déclaré pour cette colonne",
    };
  }
  const jour = jourCivil(Number(m[ordre[0]]), Number(m[ordre[1]]), Number(m[ordre[2]]));
  return jour ? { ok: true, valeur: jour } : { ok: false, motif: "date inexistante au calendrier" };
}

/** Écrit des centimes entiers (signés) en « -1398.60 » sans passer par un flottant. */
function centimesVersTexte(centimes: number): string {
  const signe = centimes < 0 ? "-" : "";
  const abs = Math.abs(centimes);
  return `${signe}${Math.floor(abs / 100)}.${deuxChiffres(abs % 100)}`;
}

const SUFFIXE_DEVISE = /\s*(?:f\s?cfa|xof|xaf|cfa|f)\s*$/i;

/**
 * Montant SIGNÉ d'une cellule. Contrairement à `lireMontant`, qui refuse tout négatif (une saisie d'écran), un relevé
 * contient des débits, des remboursements et des frais : « -250 », « 250- », « (250) » et « −250 » valent −250.
 * Les règles de séparateurs (espaces, points de milliers, virgule décimale) sont celles d'`analyserMontant`.
 */
function lireMontantCellule(v: Cellule): Lecture {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return { ok: false, motif: "montant illisible" };
    const centimes = Math.round(v * 100);
    if (Math.abs(v * 100 - centimes) > 1e-6) return { ok: false, motif: "montant avec plus de deux décimales" };
    if (String(Math.abs(Math.trunc(v))).length > MONTANT_CHIFFRES_ENTIERS_MAX) return { ok: false, motif: "montant trop élevé" };
    return { ok: true, valeur: centimesVersTexte(centimes === 0 ? 0 : centimes) };
  }
  if (typeof v !== "string") return { ok: false, motif: "montant attendu" };

  let texte = v.replace(/[  ]/g, " ").trim().replace(SUFFIXE_DEVISE, "").trim();
  let negatif = false;
  if (/^\(.*\)$/.test(texte)) {
    negatif = true;
    texte = texte.slice(1, -1).trim();
  }
  if (/^[-−]/.test(texte)) {
    negatif = !negatif;
    texte = texte.slice(1).trim();
  } else if (/[-−]$/.test(texte)) {
    negatif = !negatif;
    texte = texte.slice(0, -1).trim();
  } else if (texte.startsWith("+")) {
    texte = texte.slice(1).trim();
  }
  const r = analyserMontant(texte, { decimales: true });
  if (!r.ok) return { ok: false, motif: r.message };
  const centimes = negatif ? -r.centimes : r.centimes;
  return { ok: true, valeur: centimesVersTexte(centimes === 0 ? 0 : centimes) };
}

function lireTexte(v: Cellule): string | null {
  if (v === null || v === undefined) return null;
  let s: string;
  if (v instanceof Date) s = cellulePourAffichage(v);
  else if (typeof v === "number") s = Number.isInteger(v) ? v.toFixed(0) : String(v);
  else s = String(v);
  s = s.replace(/ /g, " ").trim();
  return s === "" ? null : s;
}

// ---------- Fichier ----------

function decoderTexte(contenu: Buffer): string {
  const sansBom = contenu[0] === 0xef && contenu[1] === 0xbb && contenu[2] === 0xbf ? contenu.subarray(3) : contenu;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(sansBom);
  } catch {
    // Export d'un vieux logiciel : Windows-1252 (accents français). Jamais de lecture « au hasard » en Latin-1 par défaut.
    return new TextDecoder("windows-1252").decode(sansBom);
  }
}

/** Exportée pour l'aperçu d'un fichier d'exemple (`cptFormatApercu.ts`) : une seule lecture de classeur dans le module. */
export function lireClasseur(contenu: Buffer, type: TypeTableurCpt, lignesALire: number): XLSX.WorkBook {
  const commun = { cellFormula: false, cellHTML: false, cellStyles: false, sheetRows: lignesALire } as const;
  try {
    if (type === "csv") return XLSX.read(decoderTexte(contenu), { type: "string", raw: true, ...commun });
    return XLSX.read(contenu, { type: "buffer", cellDates: true, ...commun });
  } catch {
    throw new CptImportLectureError("Fichier illisible (format non reconnu ou corrompu).");
  }
}

function resoudreColonnes(
  enTetes: Cellule[],
  colonnes: readonly ColonneFormatCpt[]
): { index: number[]; manquantes: ColonneFormatCpt[]; nonUtilises: string[] } {
  const parForme = new Map<string, number>();
  enTetes.forEach((e, i) => {
    const forme = normaliserEnteteCpt(e);
    if (forme && !parForme.has(forme)) parForme.set(forme, i);
  });
  const utilises = new Set<number>();
  const manquantes: ColonneFormatCpt[] = [];
  const index = colonnes.map((c) => {
    const i = parForme.get(normaliserEnteteCpt(c.entete));
    if (i === undefined) {
      manquantes.push(c);
      return -1;
    }
    utilises.add(i);
    return i;
  });
  const nonUtilises = enTetes.flatMap((e, i) => (utilises.has(i) || vide(e) ? [] : [String(e).trim()]));
  return { index, manquantes, nonUtilises };
}

/**
 * Lit un fichier `.xlsx`, `.xls` ou `.csv` (première feuille) selon `definition`. Lève `CptImportLectureError` sur une erreur
 * structurelle ; toute autre irrégularité devient une anomalie de la ligne concernée.
 */
export function lireTableurSelonFormat(
  contenu: Buffer,
  definition: DefinitionFormatCpt,
  limites: Partial<LimitesImportCpt> = {}
): ResultatLectureCpt {
  const tailleMax = limites.tailleMaxOctets ?? CPT_IMPORT_TAILLE_MAX_OCTETS_DEFAUT;
  const lignesMax = limites.lignesMax ?? CPT_IMPORT_LIGNES_MAX_DEFAUT;

  if (contenu.length === 0) throw new CptImportLectureError("Fichier vide.");
  if (contenu.length > tailleMax) {
    throw new CptImportLectureError(`Fichier trop volumineux : ${contenu.length} octets (maximum ${tailleMax}).`);
  }
  const type = detecterTypeTableurCpt(contenu);
  if (!type) throw new CptImportLectureError("Format de fichier non reconnu (.xlsx, .xls ou .csv attendu).");

  const { ligneEntete } = definition;
  // En-têtes + lignes de titre éventuelles + une ligne de plus que le maximum : sans ce +1, une ligne EXCÉDENTAIRE serait
  // tronquée en silence avant le contrôle de dépassement ci-dessous, qui ne verrait plus jamais le dépassement.
  const classeur = lireClasseur(contenu, type, ligneEntete + lignesMax + 1);
  const nomFeuille = classeur.SheetNames[0];
  if (!nomFeuille) throw new CptImportLectureError("Aucune feuille dans le fichier.");
  const feuille = classeur.Sheets[nomFeuille];
  if (!feuille || !feuille["!ref"]) throw new CptImportLectureError("Fichier vide (aucune ligne).");

  // Plage forcée à partir de A1 : sans elle, des lignes vides en tête décaleraient les numéros de ligne annoncés.
  const fin = XLSX.utils.decode_range(feuille["!ref"]).e;
  const brutes = XLSX.utils.sheet_to_json<Cellule[]>(feuille, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
    range: { s: { r: 0, c: 0 }, e: fin },
  });

  const enTetes = brutes[ligneEntete - 1];
  if (!enTetes || enTetes.every(vide)) {
    throw new CptImportLectureError(`Aucun en-tête trouvé à la ligne ${ligneEntete} du fichier.`);
  }
  const { index, manquantes, nonUtilises } = resoudreColonnes(enTetes, definition.colonnes);
  const obligatoiresAbsentes = manquantes.filter((c) => c.obligatoire);
  if (obligatoiresAbsentes.length > 0) {
    const trouves = enTetes.filter((e) => !vide(e)).slice(0, 15).map((e) => `« ${String(e).trim()} »`).join(", ");
    throw new CptImportLectureError(
      `Colonne(s) obligatoire(s) introuvable(s) à la ligne ${ligneEntete} : ${obligatoiresAbsentes
        .map((c) => `« ${c.entete} »`)
        .join(", ")}. En-têtes trouvés : ${trouves || "(aucun)"}.`
    );
  }

  const donnees = brutes.slice(ligneEntete);
  if (donnees.length > lignesMax && donnees.slice(lignesMax).some((l) => !l.every(vide))) {
    throw new CptImportLectureError(`Fichier trop volumineux : plus de ${lignesMax} lignes.`);
  }

  const lignes: LigneLueCpt[] = [];
  const anomalies: AnomalieLectureCpt[] = [];
  let nbAnomalies = 0;
  let nbLignesVidesIgnorees = 0;

  donnees.forEach((brute, position) => {
    if (brute.every(vide)) {
      nbLignesVidesIgnorees += 1;
      return;
    }
    const numeroLigne = ligneEntete + position + 1;
    const valeurs: Record<string, string | null> = {};
    const signaler = (c: ColonneFormatCpt, cellule: Cellule, motif: string) => {
      nbAnomalies += 1;
      if (anomalies.length < CPT_IMPORT_ANOMALIES_DETAILLEES_MAX) {
        anomalies.push({ numeroLigne, champ: c.champ, entete: c.entete, valeurBrute: cellulePourAffichage(cellule), motif });
      }
    };

    definition.colonnes.forEach((c, k) => {
      const cellule = index[k] === -1 ? null : brute[index[k]];
      if (vide(cellule)) {
        valeurs[c.champ] = null;
        if (c.obligatoire) signaler(c, cellule, "valeur obligatoire absente");
        return;
      }
      if (c.type === "texte") {
        valeurs[c.champ] = lireTexte(cellule);
        return;
      }
      const lu = c.type === "date" ? lireDate(cellule, c.formatDate) : lireMontantCellule(cellule);
      if (lu.ok) valeurs[c.champ] = lu.valeur;
      else {
        valeurs[c.champ] = null;
        signaler(c, cellule, lu.motif);
      }
    });
    lignes.push({ numeroLigne, valeurs });
  });

  return {
    typeTableur: type,
    lignes,
    anomalies,
    nbAnomalies,
    nbLignesVidesIgnorees,
    enTetesNonUtilises: nonUtilises,
    colonnesFacultativesAbsentes: manquantes.filter((c) => !c.obligatoire).map((c) => c.entete),
  };
}
