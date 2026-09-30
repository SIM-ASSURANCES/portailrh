// Lecture du fichier de production (module Encaissements, CDC V2.6 §7.1/F1, docs/encaissements-conception.md §8.1).
//
// PURE : aucun accès à la base, aucune règle métier (doublon, avenant, écart de taux, annulation...) — seulement la
// lecture du tableur et l'extraction des colonnes A à AH par POSITION (les en-têtes ne servent qu'au CONTRÔLE). Les
// règles F1 (tableau des cas) vivent dans encImportRegles.ts (commit suivant), qui consomme la sortie d'ici.
//
// Permissive à dessein : un champ de contenu absent/illisible (numéro de police, dates, montants, paiement) devient
// `null`, jamais une exception pour la ligne ni pour le fichier — seuls les problèmes STRUCTURELS (en-têtes qui ne
// correspondent pas, fichier vide, trop volumineux, trop de lignes) sont fatals ici. Une ligne incomplète est une
// donnée métier pour encImportRegles.ts (cas « à compléter », F1.4), pas une erreur de lecture.
//
// Bibliothèque : SheetJS CE 0.20.3, vendue dans le dépôt (`backend/vendor/xlsx-0.20.3.tgz`, dépendance `file:`) — le
// paquet npm `xlsx` 0.18.5 n'est plus maintenu et porte CVE-2023-30533/CVE-2024-22363 (voir
// docs/encaissements-analyse-impact-v2.md §7). Lecture UNIQUEMENT côté serveur ; formules, HTML et styles désactivés ;
// une seule fonction d'entrée, `lireTableur`.

import * as XLSX from "xlsx";

import type { Montant } from "./encCalcul";
import { montant } from "./encCalcul";

export class EncImportLectureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncImportLectureError";
  }
}

/** Comme les pièces jointes (10 Mo) — aucune limite propre au module n'est donnée par le cahier. */
export const TAILLE_MAX_OCTETS = 10 * 1024 * 1024;

/** Aucune limite précisée par le cahier au-delà de l'objectif de performance (5 000 lignes < 2 min) — 20 000 retenu
 *  comme plafond large, à ajuster si un vrai fichier de production s'avère plus volumineux. */
export const LIGNES_MAX = 20_000;

/**
 * En-têtes canoniques des 34 colonnes A à AH, dans l'ordre, symboles ▲/✦ de la maquette déjà retirés (comparaison
 * insensible à ces symboles — `normaliserEntete`). Source : Maquette_registre_paiements.html (tableau HEADERS) et CDC
 * §3.1/§3.2/§7.1. Une colonne « Branche » optionnelle, reconnue par son en-tête, peut être insérée à N'IMPORTE QUELLE
 * position parmi celles-ci (CDC §7.1) — traitée séparément, jamais un 35ᵉ élément de cette liste.
 */
const ENTETES_ATTENDUES = [
  "DateEnregistrement",
  "PaiementID",
  "NumPolice",
  "TypeDeContrat",
  "LibelléProduit",
  "CodeProduit",
  "TypeOpération",
  "ClientID",
  "NomClient/Souscripteur",
  "NomPartenaire",
  "DatePaiement",
  "ModePaiement",
  "RéférencePaiement",
  "DDF (jours)",
  "Date effet",
  "Date échéance",
  "StatutContrat",
  "N° Paiement",
  "PrimeTTC Contrat (FCFA)",
  "PrimeNetteHT",
  "AccessoiresHT",
  "TaxesMontant",
  "MontantCommission",
  "MontantGestion",
  "Type Police",
  "Montant reçu TTC",
  "Montant restant dû",
  "Prime nette reçue",
  "Accessoires reçus",
  "Taxe effective à payer",
  "Statut du paiement",
  "Observations",
  "SemaineAnnée",
  "Contrôle référence",
] as const;

/** Index 0-based des colonnes calculées, ignorées à l'import et recalculées (CDC §7.1) : N, Q, R, AA à AH. Les 4
 *  dernières (AE-AH, dont « Observations ») sont ignorées elles aussi : le cahier ne fait aucune exception pour cette
 *  plage, la valeur éventuellement présente dans le fichier n'est jamais reprise telle quelle à l'import. */
const INDEX_IGNORES = new Set<number>([13, 16, 17, 26, 27, 28, 29, 30, 31, 32, 33]);

const NOM_COLONNE_BRANCHE = "branche";

function normaliserEntete(valeur: unknown): string {
  return String(valeur ?? "")
    .replace(/[▲✦]/g, "")
    .trim();
}

/** Reprise directe de `normMode` (Maquette_registre_paiements.html) : reconnaît le mode quel que soit le libellé
 *  saisi par la production. Retourne `null` (pas de mode) plutôt qu'une chaîne vide. */
export function normaliserMode(valeur: unknown): string | null {
  const s = String(valeur ?? "").trim().toUpperCase();
  if (!s) return null;
  if (/WAVE/.test(s)) return "WAVE";
  if (/ORANGE|^OM\b|OM$/.test(s)) return "OM";
  if (/MTN|MOMO/.test(s)) return "MTN";
  if (/CH[EÈÉ]QUE|^CHQ/.test(s)) return "CHQ";
  if (/VIR/.test(s)) return "VIR";
  if (/CARTE|^CB$|VISA/.test(s)) return "CB";
  if (/MOOV|FLOOZ|MOBILE|MOB/.test(s)) return "MOB";
  return s;
}

function texte(valeur: unknown): string | null {
  const s = String(valeur ?? "").trim();
  return s ? s : null;
}

function date(valeur: unknown): Date | null {
  if (valeur instanceof Date && !Number.isNaN(valeur.getTime())) return valeur;
  return null;
}

/** Nombre de cellule → `Montant` au centime, en passant par une chaîne (jamais le flottant brut, qui peut porter un
 *  résidu binaire, ex. 1398.5999999999998 pour 1 398,60) ; `null` si absent ou non numérique. */
function montantCellule(valeur: unknown): Montant | null {
  if (typeof valeur !== "number" || !Number.isFinite(valeur)) return null;
  return montant((Math.round(valeur * 100) / 100).toFixed(2));
}

export interface LigneFichierProduction {
  /** Position dans le fichier (1 = première ligne de données, juste après l'en-tête) — pour les signalements. */
  numeroLigne: number;
  dateEnregistrement: Date | null;
  /** PaiementID DU FICHIER (colonne B) : clé anti-doublon seulement, jamais notre propre numéro PAI (D7/A1b). */
  paiementIdFichier: string | null;
  numPolice: string | null;
  /** `null` si le fichier ne porte aucune colonne « Branche » (choisie à l'import dans ce cas, hors de ce module). */
  brancheCode: string | null;
  typeContrat: string | null;
  produitLibelle: string | null;
  produitCode: string | null;
  typeOperation: string | null;
  clientId: string | null;
  clientNom: string | null;
  partenaireNom: string | null;
  datePaiement: Date | null;
  mode: string | null;
  reference: string | null;
  dateEffet: Date | null;
  dateEcheance: Date | null;
  /** Montants du contrat (S, T, U, V, W, X) — mêmes noms que `MontantsContrat` (encCalcul.ts), jamais recalculés. */
  S: Montant | null;
  T: Montant | null;
  U: Montant | null;
  V: Montant | null;
  W: Montant | null;
  X: Montant | null;
  typePolice: string | null;
  /** Montant reçu TTC de l'éventuel paiement porté par cette ligne. */
  Z: Montant | null;
}

export interface ResultatLectureProduction {
  lignes: LigneFichierProduction[];
  /** `true` si une colonne « Branche » a été reconnue dans le fichier. */
  brancheColonnePresente: boolean;
  /** Lignes entièrement vides rencontrées (et ignorées, jamais comptées dans `lignes`). */
  nbLignesVidesIgnorees: number;
}

/** Repère la colonne « Branche » (n'importe quelle position, CDC §7.1) puis vérifie que les colonnes restantes
 *  correspondent, PAR POSITION, à `ENTETES_ATTENDUES`. Renvoie l'index réel (dans la ligne d'en-têtes) de chaque
 *  colonne logique, dans l'ordre de `ENTETES_ATTENDUES`. */
function resoudreColonnes(enTetes: unknown[]): { indexParColonne: number[]; indexBranche: number | null } {
  const indexBranche = enTetes.findIndex((v) => normaliserEntete(v).toLowerCase() === NOM_COLONNE_BRANCHE);
  const indexRestants = enTetes.map((_, i) => i).filter((i) => i !== indexBranche);

  if (indexRestants.length !== ENTETES_ATTENDUES.length) {
    throw new EncImportLectureError(
      `En-têtes invalides : ${indexRestants.length} colonne(s) trouvée(s) hors « Branche », ${ENTETES_ATTENDUES.length} attendues.`
    );
  }
  ENTETES_ATTENDUES.forEach((attendu, position) => {
    const reel = normaliserEntete(enTetes[indexRestants[position]]);
    if (reel !== attendu) {
      throw new EncImportLectureError(
        `En-tête invalide en position ${position + 1}${indexBranche !== null && indexBranche <= indexRestants[position] ? " (hors colonne Branche)" : ""} : attendu « ${attendu} », trouvé « ${reel || "(vide)"} ».`
      );
    }
  });

  return { indexParColonne: indexRestants, indexBranche: indexBranche === -1 ? null : indexBranche };
}

function ligneEntierementVide(brute: unknown[]): boolean {
  return brute.every((v) => v === null || v === undefined || String(v).trim() === "");
}

/**
 * Lit un fichier de production (`.xls`, `.xlsx` ou `.csv`) et renvoie ses lignes, colonne par colonne, par position.
 * Seule fonction d'entrée de ce module (§8.4) : un changement de bibliothèque de lecture ne toucherait qu'ici.
 */
export function lireTableur(buffer: Buffer): ResultatLectureProduction {
  if (buffer.length === 0) throw new EncImportLectureError("Fichier vide.");
  if (buffer.length > TAILLE_MAX_OCTETS) {
    throw new EncImportLectureError(`Fichier trop volumineux : ${buffer.length} octets (maximum ${TAILLE_MAX_OCTETS}).`);
  }

  let classeur: XLSX.WorkBook;
  try {
    classeur = XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      // + la ligne d'en-têtes, + 1 rang supplémentaire : sans ce +1, une ligne de données EXCÉDENTAIRE serait
      // silencieusement tronquée par SheetJS avant même d'atteindre le contrôle `donnees.length > LIGNES_MAX`
      // ci-dessous, qui ne verrait alors plus jamais le dépassement (borne quand même : jamais plus de
      // `LIGNES_MAX + 1` lignes de données chargées en mémoire, quelle que soit la taille réelle du fichier).
      sheetRows: LIGNES_MAX + 2,
    });
  } catch {
    throw new EncImportLectureError("Fichier illisible (format non reconnu ou corrompu).");
  }

  const nomFeuille = classeur.SheetNames[0];
  if (!nomFeuille) throw new EncImportLectureError("Aucune feuille dans le fichier.");
  const feuille = classeur.Sheets[nomFeuille];

  const lignesBrutes = XLSX.utils.sheet_to_json<unknown[]>(feuille, { header: 1, raw: true, defval: null });
  if (lignesBrutes.length === 0) throw new EncImportLectureError("Fichier vide (aucune ligne).");

  const [enTetes, ...donnees] = lignesBrutes;
  if (donnees.length > LIGNES_MAX) {
    throw new EncImportLectureError(`Fichier trop volumineux : ${donnees.length} lignes (maximum ${LIGNES_MAX}).`);
  }

  const { indexParColonne, indexBranche } = resoudreColonnes(enTetes);
  const idx = (nom: (typeof ENTETES_ATTENDUES)[number]): number => indexParColonne[ENTETES_ATTENDUES.indexOf(nom)];

  const IDX = {
    dateEnregistrement: idx("DateEnregistrement"),
    paiementIdFichier: idx("PaiementID"),
    numPolice: idx("NumPolice"),
    typeContrat: idx("TypeDeContrat"),
    produitLibelle: idx("LibelléProduit"),
    produitCode: idx("CodeProduit"),
    typeOperation: idx("TypeOpération"),
    clientId: idx("ClientID"),
    clientNom: idx("NomClient/Souscripteur"),
    partenaireNom: idx("NomPartenaire"),
    datePaiement: idx("DatePaiement"),
    mode: idx("ModePaiement"),
    reference: idx("RéférencePaiement"),
    dateEffet: idx("Date effet"),
    dateEcheance: idx("Date échéance"),
    S: idx("PrimeTTC Contrat (FCFA)"),
    T: idx("PrimeNetteHT"),
    U: idx("AccessoiresHT"),
    V: idx("TaxesMontant"),
    W: idx("MontantCommission"),
    X: idx("MontantGestion"),
    typePolice: idx("Type Police"),
    Z: idx("Montant reçu TTC"),
  } as const;
  void INDEX_IGNORES; // documente les colonnes volontairement non lues (N, Q, R, AA-AH) ; aucune n'est dans IDX ci-dessus.

  const lignes: LigneFichierProduction[] = [];
  let nbLignesVidesIgnorees = 0;

  donnees.forEach((brute, position) => {
    if (ligneEntierementVide(brute)) {
      nbLignesVidesIgnorees += 1;
      return;
    }
    lignes.push({
      numeroLigne: position + 1,
      dateEnregistrement: date(brute[IDX.dateEnregistrement]),
      paiementIdFichier: texte(brute[IDX.paiementIdFichier]),
      numPolice: texte(brute[IDX.numPolice]),
      brancheCode: indexBranche !== null ? texte(brute[indexBranche]) : null,
      typeContrat: texte(brute[IDX.typeContrat]),
      produitLibelle: texte(brute[IDX.produitLibelle]),
      produitCode: texte(brute[IDX.produitCode]),
      typeOperation: texte(brute[IDX.typeOperation]),
      clientId: texte(brute[IDX.clientId]),
      clientNom: texte(brute[IDX.clientNom]),
      partenaireNom: texte(brute[IDX.partenaireNom]),
      datePaiement: date(brute[IDX.datePaiement]),
      mode: normaliserMode(brute[IDX.mode]),
      reference: texte(brute[IDX.reference]),
      dateEffet: date(brute[IDX.dateEffet]),
      dateEcheance: date(brute[IDX.dateEcheance]),
      S: montantCellule(brute[IDX.S]),
      T: montantCellule(brute[IDX.T]),
      U: montantCellule(brute[IDX.U]),
      V: montantCellule(brute[IDX.V]),
      W: montantCellule(brute[IDX.W]),
      X: montantCellule(brute[IDX.X]),
      typePolice: texte(brute[IDX.typePolice]),
      Z: montantCellule(brute[IDX.Z]),
    });
  });

  return { lignes, brancheColonnePresente: indexBranche !== null, nbLignesVidesIgnorees };
}
