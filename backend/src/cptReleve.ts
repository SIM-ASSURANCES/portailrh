// Lecture et contrôle d'un relevé d'encaissements (Gestion Compta, lot GC-4b ; docs/compta-conception.md §7).
//
// Un relevé (Wave Business, Wave hors Business, banque, microfinance, PeyaPay) est lu SELON UN FORMAT paramétrable
// (`CptFormatImport`) : l'en-tête de chaque colonne du fichier alimente un champ interne de `CHAMPS_RELEVE_CPT`. Ce fichier ne
// fait que LIRE et CONTRÔLER : reconnaître les remboursements, les transactions test et les virements internes est le lot 4c,
// écrire en base le lot 4d. PUR : aucun accès base, l'appelant fournit le format, les limites et le contexte de contrôle.
//
// Indépendant d'Encaissements : aucun import d'un fichier `enc*`.
//
// ⚠️ Les formats PROPOSÉS ci-dessous (`formatReleveProposeCpt`) reposent sur les colonnes décrites par le plan (horodatage,
// identifiant `T_…`, type, brut, frais, net, contrepartie, session `cos-…`, référence client), pas sur un vrai relevé : les
// échantillons anonymisés (question Q6) n'ont pas encore été fournis. Ils servent de point de départ à l'écran de paramétrage ;
// le format réellement utilisé est celui que la Finance enregistre dans `CptFormatImport`.

import {
  lireTableurSelonFormat,
  CptImportLectureError,
  type LimitesImportCpt,
  type ResultatLectureCpt,
} from "./cptImportLecture";
import type { DefinitionFormatCpt, TypeImportCpt } from "./cptFormatImport";
import { centimesSignes, normaliserReferenceProduction } from "./cptProduction";

// ---------------------------------------------------------------------------------------------------------------------
// Types de relevé et champs internes
// ---------------------------------------------------------------------------------------------------------------------

export const TYPES_RELEVE_CPT = ["RELEVE_WAVE_BUSINESS", "RELEVE_WAVE_HORS_BUSINESS", "RELEVE_BANQUE", "RELEVE_MICROFINANCE", "RELEVE_PEYAPAY"] as const;
export type TypeReleveCpt = Extract<TypeImportCpt, (typeof TYPES_RELEVE_CPT)[number]>;

export function estTypeReleveCpt(type: string): type is TypeReleveCpt {
  return (TYPES_RELEVE_CPT as readonly string[]).includes(type);
}

export interface ChampReleve {
  champ: string;
  libelle: string;
  type: "texte" | "date" | "montant";
  obligatoire: boolean;
}

/**
 * Champs que le format d'un relevé peut alimenter. Seuls la référence et la date sont obligatoires dans TOUT format ; le montant
 * est soit une colonne signée (`montant`), soit deux colonnes (`credit`, `debit`) : `verifierFormatReleveCpt` exige l'un des deux.
 */
export const CHAMPS_RELEVE_CPT: readonly ChampReleve[] = [
  { champ: "reference", libelle: "Référence de la ligne", type: "texte", obligatoire: true },
  { champ: "dateValeur", libelle: "Date de la ligne", type: "date", obligatoire: true },
  { champ: "montant", libelle: "Montant (signé)", type: "montant", obligatoire: false },
  { champ: "credit", libelle: "Crédit", type: "montant", obligatoire: false },
  { champ: "debit", libelle: "Débit", type: "montant", obligatoire: false },
  { champ: "frais", libelle: "Frais retenus", type: "montant", obligatoire: false },
  { champ: "net", libelle: "Montant net", type: "montant", obligatoire: false },
  { champ: "typeSource", libelle: "Type de transaction chez l'opérateur", type: "texte", obligatoire: false },
  { champ: "payeur", libelle: "Payeur ou contrepartie", type: "texte", obligatoire: false },
  { champ: "telephone", libelle: "Téléphone du payeur", type: "texte", obligatoire: false },
  { champ: "referenceClient", libelle: "Référence indiquée par le payeur", type: "texte", obligatoire: false },
  { champ: "libelle", libelle: "Libellé", type: "texte", obligatoire: false },
  { champ: "sessionPaiement", libelle: "Session de paiement", type: "texte", obligatoire: false },
];

const col = (entete: string, champ: string, type: ChampReleve["type"], obligatoire = false) => ({
  entete,
  champ,
  type,
  obligatoire,
  ...(type === "date" ? { formatDate: "AAAA-MM-JJ" as const } : {}),
});

/**
 * Format proposé pour un type de relevé (PROVISOIRE, voir l'en-tête du fichier). Les dates sont lues au format ISO, avec heure
 * facultative ; un export qui écrit « 03/04/2026 » se règle en choisissant l'ordre de la date dans l'écran de paramétrage.
 */
export function formatReleveProposeCpt(type: TypeReleveCpt): DefinitionFormatCpt {
  switch (type) {
    case "RELEVE_WAVE_BUSINESS":
      return {
        ligneEntete: 1,
        colonnes: [
          col("Horodatage", "dateValeur", "date", true),
          col("Identifiant de transaction", "reference", "texte", true),
          col("Type de transaction", "typeSource", "texte"),
          col("Montant brut", "montant", "montant"),
          col("Frais", "frais", "montant"),
          col("Montant net", "net", "montant"),
          col("Contrepartie", "payeur", "texte"),
          col("Téléphone", "telephone", "texte"),
          col("Identifiant de session", "sessionPaiement", "texte"),
          col("Référence client", "referenceClient", "texte"),
        ],
      };
    case "RELEVE_WAVE_HORS_BUSINESS":
      return {
        ligneEntete: 1,
        colonnes: [
          col("Horodatage", "dateValeur", "date", true),
          col("Identifiant de transaction", "reference", "texte", true),
          col("Montant", "montant", "montant"),
          col("Frais", "frais", "montant"),
          col("Contrepartie", "payeur", "texte"),
          col("Téléphone", "telephone", "texte"),
          col("Libellé", "libelle", "texte"),
        ],
      };
    case "RELEVE_BANQUE":
    case "RELEVE_MICROFINANCE":
      return {
        ligneEntete: 1,
        colonnes: [
          col("Date de valeur", "dateValeur", "date", true),
          col("Référence", "reference", "texte", true),
          col("Libellé", "libelle", "texte"),
          col("Débit", "debit", "montant"),
          col("Crédit", "credit", "montant"),
        ],
      };
    case "RELEVE_PEYAPAY":
      return {
        ligneEntete: 1,
        colonnes: [
          col("Date", "dateValeur", "date", true),
          col("Référence", "reference", "texte", true),
          col("Montant", "montant", "montant"),
          col("Frais", "frais", "montant"),
          col("Client", "payeur", "texte"),
          col("Téléphone", "telephone", "texte"),
          col("Référence client", "referenceClient", "texte"),
        ],
      };
  }
}

/**
 * Un format de relevé est utilisable s'il alimente la référence, la date et un montant (colonne signée, ou crédit et/ou débit).
 * Renvoie TOUTES les erreurs d'un coup ; liste vide = format utilisable.
 */
export function verifierFormatReleveCpt(definition: DefinitionFormatCpt): string[] {
  const champs = new Set(definition.colonnes.map((c) => c.champ));
  const erreurs: string[] = [];
  const inconnus = [...champs].filter((c) => !CHAMPS_RELEVE_CPT.some((d) => d.champ === c));
  if (inconnus.length > 0) erreurs.push(`Champ(s) inconnu(s) pour un relevé : ${inconnus.join(", ")}.`);
  if (!champs.has("reference")) erreurs.push("Aucune colonne n'alimente la référence de la ligne.");
  if (!champs.has("dateValeur")) erreurs.push("Aucune colonne n'alimente la date de la ligne.");
  if (!champs.has("montant") && !champs.has("credit") && !champs.has("debit")) {
    erreurs.push("Aucune colonne n'alimente le montant (colonne signée, ou colonnes crédit et débit).");
  }
  for (const c of definition.colonnes) {
    const attendu = CHAMPS_RELEVE_CPT.find((d) => d.champ === c.champ);
    if (attendu && attendu.type !== c.type) erreurs.push(`Le champ « ${c.champ} » est de type ${attendu.type}, pas ${c.type}.`);
  }
  return erreurs;
}

// ---------------------------------------------------------------------------------------------------------------------
// Ligne typée
// ---------------------------------------------------------------------------------------------------------------------

export interface LigneReleve {
  /** Numéro de ligne tel que l'affiche le tableur. */
  numeroLigne: number;
  /** Référence normalisée (majuscules, sans espaces). */
  reference: string | null;
  /** `AAAA-MM-JJ`. */
  dateValeur: string | null;
  /** Centimes signés : positif = crédit, négatif = débit. `null` = absent ou illisible. */
  montant: bigint | null;
  /** Frais retenus, centimes, toujours positifs. */
  frais: bigint | null;
  /** Net annoncé par l'opérateur, centimes signés. */
  net: bigint | null;
  typeSource: string | null;
  payeur: string | null;
  telephone: string | null;
  referenceClient: string | null;
  libelle: string | null;
  sessionPaiement: string | null;
}

const ZERO = BigInt(0);
const CENT = BigInt(100);
const absolu = (n: bigint) => (n < ZERO ? -n : n);

const texteOuNull = (v: string | null | undefined) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};

/** Téléphone : seulement les chiffres (et le « + » de tête), pour comparer des numéros écrits de plusieurs façons. */
export function normaliserTelephoneReleve(valeur: string | null | undefined): string | null {
  const brut = (valeur ?? "").trim();
  if (brut === "") return null;
  const chiffres = brut.replace(/\D/g, "");
  if (chiffres === "") return null;
  return brut.startsWith("+") ? `+${chiffres}` : chiffres;
}

/**
 * Ligne lue (valeurs par champ interne) → ligne typée. Le montant vient de la colonne signée ; à défaut, de crédit − débit
 * (chacun pris en valeur absolue : une banque écrit souvent un débit positif). Ne contrôle rien : voir `controlerLotReleve`.
 */
export function ligneReleveDepuisValeurs(numeroLigne: number, valeurs: Record<string, string | null>): LigneReleve {
  const signe = centimesSignes(valeurs.montant);
  const credit = centimesSignes(valeurs.credit);
  const debit = centimesSignes(valeurs.debit);
  let montant: bigint | null = signe;
  if (montant === null && (credit !== null || debit !== null)) {
    montant = absolu(credit ?? ZERO) - absolu(debit ?? ZERO);
  }
  const frais = centimesSignes(valeurs.frais);
  return {
    numeroLigne,
    reference: normaliserReferenceProduction(valeurs.reference),
    dateValeur: texteOuNull(valeurs.dateValeur),
    montant,
    frais: frais === null ? null : absolu(frais),
    net: centimesSignes(valeurs.net),
    typeSource: texteOuNull(valeurs.typeSource),
    payeur: texteOuNull(valeurs.payeur),
    telephone: normaliserTelephoneReleve(valeurs.telephone),
    referenceClient: texteOuNull(valeurs.referenceClient),
    libelle: texteOuNull(valeurs.libelle),
    sessionPaiement: texteOuNull(valeurs.sessionPaiement),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Contrôles
// ---------------------------------------------------------------------------------------------------------------------

export type GraviteReleve = "BLOQUANT" | "ALERTE" | "INFO";

export type CodeSignalementReleve =
  | "REFERENCE_MANQUANTE"
  | "REFERENCE_EN_DOUBLE"
  | "DATE_MANQUANTE"
  | "DATE_FUTURE"
  | "HORS_PERIODE"
  | "MONTANT_MANQUANT"
  | "MONTANT_NUL"
  | "FRAIS_SUPERIEURS_AU_MONTANT"
  | "NET_INCOHERENT";

export interface SignalementReleve {
  code: CodeSignalementReleve;
  gravite: GraviteReleve;
  champ?: string;
  message: string;
}

export interface ContexteControleReleve {
  /** Date du jour, `AAAA-MM-JJ`. */
  aujourdhui: string;
  /** Mois du relevé, `AAAA-MM-01`, quand il est connu (choisi à l'import) ; une ligne d'un autre mois est signalée. */
  periode?: string | null;
  /** Écart toléré entre net annoncé et brut − frais, en centimes (défaut 100 = 1 FCFA, arrondis de l'opérateur). */
  toleranceCentimes?: bigint;
}

const sig = (code: CodeSignalementReleve, gravite: GraviteReleve, message: string, champ?: string): SignalementReleve => ({
  code,
  gravite,
  message,
  ...(champ ? { champ } : {}),
});

const formater = (c: bigint) => {
  const n = absolu(c);
  const entier = (n / CENT).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const reste = n % CENT;
  return `${c < ZERO ? "-" : ""}${entier}${reste === ZERO ? "" : "," + reste.toString().padStart(2, "0")}`;
};

/**
 * Contrôles d'une ligne seule. Bloquants (la ligne ne peut pas devenir un encaissement) : référence, date, montant. Les autres
 * sont des alertes à traiter : montant nul, frais plus grands que le montant, net qui ne correspond pas à brut − frais, date
 * future, date hors du mois du relevé.
 */
export function controlerLigneReleve(ligne: LigneReleve, contexte: ContexteControleReleve): SignalementReleve[] {
  const s: SignalementReleve[] = [];
  const tolerance = contexte.toleranceCentimes ?? CENT;

  if (ligne.reference === null) s.push(sig("REFERENCE_MANQUANTE", "BLOQUANT", "Référence de la ligne manquante.", "reference"));

  if (ligne.dateValeur === null) s.push(sig("DATE_MANQUANTE", "BLOQUANT", "Date de la ligne manquante ou illisible.", "dateValeur"));
  else {
    if (ligne.dateValeur > contexte.aujourdhui) s.push(sig("DATE_FUTURE", "ALERTE", `Date ${ligne.dateValeur} dans le futur.`, "dateValeur"));
    if (contexte.periode && ligne.dateValeur.slice(0, 7) !== contexte.periode.slice(0, 7)) {
      s.push(sig("HORS_PERIODE", "ALERTE", `Date ${ligne.dateValeur} hors du mois du relevé (${contexte.periode.slice(0, 7)}).`, "dateValeur"));
    }
  }

  if (ligne.montant === null) s.push(sig("MONTANT_MANQUANT", "BLOQUANT", "Montant manquant ou illisible.", "montant"));
  else {
    if (ligne.montant === ZERO) s.push(sig("MONTANT_NUL", "ALERTE", "Montant nul.", "montant"));
    if (ligne.frais !== null && ligne.frais > absolu(ligne.montant)) {
      s.push(sig("FRAIS_SUPERIEURS_AU_MONTANT", "ALERTE", `Frais (${formater(ligne.frais)}) supérieurs au montant (${formater(absolu(ligne.montant))}).`, "frais"));
    }
    // Le net n'a de sens à contrôler que pour un crédit : c'est lui que la Finance rapproche des primes.
    if (ligne.net !== null && ligne.montant > ZERO) {
      const attendu = ligne.montant - (ligne.frais ?? ZERO);
      if (absolu(ligne.net - attendu) > tolerance) {
        s.push(sig("NET_INCOHERENT", "ALERTE", `Net annoncé ${formater(ligne.net)} différent de brut − frais (${formater(attendu)}).`, "net"));
      }
    }
  }
  return s;
}

export interface ResultatLotReleve {
  /** Signalements par numéro de ligne (les lignes sans signalement sont absentes). */
  parLigne: Map<number, SignalementReleve[]>;
  nbBloquants: number;
  nbAlertes: number;
  nbInfos: number;
}

/**
 * Contrôle un relevé entier : contrôles de chaque ligne, plus la référence répétée dans le fichier (la PREMIÈRE occurrence reste
 * importable, les suivantes sont bloquées : une même transaction ne se compte qu'une fois — c'est aussi ce que garantit la base
 * par (compte, référence)).
 */
export function controlerLotReleve(lignes: LigneReleve[], contexte: ContexteControleReleve): ResultatLotReleve {
  const parLigne = new Map<number, SignalementReleve[]>();
  const ajouter = (n: number, x: SignalementReleve) => parLigne.set(n, [...(parLigne.get(n) ?? []), x]);
  for (const l of lignes) for (const x of controlerLigneReleve(l, contexte)) ajouter(l.numeroLigne, x);

  const premiere = new Map<string, number>();
  for (const l of lignes) {
    if (l.reference === null) continue;
    const vue = premiere.get(l.reference);
    if (vue === undefined) premiere.set(l.reference, l.numeroLigne);
    else ajouter(l.numeroLigne, sig("REFERENCE_EN_DOUBLE", "BLOQUANT", `Référence ${l.reference} déjà présente à la ligne ${vue} du fichier.`, "reference"));
  }

  let nbBloquants = 0;
  let nbAlertes = 0;
  let nbInfos = 0;
  for (const liste of parLigne.values()) {
    for (const x of liste) {
      if (x.gravite === "BLOQUANT") nbBloquants++;
      else if (x.gravite === "ALERTE") nbAlertes++;
      else nbInfos++;
    }
  }
  return { parLigne, nbBloquants, nbAlertes, nbInfos };
}

/** Une ligne est importable tant qu'aucun de ses signalements n'est bloquant. */
export function ligneReleveImportable(signalements: SignalementReleve[] | undefined): boolean {
  return !(signalements ?? []).some((x) => x.gravite === "BLOQUANT");
}

// ---------------------------------------------------------------------------------------------------------------------
// Mois couverts et totaux
// ---------------------------------------------------------------------------------------------------------------------

export interface MoisCouvertReleve {
  /** `AAAA-MM-01`. */
  mois: string;
  nbLignes: number;
}

/** Mois (premier jour) des dates du relevé, du plus ancien au plus récent, avec le nombre de lignes de chacun. */
export function moisCouvertsReleve(lignes: LigneReleve[]): MoisCouvertReleve[] {
  const comptes = new Map<string, number>();
  for (const l of lignes) {
    if (l.dateValeur === null) continue;
    const mois = `${l.dateValeur.slice(0, 7)}-01`;
    comptes.set(mois, (comptes.get(mois) ?? 0) + 1);
  }
  return [...comptes.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([mois, nbLignes]) => ({ mois, nbLignes }));
}

/** Mois qui porte le plus de lignes (à égalité, le plus ancien) ; `null` si aucune ligne n'a de date. */
export function moisPrincipalReleve(lignes: LigneReleve[]): string | null {
  const mois = moisCouvertsReleve(lignes);
  if (mois.length === 0) return null;
  return mois.reduce((meilleur, m) => (m.nbLignes > meilleur.nbLignes ? m : meilleur)).mois;
}

export interface TotauxReleve {
  nbLignes: number;
  /** Somme des montants positifs. */
  totalCredits: bigint;
  /** Somme des montants négatifs, en valeur absolue. */
  totalDebits: bigint;
  totalFrais: bigint;
}

/** Totaux d'un ensemble de lignes (celles que l'appelant retient : en pratique les lignes importables). */
export function totauxReleve(lignes: LigneReleve[]): TotauxReleve {
  let totalCredits = ZERO;
  let totalDebits = ZERO;
  let totalFrais = ZERO;
  for (const l of lignes) {
    if (l.montant !== null) {
      if (l.montant > ZERO) totalCredits += l.montant;
      else totalDebits += -l.montant;
    }
    if (l.frais !== null) totalFrais += l.frais;
  }
  return { nbLignes: lignes.length, totalCredits, totalDebits, totalFrais };
}

// ---------------------------------------------------------------------------------------------------------------------
// Lecture d'un fichier
// ---------------------------------------------------------------------------------------------------------------------

export interface ResultatLectureReleve {
  /** Lecture brute (anomalies de cellule, en-têtes non utilisés…). */
  lecture: ResultatLectureCpt;
  lignes: LigneReleve[];
}

/**
 * Lit un fichier de relevé selon son format. Lève `CptImportLectureError` si le format ne permet pas de lire un relevé
 * (référence, date ou montant sans colonne) ou sur une erreur structurelle du fichier (voir `lireTableurSelonFormat`).
 */
export function lireReleveCpt(contenu: Buffer, definition: DefinitionFormatCpt, limites: Partial<LimitesImportCpt> = {}): ResultatLectureReleve {
  const erreurs = verifierFormatReleveCpt(definition);
  if (erreurs.length > 0) throw new CptImportLectureError(`Format de relevé inutilisable : ${erreurs.join(" ")}`);
  const lecture = lireTableurSelonFormat(contenu, definition, limites);
  return { lecture, lignes: lecture.lignes.map((l) => ligneReleveDepuisValeurs(l.numeroLigne, l.valeurs)) };
}
