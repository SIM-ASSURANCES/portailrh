import { texteDepuisCentimes } from "./cptEcheancier";
import type { ColonneExportCpt, LigneExportCpt } from "./cptExportCsv";
import { ventilerHonoraireCpt } from "./cptHonoraires";
import { LIBELLE_NATURE_REMUNERATION_CPT, type NatureRemunerationCpt } from "./cptReferentiels";
import { LIBELLE_MODE_PAIEMENT_PARTENAIRE_CPT, type ModePaiementPartenaireCpt } from "./cptReglementPartenaire";
import { soldeNatureCpt, trierLignesRemunerationCpt, type LigneRemunerationCalculeeCpt, type SoldeNatureCpt } from "./cptRemuneration";

// Aucun import d'`enc*` ou de `treso*` (règle d'indépendance du module).

/**
 * Relevé d'un partenaire pour UNE nature (lot GC-9g). PUR : l'écran, l'export CSV / Excel et le PDF lisent ce même objet, jamais
 * un second calcul. Les mouvements (règlements, et compensations signées : négative quand la nature est la source) expliquent le
 * payé : leur somme est égale au payé du solde.
 */

const ZERO = BigInt(0);

export interface ReglementReleveCpt {
  reference: string;
  date: string;
  montant: bigint;
  montantAvance: bigint;
  mode: ModePaiementPartenaireCpt;
  referenceReglement: string;
  /** Instant de la saisie (texte ISO) : départage les mouvements d'un même jour. */
  creeAt: string;
}

export interface CompensationReleveCpt {
  date: string;
  natureSource: NatureRemunerationCpt;
  natureCible: NatureRemunerationCpt;
  montant: bigint;
  motif: string;
  creeAt: string;
}

export interface LigneReleveCpt extends LigneRemunerationCalculeeCpt {
  clientNom: string;
  /** Ventilation des honoraires (nuls pour les autres natures). */
  surPrimesEncaissees: bigint | null;
  surPrimesNonEncaissees: bigint | null;
}

export interface MouvementReleveCpt {
  type: "REGLEMENT" | "COMPENSATION";
  date: string;
  creeAt: string;
  /** Numéro CPR d'un règlement ; vide pour une compensation. */
  reference: string;
  detail: string;
  /** Effet sur le payé de la nature, signé. */
  montant: bigint;
}

export interface ReleveRemunerationCpt {
  nature: NatureRemunerationCpt;
  libelleNature: string;
  lignes: LigneReleveCpt[];
  mouvements: MouvementReleveCpt[];
  solde: SoldeNatureCpt;
  honoraires: { surPrimesEncaissees: bigint; surPrimesNonEncaissees: bigint } | null;
}

const fcfa = (c: bigint) => `${Number(texteDepuisCentimes(c)).toLocaleString("fr-FR")} FCFA`;

export function construireReleveRemunerationCpt(entree: {
  nature: NatureRemunerationCpt;
  lignes: readonly LigneRemunerationCalculeeCpt[];
  clients: ReadonlyMap<string, { clientNom: string }>;
  reglements: readonly ReglementReleveCpt[];
  compensations: readonly CompensationReleveCpt[];
}): ReleveRemunerationCpt {
  const { nature } = entree;
  const lignes: LigneReleveCpt[] = trierLignesRemunerationCpt(entree.lignes.filter((l) => l.nature === nature)).map((l) => {
    const v = nature === "HONORAIRES" ? ventilerHonoraireCpt(l) : null;
    return { ...l, clientNom: entree.clients.get(l.contratId)?.clientNom ?? "", surPrimesEncaissees: v?.surPrimesEncaissees ?? null, surPrimesNonEncaissees: v?.surPrimesNonEncaissees ?? null };
  });
  const mouvements: MouvementReleveCpt[] = [
    ...entree.reglements.map((r) => ({
      type: "REGLEMENT" as const,
      date: r.date,
      creeAt: r.creeAt,
      reference: r.reference,
      detail: `${LIBELLE_MODE_PAIEMENT_PARTENAIRE_CPT[r.mode]} ${r.referenceReglement}${r.montantAvance > ZERO ? ` (dont avance ${fcfa(r.montantAvance)})` : ""}`,
      montant: r.montant,
    })),
    ...entree.compensations
      .filter((c) => c.natureSource === nature || c.natureCible === nature)
      .map((c) => ({
        type: "COMPENSATION" as const,
        date: c.date,
        creeAt: c.creeAt,
        reference: "",
        detail:
          c.natureSource === nature
            ? `Avance reprise vers ${LIBELLE_NATURE_REMUNERATION_CPT[c.natureCible].toLowerCase()} — ${c.motif}`
            : `Imputation d'une avance de ${LIBELLE_NATURE_REMUNERATION_CPT[c.natureSource].toLowerCase()} — ${c.motif}`,
        montant: c.natureSource === nature ? -c.montant : c.montant,
      })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.creeAt.localeCompare(b.creeAt));
  const honoraires =
    nature === "HONORAIRES"
      ? {
          surPrimesEncaissees: lignes.reduce((s, l) => s + (l.surPrimesEncaissees ?? ZERO), ZERO),
          surPrimesNonEncaissees: lignes.reduce((s, l) => s + (l.surPrimesNonEncaissees ?? ZERO), ZERO),
        }
      : null;
  return { nature, libelleNature: LIBELLE_NATURE_REMUNERATION_CPT[nature], lignes, mouvements, solde: soldeNatureCpt(nature, lignes), honoraires };
}

// ---------- Export (CSV / Excel) : les mêmes lignes que l'écran ----------

export function colonnesReleveRemunerationCpt(nature: NatureRemunerationCpt): ColonneExportCpt[] {
  return [
    { cle: "section", titre: "Section", type: "texte" },
    { cle: "date", titre: "Date", type: "date" },
    { cle: "reference", titre: "Police / référence", type: "texte", largeur: 20 },
    { cle: "echeance", titre: "Échéance", type: "entier" },
    { cle: "client", titre: "Client", type: "texte", largeur: 28 },
    { cle: "du", titre: "Dû (FCFA)", type: "montant" },
    { cle: "exigible", titre: "Exigible (FCFA)", type: "montant" },
    { cle: "payable", titre: "Payable (FCFA)", type: "montant" },
    { cle: "paye", titre: "Payé (FCFA)", type: "montant" },
    { cle: "restePayable", titre: "Reste payable (FCFA)", type: "montant" },
    { cle: "resteDu", titre: "Reste dû (FCFA)", type: "montant" },
    { cle: "avance", titre: "Avance (FCFA)", type: "montant" },
    { cle: "aRegulariser", titre: "À régulariser (FCFA)", type: "montant" },
    ...(nature === "HONORAIRES"
      ? [
          { cle: "encaissees", titre: "Sur primes encaissées (FCFA)", type: "montant" as const },
          { cle: "nonEncaissees", titre: "Sur primes non encaissées (FCFA)", type: "montant" as const },
        ]
      : []),
    { cle: "mouvement", titre: "Mouvement (FCFA)", type: "montant" },
    { cle: "detail", titre: "Détail", type: "texte", largeur: 60 },
  ];
}

const nombre = (c: bigint) => Number(texteDepuisCentimes(c));

/** Échéances, puis mouvements, puis le total de la nature (le « Net à verser » du total est le net de la nature). */
export function lignesExportReleveRemunerationCpt(r: ReleveRemunerationCpt): LigneExportCpt[] {
  const echeances: LigneExportCpt[] = r.lignes.map((l) => ({
    section: "Échéance",
    date: l.datePrevue,
    reference: l.numPolice,
    echeance: l.rang,
    client: l.clientNom,
    du: nombre(l.du),
    exigible: nombre(l.exigible),
    payable: nombre(l.payable),
    paye: nombre(l.paye),
    restePayable: nombre(l.restePayable),
    resteDu: nombre(l.resteDu),
    avance: nombre(l.avance),
    aRegulariser: nombre(l.aRegulariser),
    ...(r.honoraires ? { encaissees: nombre(l.surPrimesEncaissees ?? ZERO), nonEncaissees: nombre(l.surPrimesNonEncaissees ?? ZERO) } : {}),
    detail: l.primeAbandonnee ? "Prime abandonnée" : "",
  }));
  const mouvements: LigneExportCpt[] = r.mouvements.map((m) => ({
    section: m.type === "REGLEMENT" ? "Règlement" : "Compensation",
    date: m.date,
    reference: m.reference,
    mouvement: nombre(m.montant),
    detail: m.detail,
  }));
  const s = r.solde;
  const total: LigneExportCpt = {
    section: "Total",
    du: nombre(s.du),
    exigible: nombre(s.exigible),
    payable: nombre(s.payable),
    paye: nombre(s.paye),
    restePayable: nombre(s.montantReglable),
    resteDu: nombre(s.resteDu),
    avance: nombre(s.avanceNette),
    aRegulariser: nombre(s.aRegulariser),
    ...(r.honoraires ? { encaissees: nombre(r.honoraires.surPrimesEncaissees), nonEncaissees: nombre(r.honoraires.surPrimesNonEncaissees) } : {}),
    mouvement: nombre(r.mouvements.reduce((t, m) => t + m.montant, ZERO)),
    detail: "Reste payable et avance du total : nets dans la nature",
  };
  return [...echeances, ...mouvements, total];
}
