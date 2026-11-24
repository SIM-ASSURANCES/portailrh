// Référentiels de Gestion Compta : validation des saisies, taux de TCA en vigueur, conventions et chevauchements
// (lot GC-2b ; docs/compta-conception.md §5.3, règles C-4 et C-10).
//
// PUR : aucune base de données, aucune dépendance autre que `./montant` (règle d'indépendance : jamais un import `enc*` ou
// `treso*`). Les actions serveur (GC-2c) chargent les lignes puis appellent ces fonctions ; elles revérifient toujours
// la permission et prennent un verrou avant d'écrire.
//
// Conventions : les dates sont des chaînes ISO `AAAA-MM-JJ` (comparables telles quelles) ; un taux est une FRACTION en texte
// (« 0.072500 » pour 7,25 %), saisi et affiché en pourcentage ; jamais de calcul sur un flottant.

import { lireMontant } from "./montant";

// ---------- Énumérations (miroir de schema.prisma, vérifié par cptReferentiels.test.ts) ----------

export const BRANCHES_CPT = ["ACCIDENTS", "SANTE", "INCENDIE", "DECES"] as const;
export type BrancheCpt = (typeof BRANCHES_CPT)[number];
export const LIBELLE_BRANCHE_CPT: Record<BrancheCpt, string> = {
  ACCIDENTS: "Accidents",
  SANTE: "Santé",
  INCENDIE: "Incendie",
  DECES: "Décès",
};

export const NATURES_CONTRAT_CPT = ["INDIVIDUEL", "GROUPE"] as const;
export type NatureContratCpt = (typeof NATURES_CONTRAT_CPT)[number];
export const LIBELLE_NATURE_CONTRAT_CPT: Record<NatureContratCpt, string> = { INDIVIDUEL: "Individuel", GROUPE: "Groupe" };

export const TYPES_COMPTE_CPT = ["WAVE_BUSINESS", "WAVE_HORS_BUSINESS", "BANQUE", "MICROFINANCE", "AGREGATEUR", "CAISSE"] as const;
export type TypeCompteCpt = (typeof TYPES_COMPTE_CPT)[number];
export const LIBELLE_TYPE_COMPTE_CPT: Record<TypeCompteCpt, string> = {
  WAVE_BUSINESS: "Wave Business",
  WAVE_HORS_BUSINESS: "Wave hors Business",
  BANQUE: "Banque",
  MICROFINANCE: "Microfinance",
  AGREGATEUR: "Agrégateur",
  CAISSE: "Caisse",
};

export const NATURES_REMUNERATION_CPT = ["COMMISSION", "ACCESSOIRES", "HONORAIRES"] as const;
export type NatureRemunerationCpt = (typeof NATURES_REMUNERATION_CPT)[number];
export const LIBELLE_NATURE_REMUNERATION_CPT: Record<NatureRemunerationCpt, string> = {
  COMMISSION: "Commission",
  ACCESSOIRES: "Accessoires",
  HONORAIRES: "Honoraires de gestion",
};

export const BASES_CONVENTION_CPT = ["PRIME_NETTE", "NETTE_PLUS_ACCESSOIRES", "TTC"] as const;
export type BaseConventionCpt = (typeof BASES_CONVENTION_CPT)[number];
export const LIBELLE_BASE_CONVENTION_CPT: Record<BaseConventionCpt, string> = {
  PRIME_NETTE: "Prime nette",
  NETTE_PLUS_ACCESSOIRES: "Prime nette + accessoires",
  TTC: "Prime TTC",
};

export const FAITS_GENERATEURS_CPT = ["EMISSION", "ENCAISSEMENT"] as const;
export type FaitGenerateurCpt = (typeof FAITS_GENERATEURS_CPT)[number];
export const LIBELLE_FAIT_GENERATEUR_CPT: Record<FaitGenerateurCpt, string> = { EMISSION: "À l'émission", ENCAISSEMENT: "À l'encaissement" };

export const MODES_REGLEMENT_CPT = ["EN_UNE_FOIS", "AU_PRORATA"] as const;
export type ModeReglementCpt = (typeof MODES_REGLEMENT_CPT)[number];
export const LIBELLE_MODE_REGLEMENT_CPT: Record<ModeReglementCpt, string> = { EN_UNE_FOIS: "En une fois", AU_PRORATA: "Au prorata des encaissements" };

// ---------- Résultat d'une validation ----------

/** Erreurs par champ (nom du champ du formulaire → message), directement utilisables par `fieldErrors`. */
export type ErreursChampsCpt = Record<string, string>;
export type ResultatValidationCpt<T> = { ok: true; valeur: T } | { ok: false; erreurs: ErreursChampsCpt };

type Saisie = Record<string, unknown>;

function reussi<T>(valeur: T): ResultatValidationCpt<T> {
  return { ok: true, valeur };
}

/** Texte nettoyé : espaces réduits et bords retirés. Seuls un texte et un nombre sont admis (jamais un objet). */
export function nettoyerTexteCpt(valeur: unknown): string {
  if (typeof valeur === "string") return valeur.replace(/\s+/g, " ").trim();
  if (typeof valeur === "number" && Number.isFinite(valeur)) return String(valeur);
  return "";
}

function texteObligatoire(saisie: Saisie, champ: string, libelle: string, min: number, max: number, erreurs: ErreursChampsCpt): string {
  const texte = nettoyerTexteCpt(saisie[champ]);
  if (texte.length < min) erreurs[champ] = min <= 1 ? `${libelle} : champ obligatoire.` : `${libelle} : ${min} caractères au moins.`;
  else if (texte.length > max) erreurs[champ] = `${libelle} : ${max} caractères au plus.`;
  return texte;
}

function texteOptionnel(saisie: Saisie, champ: string, libelle: string, max: number, erreurs: ErreursChampsCpt): string | null {
  const texte = nettoyerTexteCpt(saisie[champ]);
  if (!texte) return null;
  if (texte.length > max) {
    erreurs[champ] = `${libelle} : ${max} caractères au plus.`;
    return null;
  }
  return texte;
}

/** Case à cocher d'un formulaire (« on », « true », « 1 ») ou booléen d'un appel direct. */
export function lireBooleenCpt(valeur: unknown): boolean {
  return valeur === true || valeur === "on" || valeur === "true" || valeur === "1";
}

function valeurEnumeree<T extends string>(saisie: Saisie, champ: string, libelle: string, valeurs: readonly T[], erreurs: ErreursChampsCpt): T | null {
  const texte = nettoyerTexteCpt(saisie[champ]);
  if ((valeurs as readonly string[]).includes(texte)) return texte as T;
  erreurs[champ] = `${libelle} : choisissez une valeur dans la liste.`;
  return null;
}

function enumOptionnelle<T extends string>(saisie: Saisie, champ: string, libelle: string, valeurs: readonly T[], erreurs: ErreursChampsCpt): T | null {
  if (!nettoyerTexteCpt(saisie[champ])) return null;
  return valeurEnumeree(saisie, champ, libelle, valeurs, erreurs);
}

// ---------- Dates ----------

/** Date ISO `AAAA-MM-JJ` qui existe au calendrier, entre 2000 et 2100. */
export function estDateIsoCpt(valeur: unknown): valeur is string {
  if (typeof valeur !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeur);
  if (!m) return false;
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a < 2000 || a > 2100) return false;
  const d = new Date(Date.UTC(a, mo - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === mo - 1 && d.getUTCDate() === j;
}

function dateObligatoire(saisie: Saisie, champ: string, libelle: string, erreurs: ErreursChampsCpt): string {
  const texte = nettoyerTexteCpt(saisie[champ]);
  if (!texte) erreurs[champ] = `${libelle} : champ obligatoire.`;
  else if (!estDateIsoCpt(texte)) erreurs[champ] = `${libelle} : date invalide (format AAAA-MM-JJ).`;
  return texte;
}

// ---------- Pourcentages et taux (fractions exactes) ----------

export type ResultatPourcentageCpt = { ok: true; fraction: string; pourcent: string } | { ok: false; message: string };

/**
 * Lit un pourcentage saisi (« 7,25 », « 7.25 % », 12.5) et le convertit en fraction EXACTE à six décimales (« 0.072500 »),
 * sans passer par un flottant. De 0 à 100 %, quatre décimales au plus (la colonne garde six décimales de fraction).
 */
export function lirePourcentageCpt(brut: unknown): ResultatPourcentageCpt {
  const texte = (typeof brut === "number" && Number.isFinite(brut) ? String(brut) : typeof brut === "string" ? brut : "")
    .replace(/\s+/g, "")
    .replace(/%$/, "")
    .replace(",", ".");
  if (!texte) return { ok: false, message: "Saisissez un pourcentage." };
  const m = /^(\d{1,3})(?:\.(\d+))?$/.exec(texte);
  if (!m) return { ok: false, message: "Le pourcentage ne doit contenir que des chiffres et une virgule (exemple : 7,25)." };
  const decimales = m[2] ?? "";
  if (decimales.length > 4) return { ok: false, message: "Quatre décimales au plus (exemple : 7,2525)." };
  const dixMilliemes = Number(m[1]) * 10_000 + Number(decimales.padEnd(4, "0"));
  if (dixMilliemes > 1_000_000) return { ok: false, message: "Le pourcentage ne peut pas dépasser 100." };
  const chiffres = String(dixMilliemes).padStart(7, "0");
  const dec4 = String(dixMilliemes % 10_000).padStart(4, "0").replace(/0+$/, "");
  return {
    ok: true,
    fraction: `${chiffres.slice(0, 1)}.${chiffres.slice(1)}`,
    pourcent: `${Math.floor(dixMilliemes / 10_000)}${dec4 ? `,${dec4}` : ""}`,
  };
}

/** Affichage d'une fraction stockée (« 0.0725 », « 0.072500 ») en pourcentage (« 7,25 »). `null` si elle n'est pas lisible. */
export function fractionVersPourcentCpt(fraction: unknown): string | null {
  const texte = typeof fraction === "number" && Number.isFinite(fraction) ? fraction.toFixed(6) : typeof fraction === "string" ? fraction.trim() : "";
  const m = /^([01])(?:\.(\d{1,6}))?$/.exec(texte);
  if (!m) return null;
  // Une fraction à six décimales = un pourcentage à quatre décimales (× 10 000).
  const dixMilliemes = Number(m[1]) * 1_000_000 + Number((m[2] ?? "").padEnd(6, "0"));
  if (dixMilliemes > 1_000_000) return null;
  const dec4 = String(dixMilliemes % 10_000).padStart(4, "0").replace(/0+$/, "");
  return `${Math.floor(dixMilliemes / 10_000)}${dec4 ? `,${dec4}` : ""}`;
}

function pourcentageObligatoire(saisie: Saisie, champ: string, libelle: string, erreurs: ErreursChampsCpt): string {
  const lu = lirePourcentageCpt(saisie[champ]);
  if (!lu.ok) {
    erreurs[champ] = `${libelle} : ${lu.message}`;
    return "";
  }
  return lu.fraction;
}

// ---------- Partenaire ----------

export interface PartenaireValide {
  nom: string;
  estApporteur: boolean;
  estBeneficiaire: boolean;
  estGestionnaire: boolean;
  estClient: boolean;
  coordonnees: string | null;
  tiersOdoo: string | null;
}

export function validerPartenaireCpt(saisie: Saisie): ResultatValidationCpt<PartenaireValide> {
  const erreurs: ErreursChampsCpt = {};
  const nom = texteObligatoire(saisie, "nom", "Nom", 2, 120, erreurs);
  const roles = {
    estApporteur: lireBooleenCpt(saisie.estApporteur),
    estBeneficiaire: lireBooleenCpt(saisie.estBeneficiaire),
    estGestionnaire: lireBooleenCpt(saisie.estGestionnaire),
    estClient: lireBooleenCpt(saisie.estClient),
  };
  if (!Object.values(roles).some(Boolean)) erreurs.roles = "Rôles : cochez au moins un rôle (apporteur, bénéficiaire, gestionnaire ou client).";
  const coordonnees = texteOptionnel(saisie, "coordonnees", "Coordonnées", 500, erreurs);
  const tiersOdoo = texteOptionnel(saisie, "tiersOdoo", "Tiers Odoo", 60, erreurs);
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return reussi({ nom, ...roles, coordonnees, tiersOdoo });
}

// ---------- Client ----------

export interface ClientValide {
  nom: string;
  telephone: string | null;
  pieceIdentite: string | null;
  partenaireOrigineId: string | null;
  tiersOdoo: string | null;
}

/** Téléphone sans espace ni ponctuation, `+` initial conservé ; 8 à 15 chiffres. `null` s'il n'est pas lisible. */
export function normaliserTelephoneCpt(valeur: string): string | null {
  const brut = valeur.replace(/[\s.\-()]/g, "");
  if (!/^\+?\d+$/.test(brut)) return null;
  const nombre = brut.replace("+", "").length;
  return nombre >= 8 && nombre <= 15 ? brut : null;
}

export function validerClientCpt(saisie: Saisie): ResultatValidationCpt<ClientValide> {
  const erreurs: ErreursChampsCpt = {};
  const nom = texteObligatoire(saisie, "nom", "Nom", 2, 160, erreurs);
  let telephone: string | null = null;
  const brutTelephone = nettoyerTexteCpt(saisie.telephone);
  if (brutTelephone) {
    telephone = normaliserTelephoneCpt(brutTelephone);
    if (!telephone) erreurs.telephone = "Téléphone : 8 à 15 chiffres (le + initial est admis).";
  }
  const pieceIdentite = texteOptionnel(saisie, "pieceIdentite", "Pièce d'identité", 60, erreurs);
  const partenaireOrigineId = texteOptionnel(saisie, "partenaireOrigineId", "Partenaire d'origine", 60, erreurs);
  const tiersOdoo = texteOptionnel(saisie, "tiersOdoo", "Tiers Odoo", 60, erreurs);
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return reussi({ nom, telephone, pieceIdentite, partenaireOrigineId, tiersOdoo });
}

// ---------- Produit ----------

export interface ProduitValide {
  code: string;
  libelle: string;
  branche: BrancheCpt;
  /** Tarif de référence au format canonique « 25000.50 », ou `null`. */
  tarifReference: string | null;
  compteOdoo: string | null;
}

export const CODE_PRODUIT_MOTIF = /^[A-Z0-9][A-Z0-9_-]{1,29}$/;

export function validerProduitCpt(saisie: Saisie): ResultatValidationCpt<ProduitValide> {
  const erreurs: ErreursChampsCpt = {};
  const code = nettoyerTexteCpt(saisie.code).toUpperCase();
  if (!code) erreurs.code = "Code : champ obligatoire.";
  else if (!CODE_PRODUIT_MOTIF.test(code)) erreurs.code = "Code : 2 à 30 caractères, lettres, chiffres, tiret ou souligné (exemple : SECURPRO).";
  const libelle = texteObligatoire(saisie, "libelle", "Libellé", 2, 160, erreurs);
  const branche = valeurEnumeree(saisie, "branche", "Branche", BRANCHES_CPT, erreurs);
  let tarifReference: string | null = null;
  if (nettoyerTexteCpt(saisie.tarifReference)) {
    const montant = lireMontant(saisie.tarifReference, { devise: "XOF" });
    if (montant.ok) tarifReference = montant.canonique;
    else erreurs.tarifReference = `Tarif de référence : ${montant.message}`;
  }
  const compteOdoo = texteOptionnel(saisie, "compteOdoo", "Compte Odoo", 40, erreurs);
  if (Object.keys(erreurs).length > 0 || !branche) return { ok: false, erreurs };
  return reussi({ code, libelle, branche, tarifReference, compteOdoo });
}

// ---------- Compte d'encaissement ----------

export interface CompteValide {
  libelle: string;
  type: TypeCompteCpt;
  journalOdoo: string | null;
  compteOdoo: string | null;
}

export function validerCompteCpt(saisie: Saisie): ResultatValidationCpt<CompteValide> {
  const erreurs: ErreursChampsCpt = {};
  const libelle = texteObligatoire(saisie, "libelle", "Libellé", 2, 120, erreurs);
  const type = valeurEnumeree(saisie, "type", "Type de compte", TYPES_COMPTE_CPT, erreurs);
  const journalOdoo = texteOptionnel(saisie, "journalOdoo", "Journal Odoo", 40, erreurs);
  const compteOdoo = texteOptionnel(saisie, "compteOdoo", "Compte Odoo", 40, erreurs);
  if (Object.keys(erreurs).length > 0 || !type) return { ok: false, erreurs };
  return reussi({ libelle, type, journalOdoo, compteOdoo });
}

// ---------- Taux de TCA datés ----------

export interface TauxTcaLigne {
  id: string;
  branche: BrancheCpt;
  produitCode: string | null;
  natureContrat: NatureContratCpt | null;
  /** Fraction en texte (« 0.0725 »). */
  taux: string;
  /** `AAAA-MM-JJ`. */
  dateEffet: string;
}

export interface TauxTcaValide {
  branche: BrancheCpt;
  produitCode: string | null;
  natureContrat: NatureContratCpt | null;
  /** Fraction à six décimales (« 0.072500 »). */
  taux: string;
  dateEffet: string;
}

export function validerTauxTcaCpt(saisie: Saisie): ResultatValidationCpt<TauxTcaValide> {
  const erreurs: ErreursChampsCpt = {};
  const branche = valeurEnumeree(saisie, "branche", "Branche", BRANCHES_CPT, erreurs);
  const produitCode = nettoyerTexteCpt(saisie.produitCode).toUpperCase() || null;
  const natureContrat = enumOptionnelle(saisie, "natureContrat", "Nature du contrat", NATURES_CONTRAT_CPT, erreurs);
  const taux = pourcentageObligatoire(saisie, "taux", "Taux", erreurs);
  const dateEffet = dateObligatoire(saisie, "dateEffet", "Date d'effet", erreurs);
  if (Object.keys(erreurs).length > 0 || !branche) return { ok: false, erreurs };
  return reussi({ branche, produitCode, natureContrat, taux, dateEffet });
}

/**
 * Cohérence d'un taux avec les produits connus : le produit visé existe et appartient à la branche du taux. À appeler par
 * l'action serveur avec les produits lus en base. `null` si tout va bien, sinon l'erreur par champ.
 */
export function controlerCoherenceTauxTca(taux: TauxTcaValide, produits: readonly { code: string; branche: BrancheCpt }[]): ErreursChampsCpt | null {
  if (!taux.produitCode) return null;
  const produit = produits.find((p) => p.code === taux.produitCode);
  if (!produit) return { produitCode: `Produit : « ${taux.produitCode} » n'existe pas.` };
  if (produit.branche !== taux.branche) {
    return { branche: `Branche : le produit ${produit.code} relève de la branche ${LIBELLE_BRANCHE_CPT[produit.branche]}.` };
  }
  return null;
}

/** Clé de portée d'un taux : même branche, même produit, même nature. */
export function porteeTauxTcaCpt(l: Pick<TauxTcaLigne, "branche" | "produitCode" | "natureContrat">): string {
  return `${l.branche}|${l.produitCode ?? ""}|${l.natureContrat ?? ""}`;
}

/** Message si une ligne existe déjà pour cette portée à cette date d'effet (la base l'interdit aussi), sinon `null`. */
export function controlerDoublonTauxTca(existants: readonly TauxTcaLigne[], nouveau: TauxTcaValide): string | null {
  const portee = porteeTauxTcaCpt(nouveau);
  const doublon = existants.find((e) => porteeTauxTcaCpt(e) === portee && e.dateEffet === nouveau.dateEffet);
  return doublon
    ? `Un taux existe déjà pour cette portée à la date du ${nouveau.dateEffet} : un taux ne se modifie pas, saisissez une autre date d'effet.`
    : null;
}

export interface CritereTauxTca {
  branche: BrancheCpt;
  produitCode?: string | null;
  natureContrat?: NatureContratCpt | null;
  /** Date de valeur de l'encaissement (C-10), `AAAA-MM-JJ`. */
  date: string;
}

/**
 * Taux de TCA applicable (C-10) : parmi les lignes de la branche déjà en vigueur à la date (date d'effet ≤ date) et dont la
 * portée convient au contrat, la plus SPÉCIFIQUE l'emporte (produit : 2 points, nature : 1 point), puis la date d'effet la
 * plus récente. `null` si aucun taux ne s'applique (le moteur de taxe le signale, il ne devine jamais 0). Règle de
 * spécificité (produit avant nature) provisoire, registre C-15.
 */
export function tauxTcaEnVigueur(lignes: readonly TauxTcaLigne[], critere: CritereTauxTca): TauxTcaLigne | null {
  const produit = critere.produitCode ?? null;
  const nature = critere.natureContrat ?? null;
  let retenue: TauxTcaLigne | null = null;
  let scoreRetenu = -1;
  for (const l of lignes) {
    if (l.branche !== critere.branche || l.dateEffet > critere.date) continue;
    if (l.produitCode !== null && l.produitCode !== produit) continue;
    if (l.natureContrat !== null && l.natureContrat !== nature) continue;
    const score = (l.produitCode !== null ? 2 : 0) + (l.natureContrat !== null ? 1 : 0);
    if (score > scoreRetenu || (score === scoreRetenu && retenue !== null && l.dateEffet > retenue.dateEffet)) {
      retenue = l;
      scoreRetenu = score;
    }
  }
  return retenue;
}

export type EtatTauxTca = "REMPLACE" | "EN_VIGUEUR" | "A_VENIR";

export interface LigneChronologieTauxTca {
  ligne: TauxTcaLigne;
  etat: EtatTauxTca;
}

/**
 * Historique d'une portée précise (même branche, produit et nature), du plus ancien au plus récent : « à venir » (date d'effet
 * dans le futur), « en vigueur » (la dernière dont la date est passée), « remplacé » (les autres). Les anciennes lignes
 * restent intactes : c'est la lecture, jamais une modification.
 */
export function chronologieTauxTcaCpt(
  lignes: readonly TauxTcaLigne[],
  portee: Pick<TauxTcaLigne, "branche" | "produitCode" | "natureContrat">,
  aujourdhui: string
): LigneChronologieTauxTca[] {
  const cle = porteeTauxTcaCpt(portee);
  const triees = lignes.filter((l) => porteeTauxTcaCpt(l) === cle).sort((a, b) => (a.dateEffet < b.dateEffet ? -1 : a.dateEffet > b.dateEffet ? 1 : 0));
  let idxEnVigueur = -1;
  triees.forEach((l, i) => {
    if (l.dateEffet <= aujourdhui) idxEnVigueur = i;
  });
  return triees.map((ligne, i) => ({ ligne, etat: ligne.dateEffet > aujourdhui ? "A_VENIR" : i === idxEnVigueur ? "EN_VIGUEUR" : "REMPLACE" }));
}

// ---------- Conventions de rémunération ----------

export interface ConventionLigne {
  id: string;
  partenaireId: string;
  /** `null` = tous les produits. */
  produitCode: string | null;
  nature: NatureRemunerationCpt;
  /** `null` = tout apporteur. */
  apporteurId: string | null;
  dateEffet: string;
  /** `null` = convention ouverte. */
  dateFin: string | null;
}

export interface ConventionValide {
  partenaireId: string;
  produitCode: string | null;
  nature: NatureRemunerationCpt;
  /** Fraction à six décimales. */
  taux: string;
  base: BaseConventionCpt;
  faitGenerateur: FaitGenerateurCpt;
  apporteurId: string | null;
  beneficiaireId: string | null;
  modeReglement: ModeReglementCpt;
  dateEffet: string;
  dateFin: string | null;
}

export function validerConventionCpt(saisie: Saisie): ResultatValidationCpt<ConventionValide> {
  const erreurs: ErreursChampsCpt = {};
  const partenaireId = texteObligatoire(saisie, "partenaireId", "Partenaire", 1, 60, erreurs);
  const produitCode = nettoyerTexteCpt(saisie.produitCode).toUpperCase() || null;
  const nature = valeurEnumeree(saisie, "nature", "Nature", NATURES_REMUNERATION_CPT, erreurs);
  const taux = pourcentageObligatoire(saisie, "taux", "Taux", erreurs);
  const base = valeurEnumeree(saisie, "base", "Base de calcul", BASES_CONVENTION_CPT, erreurs);
  const faitGenerateur = valeurEnumeree(saisie, "faitGenerateur", "Fait générateur", FAITS_GENERATEURS_CPT, erreurs);
  const apporteurId = texteOptionnel(saisie, "apporteurId", "Apporteur", 60, erreurs);
  const beneficiaireId = texteOptionnel(saisie, "beneficiaireId", "Bénéficiaire", 60, erreurs);
  const modeReglement = valeurEnumeree(saisie, "modeReglement", "Mode de règlement", MODES_REGLEMENT_CPT, erreurs);
  const dateEffet = dateObligatoire(saisie, "dateEffet", "Date d'effet", erreurs);
  let dateFin: string | null = null;
  if (nettoyerTexteCpt(saisie.dateFin)) {
    dateFin = dateObligatoire(saisie, "dateFin", "Date de fin", erreurs);
    if (!erreurs.dateFin && !erreurs.dateEffet && dateFin < dateEffet) erreurs.dateFin = "Date de fin : elle ne peut pas précéder la date d'effet.";
  }
  if (Object.keys(erreurs).length > 0 || !nature || !base || !faitGenerateur || !modeReglement) return { ok: false, erreurs };
  return reussi({ partenaireId, produitCode, nature, taux, base, faitGenerateur, apporteurId, beneficiaireId, modeReglement, dateEffet, dateFin });
}

/**
 * Fait générateur proposé par défaut (C-4) pour les honoraires de gestion : à l'ENCAISSEMENT (au prorata) quand l'apporteur est
 * le gestionnaire lui-même, à l'ÉMISSION sinon. `null` pour les autres natures : le cahier ne fixe rien, la saisie décide.
 * Une proposition seulement : le formulaire la préremplit, la convention enregistre le choix de l'utilisateur.
 */
export function faitGenerateurSuggereCpt(nature: NatureRemunerationCpt, apporteurEstGestionnaire: boolean): FaitGenerateurCpt | null {
  if (nature !== "HONORAIRES") return null;
  return apporteurEstGestionnaire ? "ENCAISSEMENT" : "EMISSION";
}

type ClePortee = Pick<ConventionLigne, "partenaireId" | "produitCode" | "nature" | "apporteurId">;

function memePortee(a: ClePortee, b: ClePortee): boolean {
  return a.partenaireId === b.partenaireId && a.produitCode === b.produitCode && a.nature === b.nature && a.apporteurId === b.apporteurId;
}

/** Deux périodes inclusives se recouvrent (`null` = sans fin). */
export function periodesSeRecouvrentCpt(a: { dateEffet: string; dateFin: string | null }, b: { dateEffet: string; dateFin: string | null }): boolean {
  const aFinApresDebutB = a.dateFin === null || a.dateFin >= b.dateEffet;
  const bFinApresDebutA = b.dateFin === null || b.dateFin >= a.dateEffet;
  return aFinApresDebutB && bFinApresDebutA;
}

/**
 * Conventions déjà en place qui se recouvrent avec celle-ci : même partenaire, même produit (ou « tous »), même nature, même
 * apporteur (ou « tout ») ET périodes qui se chevauchent. Une convention « tous produits » et une convention d'un produit
 * précis ne se chevauchent pas : la précise l'emporte (`conventionEnVigueurCpt`). `ignorerId` écarte la convention
 * elle-même quand on modifie sa date de fin.
 */
export function conventionsEnChevauchementCpt(
  existantes: readonly ConventionLigne[],
  candidate: ClePortee & { dateEffet: string; dateFin: string | null },
  ignorerId?: string
): ConventionLigne[] {
  return existantes.filter((e) => e.id !== ignorerId && memePortee(e, candidate) && periodesSeRecouvrentCpt(e, candidate));
}

/** Message d'erreur si la nouvelle convention chevauche une convention existante, sinon `null`. */
export function controlerChevauchementConventionCpt(existantes: readonly ConventionLigne[], candidate: ConventionValide, ignorerId?: string): string | null {
  const conflits = conventionsEnChevauchementCpt(existantes, candidate, ignorerId);
  if (conflits.length === 0) return null;
  const c = conflits[0];
  const jusqua = c.dateFin ? `jusqu'au ${c.dateFin}` : "sans date de fin";
  return `Une convention de même portée est déjà en vigueur du ${c.dateEffet}, ${jusqua} : fixez d'abord sa date de fin avant la date d'effet de la nouvelle.`;
}

/**
 * Nouvelle date de fin d'une convention existante (la seule modification permise) : pas avant la date d'effet, et sans créer de
 * chevauchement avec une autre convention de même portée. `null` si elle convient, sinon le message.
 */
export function controlerNouvelleFinConventionCpt(convention: ConventionLigne, nouvelleFin: string | null, autres: readonly ConventionLigne[]): string | null {
  if (nouvelleFin !== null) {
    if (!estDateIsoCpt(nouvelleFin)) return "Date de fin : date invalide (format AAAA-MM-JJ).";
    if (nouvelleFin < convention.dateEffet) return "Date de fin : elle ne peut pas précéder la date d'effet.";
  }
  const conflits = conventionsEnChevauchementCpt(autres, { ...convention, dateFin: nouvelleFin }, convention.id);
  return conflits.length > 0 ? `Cette date de fin ferait chevaucher la convention du ${conflits[0].dateEffet} (même portée).` : null;
}

export interface CritereConvention {
  partenaireId: string;
  nature: NatureRemunerationCpt;
  produitCode?: string | null;
  apporteurId?: string | null;
  date: string;
}

/**
 * Convention applicable à une date : même partenaire et même nature, période en cours, produit et apporteur qui conviennent
 * (ou « tous »). La plus SPÉCIFIQUE l'emporte (produit : 2 points, apporteur : 1 point), puis la date d'effet la plus
 * récente. `null` si aucune convention ne s'applique : la rémunération n'est alors jamais devinée.
 */
export function conventionEnVigueurCpt<T extends ConventionLigne>(conventions: readonly T[], critere: CritereConvention): T | null {
  const produit = critere.produitCode ?? null;
  const apporteur = critere.apporteurId ?? null;
  let retenue: T | null = null;
  let scoreRetenu = -1;
  for (const c of conventions) {
    if (c.partenaireId !== critere.partenaireId || c.nature !== critere.nature) continue;
    if (c.dateEffet > critere.date || (c.dateFin !== null && c.dateFin < critere.date)) continue;
    if (c.produitCode !== null && c.produitCode !== produit) continue;
    if (c.apporteurId !== null && c.apporteurId !== apporteur) continue;
    const score = (c.produitCode !== null ? 2 : 0) + (c.apporteurId !== null ? 1 : 0);
    if (score > scoreRetenu || (score === scoreRetenu && retenue !== null && c.dateEffet > retenue.dateEffet)) {
      retenue = c;
      scoreRetenu = score;
    }
  }
  return retenue;
}
