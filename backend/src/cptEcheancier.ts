// Gestion Compta, lot GC-3e : calcul de l'échéancier d'un contrat et de ses états affichés (docs/compta-conception.md §6.3).
// Module PUR (aucun accès base) : montants en centimes entiers (BigInt pour les proportions), dates en texte `AAAA-MM-JJ`
// (jamais de fuseau horaire). Règle de base : la SOMME des échéances est égale à la prime du contrat, au centime ; l'écart
// d'arrondi est reporté sur la dernière échéance (exemple T12 : 6 077 832 en 12 mensualités = 12 × 506 486, exact).

import type { ErreursChampsCpt } from "./cptReferentiels";

export type FractionnementCpt = "COMPTANT" | "MENSUEL" | "TRIMESTRIEL" | "SEMESTRIEL" | "LIBRE";

/** Nombre de mois d'une période de chaque fractionnement périodique. */
const MOIS_PAR_PERIODE: Record<Exclude<FractionnementCpt, "COMPTANT" | "LIBRE">, number> = { MENSUEL: 1, TRIMESTRIEL: 3, SEMESTRIEL: 6 };

export type MontantEntreeCpt = string | number;

export interface EntreeEcheancier {
  fractionnement: FractionnementCpt;
  /** Date d'effet et date d'échéance du contrat (incluse), `AAAA-MM-JJ`. */
  dateEffet: string;
  dateEcheance: string;
  primeTtc: MontantEntreeCpt;
  accessoires: MontantEntreeCpt;
  taxe: MontantEntreeCpt;
  /** Fractionnement LIBRE : une ligne par échéance (date prévue et montant TTC), dans l'ordre des dates. */
  lignesLibres?: { datePrevue: string; primeTtc: MontantEntreeCpt }[];
}

export interface EcheanceCalculee {
  rang: number;
  periodeDebut: string;
  periodeFin: string;
  datePrevue: string;
  /** Montants au format « 506486.00 » (deux décimales), prêts pour une colonne DECIMAL. */
  primeTtc: string;
  primeHt: string;
  accessoires: string;
  taxe: string;
  montantDu: string;
}

export type ResultatEcheancier = { ok: true; echeances: EcheanceCalculee[] } | { ok: false; erreur: string; erreurs?: ErreursChampsCpt };

// ---------------------------------------------------------------------------------------------------------------------
// Montants
// ---------------------------------------------------------------------------------------------------------------------

/** Texte ou nombre → centimes entiers ; `null` si ce n'est pas un montant positif ou nul à deux décimales au plus. */
export function enCentimesEcheancier(valeur: MontantEntreeCpt | null | undefined): bigint | null {
  const texte = typeof valeur === "number" ? (Number.isFinite(valeur) ? String(valeur) : "") : String(valeur ?? "").trim();
  const m = /^(\d{1,12})(?:[.,](\d{1,2}))?$/.exec(texte);
  if (!m) return null;
  return BigInt(m[1]) * BigInt(100) + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
}

export function texteDepuisCentimes(centimes: bigint): string {
  const negatif = centimes < BigInt(0);
  const abs = negatif ? -centimes : centimes;
  const entier = abs / BigInt(100);
  const reste = (abs % BigInt(100)).toString().padStart(2, "0");
  return `${negatif ? "-" : ""}${entier.toString()}.${reste}`;
}

/** arrondi(total × part ÷ ensemble) en centimes, à l'entier le plus proche (demi vers le haut). */
function proportion(total: bigint, part: bigint, ensemble: bigint): bigint {
  if (ensemble === BigInt(0)) return BigInt(0);
  return (total * part * BigInt(2) + ensemble) / (ensemble * BigInt(2));
}

// ---------------------------------------------------------------------------------------------------------------------
// Dates (texte AAAA-MM-JJ, calcul en UTC)
// ---------------------------------------------------------------------------------------------------------------------

const FORMAT_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function dateValideEcheancier(texte: string): boolean {
  const m = FORMAT_DATE.exec(texte);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

const enTexte = (d: Date) => d.toISOString().slice(0, 10);
const depuisTexte = (t: string) => {
  const m = FORMAT_DATE.exec(t)!;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
};

/** Ajoute des mois en gardant le jour, ramené au dernier jour du mois quand il n'existe pas (31 janvier + 1 mois = 28 ou 29 février). */
export function ajouterMoisCpt(texte: string, mois: number): string {
  const d = depuisTexte(texte);
  const jour = d.getUTCDate();
  const cible = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + mois, 1));
  const dernier = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  cible.setUTCDate(Math.min(jour, dernier));
  return enTexte(cible);
}

export function ajouterJoursCpt(texte: string, jours: number): string {
  const d = depuisTexte(texte);
  d.setUTCDate(d.getUTCDate() + jours);
  return enTexte(d);
}

export function joursEntreCpt(debut: string, fin: string): number {
  return Math.round((depuisTexte(fin).getTime() - depuisTexte(debut).getTime()) / 86_400_000);
}

/** Nombre de mois entiers entre `debut` et `finExclue` (jour de départ conservé). */
function moisEntiers(debut: string, finExclue: string): number {
  const a = depuisTexte(debut);
  const b = depuisTexte(finExclue);
  let mois = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (ajouterMoisCpt(debut, mois) > finExclue) mois -= 1;
  return mois;
}

// ---------------------------------------------------------------------------------------------------------------------
// Construction de l'échéancier
// ---------------------------------------------------------------------------------------------------------------------

interface Periode {
  debut: string;
  fin: string;
  datePrevue: string;
}

/**
 * Découpe un montant en parts selon des poids (cumul arrondi : chaque part = cumul arrondi du rang − cumul arrondi du rang
 * précédent). La somme des parts est TOUJOURS égale au total : l'écart d'arrondi se retrouve réparti, la dernière part
 * absorbant le reliquat exact.
 */
function repartir(total: bigint, poids: bigint[]): bigint[] {
  const ensemble = poids.reduce((a, p) => a + p, BigInt(0));
  const parts: bigint[] = [];
  let cumulPoids = BigInt(0);
  let cumulAttribue = BigInt(0);
  poids.forEach((p, i) => {
    cumulPoids += p;
    const cible = i === poids.length - 1 ? total : proportion(total, cumulPoids, ensemble);
    parts.push(cible - cumulAttribue);
    cumulAttribue = cible;
  });
  return parts;
}

function periodesPeriodiques(fractionnement: FractionnementCpt, dateEffet: string, dateEcheance: string): Periode[] | string {
  if (fractionnement === "COMPTANT") return [{ debut: dateEffet, fin: dateEcheance, datePrevue: dateEffet }];
  if (fractionnement === "LIBRE") return "Le fractionnement libre exige les lignes d'échéance.";
  const pas = MOIS_PAR_PERIODE[fractionnement];
  const mois = moisEntiers(dateEffet, ajouterJoursCpt(dateEcheance, 1));
  if (mois < 1) return "La période du contrat est trop courte pour ce fractionnement.";
  const nombre = Math.ceil(mois / pas);
  return Array.from({ length: nombre }, (_, i) => {
    const debut = ajouterMoisCpt(dateEffet, i * pas);
    const fin = i === nombre - 1 ? dateEcheance : ajouterJoursCpt(ajouterMoisCpt(dateEffet, (i + 1) * pas), -1);
    return { debut, fin, datePrevue: debut };
  });
}

/**
 * Construit l'échéancier d'un contrat. Contrôles : dates valides et ordonnées, prime TTC = hors taxe + accessoires + taxe
 * (la part hors taxe est déduite : TTC − accessoires − taxe), somme des lignes libres = prime TTC. Aucune échéance n'est
 * jamais produite à partir d'une entrée incohérente.
 */
export function construireEcheancier(entree: EntreeEcheancier): ResultatEcheancier {
  const erreurs: ErreursChampsCpt = {};
  if (!dateValideEcheancier(entree.dateEffet)) erreurs.dateEffet = "Date d'effet invalide.";
  if (!dateValideEcheancier(entree.dateEcheance)) erreurs.dateEcheance = "Date d'échéance invalide.";
  if (!erreurs.dateEffet && !erreurs.dateEcheance && entree.dateEcheance < entree.dateEffet) {
    erreurs.dateEcheance = "La date d'échéance précède la date d'effet.";
  }
  const ttc = enCentimesEcheancier(entree.primeTtc);
  const accessoires = enCentimesEcheancier(entree.accessoires);
  const taxe = enCentimesEcheancier(entree.taxe);
  if (ttc === null) erreurs.primeTtc = "Prime TTC invalide.";
  if (accessoires === null) erreurs.accessoires = "Accessoires invalides.";
  if (taxe === null) erreurs.taxe = "Taxe invalide.";
  if (ttc !== null && accessoires !== null && taxe !== null && accessoires + taxe > ttc) {
    erreurs.primeTtc = "La prime TTC est inférieure aux accessoires et à la taxe.";
  }
  if (Object.keys(erreurs).length > 0 || ttc === null || accessoires === null || taxe === null) {
    return { ok: false, erreur: "Contrat incohérent : échéancier impossible.", erreurs };
  }

  // Périodes et montants TTC de chaque échéance.
  let periodes: Periode[];
  let partsTtc: bigint[];
  if (entree.fractionnement === "LIBRE") {
    const lignes = entree.lignesLibres ?? [];
    if (lignes.length === 0) return { ok: false, erreur: "Le fractionnement libre exige au moins une échéance." };
    const montants = lignes.map((l) => enCentimesEcheancier(l.primeTtc));
    if (lignes.some((l, i) => !dateValideEcheancier(l.datePrevue) || montants[i] === null || montants[i]! <= BigInt(0))) {
      return { ok: false, erreur: "Une ligne d'échéance libre a une date ou un montant invalide." };
    }
    for (let i = 1; i < lignes.length; i++) {
      if (lignes[i].datePrevue < lignes[i - 1].datePrevue) return { ok: false, erreur: "Les échéances libres doivent être classées par date." };
    }
    partsTtc = montants as bigint[];
    const somme = partsTtc.reduce((a, m) => a + m, BigInt(0));
    if (somme !== ttc) {
      return { ok: false, erreur: `La somme des échéances libres (${texteDepuisCentimes(somme)}) diffère de la prime TTC (${texteDepuisCentimes(ttc)}).` };
    }
    periodes = lignes.map((l, i) => ({
      debut: l.datePrevue,
      fin: i === lignes.length - 1 ? (entree.dateEcheance >= l.datePrevue ? entree.dateEcheance : l.datePrevue) : ajouterJoursCpt(lignes[i + 1].datePrevue, -1),
      datePrevue: l.datePrevue,
    }));
  } else {
    const p = periodesPeriodiques(entree.fractionnement, entree.dateEffet, entree.dateEcheance);
    if (typeof p === "string") return { ok: false, erreur: p };
    periodes = p;
    partsTtc = repartir(ttc, periodes.map(() => BigInt(1)));
  }

  // Accessoires et taxe : proportionnels au TTC de chaque échéance ; la part hors taxe est le reste (TTC − accessoires − taxe).
  const partsAccessoires = repartir(accessoires, partsTtc);
  const partsTaxe = repartir(taxe, partsTtc);
  const echeances: EcheanceCalculee[] = [];
  for (let i = 0; i < periodes.length; i++) {
    const ht = partsTtc[i] - partsAccessoires[i] - partsTaxe[i];
    if (ht < BigInt(0)) return { ok: false, erreur: `L'échéance ${i + 1} aurait une part hors taxe négative : répartition impossible.` };
    echeances.push({
      rang: i + 1,
      periodeDebut: periodes[i].debut,
      periodeFin: periodes[i].fin,
      datePrevue: periodes[i].datePrevue,
      primeTtc: texteDepuisCentimes(partsTtc[i]),
      primeHt: texteDepuisCentimes(ht),
      accessoires: texteDepuisCentimes(partsAccessoires[i]),
      taxe: texteDepuisCentimes(partsTaxe[i]),
      montantDu: texteDepuisCentimes(partsTtc[i]),
    });
  }
  return { ok: true, echeances };
}

// ---------------------------------------------------------------------------------------------------------------------
// États affichés et reste dû (calculés, jamais stockés)
// ---------------------------------------------------------------------------------------------------------------------

export type EtatBaseEcheance = "OUVERTE" | "SOLDEE" | "ANNULEE";
export type EtatAfficheEcheance = "A_VENIR" | "DUE" | "EN_RETARD" | "PAYEE" | "PARTIELLEMENT_PAYEE" | "ANNULEE";

export interface EcheanceEtat {
  etat: EtatBaseEcheance;
  datePrevue: string;
  montantDu: MontantEntreeCpt;
  montantRegle: MontantEntreeCpt;
}

export interface EtatAffiche {
  etat: EtatAfficheEcheance;
  libelle: string;
  /** Jours de retard (seulement pour « en retard »). */
  joursRetard: number;
  /** Reste dû de l'échéance en centimes (0 si soldée ou annulée). */
  resteDu: bigint;
}

export const LIBELLE_ETAT_ECHEANCE: Record<EtatAfficheEcheance, string> = {
  A_VENIR: "À venir",
  DUE: "Due",
  EN_RETARD: "En retard",
  PAYEE: "Payée",
  PARTIELLEMENT_PAYEE: "Partiellement payée",
  ANNULEE: "Annulée",
};

/** État d'une échéance à une date donnée : à venir, due (échue, reste > 0), en retard (n jours), payée, partiellement payée, annulée. */
export function etatAfficheEcheance(e: EcheanceEtat, aujourdhui: string): EtatAffiche {
  const du = enCentimesEcheancier(e.montantDu) ?? BigInt(0);
  const regle = enCentimesEcheancier(e.montantRegle) ?? BigInt(0);
  const reste = du > regle ? du - regle : BigInt(0);
  const resultat = (etat: EtatAfficheEcheance, joursRetard = 0, resteDu = reste): EtatAffiche => ({
    etat,
    libelle: etat === "EN_RETARD" ? `En retard de ${joursRetard} jour${joursRetard > 1 ? "s" : ""}` : LIBELLE_ETAT_ECHEANCE[etat],
    joursRetard,
    resteDu,
  });
  if (e.etat === "ANNULEE") return resultat("ANNULEE", 0, BigInt(0));
  if (reste === BigInt(0)) return resultat("PAYEE", 0, BigInt(0));
  if (e.datePrevue > aujourdhui) return resultat(regle > BigInt(0) ? "PARTIELLEMENT_PAYEE" : "A_VENIR");
  const retard = joursEntreCpt(e.datePrevue, aujourdhui);
  if (retard > 0) return resultat("EN_RETARD", retard);
  return resultat(regle > BigInt(0) ? "PARTIELLEMENT_PAYEE" : "DUE");
}

/** Reste dû du contrat : somme (montant dû − montant réglé) des échéances non annulées, jamais négatif par échéance. */
export function resteDuContrat(echeances: EcheanceEtat[]): bigint {
  return echeances.reduce((somme, e) => {
    if (e.etat === "ANNULEE") return somme;
    const du = enCentimesEcheancier(e.montantDu) ?? BigInt(0);
    const regle = enCentimesEcheancier(e.montantRegle) ?? BigInt(0);
    return somme + (du > regle ? du - regle : BigInt(0));
  }, BigInt(0));
}
