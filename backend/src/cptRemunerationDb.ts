import type { Prisma, PrismaClient } from "./generated/prisma/client";
import { debiteurDuContratCpt, syntheseContratCreanceCpt, type SyntheseContratCreanceCpt } from "./cptCreances";
import { enCentimesEcheancier } from "./cptEcheancier";
import type { BaseConventionCpt, FaitGenerateurCpt, ModeReglementCpt, NatureRemunerationCpt } from "./cptReferentiels";
import { etatHonorairesCpt, type EtatHonorairesCpt } from "./cptHonoraires";
import {
  beneficiaireConventionCpt,
  lignesContratCpt,
  soldesParNatureCpt,
  trierLignesRemunerationCpt,
  type ConflitConventionCpt,
  type ContratRemunerationCpt,
  type ConventionRemunerationCpt,
  type DecisionModeCpt,
  type LigneEnregistreeCpt,
  type LigneRemunerationCalculeeCpt,
  type SoldeNatureCpt,
} from "./cptRemuneration";

// Aucun import d'`enc*` ou de `treso*` (règle d'indépendance du module).

/**
 * Chargement de la rémunération d'un partenaire (lot GC-9c) : LECTURE SEULE. Les lignes viennent du moteur `cptRemuneration.ts`
 * (conventions par `conventionEnVigueurCpt`), l'encaissé de `montantRegle` (rattachements VALIDÉS, RG-01), le reste dû et
 * l'ancienneté du client de `cptCreances.ts`. Calcul en mémoire sur les contrats concernés par les conventions du partenaire
 * (même limite que l'état des créances, C-20).
 */
export type RemunerationDbCpt = Pick<
  PrismaClient,
  "cptPartenaire" | "cptConvention" | "cptContrat" | "cptLigneRemuneration" | "cptDecisionModeRemuneration"
>;

const ZERO = BigInt(0);
/** Decimal SIGNÉ → centimes : une reprise de compensation est négative, elle ne doit jamais être lue comme zéro. */
export function centimesSignesRemunerationCpt(d: { toFixed(n: number): string } | null | undefined): bigint {
  if (!d) return ZERO;
  const t = d.toFixed(2);
  const negatif = t.startsWith("-");
  const c = enCentimesEcheancier(negatif ? t.slice(1) : t);
  if (c === null) throw new Error(`Montant illisible en base : ${t}.`);
  return negatif ? -c : c;
}
const jour = (d: Date) => d.toISOString().slice(0, 10);

const SELECT_CONTRAT = {
  id: true,
  numPolice: true,
  statut: true,
  declarePaye: true,
  dateEffet: true,
  partenaireApporteurId: true,
  produit: { select: { code: true } },
  client: { select: { id: true, nom: true } },
  partenaireApporteur: { select: { id: true, nom: true, estClient: true } },
  echeances: { select: { id: true, rang: true, datePrevue: true, etat: true, primeHt: true, accessoires: true, primeTtc: true, montantDu: true, montantRegle: true } },
} satisfies Prisma.CptContratSelect;

type ContratLu = Prisma.CptContratGetPayload<{ select: typeof SELECT_CONTRAT }>;

function versContratRemuneration(c: ContratLu): ContratRemunerationCpt {
  return {
    id: c.id,
    numPolice: c.numPolice,
    statut: c.statut,
    produitCode: c.produit.code,
    apporteurId: c.partenaireApporteurId,
    dateEffet: jour(c.dateEffet),
    echeances: c.echeances.map((e) => ({
      id: e.id,
      rang: e.rang,
      datePrevue: jour(e.datePrevue),
      etat: e.etat,
      primeHt: centimesSignesRemunerationCpt(e.primeHt),
      accessoires: centimesSignesRemunerationCpt(e.accessoires),
      primeTtc: centimesSignesRemunerationCpt(e.primeTtc),
      montantDu: centimesSignesRemunerationCpt(e.montantDu),
      montantRegle: centimesSignesRemunerationCpt(e.montantRegle),
    })),
  };
}

function syntheseDe(c: ContratLu, aujourdhui: string): SyntheseContratCreanceCpt {
  return syntheseContratCreanceCpt(
    {
      statut: c.statut,
      declarePaye: c.declarePaye,
      echeances: c.echeances.map((e) => ({ rang: e.rang, etat: e.etat, datePrevue: jour(e.datePrevue), montantDu: e.montantDu.toString(), montantRegle: e.montantRegle.toString() })),
    },
    aujourdhui,
  );
}

/** Conventions de tout partenaire dont au moins une convention désigne ce bénéficiaire (la sélection doit voir toutes les siennes). */
async function conventionsDuBeneficiaire(db: RemunerationDbCpt, partenaireId: string, conventionsFigees: readonly string[]): Promise<ConventionRemunerationCpt[]> {
  const pointent = await db.cptConvention.findMany({
    where: { OR: [{ beneficiaireId: partenaireId }, { beneficiaireId: null, partenaireId }, { id: { in: [...conventionsFigees] } }] },
    select: { partenaireId: true },
  });
  const partenaires = [...new Set(pointent.map((c) => c.partenaireId))];
  const lues = await db.cptConvention.findMany({ where: { partenaireId: { in: partenaires } }, include: { produit: { select: { code: true } } } });
  return lues.map((c) => ({
    id: c.id,
    partenaireId: c.partenaireId,
    produitCode: c.produitCode,
    nature: c.nature as NatureRemunerationCpt,
    apporteurId: c.apporteurId,
    beneficiaireId: c.beneficiaireId,
    taux: c.taux.toFixed(6),
    base: c.base as BaseConventionCpt,
    faitGenerateur: c.faitGenerateur as FaitGenerateurCpt,
    modeReglement: c.modeReglement as ModeReglementCpt,
    dateEffet: jour(c.dateEffet),
    dateFin: c.dateFin ? jour(c.dateFin) : null,
  }));
}

/** Filtre des contrats qu'une convention désignant ce bénéficiaire peut concerner (le moteur tranche ensuite). */
function filtreContratsConcernes(conventions: readonly ConventionRemunerationCpt[], partenaireId: string): Prisma.CptContratWhereInput[] {
  const filtres = new Map<string, Prisma.CptContratWhereInput>();
  for (const c of conventions) {
    if (beneficiaireConventionCpt(c) !== partenaireId) continue;
    const apporteur = c.apporteurId ?? (c.nature === "HONORAIRES" ? null : c.partenaireId);
    const where: Prisma.CptContratWhereInput = {
      ...(c.produitCode ? { produit: { code: c.produitCode } } : {}),
      ...(apporteur ? { partenaireApporteurId: apporteur } : {}),
    };
    filtres.set(`${c.produitCode ?? "*"}|${apporteur ?? "*"}`, where);
  }
  return [...filtres.values()];
}

export async function chargerLignesEnregistreesCpt(db: RemunerationDbCpt, partenaireId: string): Promise<LigneEnregistreeCpt[]> {
  const lignes = await db.cptLigneRemuneration.findMany({
    where: { partenaireBeneficiaireId: partenaireId },
    select: {
      id: true,
      contratId: true,
      echeanceId: true,
      nature: true,
      conventionId: true,
      du: true,
      affectationsReglement: { select: { montant: true, reglement: { select: { modeDerogation: true } } } },
      affectationsCompensation: { select: { montant: true } },
    },
  });
  return lignes.map((l) => {
    let paye = ZERO;
    let payeEnUneFois = ZERO;
    for (const a of l.affectationsReglement) {
      const m = centimesSignesRemunerationCpt(a.montant);
      paye += m;
      if (a.reglement.modeDerogation === "EN_UNE_FOIS") payeEnUneFois += m;
    }
    for (const a of l.affectationsCompensation) paye += centimesSignesRemunerationCpt(a.montant);
    return {
      id: l.id,
      contratId: l.contratId,
      echeanceId: l.echeanceId,
      beneficiaireId: partenaireId,
      nature: l.nature as NatureRemunerationCpt,
      conventionId: l.conventionId,
      du: centimesSignesRemunerationCpt(l.du),
      paye,
      // Une reprise (compensation) ne laisse pas « en une fois » ce qui n'est plus payé.
      payeEnUneFois: payeEnUneFois < paye ? payeEnUneFois : paye,
    };
  });
}

export interface ContratRemunereInfoCpt {
  numPolice: string;
  clientNom: string;
  synthese: SyntheseContratCreanceCpt;
}

/** Quatrième solde : ce que le partenaire DOIT quand il paie pour ses clients (C-20), jamais compensé avec sa rémunération. */
export interface CreancePartenaireCpt {
  estClient: boolean;
  resteDu: bigint;
  resteEchu: bigint;
  resteEnRetard: bigint;
  depuisLe: string | null;
  joursAnciennete: number | null;
  nbContrats: number;
}

export interface RemunerationPartenaireCpt {
  partenaire: { id: string; nom: string; estClient: boolean; estGestionnaire: boolean };
  lignes: LigneRemunerationCalculeeCpt[];
  conflits: ConflitConventionCpt[];
  soldes: Record<NatureRemunerationCpt, SoldeNatureCpt>;
  creance: CreancePartenaireCpt;
  honoraires: EtatHonorairesCpt;
  contrats: Map<string, ContratRemunereInfoCpt>;
}

async function chargerCreancePartenaire(db: RemunerationDbCpt, partenaire: { id: string; estClient: boolean }, aujourdhui: string): Promise<CreancePartenaireCpt> {
  const vide: CreancePartenaireCpt = { estClient: partenaire.estClient, resteDu: ZERO, resteEchu: ZERO, resteEnRetard: ZERO, depuisLe: null, joursAnciennete: null, nbContrats: 0 };
  if (!partenaire.estClient) return vide;
  const contrats = await db.cptContrat.findMany({ where: { partenaireApporteurId: partenaire.id, statut: { not: "ANNULE" } }, select: SELECT_CONTRAT });
  return contrats.reduce((total, c) => {
    if (debiteurDuContratCpt({ client: c.client, apporteur: c.partenaireApporteur }).type !== "PARTENAIRE") return total;
    const s = syntheseDe(c, aujourdhui);
    if (s.resteDu === ZERO) return total;
    const plusAncien = s.depuisLe !== null && (total.depuisLe === null || s.depuisLe < total.depuisLe);
    return {
      ...total,
      resteDu: total.resteDu + s.resteDu,
      resteEchu: total.resteEchu + s.resteEchu,
      resteEnRetard: total.resteEnRetard + s.resteEnRetard,
      depuisLe: plusAncien ? s.depuisLe : total.depuisLe,
      joursAnciennete: plusAncien ? s.joursAnciennete : total.joursAnciennete,
      nbContrats: total.nbContrats + 1,
    };
  }, vide);
}

/** `null` si le partenaire n'existe pas. */
export async function chargerRemunerationPartenaireCpt(db: RemunerationDbCpt, partenaireId: string, aujourdhui: string): Promise<RemunerationPartenaireCpt | null> {
  const partenaire = await db.cptPartenaire.findUnique({ where: { id: partenaireId }, select: { id: true, nom: true, estClient: true, estGestionnaire: true } });
  if (!partenaire) return null;
  const enregistrees = await chargerLignesEnregistreesCpt(db, partenaireId);
  const [conventions, decisionsLues, creance] = await Promise.all([
    conventionsDuBeneficiaire(db, partenaireId, enregistrees.map((l) => l.conventionId)),
    db.cptDecisionModeRemuneration.findMany({ where: { partenaireId }, select: { contratId: true, partenaireId: true, nature: true, mode: true, creeAt: true } }),
    chargerCreancePartenaire(db, partenaire, aujourdhui),
  ]);
  const decisions: DecisionModeCpt[] = decisionsLues.map((d) => ({
    contratId: d.contratId,
    beneficiaireId: d.partenaireId,
    nature: d.nature as NatureRemunerationCpt,
    mode: d.mode as ModeReglementCpt,
    decideAt: d.creeAt.toISOString(),
  }));

  const filtres: Prisma.CptContratWhereInput[] = filtreContratsConcernes(conventions, partenaireId);
  const figes = [...new Set(enregistrees.map((l) => l.contratId))];
  if (figes.length > 0) filtres.push({ id: { in: figes } });
  const contratsLus = filtres.length > 0 ? await db.cptContrat.findMany({ where: { OR: filtres }, select: SELECT_CONTRAT }) : [];

  const lignes: LigneRemunerationCalculeeCpt[] = [];
  const conflits: ConflitConventionCpt[] = [];
  const contrats = new Map<string, ContratRemunereInfoCpt>();
  for (const c of contratsLus) {
    const r = lignesContratCpt({ contrat: versContratRemuneration(c), conventions, enregistrees, decisions });
    const siennes = r.lignes.filter((l) => l.beneficiaireId === partenaireId);
    conflits.push(...r.conflits.filter((x) => x.beneficiaireId === partenaireId));
    if (siennes.length === 0) continue;
    lignes.push(...siennes);
    contrats.set(c.id, { numPolice: c.numPolice, clientNom: c.client.nom, synthese: syntheseDe(c, aujourdhui) });
  }
  const triees = trierLignesRemunerationCpt(lignes);
  return {
    partenaire,
    lignes: triees,
    conflits: conflits.sort((a, b) => a.numPolice.localeCompare(b.numPolice)),
    soldes: soldesParNatureCpt(triees),
    creance,
    honoraires: etatHonorairesCpt(triees, contrats),
    contrats,
  };
}
