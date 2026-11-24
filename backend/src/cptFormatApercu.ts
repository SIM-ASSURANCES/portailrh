// Gestion Compta, lot GC-3i : créer un format d'import PRODUCTION à partir d'un fichier d'exemple.
//
// Trois étapes, toutes pures (aucun accès base) :
//   1. `apercuTableurCpt` lit les en-têtes (à la ligne choisie) et quelques lignes d'un fichier d'exemple ;
//   2. `proposerFormatProduction` suggère, pour chaque colonne du fichier, le champ interne du bordereau qu'elle alimente
//      (par ressemblance de l'en-tête, jamais par le contenu) et, pour une date écrite en texte, son ordre jour / mois quand il
//      est SANS AMBIGUÏTÉ ;
//   3. `construireDefinitionProduction` transforme le choix final de l'utilisateur en définition valide
//      (`validerDefinitionFormat` reste la seule porte d'entrée vers la base).
// Une suggestion n'est jamais enregistrée sans confirmation : l'utilisateur voit et corrige chaque association.
//
// Indépendant d'Encaissements : aucun import d'un fichier `enc*`.

import * as XLSX from "xlsx";

import {
  FORMATS_DATE_CPT,
  LIGNE_ENTETE_MAX,
  validerDefinitionFormat,
  type ColonneFormatCpt,
  type FormatDateCpt,
  type ResultatValidationFormat,
} from "./cptFormatImport";
import { CptImportLectureError, detecterTypeTableurCpt, lireClasseur, type TypeTableurCpt } from "./cptImportLecture";
import { CHAMPS_PRODUCTION_CPT } from "./cptProduction";

// ---------- 1. Aperçu d'un fichier ----------

export const APERCU_LIGNES_PAR_DEFAUT = 5;
/** Lignes vides tolérées après la ligne d'en-têtes avant de renoncer à trouver des lignes d'exemple. */
const APERCU_LIGNES_VIDES_MAX = 100;

export interface ApercuTableurCpt {
  type: TypeTableurCpt;
  /** Un texte par colonne du fichier, « » si la cellule d'en-tête est vide. */
  enTetes: string[];
  /** Les premières lignes NON vides sous les en-têtes, une valeur texte par colonne. */
  echantillon: string[][];
}

function celluleEnTexte(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    const deux = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${deux(v.getMonth() + 1)}-${deux(v.getDate())}`;
  }
  return String(v).replace(/[  ]/g, " ").trim();
}

/**
 * Lit les en-têtes (ligne `ligneEntete`, à partir de 1) et les premières lignes d'un fichier `.xlsx`, `.xls` ou `.csv`.
 * Lève `CptImportLectureError` si le fichier est vide, illisible ou n'a aucun en-tête à cette ligne.
 */
export function apercuTableurCpt(contenu: Buffer, ligneEntete: number, nbEchantillon = APERCU_LIGNES_PAR_DEFAUT): ApercuTableurCpt {
  if (!Number.isInteger(ligneEntete) || ligneEntete < 1 || ligneEntete > LIGNE_ENTETE_MAX) {
    throw new CptImportLectureError(`La ligne des en-têtes doit être un entier de 1 à ${LIGNE_ENTETE_MAX}.`);
  }
  if (contenu.length === 0) throw new CptImportLectureError("Fichier vide.");
  const type = detecterTypeTableurCpt(contenu);
  if (!type) throw new CptImportLectureError("Format de fichier non reconnu (.xlsx, .xls ou .csv attendu).");

  const classeur = lireClasseur(contenu, type, ligneEntete + nbEchantillon + APERCU_LIGNES_VIDES_MAX);
  const nomFeuille = classeur.SheetNames[0];
  const feuille = nomFeuille ? classeur.Sheets[nomFeuille] : undefined;
  if (!feuille || !feuille["!ref"]) throw new CptImportLectureError("Fichier vide (aucune ligne).");

  const fin = XLSX.utils.decode_range(feuille["!ref"]).e;
  const brutes = XLSX.utils.sheet_to_json<unknown[]>(feuille, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
    range: { s: { r: 0, c: 0 }, e: fin },
  });

  const brutesEnTetes = brutes[ligneEntete - 1];
  const enTetes = (brutesEnTetes ?? []).map(celluleEnTexte);
  if (enTetes.every((e) => e === "")) {
    throw new CptImportLectureError(`Aucun en-tête trouvé à la ligne ${ligneEntete} du fichier.`);
  }
  const echantillon = brutes
    .slice(ligneEntete)
    .map((ligne) => enTetes.map((_, i) => celluleEnTexte(ligne[i])))
    .filter((ligne) => ligne.some((c) => c !== ""))
    .slice(0, nbEchantillon);
  return { type, enTetes, echantillon };
}

// ---------- 2. Proposition d'association ----------

/** Forme de comparaison d'une SUGGESTION : sans accents, minuscules, ponctuation = espace. N'a aucun effet sur la lecture d'un fichier. */
export function formeSuggestion(valeur: unknown): string {
  return String(valeur ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Autres écritures courantes d'un en-tête, par champ interne (en plus du libellé du champ lui-même). */
const SYNONYMES_PRODUCTION: Record<string, string[]> = {
  numPolice: ["numero de police", "n police", "num police", "no police", "police", "numero police", "n de police"],
  paiementId: ["identifiant de paiement", "id paiement", "paiementid", "identifiant paiement", "paiement id"],
  natureContrat: ["type de contrat", "nature du contrat", "nature contrat"],
  produit: ["produit", "code produit", "libelle produit", "garantie"],
  typeOperation: ["type d operation", "type operation", "operation", "acte", "type d acte"],
  client: ["client", "nom du client", "nom client", "assure", "souscripteur"],
  telephone: ["telephone", "tel", "telephone du client", "contact", "mobile"],
  partenaire: ["partenaire", "apporteur", "partenaire apporteur", "courtier", "agent", "intermediaire"],
  fractionnement: ["fractionnement", "periodicite", "echelonnement"],
  dateEffet: ["date d effet", "date effet", "effet", "debut", "date de debut"],
  dateEcheance: ["date d echeance", "date echeance", "echeance", "fin", "date de fin"],
  modePaiement: ["mode de paiement", "mode paiement", "mode", "moyen de paiement"],
  referencePaiement: ["reference de paiement", "reference paiement", "reference", "ref paiement", "n transaction", "transaction id"],
  datePaiement: ["date de paiement", "date paiement", "paye le"],
  primeTtc: ["prime ttc", "ttc", "prime totale", "montant ttc"],
  primeHt: ["prime hors taxe", "prime ht", "ht", "prime nette", "prime nette ht"],
  accessoires: ["accessoires", "accessoire", "frais accessoires"],
  taxe: ["taxe", "tca", "taxes", "taxe sur les contrats d assurance"],
  commission: ["commission", "commission declaree"],
  gestion: ["frais de gestion", "gestion", "frais gestion"],
  montantPaye: ["montant paye", "montant regle", "paye", "montant verse"],
};

/** Forme → champ interne. Construite une fois ; le libellé du champ passe avant les synonymes (pas d'écrasement). */
const CHAMP_PAR_FORME: ReadonlyMap<string, string> = (() => {
  const table = new Map<string, string>();
  for (const c of CHAMPS_PRODUCTION_CPT) {
    const formes = [c.libelle, ...(SYNONYMES_PRODUCTION[c.champ] ?? [])].map(formeSuggestion);
    for (const f of formes) if (f && !table.has(f)) table.set(f, c.champ);
  }
  return table;
})();

const MOTIFS_DATE_APERCU: Record<FormatDateCpt, { re: RegExp; ordre: [number, number, number] }> = {
  "AAAA-MM-JJ": { re: /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/, ordre: [1, 2, 3] },
  "JJ/MM/AAAA": { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T].*)?$/, ordre: [3, 2, 1] },
  "JJ-MM-AAAA": { re: /^(\d{1,2})-(\d{1,2})-(\d{4})(?:[ T].*)?$/, ordre: [3, 2, 1] },
  "MM/JJ/AAAA": { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T].*)?$/, ordre: [3, 1, 2] },
};

function jourValide(a: number, m: number, j: number): boolean {
  if (a < 1900 || a > 2200 || m < 1 || m > 12 || j < 1) return false;
  return j <= new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/**
 * Ordre d'une date écrite en texte, déduit des valeurs d'exemple SEULEMENT quand une seule lecture est possible. « 03/04/2026 »
 * (3 avril ou 4 mars) reste ambigu : `null`, et l'utilisateur doit choisir — jamais de pari, une date décalée d'un mois ne se voit pas.
 */
export function devinerFormatDate(valeurs: readonly string[]): FormatDateCpt | null {
  const renseignees = valeurs.map((v) => v.trim()).filter((v) => v !== "");
  if (renseignees.length === 0) return null;
  const compatibles = FORMATS_DATE_CPT.filter((format) => {
    const { re, ordre } = MOTIFS_DATE_APERCU[format];
    return renseignees.every((v) => {
      const m = re.exec(v);
      return m !== null && jourValide(Number(m[ordre[0]]), Number(m[ordre[1]]), Number(m[ordre[2]]));
    });
  });
  return compatibles.length === 1 ? compatibles[0] : null;
}

export interface ColonneProposee {
  /** Position de la colonne dans le fichier (à partir de 0). */
  index: number;
  entete: string;
  /** Champ interne suggéré, `null` = colonne ignorée. */
  champ: string | null;
  /** Seulement pour un champ de type date ; `null` = à choisir par l'utilisateur. */
  formatDate: FormatDateCpt | null;
  echantillon: string[];
}

export interface PropositionFormatProduction {
  colonnes: ColonneProposee[];
  /** Libellés des champs obligatoires du bordereau qu'aucune colonne du fichier ne semble alimenter. */
  champsObligatoiresManquants: string[];
}

/** Suggère l'association de chaque colonne du fichier. Un champ n'est proposé qu'une fois (la première colonne qui lui ressemble). */
export function proposerFormatProduction(enTetes: readonly string[], echantillon: readonly (readonly string[])[]): PropositionFormatProduction {
  const pris = new Set<string>();
  const colonnes: ColonneProposee[] = [];
  enTetes.forEach((entete, index) => {
    if (entete.trim() === "") return;
    const candidat = CHAMP_PAR_FORME.get(formeSuggestion(entete)) ?? null;
    const champ = candidat !== null && !pris.has(candidat) ? candidat : null;
    if (champ) pris.add(champ);
    const valeurs = echantillon.map((ligne) => ligne[index] ?? "");
    const definition = champ ? CHAMPS_PRODUCTION_CPT.find((c) => c.champ === champ) : undefined;
    colonnes.push({
      index,
      entete: entete.trim(),
      champ,
      formatDate: definition?.type === "date" ? devinerFormatDate(valeurs) : null,
      echantillon: valeurs,
    });
  });
  return {
    colonnes,
    champsObligatoiresManquants: CHAMPS_PRODUCTION_CPT.filter((c) => c.obligatoire && !pris.has(c.champ)).map((c) => c.libelle),
  };
}

// ---------- 3. Définition finale ----------

export interface ChoixColonneProduction {
  /** En-tête tel qu'il est écrit dans le fichier. */
  entete: string;
  /** Champ interne alimenté, `null` ou vide = colonne ignorée. */
  champ: string | null;
  formatDate?: string | null;
}

/**
 * Transforme le choix de l'utilisateur en définition de format valide. Le type et le caractère obligatoire de chaque colonne
 * viennent du bordereau (`CHAMPS_PRODUCTION_CPT`), jamais de l'écran. Renvoie TOUTES les erreurs d'un coup.
 */
export function construireDefinitionProduction(ligneEntete: number, choix: readonly ChoixColonneProduction[]): ResultatValidationFormat {
  const erreurs: string[] = [];
  const colonnes: ColonneFormatCpt[] = [];
  const enteteDuChamp = new Map<string, string>();

  for (const c of choix) {
    if (!c.champ) continue;
    const definition = CHAMPS_PRODUCTION_CPT.find((d) => d.champ === c.champ);
    if (!definition) {
      erreurs.push(`Colonne « ${c.entete} » : champ inconnu « ${c.champ} ».`);
      continue;
    }
    const dejaPris = enteteDuChamp.get(definition.champ);
    if (dejaPris !== undefined) {
      erreurs.push(`« ${definition.libelle} » est associé à deux colonnes (« ${dejaPris} » et « ${c.entete} »).`);
      continue;
    }
    enteteDuChamp.set(definition.champ, c.entete);

    const colonne: ColonneFormatCpt = { entete: c.entete, champ: definition.champ, type: definition.type, obligatoire: definition.obligatoire };
    if (definition.type === "date") {
      if (!FORMATS_DATE_CPT.includes(c.formatDate as FormatDateCpt)) {
        erreurs.push(`Colonne « ${c.entete} » : choisissez l'ordre de la date (${FORMATS_DATE_CPT.join(", ")}).`);
        continue;
      }
      colonne.formatDate = c.formatDate as FormatDateCpt;
    }
    colonnes.push(colonne);
  }

  for (const d of CHAMPS_PRODUCTION_CPT) {
    if (d.obligatoire && !enteteDuChamp.has(d.champ)) erreurs.push(`« ${d.libelle} » est obligatoire : associez-lui une colonne du fichier.`);
  }
  if (erreurs.length > 0) return { ok: false, erreurs };
  return validerDefinitionFormat({ ligneEntete, colonnes });
}
