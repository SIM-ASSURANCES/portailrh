import { dateValideEcheancier, texteDepuisCentimes } from "./cptEcheancier";
import { partEncaisseeCpt, trierLignesRemunerationCpt, type LigneRemunerationCalculeeCpt } from "./cptRemuneration";
import { MODES_REGLEMENT_CPT, NATURES_REMUNERATION_CPT, type ModeReglementCpt, type NatureRemunerationCpt } from "./cptReferentiels";
import { lireMontant } from "./montant";

// Aucun import d'`enc*` ou de `treso*` (règle d'indépendance du module).

/**
 * Règlement d'un partenaire (lot GC-9e, règle C-37). PUR : validation de la saisie et affectation aux montants les plus anciens.
 *
 * Un règlement supérieur au net payable de la nature est TOUJOURS refusé : il n'existe pas d'avance volontaire (une avance ne naît
 * que d'une prime abandonnée après un versement). La somme des affectations est ainsi toujours égale au montant du règlement.
 */

const ZERO = BigInt(0);
const max0 = (x: bigint) => (x > ZERO ? x : ZERO);
const minimum = (a: bigint, b: bigint) => (a < b ? a : b);
const maximum = (a: bigint, b: bigint) => (a > b ? a : b);

export const MODES_PAIEMENT_PARTENAIRE_CPT = ["VIREMENT", "CHEQUE", "ESPECES", "MOBILE_MONEY", "AUTRE"] as const;
export type ModePaiementPartenaireCpt = (typeof MODES_PAIEMENT_PARTENAIRE_CPT)[number];
export const LIBELLE_MODE_PAIEMENT_PARTENAIRE_CPT: Record<ModePaiementPartenaireCpt, string> = {
  VIREMENT: "Virement",
  CHEQUE: "Chèque",
  ESPECES: "Espèces",
  MOBILE_MONEY: "Mobile money",
  AUTRE: "Autre",
};

export const MOTIF_REMUNERATION_MIN_CPT = 10;
export const MOTIF_REMUNERATION_MAX_CPT = 500;

/** Texte nettoyé, ou message si le motif est trop court ou trop long. */
export function lireMotifRemunerationCpt(brut: unknown): { ok: true; motif: string } | { ok: false; message: string } {
  const motif = String(brut ?? "").replace(/\s+/g, " ").trim();
  if (motif.length < MOTIF_REMUNERATION_MIN_CPT || motif.length > MOTIF_REMUNERATION_MAX_CPT) {
    return { ok: false, message: `Le motif est obligatoire (${MOTIF_REMUNERATION_MIN_CPT} à ${MOTIF_REMUNERATION_MAX_CPT} caractères).` };
  }
  return { ok: true, motif };
}

/** Montant FCFA entier strictement positif, en centimes. */
export function lireMontantRemunerationCpt(brut: unknown): { ok: true; centimes: bigint } | { ok: false; message: string } {
  const r = lireMontant(brut, { devise: "XOF" });
  if (!r.ok) return { ok: false, message: r.message };
  if (r.centimes <= 0) return { ok: false, message: "Le montant doit être supérieur à zéro." };
  return { ok: true, centimes: BigInt(r.centimes) };
}

export interface ReglementPartenaireSaisi {
  partenaireId: string;
  nature: NatureRemunerationCpt;
  montant: bigint;
  date: string;
  mode: ModePaiementPartenaireCpt;
  referenceReglement: string;
  pieceOdoo: string | null;
  modeDerogation: ModeReglementCpt | null;
  motif: string | null;
}

export type ResultatSaisieReglementCpt = { ok: true; valeur: ReglementPartenaireSaisi } | { ok: false; erreurs: Record<string, string> };

export function validerSaisieReglementCpt(saisie: Record<string, unknown>, aujourdhui: string): ResultatSaisieReglementCpt {
  const erreurs: Record<string, string> = {};
  const texte = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
  const partenaireId = texte(saisie.partenaireId);
  if (!partenaireId) erreurs.partenaireId = "Partenaire obligatoire.";
  const nature = NATURES_REMUNERATION_CPT.find((n) => n === saisie.nature);
  if (!nature) erreurs.nature = "La nature est obligatoire (commission, accessoires reversés ou honoraires).";
  const montant = lireMontantRemunerationCpt(saisie.montant);
  if (!montant.ok) erreurs.montant = montant.message;
  const date = texte(saisie.date);
  if (!dateValideEcheancier(date)) erreurs.date = "Date du règlement invalide.";
  else if (date > aujourdhui) erreurs.date = "La date du règlement ne peut pas être dans le futur.";
  const mode = MODES_PAIEMENT_PARTENAIRE_CPT.find((m) => m === saisie.mode);
  if (!mode) erreurs.mode = "Moyen de paiement obligatoire.";
  const referenceReglement = texte(saisie.referenceReglement);
  if (referenceReglement.length < 1 || referenceReglement.length > 60) erreurs.referenceReglement = "Référence du règlement obligatoire (60 caractères au plus).";
  const pieceOdoo = texte(saisie.pieceOdoo) || null;
  if (pieceOdoo && pieceOdoo.length > 60) erreurs.pieceOdoo = "Pièce Odoo : 60 caractères au plus.";
  const brutMode = texte(saisie.modeDerogation);
  const modeDerogation = brutMode ? (MODES_REGLEMENT_CPT.find((m) => m === brutMode) ?? null) : null;
  if (brutMode && !modeDerogation) erreurs.modeDerogation = "Choix « en une fois » ou « au prorata » invalide.";
  const motifBrut = texte(saisie.motif);
  let motif: string | null = motifBrut || null;
  if (modeDerogation) {
    const m = lireMotifRemunerationCpt(motifBrut);
    if (!m.ok) erreurs.motif = m.message;
    else motif = m.motif;
  } else if (motifBrut.length > MOTIF_REMUNERATION_MAX_CPT) erreurs.motif = `Motif : ${MOTIF_REMUNERATION_MAX_CPT} caractères au plus.`;

  if (Object.keys(erreurs).length > 0 || !nature || !montant.ok || !mode) return { ok: false, erreurs };
  return { ok: true, valeur: { partenaireId, nature, montant: montant.centimes, date, mode, referenceReglement, pieceOdoo, modeDerogation, motif } };
}

/** Payable d'une ligne pour CE règlement : la règle de la ligne, ou le choix décidé pour ce règlement. */
export function payablePourReglementCpt(l: LigneRemunerationCalculeeCpt, derogation: ModeReglementCpt | null): bigint {
  if (!derogation) return l.payable;
  if (derogation === "EN_UNE_FOIS") return l.exigible;
  const auProrata = l.primeAbandonnee ? l.exigible : partEncaisseeCpt(l.du, { montantDu: l.primeDue, montantRegle: l.primeEncaissee });
  return maximum(auProrata, minimum(l.exigible, l.payeEnUneFois));
}

export interface CapaciteReglementCpt {
  /** Net payable aujourd'hui dans la nature : un règlement ne le dépasse jamais. */
  payable: bigint;
}

export function capaciteReglementCpt(lignes: readonly LigneRemunerationCalculeeCpt[], derogation: ModeReglementCpt | null): CapaciteReglementCpt {
  let payable = ZERO;
  let paye = ZERO;
  for (const l of lignes) {
    payable += payablePourReglementCpt(l, derogation);
    paye += l.paye;
  }
  return { payable: max0(payable - paye) };
}

export interface PartAffecteeCpt {
  cle: string;
  contratId: string;
  echeanceId: string;
  numPolice: string;
  rang: number;
  montant: bigint;
}

export type PlanReglementCpt =
  | { ok: true; parts: PartAffecteeCpt[]; capacite: CapaciteReglementCpt }
  | { ok: false; message: string; capacite: CapaciteReglementCpt };

const fcfa = (c: bigint) => `${Number(texteDepuisCentimes(c)).toLocaleString("fr-FR")} FCFA`;

/** Affecte un règlement aux lignes d'UNE nature (celles d'un partenaire) : les montants payables les plus anciens d'abord. */
export function planifierReglementCpt(
  lignes: readonly LigneRemunerationCalculeeCpt[],
  montant: bigint,
  options: { modeDerogation: ModeReglementCpt | null },
): PlanReglementCpt {
  const natures = new Set(lignes.map((l) => l.nature));
  if (natures.size > 1) throw new Error("Un règlement porte sur une seule nature.");
  const capacite = capaciteReglementCpt(lignes, options.modeDerogation);
  if (montant <= ZERO) return { ok: false, message: "Le montant doit être supérieur à zéro.", capacite };
  if (montant > capacite.payable) {
    return { ok: false, message: `Le montant dépasse le payable aujourd'hui (${fcfa(capacite.payable)}) : un règlement n'est jamais accepté au-delà.`, capacite };
  }
  const ordre = trierLignesRemunerationCpt(lignes);
  const affecte = new Map<string, bigint>();
  let restant = montant;
  const affecter = (l: LigneRemunerationCalculeeCpt, disponible: bigint) => {
    const part = minimum(restant, max0(disponible));
    if (part === ZERO) return;
    affecte.set(l.cle, (affecte.get(l.cle) ?? ZERO) + part);
    restant -= part;
  };
  for (const l of ordre) affecter(l, payablePourReglementCpt(l, options.modeDerogation) - l.paye);
  if (restant !== ZERO) return { ok: false, message: "Le montant ne peut pas être affecté en entier aux lignes de cette nature.", capacite };
  const parts = ordre
    .filter((l) => affecte.has(l.cle))
    .map((l) => ({ cle: l.cle, contratId: l.contratId, echeanceId: l.echeanceId, numPolice: l.numPolice, rang: l.rang, montant: affecte.get(l.cle)! }));
  return { ok: true, parts, capacite };
}
