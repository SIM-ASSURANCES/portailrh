import { dateValideEcheancier, texteDepuisCentimes } from "./cptEcheancier";
import type { ColonneExportCpt, LigneExportCpt } from "./cptExportCsv";
import { ventilerHonoraireCpt } from "./cptHonoraires";
import { LIBELLE_NATURE_REMUNERATION_CPT, type NatureRemunerationCpt } from "./cptReferentiels";
import { LIBELLE_MODE_PAIEMENT_PARTENAIRE_CPT, type ModePaiementPartenaireCpt } from "./cptReglementPartenaire";
import { soldeNatureCpt, trierLignesRemunerationCpt, type LigneRemunerationCalculeeCpt, type SoldeNatureCpt } from "./cptRemuneration";

// Aucun import d'`enc*` ou de `treso*` (règle d'indépendance du module).

/**
 * Relevé d'un partenaire pour UNE nature (lot GC-9g). PUR : l'écran, l'export CSV / Excel et le PDF lisent ce même objet, jamais
 * un second calcul. Les mouvements (règlements, compensations signées — négative quand la nature est la source — et leurs
 * annulations, chacun à sa date) expliquent le payé : sur tout l'historique, leur somme est égale au payé du solde.
 *
 * Période (Q24, C-40) : le relevé montre les échéances PRÉVUES et les mouvements DATÉS entre `du` et `au`. Son solde est le reste dû :
 * solde d'ouverture (dû des échéances prévues avant `du` − mouvements datés avant `du`) + dû des échéances de la période
 * − versements de la période = solde de clôture. Le dû est celui d'aujourd'hui (une prime abandonnée depuis réduit son échéance).
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
  annulation: AnnulationReleveCpt | null;
}

export interface AnnulationReleveCpt {
  date: string;
  creeAt: string;
  motif: string;
}

export interface CompensationReleveCpt {
  date: string;
  natureSource: NatureRemunerationCpt;
  natureCible: NatureRemunerationCpt;
  montant: bigint;
  motif: string;
  creeAt: string;
  annulation: AnnulationReleveCpt | null;
}

export interface LigneReleveCpt extends LigneRemunerationCalculeeCpt {
  clientNom: string;
  /** Ventilation des honoraires (nuls pour les autres natures). */
  surPrimesEncaissees: bigint | null;
  surPrimesNonEncaissees: bigint | null;
}

export interface MouvementReleveCpt {
  type: "REGLEMENT" | "COMPENSATION" | "ANNULATION";
  date: string;
  creeAt: string;
  /** Numéro CPR d'un règlement ; vide pour une compensation. */
  reference: string;
  detail: string;
  /** Effet sur le payé de la nature, signé. */
  montant: bigint;
}

export const LIBELLE_MOUVEMENT_RELEVE_CPT: Record<MouvementReleveCpt["type"], string> = {
  REGLEMENT: "Règlement",
  COMPENSATION: "Compensation",
  ANNULATION: "Annulation",
};

/** Intitulé court d'un mouvement : le numéro d'un règlement (et de son annulation), sinon le type. */
export function titreMouvementReleveCpt(m: Pick<MouvementReleveCpt, "type" | "reference">): string {
  if (!m.reference) return LIBELLE_MOUVEMENT_RELEVE_CPT[m.type];
  return m.type === "ANNULATION" ? `Annulation ${m.reference}` : m.reference;
}

/** `null` de chaque côté = tout l'historique. */
export interface PeriodeReleveCpt {
  du: string | null;
  au: string | null;
}

export const TOUT_HISTORIQUE_CPT: PeriodeReleveCpt = { du: null, au: null };

/** Trimestre civil qui contient ce jour. */
export function trimestreCivilCpt(jour: string): { du: string; au: string } {
  const annee = jour.slice(0, 4);
  const trimestre = Math.floor((Number(jour.slice(5, 7)) - 1) / 3);
  const [debut, fin] = [
    ["01-01", "03-31"],
    ["04-01", "06-30"],
    ["07-01", "09-30"],
    ["10-01", "12-31"],
  ][trimestre];
  return { du: `${annee}-${debut}`, au: `${annee}-${fin}` };
}

/**
 * Période demandée (adresse de l'écran et des exports). « periode=tout » : tout l'historique. Deux dates valides et ordonnées : elles.
 * Une seule : complétée par le trimestre de cette date. Rien ou saisie incohérente : le trimestre civil en cours.
 */
export function lirePeriodeReleveCpt(recherche: { du?: unknown; au?: unknown; periode?: unknown }, aujourdhui: string): PeriodeReleveCpt {
  if (recherche.periode === "tout") return TOUT_HISTORIQUE_CPT;
  const lire = (v: unknown) => (typeof v === "string" && dateValideEcheancier(v) ? v : null);
  const du = lire(recherche.du);
  const au = lire(recherche.au);
  if (du && au) return du <= au ? { du, au } : trimestreCivilCpt(aujourdhui);
  if (du) return { du, au: trimestreCivilCpt(du).au };
  if (au) return { du: trimestreCivilCpt(au).du, au };
  return trimestreCivilCpt(aujourdhui);
}

/** Paramètres d'adresse qui redonnent la même période (écran et exports). */
export function requetePeriodeReleveCpt(p: PeriodeReleveCpt): string {
  return p.du && p.au ? `du=${p.du}&au=${p.au}` : "periode=tout";
}

const jourFr = (iso: string) => iso.split("-").reverse().join("/");

export function libellePeriodeReleveCpt(p: PeriodeReleveCpt): string {
  return p.du && p.au ? `Du ${jourFr(p.du)} au ${jourFr(p.au)}` : "Tout l'historique";
}

export interface SoldePeriodeCpt {
  ouverture: bigint;
  /** Dû des échéances prévues dans la période. */
  duPeriode: bigint;
  /** Somme signée des mouvements de la période (règlements, compensations, annulations). */
  versementsPeriode: bigint;
  cloture: bigint;
}

export interface ReleveRemunerationCpt {
  nature: NatureRemunerationCpt;
  periode: PeriodeReleveCpt;
  soldePeriode: SoldePeriodeCpt;
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
  periode?: PeriodeReleveCpt;
}): ReleveRemunerationCpt {
  const { nature } = entree;
  const periode = entree.periode ?? TOUT_HISTORIQUE_CPT;
  const avant = (date: string) => periode.du !== null && date < periode.du;
  const dedans = (date: string) => !avant(date) && (periode.au === null || date <= periode.au);
  const lignes: LigneReleveCpt[] = trierLignesRemunerationCpt(entree.lignes.filter((l) => l.nature === nature)).map((l) => {
    const v = nature === "HONORAIRES" ? ventilerHonoraireCpt(l) : null;
    return { ...l, clientNom: entree.clients.get(l.contratId)?.clientNom ?? "", surPrimesEncaissees: v?.surPrimesEncaissees ?? null, surPrimesNonEncaissees: v?.surPrimesNonEncaissees ?? null };
  });
  const operations: { mouvement: MouvementReleveCpt; annulation: AnnulationReleveCpt | null; nom: string }[] = [
    ...entree.reglements.map((r) => ({
      mouvement: {
        type: "REGLEMENT" as const,
        date: r.date,
        creeAt: r.creeAt,
        reference: r.reference,
        detail: `${LIBELLE_MODE_PAIEMENT_PARTENAIRE_CPT[r.mode]} ${r.referenceReglement}${r.montantAvance > ZERO ? ` (dont avance ${fcfa(r.montantAvance)})` : ""}`,
        montant: r.montant,
      },
      annulation: r.annulation,
      nom: `du règlement ${r.reference}`,
    })),
    ...entree.compensations
      .filter((c) => c.natureSource === nature || c.natureCible === nature)
      .map((c) => ({
        mouvement: {
          type: "COMPENSATION" as const,
          date: c.date,
          creeAt: c.creeAt,
          reference: "",
          detail:
            c.natureSource === nature
              ? `Avance reprise vers ${LIBELLE_NATURE_REMUNERATION_CPT[c.natureCible].toLowerCase()} — ${c.motif}`
              : `Imputation d'une avance de ${LIBELLE_NATURE_REMUNERATION_CPT[c.natureSource].toLowerCase()} — ${c.motif}`,
          montant: c.natureSource === nature ? -c.montant : c.montant,
        },
        annulation: c.annulation,
        nom: `de la compensation du ${c.date.slice(8, 10)}/${c.date.slice(5, 7)}/${c.date.slice(0, 4)}`,
      })),
  ];
  const mouvements: MouvementReleveCpt[] = operations
    .flatMap(({ mouvement, annulation, nom }) =>
      annulation
        ? [
            mouvement,
            {
              type: "ANNULATION" as const,
              date: annulation.date,
              creeAt: annulation.creeAt,
              reference: mouvement.reference,
              detail: `Annulation ${nom} — ${annulation.motif}`,
              montant: -mouvement.montant,
            },
          ]
        : [mouvement],
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.creeAt.localeCompare(b.creeAt));
  const honoraires =
    nature === "HONORAIRES"
      ? {
          surPrimesEncaissees: lignes.reduce((s, l) => s + (l.surPrimesEncaissees ?? ZERO), ZERO),
          surPrimesNonEncaissees: lignes.reduce((s, l) => s + (l.surPrimesNonEncaissees ?? ZERO), ZERO),
        }
      : null;
  const somme = <T,>(elements: readonly T[], montant: (e: T) => bigint) => elements.reduce((s, e) => s + montant(e), ZERO);
  const ouverture = somme(lignes.filter((l) => avant(l.datePrevue)), (l) => l.du) - somme(mouvements.filter((m) => avant(m.date)), (m) => m.montant);
  const lignesPeriode = lignes.filter((l) => dedans(l.datePrevue));
  const mouvementsPeriode = mouvements.filter((m) => dedans(m.date));
  const duPeriode = somme(lignesPeriode, (l) => l.du);
  const versementsPeriode = somme(mouvementsPeriode, (m) => m.montant);
  return {
    nature,
    periode,
    soldePeriode: { ouverture, duPeriode, versementsPeriode, cloture: ouverture + duPeriode - versementsPeriode },
    libelleNature: LIBELLE_NATURE_REMUNERATION_CPT[nature],
    lignes: lignesPeriode,
    mouvements: mouvementsPeriode,
    // Situation à ce jour : calculée sur toutes les lignes, quelle que soit la période.
    solde: soldeNatureCpt(nature, lignes),
    honoraires,
  };
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
    { cle: "solde", titre: "Solde (FCFA)", type: "montant" },
    { cle: "detail", titre: "Détail", type: "texte", largeur: 60 },
  ];
}

const nombre = (c: bigint) => Number(texteDepuisCentimes(c));

/** Solde d'ouverture, échéances et mouvements de la période, totaux de la période, solde de clôture. */
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
    section: LIBELLE_MOUVEMENT_RELEVE_CPT[m.type],
    date: m.date,
    reference: m.reference,
    mouvement: nombre(m.montant),
    detail: m.detail,
  }));
  const somme = (montant: (l: LigneReleveCpt) => bigint) => nombre(r.lignes.reduce((t, l) => t + montant(l), ZERO));
  const total: LigneExportCpt = {
    section: "Total de la période",
    du: somme((l) => l.du),
    exigible: somme((l) => l.exigible),
    payable: somme((l) => l.payable),
    paye: somme((l) => l.paye),
    restePayable: somme((l) => l.restePayable),
    resteDu: somme((l) => l.resteDu),
    avance: somme((l) => l.avance),
    aRegulariser: somme((l) => l.aRegulariser),
    ...(r.honoraires ? { encaissees: somme((l) => l.surPrimesEncaissees ?? ZERO), nonEncaissees: somme((l) => l.surPrimesNonEncaissees ?? ZERO) } : {}),
    mouvement: nombre(r.soldePeriode.versementsPeriode),
    detail: "Montants des échéances de la période ; mouvement : versements de la période",
  };
  const ouverture: LigneExportCpt = { section: "Solde d'ouverture", date: r.periode.du, solde: nombre(r.soldePeriode.ouverture), detail: libellePeriodeReleveCpt(r.periode) };
  const cloture: LigneExportCpt = {
    section: "Solde de clôture",
    date: r.periode.au,
    solde: nombre(r.soldePeriode.cloture),
    detail: "Solde d'ouverture + dû des échéances de la période − versements de la période",
  };
  return [ouverture, ...echeances, ...mouvements, total, cloture];
}
