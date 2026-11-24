// Gestion Compta, lot GC-3b : lecture typée d'une ligne du bordereau de production, contrôles de saisie (docs/PLAN_GESTION_COMPTA.md,
// GC-3) et comparaison avec l'import précédent. Module PUR (aucun accès base) : la base fournit le contexte (produits, partenaires,
// références déjà utilisées, dernier mois clôturé), jamais ce module. Lecture PERMISSIVE : une ligne illisible ne fait pas échouer le
// fichier, elle produit des signalements ; seul un signalement BLOQUANT empêche de créer le contrat (ou, en saisie, d'enregistrer).
// Copie d'esprit des règles d'Encaissements (aucun import d'`enc*`, règle d'indépendance du module).

import { enCentimesEcheancier, dateValideEcheancier } from "./cptEcheancier";
import type { DefinitionFormatCpt } from "./cptFormatImport";

export type NatureContratProduction = "INDIVIDUEL" | "GROUPE";
export type TypeActeProduction = "AFFAIRE_NOUVELLE" | "RENOUVELLEMENT" | "TRANCHE" | "AVENANT_INCORPORATION" | "RETRAIT" | "RISTOURNE" | "ANNULATION";
export type FractionnementProduction = "COMPTANT" | "MENSUEL" | "TRIMESTRIEL" | "SEMESTRIEL" | "LIBRE";
export type ModePaiementProduction = "WAVE" | "ORANGE_MONEY" | "MTN_MOMO" | "MOOV" | "PEYAPAY" | "CHEQUE" | "ESPECES" | "VIREMENT" | "CARTE" | "AUTRE";

// ---------------------------------------------------------------------------------------------------------------------
// Champs internes du bordereau (les en-têtes du fichier y sont associés par le format paramétrable, CptFormatImport)
// ---------------------------------------------------------------------------------------------------------------------

export interface ChampProduction {
  champ: string;
  libelle: string;
  type: "texte" | "date" | "montant";
  obligatoire: boolean;
}

/** Champs que le format d'import PRODUCTION peut alimenter. Seuls `numPolice`, `produit`, les deux dates et la prime TTC sont obligatoires. */
export const CHAMPS_PRODUCTION_CPT: readonly ChampProduction[] = [
  { champ: "numPolice", libelle: "Numéro de police", type: "texte", obligatoire: true },
  { champ: "paiementId", libelle: "Identifiant de paiement (PaiementID)", type: "texte", obligatoire: false },
  { champ: "natureContrat", libelle: "Type de contrat (individuel ou groupe)", type: "texte", obligatoire: false },
  { champ: "produit", libelle: "Produit (code ou libellé)", type: "texte", obligatoire: true },
  { champ: "typeOperation", libelle: "Type d'opération", type: "texte", obligatoire: false },
  { champ: "client", libelle: "Client", type: "texte", obligatoire: false },
  { champ: "telephone", libelle: "Téléphone du client", type: "texte", obligatoire: false },
  { champ: "partenaire", libelle: "Partenaire apporteur", type: "texte", obligatoire: false },
  { champ: "fractionnement", libelle: "Fractionnement", type: "texte", obligatoire: false },
  { champ: "dateEffet", libelle: "Date d'effet", type: "date", obligatoire: true },
  { champ: "dateEcheance", libelle: "Date d'échéance", type: "date", obligatoire: true },
  { champ: "modePaiement", libelle: "Mode de paiement déclaré", type: "texte", obligatoire: false },
  { champ: "referencePaiement", libelle: "Référence de paiement déclarée", type: "texte", obligatoire: false },
  { champ: "datePaiement", libelle: "Date de paiement déclarée", type: "date", obligatoire: false },
  { champ: "primeTtc", libelle: "Prime TTC", type: "montant", obligatoire: true },
  { champ: "primeHt", libelle: "Prime hors taxe", type: "montant", obligatoire: false },
  { champ: "accessoires", libelle: "Accessoires", type: "montant", obligatoire: false },
  { champ: "taxe", libelle: "Taxe", type: "montant", obligatoire: false },
  { champ: "commission", libelle: "Commission déclarée", type: "montant", obligatoire: false },
  { champ: "gestion", libelle: "Frais de gestion déclarés", type: "montant", obligatoire: false },
  { champ: "montantPaye", libelle: "Montant payé déclaré", type: "montant", obligatoire: false },
];

/** Nom du format d'import PRODUCTION posé par la migration `20261101170000_compta_format_production_defaut`. */
export const NOM_FORMAT_PRODUCTION_DEFAUT_CPT = "Bordereau de production standard";

/**
 * Format d'import par défaut : un en-tête par champ interne, libellé identique à `libelle`, dates écrites en texte au format
 * JJ/MM/AAAA (une vraie cellule date d'un classeur n'en a pas besoin). La migration en recopie le JSON ; un test garde les deux
 * identiques. Un bordereau de partenaire aux en-têtes différents se traite par un AUTRE format (jamais en modifiant celui-ci).
 */
export function formatProductionParDefautCpt(): DefinitionFormatCpt {
  return {
    ligneEntete: 1,
    colonnes: CHAMPS_PRODUCTION_CPT.map((c) => ({
      entete: c.libelle,
      champ: c.champ,
      type: c.type,
      obligatoire: c.obligatoire,
      ...(c.type === "date" ? { formatDate: "JJ/MM/AAAA" as const } : {}),
    })),
  };
}

export interface LigneProduction {
  numeroLigne: number;
  numPolice: string | null;
  paiementId: string | null;
  natureContrat: NatureContratProduction | null;
  /** Code ou libellé du produit tel que lu (résolu par le contrôle). */
  produit: string | null;
  typeActe: TypeActeProduction | null;
  /** Texte du type d'opération quand il n'est pas reconnu. */
  typeOperationBrut: string | null;
  client: string | null;
  telephone: string | null;
  partenaire: string | null;
  fractionnement: FractionnementProduction | null;
  dateEffet: string | null;
  dateEcheance: string | null;
  modePaiement: ModePaiementProduction | null;
  referencePaiement: string | null;
  datePaiement: string | null;
  /** Montants en centimes ; `null` = absent ou illisible. */
  primeTtc: bigint | null;
  primeHt: bigint | null;
  accessoires: bigint | null;
  taxe: bigint | null;
  commission: bigint | null;
  gestion: bigint | null;
  montantPaye: bigint | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------------------------------------------------

/** Minuscules, sans accents, espaces réduits : pour comparer des libellés (produit, partenaire, type d'opération…). */
export function normaliserLibelleProduction(valeur: unknown): string {
  return String(valeur ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Référence de paiement normalisée pour la comparer (majuscules, sans espaces) ; `null` si vide. */
export function normaliserReferenceProduction(valeur: unknown): string | null {
  const texte = String(valeur ?? "").replace(/\s+/g, "").toUpperCase();
  return texte === "" ? null : texte;
}

export function natureContratDepuisTexte(valeur: unknown): NatureContratProduction | null {
  const t = normaliserLibelleProduction(valeur);
  if (t === "") return null;
  if (t.startsWith("group") || t === "g" || t.includes("collectif")) return "GROUPE";
  if (t.startsWith("individ") || t === "i") return "INDIVIDUEL";
  return null;
}

export function typeActeDepuisTexte(valeur: unknown): TypeActeProduction | null {
  const t = normaliserLibelleProduction(valeur);
  if (t === "") return null;
  if (/^(affaire nouvelle|nouvelle affaire|nouveau|an)$/.test(t)) return "AFFAIRE_NOUVELLE";
  if (t.startsWith("renouv")) return "RENOUVELLEMENT";
  if (t.startsWith("tranche")) return "TRANCHE";
  if (t.startsWith("avenant") || t.includes("incorporation")) return "AVENANT_INCORPORATION";
  if (t.startsWith("retrait")) return "RETRAIT";
  if (t.startsWith("ristourne")) return "RISTOURNE";
  if (t.startsWith("annul")) return "ANNULATION";
  return null;
}

export function fractionnementDepuisTexte(valeur: unknown): FractionnementProduction | null {
  const t = normaliserLibelleProduction(valeur);
  if (t === "") return null;
  if (t.startsWith("comptant") || t.startsWith("annuel") || t.includes("une fois")) return "COMPTANT";
  if (t.startsWith("mensuel")) return "MENSUEL";
  if (t.startsWith("trimestr")) return "TRIMESTRIEL";
  if (t.startsWith("semestr")) return "SEMESTRIEL";
  if (t.startsWith("libre")) return "LIBRE";
  return null;
}

export function modePaiementDepuisTexte(valeur: unknown): ModePaiementProduction | null {
  const t = normaliserLibelleProduction(valeur);
  if (t === "") return null;
  if (t.includes("wave")) return "WAVE";
  if (t.includes("orange")) return "ORANGE_MONEY";
  if (t.includes("mtn") || t.includes("momo")) return "MTN_MOMO";
  if (t.includes("moov")) return "MOOV";
  if (t.includes("peya")) return "PEYAPAY";
  if (t.includes("cheque")) return "CHEQUE";
  if (t.includes("espece") || t.includes("cash") || t.includes("liquide")) return "ESPECES";
  if (t.includes("virement")) return "VIREMENT";
  if (t.includes("carte") || t === "cb") return "CARTE";
  return "AUTRE";
}

/** Texte « -1398.60 » ou « 1398.6 » → centimes signés ; `null` si illisible. */
export function centimesSignes(valeur: string | null | undefined): bigint | null {
  if (valeur === null || valeur === undefined) return null;
  const texte = String(valeur).trim();
  const negatif = texte.startsWith("-");
  const positif = enCentimesEcheancier(negatif ? texte.slice(1) : texte);
  if (positif === null) return null;
  return negatif ? -positif : positif;
}

/** Identifiant de transaction Wave (`T_` suivi d'au moins dix lettres ou chiffres) ou session `cos-…`. */
export function estReferenceWave(reference: string | null): boolean {
  return reference !== null && (/^T_[A-Z0-9]{10,}$/.test(reference) || /^COS-[A-Z0-9-]{6,}$/.test(reference));
}
export function estReferencePeyapay(reference: string | null): boolean {
  return reference !== null && /^API-PEYAPAY-/.test(reference);
}

const texteOuNull = (v: string | null | undefined) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};

/** Ligne lue du tableur (`valeurs` indexées par champ interne) → ligne typée. Ne contrôle rien : voir `controlerLigneProduction`. */
export function ligneProductionDepuisValeurs(numeroLigne: number, valeurs: Record<string, string | null>): LigneProduction {
  const texte = (c: string) => texteOuNull(valeurs[c]);
  const typeOperation = texte("typeOperation");
  const typeActe = typeActeDepuisTexte(typeOperation);
  return {
    numeroLigne,
    numPolice: texte("numPolice"),
    paiementId: texte("paiementId"),
    natureContrat: natureContratDepuisTexte(valeurs.natureContrat),
    produit: texte("produit"),
    typeActe,
    typeOperationBrut: typeActe === null ? typeOperation : null,
    client: texte("client"),
    telephone: texte("telephone"),
    partenaire: texte("partenaire"),
    fractionnement: fractionnementDepuisTexte(valeurs.fractionnement),
    dateEffet: texte("dateEffet"),
    dateEcheance: texte("dateEcheance"),
    modePaiement: modePaiementDepuisTexte(valeurs.modePaiement),
    referencePaiement: normaliserReferenceProduction(valeurs.referencePaiement),
    datePaiement: texte("datePaiement"),
    primeTtc: centimesSignes(valeurs.primeTtc),
    primeHt: centimesSignes(valeurs.primeHt),
    accessoires: centimesSignes(valeurs.accessoires),
    taxe: centimesSignes(valeurs.taxe),
    commission: centimesSignes(valeurs.commission),
    gestion: centimesSignes(valeurs.gestion),
    montantPaye: centimesSignes(valeurs.montantPaye),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Contrôles
// ---------------------------------------------------------------------------------------------------------------------

export type GraviteProduction = "BLOQUANT" | "ALERTE" | "INFO";

export type CodeSignalementProduction =
  | "NUM_POLICE_MANQUANT"
  | "PRODUIT_MANQUANT"
  | "PRODUIT_INCONNU"
  | "PARTENAIRE_INCONNU"
  | "DATE_MANQUANTE"
  | "DATE_INVALIDE"
  | "DATES_INCOHERENTES"
  | "PRIME_MANQUANTE"
  | "MONTANT_NEGATIF"
  | "MONTANTS_INCOHERENTS"
  | "MONTANT_DIFFERENT_TARIF"
  | "PRIME_OFFERTE"
  | "REFERENCE_MANQUANTE"
  | "REFERENCE_DEJA_UTILISEE"
  | "MODE_INCOHERENT_REFERENCE"
  | "REFERENCE_WAVE_NON_CONFORME"
  | "MONTANT_PAYE_SUPERIEUR_PRIME"
  | "DATE_PAIEMENT_FUTURE"
  | "TYPE_OPERATION_INCONNU"
  | "TYPE_OPERATION_MANQUANT"
  | "LIGNE_EN_DOUBLE"
  | "SAISIE_APRES_CLOTURE";

export interface SignalementProduction {
  code: CodeSignalementProduction;
  gravite: GraviteProduction;
  champ?: string;
  message: string;
}

export interface ProduitConnuProduction {
  code: string;
  libelle: string;
  tarifReference: bigint | null;
}

export interface ContexteControleProduction {
  /** Produits actifs indexés par code ET libellé normalisés (voir `indexerProduitsProduction`). */
  produits: Map<string, ProduitConnuProduction>;
  /** Noms de partenaires connus, normalisés (`normaliserLibelleProduction`). */
  partenaires: Set<string>;
  /** Référence normalisée → numéros de police qui la portent déjà en base. */
  referencesUtilisees: Map<string, string[]>;
  /** Date du jour, `AAAA-MM-JJ`. */
  aujourdhui: string;
  /** Saisie à l'écran : les signalements de référence et de mode deviennent bloquants (T2, T4). Import : ils restent des alertes. */
  enSaisie: boolean;
  /** Écart toléré entre TTC et HT + accessoires + taxe, en centimes (défaut 100 = 1 FCFA). */
  toleranceCentimes?: bigint;
  /** Premier jour du dernier mois clôturé (`AAAA-MM-01`), ou `null`. */
  dernierMoisCloture?: string | null;
}

export function indexerProduitsProduction(produits: ProduitConnuProduction[]): Map<string, ProduitConnuProduction> {
  const index = new Map<string, ProduitConnuProduction>();
  for (const p of produits) {
    index.set(normaliserLibelleProduction(p.code), p);
    index.set(normaliserLibelleProduction(p.libelle), p);
  }
  return index;
}

const sig = (code: CodeSignalementProduction, gravite: GraviteProduction, message: string, champ?: string): SignalementProduction => ({ code, gravite, message, ...(champ ? { champ } : {}) });
const formater = (c: bigint) => `${c / BigInt(100)}${(c % BigInt(100)) === BigInt(0) ? "" : "," + (c % BigInt(100)).toString().padStart(2, "0")}`;

/**
 * Contrôles d'une ligne seule. Bloquants : numéro de police, produit, dates, prime TTC (sans eux, aucun contrat). En SAISIE, la
 * référence manquante, la référence déjà utilisée et le mode incohérent sont aussi bloquants ; à l'IMPORT ils restent des alertes
 * (le contrat existe, l'anomalie est à traiter). Les doublons entre lignes du fichier se contrôlent dans `controlerLotProduction`.
 */
export function controlerLigneProduction(ligne: LigneProduction, contexte: ContexteControleProduction): SignalementProduction[] {
  const s: SignalementProduction[] = [];
  const graviteSaisie: GraviteProduction = contexte.enSaisie ? "BLOQUANT" : "ALERTE";
  const tolerance = contexte.toleranceCentimes ?? BigInt(100);

  if (ligne.numPolice === null) s.push(sig("NUM_POLICE_MANQUANT", "BLOQUANT", "Numéro de police manquant.", "numPolice"));

  // Produit (code ou libellé) et tarif de référence.
  let produit: ProduitConnuProduction | undefined;
  if (ligne.produit === null) s.push(sig("PRODUIT_MANQUANT", "BLOQUANT", "Produit manquant.", "produit"));
  else {
    produit = contexte.produits.get(normaliserLibelleProduction(ligne.produit));
    if (!produit) s.push(sig("PRODUIT_INCONNU", "BLOQUANT", `Produit inconnu : « ${ligne.produit} ».`, "produit"));
  }
  if (ligne.partenaire !== null && !contexte.partenaires.has(normaliserLibelleProduction(ligne.partenaire))) {
    s.push(sig("PARTENAIRE_INCONNU", "ALERTE", `Partenaire inconnu : « ${ligne.partenaire} ».`, "partenaire"));
  }

  // Dates.
  for (const [champ, libelle, valeur] of [["dateEffet", "Date d'effet", ligne.dateEffet], ["dateEcheance", "Date d'échéance", ligne.dateEcheance]] as const) {
    if (valeur === null) s.push(sig("DATE_MANQUANTE", "BLOQUANT", `${libelle} manquante.`, champ));
    else if (!dateValideEcheancier(valeur)) s.push(sig("DATE_INVALIDE", "BLOQUANT", `${libelle} invalide : « ${valeur} ».`, champ));
  }
  const effetOk = ligne.dateEffet !== null && dateValideEcheancier(ligne.dateEffet);
  const echeanceOk = ligne.dateEcheance !== null && dateValideEcheancier(ligne.dateEcheance);
  if (effetOk && echeanceOk && ligne.dateEcheance! < ligne.dateEffet!) {
    s.push(sig("DATES_INCOHERENTES", "BLOQUANT", "La date d'échéance précède la date d'effet.", "dateEcheance"));
  }
  if (ligne.datePaiement !== null && dateValideEcheancier(ligne.datePaiement) && ligne.datePaiement > contexte.aujourdhui) {
    s.push(sig("DATE_PAIEMENT_FUTURE", "ALERTE", `La date de paiement déclarée (${ligne.datePaiement}) est dans le futur.`, "datePaiement"));
  }
  if (effetOk && contexte.dernierMoisCloture && ligne.dateEffet!.slice(0, 7) <= contexte.dernierMoisCloture.slice(0, 7)) {
    s.push(sig("SAISIE_APRES_CLOTURE", "ALERTE", `Ligne datée du ${ligne.dateEffet} alors que le mois est déjà clôturé : elle modifie une période close.`, "dateEffet"));
  }

  // Montants.
  if (ligne.primeTtc === null) s.push(sig("PRIME_MANQUANTE", "BLOQUANT", "Prime TTC manquante ou illisible.", "primeTtc"));
  for (const [champ, libelle, valeur] of [["primeTtc", "Prime TTC", ligne.primeTtc], ["primeHt", "Prime hors taxe", ligne.primeHt], ["accessoires", "Accessoires", ligne.accessoires], ["taxe", "Taxe", ligne.taxe]] as const) {
    // Un acte de retrait, de ristourne ou d'annulation porte légitimement des montants négatifs.
    const acteNegatif = ligne.typeActe === "RETRAIT" || ligne.typeActe === "RISTOURNE" || ligne.typeActe === "ANNULATION";
    if (valeur !== null && valeur < BigInt(0) && !acteNegatif) s.push(sig("MONTANT_NEGATIF", "ALERTE", `${libelle} négatif(ve) pour une opération qui n'est pas un retrait, une ristourne ou une annulation.`, champ));
  }
  if (ligne.primeTtc !== null && ligne.primeHt !== null) {
    const attendu = ligne.primeHt + (ligne.accessoires ?? BigInt(0)) + (ligne.taxe ?? BigInt(0));
    const ecart = ligne.primeTtc > attendu ? ligne.primeTtc - attendu : attendu - ligne.primeTtc;
    if (ecart > tolerance) {
      s.push(sig("MONTANTS_INCOHERENTS", "ALERTE", `Prime TTC (${formater(ligne.primeTtc)}) différente de hors taxe + accessoires + taxe (${formater(attendu)}).`, "primeTtc"));
    }
  }
  if (produit?.tarifReference != null && ligne.primeTtc !== null && ligne.primeTtc > BigInt(0) && ligne.primeTtc !== produit.tarifReference) {
    s.push(sig("MONTANT_DIFFERENT_TARIF", "ALERTE", `Prime TTC (${formater(ligne.primeTtc)}) différente du tarif du produit (${formater(produit.tarifReference)}).`, "primeTtc"));
  }
  if (ligne.primeTtc === BigInt(0)) s.push(sig("PRIME_OFFERTE", "INFO", "Prime offerte (TTC à zéro).", "primeTtc"));

  // Type d'opération.
  if (ligne.typeActe === null && ligne.typeOperationBrut !== null) {
    s.push(sig("TYPE_OPERATION_INCONNU", "ALERTE", `Type d'opération inconnu : « ${ligne.typeOperationBrut} » (traité comme une affaire nouvelle).`, "typeOperation"));
  } else if (ligne.typeActe === null) {
    s.push(sig("TYPE_OPERATION_MANQUANT", "INFO", "Type d'opération absent (traité comme une affaire nouvelle).", "typeOperation"));
  }

  // Paiement déclaré : référence obligatoire, une référence = un contrat, mode cohérent avec la référence.
  const declarePaye = (ligne.montantPaye !== null && ligne.montantPaye > BigInt(0)) || ligne.datePaiement !== null || ligne.modePaiement !== null;
  if (declarePaye && ligne.referencePaiement === null) {
    s.push(sig("REFERENCE_MANQUANTE", graviteSaisie, "Contrat déclaré payé sans référence de paiement.", "referencePaiement"));
  }
  if (declarePaye && ligne.montantPaye !== null && ligne.primeTtc !== null && ligne.primeTtc >= BigInt(0) && ligne.montantPaye > ligne.primeTtc) {
    s.push(sig("MONTANT_PAYE_SUPERIEUR_PRIME", "ALERTE", `Montant payé déclaré (${formater(ligne.montantPaye)}) supérieur à la prime TTC (${formater(ligne.primeTtc)}).`, "montantPaye"));
  }
  if (ligne.referencePaiement !== null) {
    const autres = (contexte.referencesUtilisees.get(ligne.referencePaiement) ?? []).filter((n) => n !== ligne.numPolice);
    if (autres.length > 0) {
      s.push(sig("REFERENCE_DEJA_UTILISEE", graviteSaisie, `Référence ${ligne.referencePaiement} déjà utilisée par le contrat ${autres.slice(0, 3).join(", ")}.`, "referencePaiement"));
    }
    const wave = estReferenceWave(ligne.referencePaiement);
    const peya = estReferencePeyapay(ligne.referencePaiement);
    if (wave && ligne.modePaiement !== null && ligne.modePaiement !== "WAVE") {
      s.push(sig("MODE_INCOHERENT_REFERENCE", graviteSaisie, `La référence ${ligne.referencePaiement} est une référence Wave mais le mode déclaré est « ${ligne.modePaiement} ».`, "modePaiement"));
    } else if (peya && ligne.modePaiement !== null && ligne.modePaiement !== "PEYAPAY") {
      s.push(sig("MODE_INCOHERENT_REFERENCE", graviteSaisie, `La référence ${ligne.referencePaiement} est une référence PeyaPay mais le mode déclaré est « ${ligne.modePaiement} ».`, "modePaiement"));
    } else if (ligne.modePaiement === "WAVE" && !wave) {
      s.push(sig("REFERENCE_WAVE_NON_CONFORME", "ALERTE", `La référence ${ligne.referencePaiement} n'a pas la forme d'une référence Wave (T_ suivi d'au moins 10 caractères).`, "referencePaiement"));
    }
  }
  return s;
}

export interface ResultatLotProduction {
  /** Signalements par numéro de ligne (les lignes sans signalement sont absentes). */
  parLigne: Map<number, SignalementProduction[]>;
  nbBloquants: number;
  nbAlertes: number;
  nbInfos: number;
}

/**
 * Contrôle un fichier entier : contrôles de chaque ligne, plus ce qui dépend des autres lignes — la même référence portée par
 * deux contrats (sauf paiement groupé : même `paiementId` renseigné) et la même opération répétée (même police, même type, même
 * date d'effet).
 */
export function controlerLotProduction(lignes: LigneProduction[], contexte: ContexteControleProduction): ResultatLotProduction {
  const parLigne = new Map<number, SignalementProduction[]>();
  const ajouter = (n: number, s: SignalementProduction) => parLigne.set(n, [...(parLigne.get(n) ?? []), s]);
  for (const l of lignes) for (const s of controlerLigneProduction(l, contexte)) ajouter(l.numeroLigne, s);

  // Références partagées dans le fichier.
  const parReference = new Map<string, LigneProduction[]>();
  for (const l of lignes) {
    if (l.referencePaiement === null || l.numPolice === null) continue;
    parReference.set(l.referencePaiement, [...(parReference.get(l.referencePaiement) ?? []), l]);
  }
  const graviteRef: GraviteProduction = contexte.enSaisie ? "BLOQUANT" : "ALERTE";
  for (const [reference, portees] of parReference) {
    const polices = new Set(portees.map((l) => l.numPolice));
    if (polices.size < 2) continue;
    const identifiants = new Set(portees.map((l) => l.paiementId));
    const groupe = identifiants.size === 1 && !identifiants.has(null);
    if (groupe) continue;
    for (const l of portees) {
      const dejaSignale = (parLigne.get(l.numeroLigne) ?? []).some((x) => x.code === "REFERENCE_DEJA_UTILISEE");
      if (!dejaSignale) ajouter(l.numeroLigne, sig("REFERENCE_DEJA_UTILISEE", graviteRef, `Référence ${reference} portée par ${polices.size} contrats du fichier sans paiement groupé déclaré.`, "referencePaiement"));
    }
  }

  // Lignes en double (même police, même type d'opération, même date d'effet).
  const vues = new Map<string, number>();
  for (const l of lignes) {
    if (l.numPolice === null) continue;
    const cle = `${l.numPolice}|${l.typeActe ?? "AFFAIRE_NOUVELLE"}|${l.dateEffet ?? ""}`;
    const premiere = vues.get(cle);
    if (premiere === undefined) vues.set(cle, l.numeroLigne);
    else ajouter(l.numeroLigne, sig("LIGNE_EN_DOUBLE", "ALERTE", `Ligne en double de la ligne ${premiere} (même police, même opération, même date d'effet).`));
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
export function ligneImportable(signalements: SignalementProduction[] | undefined): boolean {
  return !(signalements ?? []).some((x) => x.gravite === "BLOQUANT");
}

// ---------------------------------------------------------------------------------------------------------------------
// Comparaison avec l'import précédent
// ---------------------------------------------------------------------------------------------------------------------

/** Ce que l'on sait d'un contrat déjà en base, pour le comparer à une ligne du nouveau fichier. */
export interface ContratConnuProduction {
  numPolice: string;
  produit: string | null;
  partenaire: string | null;
  client: string | null;
  dateEffet: string | null;
  dateEcheance: string | null;
  primeTtc: bigint | null;
  primeHt: bigint | null;
  accessoires: bigint | null;
  taxe: bigint | null;
}

export interface ModificationProduction {
  numPolice: string;
  numeroLigne: number;
  /** Champs dont la valeur diffère de celle du contrat en base. */
  champs: string[];
}

export interface ComparaisonProduction {
  nouvelles: { numPolice: string; numeroLigne: number }[];
  modifiees: ModificationProduction[];
  inchangees: number;
  /** Contrats de la base absents du nouveau fichier (la liste fournie est celle de l'import précédent ou de la période comparée). */
  absentes: string[];
}

const CHAMPS_COMPARES: { champ: keyof ContratConnuProduction; ligne: (l: LigneProduction) => string | bigint | null; libelle: string; texte?: boolean }[] = [
  { champ: "produit", ligne: (l) => l.produit, libelle: "produit", texte: true },
  { champ: "partenaire", ligne: (l) => l.partenaire, libelle: "partenaire", texte: true },
  { champ: "client", ligne: (l) => l.client, libelle: "client", texte: true },
  { champ: "dateEffet", ligne: (l) => l.dateEffet, libelle: "date d'effet" },
  { champ: "dateEcheance", ligne: (l) => l.dateEcheance, libelle: "date d'échéance" },
  { champ: "primeTtc", ligne: (l) => l.primeTtc, libelle: "prime TTC" },
  { champ: "primeHt", ligne: (l) => l.primeHt, libelle: "prime hors taxe" },
  { champ: "accessoires", ligne: (l) => l.accessoires, libelle: "accessoires" },
  { champ: "taxe", ligne: (l) => l.taxe, libelle: "taxe" },
];

/**
 * Compare les lignes d'un fichier aux contrats connus : nouvelles (police inconnue), modifiées (au moins un champ différent),
 * inchangées, et absentes du fichier. Une valeur absente du fichier (null) ne compte pas comme une modification : le fichier
 * ne retire jamais une information, il peut seulement l'omettre.
 */
export function comparerAvecImportPrecedent(lignes: LigneProduction[], connus: Map<string, ContratConnuProduction>): ComparaisonProduction {
  const resultat: ComparaisonProduction = { nouvelles: [], modifiees: [], inchangees: 0, absentes: [] };
  const vues = new Set<string>();
  for (const l of lignes) {
    if (l.numPolice === null || vues.has(l.numPolice)) continue;
    vues.add(l.numPolice);
    const connu = connus.get(l.numPolice);
    if (!connu) {
      resultat.nouvelles.push({ numPolice: l.numPolice, numeroLigne: l.numeroLigne });
      continue;
    }
    const champs: string[] = [];
    for (const c of CHAMPS_COMPARES) {
      const nouvelle = c.ligne(l);
      if (nouvelle === null) continue;
      const ancienne = connu[c.champ];
      const different = c.texte ? normaliserLibelleProduction(nouvelle) !== normaliserLibelleProduction(ancienne) : nouvelle !== ancienne;
      if (different) champs.push(c.libelle);
    }
    if (champs.length > 0) resultat.modifiees.push({ numPolice: l.numPolice, numeroLigne: l.numeroLigne, champs });
    else resultat.inchangees++;
  }
  for (const numPolice of connus.keys()) if (!vues.has(numPolice)) resultat.absentes.push(numPolice);
  return resultat;
}
