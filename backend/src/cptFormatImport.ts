// Format d'import paramétrable (Gestion Compta, lot GC-1f ; docs/compta-conception.md §5.3 et §7).
//
// Un format dit, pour un type de fichier (production, relevé Wave, banque…), quelle colonne du fichier alimente quel champ
// interne, de quel type (texte, date, montant) et, pour une date écrite en texte, dans quel ordre. Changer la présentation
// d'un relevé = modifier son format, jamais le code. PUR : aucun accès base ; la ligne `CptFormatImport` porte la définition
// en JSON et `validerDefinitionFormat` en est la seule porte d'entrée (écran de paramétrage GC-2, lecture à l'import).
//
// Indépendant d'Encaissements : aucun import d'un fichier `enc*`.

export const TYPES_IMPORT_CPT = [
  "PRODUCTION",
  "RELEVE_WAVE_BUSINESS",
  "RELEVE_WAVE_HORS_BUSINESS",
  "RELEVE_BANQUE",
  "RELEVE_MICROFINANCE",
  "RELEVE_PEYAPAY",
  "BORDEREAU_PARTENAIRE",
] as const;
export type TypeImportCpt = (typeof TYPES_IMPORT_CPT)[number];

export const LIBELLE_TYPE_IMPORT_CPT: Record<TypeImportCpt, string> = {
  PRODUCTION: "Bordereau de production",
  RELEVE_WAVE_BUSINESS: "Relevé Wave Business",
  RELEVE_WAVE_HORS_BUSINESS: "Relevé Wave (hors Business)",
  RELEVE_BANQUE: "Relevé bancaire",
  RELEVE_MICROFINANCE: "Relevé de microfinance",
  RELEVE_PEYAPAY: "Relevé PeyaPay",
  BORDEREAU_PARTENAIRE: "Bordereau de partenaire",
};

export const TYPES_CHAMP_CPT = ["texte", "date", "montant"] as const;
export type TypeChampCpt = (typeof TYPES_CHAMP_CPT)[number];

/**
 * Ordre des éléments d'une date écrite EN TEXTE (les vraies cellules date d'un classeur n'en ont pas besoin).
 * Volontairement fermé : jamais d'inférence. « 03/04/2026 » est le 3 avril ou le 4 mars selon le fichier, et se tromper
 * déplace silencieusement une écriture d'un mois.
 */
export const FORMATS_DATE_CPT = ["AAAA-MM-JJ", "JJ/MM/AAAA", "JJ-MM-AAAA", "MM/JJ/AAAA"] as const;
export type FormatDateCpt = (typeof FORMATS_DATE_CPT)[number];

export interface ColonneFormatCpt {
  /** En-tête tel qu'il est écrit dans le fichier (comparé sans tenir compte de `normaliserEnteteCpt`). */
  entete: string;
  /** Nom du champ interne alimenté (lettres et chiffres, commence par une minuscule). */
  champ: string;
  type: TypeChampCpt;
  /** `true` : l'en-tête doit exister dans le fichier (sinon l'import s'arrête) ET la cellule doit être renseignée (sinon anomalie de la ligne). */
  obligatoire: boolean;
  /** Seulement pour `type: "date"` ; absent = seul le format ISO `AAAA-MM-JJ` est accepté pour une date écrite en texte. */
  formatDate?: FormatDateCpt;
}

export interface DefinitionFormatCpt {
  /** Ligne (à partir de 1) qui porte les en-têtes. */
  ligneEntete: number;
  colonnes: ColonneFormatCpt[];
}

export const COLONNES_FORMAT_MAX = 100;
export const LIGNE_ENTETE_MAX = 50;
const ENTETE_LONGUEUR_MAX = 120;
const MOTIF_CHAMP = /^[a-z][A-Za-z0-9]{0,39}$/;
const PROPRIETES_COLONNE = new Set(["entete", "champ", "type", "obligatoire", "formatDate"]);

/**
 * Forme canonique d'un en-tête, pour retrouver la colonne d'un format dans un fichier : deux en-têtes qui donnent la même
 * forme sont la MÊME colonne. Sert aussi à refuser, dans un format, deux colonnes qui se confondraient.
 *
 * Choix de conception à faire : jusqu'où tolérer les variations d'un export à l'autre (majuscules, accents, espaces
 * multiples ou insécables, ponctuation) sans confondre deux colonnes réellement différentes.
 */
export function normaliserEnteteCpt(valeur: unknown): string {
  // TODO(human) : remplacer ce minimum (espaces réduits, bords retirés, minuscules) par la règle de comparaison voulue.
  return String(valeur ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export type ResultatValidationFormat = { ok: true; definition: DefinitionFormatCpt } | { ok: false; erreurs: string[] };

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Contrôle une définition reçue (JSON de la base ou saisie d'un écran) et la renvoie normalisée, ou TOUTES ses erreurs
 * d'un coup (jamais seulement la première : l'écran de paramétrage les affiche ensemble). Ne lève jamais.
 */
export function validerDefinitionFormat(entree: { ligneEntete?: unknown; colonnes?: unknown }): ResultatValidationFormat {
  const erreurs: string[] = [];

  const ligne = entree.ligneEntete === undefined ? 1 : entree.ligneEntete;
  if (typeof ligne !== "number" || !Number.isInteger(ligne) || ligne < 1 || ligne > LIGNE_ENTETE_MAX) {
    erreurs.push(`La ligne des en-têtes doit être un entier de 1 à ${LIGNE_ENTETE_MAX}.`);
  }

  if (!Array.isArray(entree.colonnes) || entree.colonnes.length === 0) {
    erreurs.push("Le format doit décrire au moins une colonne.");
    return { ok: false, erreurs };
  }
  if (entree.colonnes.length > COLONNES_FORMAT_MAX) {
    erreurs.push(`Un format décrit au plus ${COLONNES_FORMAT_MAX} colonnes.`);
    return { ok: false, erreurs };
  }

  const colonnes: ColonneFormatCpt[] = [];
  const champsVus = new Map<string, number>();
  const entetesVus = new Map<string, number>();

  entree.colonnes.forEach((brute, i) => {
    const n = i + 1;
    if (!estObjet(brute)) {
      erreurs.push(`Colonne ${n} : description invalide.`);
      return;
    }
    for (const cle of Object.keys(brute)) {
      if (!PROPRIETES_COLONNE.has(cle)) erreurs.push(`Colonne ${n} : propriété inconnue « ${cle} ».`);
    }

    const entete = typeof brute.entete === "string" ? brute.entete.trim() : "";
    if (!entete) erreurs.push(`Colonne ${n} : l'en-tête du fichier est obligatoire.`);
    else if (entete.length > ENTETE_LONGUEUR_MAX) erreurs.push(`Colonne ${n} : en-tête trop long (${ENTETE_LONGUEUR_MAX} caractères au plus).`);

    const champ = typeof brute.champ === "string" ? brute.champ : "";
    if (!MOTIF_CHAMP.test(champ)) {
      erreurs.push(`Colonne ${n} : le champ interne doit commencer par une minuscule et ne contenir que des lettres et des chiffres (40 au plus).`);
    }

    const type = brute.type;
    if (!TYPES_CHAMP_CPT.includes(type as TypeChampCpt)) {
      erreurs.push(`Colonne ${n} : le type doit être ${TYPES_CHAMP_CPT.map((t) => `« ${t} »`).join(", ")}.`);
    }

    if (brute.obligatoire !== undefined && typeof brute.obligatoire !== "boolean") {
      erreurs.push(`Colonne ${n} : « obligatoire » doit valoir vrai ou faux.`);
    }

    const formatDate = brute.formatDate;
    if (formatDate !== undefined) {
      if (type !== "date") erreurs.push(`Colonne ${n} : un format de date n'a de sens que pour une colonne de type « date ».`);
      else if (!FORMATS_DATE_CPT.includes(formatDate as FormatDateCpt)) {
        erreurs.push(`Colonne ${n} : format de date inconnu (${FORMATS_DATE_CPT.map((f) => `« ${f} »`).join(", ")}).`);
      }
    }

    if (entete) {
      const forme = normaliserEnteteCpt(entete);
      const deja = entetesVus.get(forme);
      if (deja !== undefined) erreurs.push(`Colonne ${n} : l'en-tête « ${entete} » se confond avec celui de la colonne ${deja}.`);
      else entetesVus.set(forme, n);
    }
    if (champ) {
      const deja = champsVus.get(champ);
      if (deja !== undefined) erreurs.push(`Colonne ${n} : le champ « ${champ} » est déjà alimenté par la colonne ${deja}.`);
      else champsVus.set(champ, n);
    }

    colonnes.push({
      entete,
      champ,
      type: type as TypeChampCpt,
      obligatoire: brute.obligatoire === true,
      ...(formatDate !== undefined && type === "date" ? { formatDate: formatDate as FormatDateCpt } : {}),
    });
  });

  if (erreurs.length > 0) return { ok: false, erreurs };
  return { ok: true, definition: { ligneEntete: ligne as number, colonnes } };
}
