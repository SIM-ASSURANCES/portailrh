// Reconnaissance des lignes d'un relevé (Gestion Compta, lot GC-4c ; docs/compta-conception.md §7) : remboursements,
// transactions test, frais, virements entre comptes du groupe, et anti-doublon par (compte, référence).
//
// PUR : aucun accès base. L'appelant (lot 4d) fournit les références déjà importées pour ce compte et les lignes des AUTRES comptes
// qui pourraient être l'autre côté d'un virement. Ce fichier DÉCIDE, il n'écrit rien.
//
// Principe de prudence : une ligne n'est reconnue « virement interne » que si l'appariement est SANS AMBIGUÏTÉ ; dans le doute elle
// reste un crédit à rattacher (ou un débit) avec une alerte, et un humain tranche. Se tromper dans l'autre sens ferait disparaître
// une prime des encaissements, ou compter deux fois le même argent.
//
// Indépendant d'Encaissements : aucun import d'un fichier `enc*`.

import type { LigneReleve } from "./cptReleve";

const ZERO = BigInt(0);
const absolu = (n: bigint) => (n < ZERO ? -n : n);

/** Mêmes valeurs que l'enum Prisma `CptTypeFlux` (copiées : ce fichier reste utilisable côté navigateur et dans les tests sans base). */
export type TypeFluxCpt =
  | "ENCAISSEMENT"
  | "VIREMENT_INTERNE_ENTRANT"
  | "VIREMENT_INTERNE_SORTANT"
  | "REMBOURSEMENT"
  | "TEST"
  | "FRAIS"
  | "AUTRE_DEBIT";

/** Ligne dont la référence, la date et le montant sont connus (les lignes bloquées par `controlerLotReleve` n'arrivent pas ici). */
export interface LigneReleveComplete extends LigneReleve {
  reference: string;
  dateValeur: string;
  montant: bigint;
}

/** Garde de type : `null` si la ligne n'a pas de référence, de date ou de montant. */
export function enLigneComplete(ligne: LigneReleve): LigneReleveComplete | null {
  if (ligne.reference === null || ligne.dateValeur === null || ligne.montant === null) return null;
  return ligne as LigneReleveComplete;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reconnaissance par le texte
// ---------------------------------------------------------------------------------------------------------------------

/** Minuscules, sans accents, espaces réduits. */
function forme(valeur: string | null): string {
  return (valeur ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Mot entier « test » dans le type chez l'opérateur ou dans le nom du payeur (« testament » n'en est pas un). */
export function estTransactionTestReleve(ligne: Pick<LigneReleve, "typeSource" | "payeur">): boolean {
  return /\btest\b/.test(forme(ligne.typeSource)) || /\btest\b/.test(forme(ligne.payeur));
}

export function estRemboursementReleve(ligne: Pick<LigneReleve, "typeSource" | "libelle">): boolean {
  return /refund|rembours/.test(forme(ligne.typeSource)) || /^\s*rembours/.test(forme(ligne.libelle));
}

export function estFraisReleve(ligne: Pick<LigneReleve, "typeSource" | "libelle">): boolean {
  return /\b(fee|fees|frais|commission|agios?)\b/.test(forme(ligne.typeSource)) || /^\s*(frais|commission|agios?)\b/.test(forme(ligne.libelle));
}

// ---------------------------------------------------------------------------------------------------------------------
// Appariement des virements internes
// ---------------------------------------------------------------------------------------------------------------------

export type SensVirement = "ENTREE" | "SORTIE";

/** Ligne d'un AUTRE compte, déjà en base, qui peut être l'autre côté d'un virement. */
export interface ContrepartieVirement {
  id: string;
  compteId: string;
  /** `AAAA-MM-JJ`. */
  dateValeur: string;
  /** Centimes, positif. */
  montant: bigint;
  sens: SensVirement;
}

export interface ContexteReconnaissance {
  /** Compte du relevé importé. */
  compteId: string;
  /** Références déjà importées pour CE compte (anti-doublon, RG-04). */
  referencesExistantes: ReadonlySet<string>;
  /** Lignes des autres comptes encore libres (ni apparié à un virement, ni déjà rattachées) : l'appelant les filtre. */
  contreparties?: readonly ContrepartieVirement[];
  /** Écart de jours toléré entre les deux côtés d'un virement (défaut 3 : la banque crédite parfois le lendemain ou le surlendemain). */
  fenetreJoursVirement?: number;
  /** Écart de montant toléré, en centimes (défaut 0 : un virement est exact ; les frais d'un opérateur sont un autre sujet). */
  toleranceVirementCentimes?: bigint;
}

const MS_PAR_JOUR = 24 * 60 * 60 * 1000;
/** Écart en jours entre deux dates `AAAA-MM-JJ` (valeur absolue). */
export function ecartJours(a: string, b: string): number {
  const t = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.abs(Math.round((t(a) - t(b)) / MS_PAR_JOUR));
}

// ---------------------------------------------------------------------------------------------------------------------
// Résultat
// ---------------------------------------------------------------------------------------------------------------------

export type DecisionLigneReleveCpt = "A_CREER" | "DEJA_IMPORTEE";

export type RaisonClassement = "TEST" | "REMBOURSEMENT" | "FRAIS" | "VIREMENT_APPARIE" | "CREDIT" | "DEBIT" | "DEJA_IMPORTEE";

export type CodeSignalementReconnaissance = "REMBOURSEMENT_RECU" | "VIREMENT_AMBIGU";

export interface SignalementReconnaissance {
  code: CodeSignalementReconnaissance;
  message: string;
}

export interface LigneReconnue {
  numeroLigne: number;
  reference: string;
  decision: DecisionLigneReleveCpt;
  /** Type de flux à enregistrer (pour une ligne déjà importée : celui qu'elle aurait eu, sans effet). */
  typeFlux: TypeFluxCpt;
  raison: RaisonClassement;
  /** Pour un virement apparié : la ligne de l'autre compte, qui devra passer elle aussi en virement interne. */
  contrepartieId?: string;
  signalements: SignalementReconnaissance[];
}

export interface BilanReconnaissance {
  nbLignes: number;
  nbACreer: number;
  nbDejaImportees: number;
  parType: Record<TypeFluxCpt, number>;
  nbVirementsApparies: number;
  nbAlertes: number;
}

// ---------------------------------------------------------------------------------------------------------------------
// Moteur
// ---------------------------------------------------------------------------------------------------------------------

function typeParDefaut(montant: bigint): { typeFlux: TypeFluxCpt; raison: RaisonClassement } {
  return montant > ZERO ? { typeFlux: "ENCAISSEMENT", raison: "CREDIT" } : { typeFlux: "AUTRE_DEBIT", raison: "DEBIT" };
}

/**
 * Classe chaque ligne du relevé. Ordre de priorité : déjà importée > transaction test > remboursement > frais > virement apparié
 * > crédit ou débit ordinaire.
 * - Un remboursement n'est reconnu que pour un DÉBIT ; un remboursement REÇU (crédit) reste un crédit et une alerte le signale :
 *   ce n'est pas une prime, la Finance le classera « pas une prime » avec son motif.
 * - Des frais ne sont reconnus que pour un débit.
 * - Un virement n'est apparié que s'il n'y a qu'UNE contrepartie la plus proche en date ET qu'aucune autre ligne du relevé ne la
 *   réclame ; sinon alerte `VIREMENT_AMBIGU`, la ligne reste ordinaire.
 */
export function reconnaitreLignesReleve(lignes: readonly LigneReleveComplete[], contexte: ContexteReconnaissance): LigneReconnue[] {
  const fenetre = contexte.fenetreJoursVirement ?? 3;
  const tolerance = contexte.toleranceVirementCentimes ?? ZERO;
  const contreparties = (contexte.contreparties ?? []).filter((c) => c.compteId !== contexte.compteId);

  const resultats: LigneReconnue[] = lignes.map((l): LigneReconnue => {
    const base = { numeroLigne: l.numeroLigne, reference: l.reference, signalements: [] as SignalementReconnaissance[] };
    if (contexte.referencesExistantes.has(l.reference)) {
      return { ...base, decision: "DEJA_IMPORTEE", ...typeParDefaut(l.montant), raison: "DEJA_IMPORTEE" };
    }
    if (estTransactionTestReleve(l)) return { ...base, decision: "A_CREER", typeFlux: "TEST", raison: "TEST" };
    if (estRemboursementReleve(l)) {
      if (l.montant < ZERO) return { ...base, decision: "A_CREER", typeFlux: "REMBOURSEMENT", raison: "REMBOURSEMENT" };
      return {
        ...base,
        decision: "A_CREER",
        ...typeParDefaut(l.montant),
        signalements: [{ code: "REMBOURSEMENT_RECU", message: "Remboursement reçu : ce n'est pas une prime, à classer « pas une prime » avec son motif." }],
      };
    }
    if (l.montant < ZERO && estFraisReleve(l)) return { ...base, decision: "A_CREER", typeFlux: "FRAIS", raison: "FRAIS" };
    return { ...base, decision: "A_CREER", ...typeParDefaut(l.montant) };
  });

  // Appariement : seulement les lignes ordinaires (crédit ou débit non nul) restées à créer.
  const candidatesParLigne = new Map<number, { contrepartie: ContrepartieVirement; ecart: number }[]>();
  resultats.forEach((r, i) => {
    if (r.decision !== "A_CREER" || (r.raison !== "CREDIT" && r.raison !== "DEBIT")) return;
    const l = lignes[i];
    if (l.montant === ZERO) return;
    const sensLigne: SensVirement = l.montant > ZERO ? "ENTREE" : "SORTIE";
    const trouvees = contreparties
      .filter((c) => c.sens !== sensLigne && absolu(c.montant - absolu(l.montant)) <= tolerance)
      .map((c) => ({ contrepartie: c, ecart: ecartJours(c.dateValeur, l.dateValeur) }))
      .filter((x) => x.ecart <= fenetre);
    if (trouvees.length > 0) candidatesParLigne.set(i, trouvees);
  });

  // Meilleure(s) contrepartie(s) de chaque ligne = celles de plus petit écart de date.
  const meilleures = new Map<number, ContrepartieVirement[]>();
  for (const [i, trouvees] of candidatesParLigne) {
    const minimum = Math.min(...trouvees.map((x) => x.ecart));
    meilleures.set(i, trouvees.filter((x) => x.ecart === minimum).map((x) => x.contrepartie));
  }
  // Combien de lignes du relevé réclament chaque contrepartie (comme « meilleure » ou non : toute candidate compte).
  const reclamants = new Map<string, number>();
  for (const trouvees of candidatesParLigne.values()) {
    for (const { contrepartie } of trouvees) reclamants.set(contrepartie.id, (reclamants.get(contrepartie.id) ?? 0) + 1);
  }

  for (const [i, trouvees] of candidatesParLigne) {
    const r = resultats[i];
    const choisies = meilleures.get(i)!;
    const unique = choisies.length === 1 && (reclamants.get(choisies[0].id) ?? 0) === 1;
    if (unique) {
      r.typeFlux = lignes[i].montant > ZERO ? "VIREMENT_INTERNE_ENTRANT" : "VIREMENT_INTERNE_SORTANT";
      r.raison = "VIREMENT_APPARIE";
      r.contrepartieId = choisies[0].id;
    } else {
      r.signalements.push({
        code: "VIREMENT_AMBIGU",
        message: `Ressemble à un virement interne (${trouvees.length} ligne(s) d'un autre compte de même montant à moins de ${fenetre} jour(s)) mais l'appariement n'est pas sans ambiguïté : à rapprocher à la main.`,
      });
    }
  }

  return resultats;
}

/** Décompte d'un résultat de reconnaissance, pour le bilan de l'import et l'écran. */
export function bilanReconnaissance(resultats: readonly LigneReconnue[]): BilanReconnaissance {
  const parType: Record<TypeFluxCpt, number> = {
    ENCAISSEMENT: 0,
    VIREMENT_INTERNE_ENTRANT: 0,
    VIREMENT_INTERNE_SORTANT: 0,
    REMBOURSEMENT: 0,
    TEST: 0,
    FRAIS: 0,
    AUTRE_DEBIT: 0,
  };
  let nbACreer = 0;
  let nbDejaImportees = 0;
  let nbVirementsApparies = 0;
  let nbAlertes = 0;
  for (const r of resultats) {
    if (r.decision === "DEJA_IMPORTEE") {
      nbDejaImportees++;
      continue;
    }
    nbACreer++;
    parType[r.typeFlux]++;
    if (r.raison === "VIREMENT_APPARIE") nbVirementsApparies++;
    nbAlertes += r.signalements.length;
  }
  return { nbLignes: resultats.length, nbACreer, nbDejaImportees, parType, nbVirementsApparies, nbAlertes };
}
