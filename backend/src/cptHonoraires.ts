import type { SyntheseContratCreanceCpt, TrancheCreanceCpt } from "./cptCreances";
import { partEncaisseeCpt, type LigneRemunerationCalculeeCpt } from "./cptRemuneration";

// Aucun import d'`enc*` ou de `treso*` (règle d'indépendance du module).

/**
 * Honoraires de gestion « sur primes encaissées » et « sur primes non encaissées » (lot GC-9c, règle C-4 et C-32). PUR.
 * La ventilation porte sur l'EXIGIBLE : un honoraire à l'émission est exigible même sur une prime non encaissée ; à
 * l'encaissement, rien n'est exigible tant que rien n'est encaissé (cas T6 bis). Le reste dû du client et l'ancienneté de sa
 * dette viennent de `cptCreances.ts` (`syntheseContratCreanceCpt`) : jamais un second calcul.
 */

const ZERO = BigInt(0);

export interface VentilationHonoraireCpt {
  surPrimesEncaissees: bigint;
  surPrimesNonEncaissees: bigint;
}

export function ventilerHonoraireCpt(
  ligne: Pick<LigneRemunerationCalculeeCpt, "du" | "exigible" | "primeDue" | "primeEncaissee">,
): VentilationHonoraireCpt {
  const partEncaissee = partEncaisseeCpt(ligne.du, { montantDu: ligne.primeDue, montantRegle: ligne.primeEncaissee });
  const surPrimesEncaissees = partEncaissee < ligne.exigible ? partEncaissee : ligne.exigible;
  return { surPrimesEncaissees, surPrimesNonEncaissees: ligne.exigible - surPrimesEncaissees };
}

export interface ContratHonoraireCpt {
  contratId: string;
  numPolice: string;
  clientNom: string;
  du: bigint;
  exigible: bigint;
  surPrimesEncaissees: bigint;
  surPrimesNonEncaissees: bigint;
  paye: bigint;
  /** Honoraires d'une prime qui ne sera jamais encaissée (annulation, résiliation). */
  aRegulariser: bigint;
  /** Part déjà versée sur des honoraires à régulariser (avance à reprendre). */
  avance: bigint;
  resteDuClient: bigint;
  resteEnRetardClient: bigint;
  /** Jours depuis la plus ancienne échéance impayée et échue (C-5) ; nul s'il n'y en a pas. */
  ancienneteClientJours: number | null;
  trancheClient: TrancheCreanceCpt | null;
}

export interface EtatHonorairesCpt {
  contrats: ContratHonoraireCpt[];
  total: Pick<ContratHonoraireCpt, "du" | "exigible" | "surPrimesEncaissees" | "surPrimesNonEncaissees" | "paye" | "aRegulariser" | "avance">;
}

/** Honoraires d'un partenaire, contrat par contrat. Les contrats à régulariser d'abord, puis les dettes clients les plus anciennes. */
export function etatHonorairesCpt(
  lignes: readonly LigneRemunerationCalculeeCpt[],
  contrats: ReadonlyMap<string, { clientNom: string; synthese: SyntheseContratCreanceCpt }>,
): EtatHonorairesCpt {
  const parContrat = new Map<string, ContratHonoraireCpt>();
  for (const l of lignes) {
    if (l.nature !== "HONORAIRES") continue;
    const info = contrats.get(l.contratId);
    if (!info) throw new Error(`Contrat ${l.contratId} sans synthèse de créance.`);
    const c = parContrat.get(l.contratId) ?? {
      contratId: l.contratId,
      numPolice: l.numPolice,
      clientNom: info.clientNom,
      du: ZERO,
      exigible: ZERO,
      surPrimesEncaissees: ZERO,
      surPrimesNonEncaissees: ZERO,
      paye: ZERO,
      aRegulariser: ZERO,
      avance: ZERO,
      resteDuClient: info.synthese.resteDu,
      resteEnRetardClient: info.synthese.resteEnRetard,
      ancienneteClientJours: info.synthese.joursAnciennete,
      trancheClient: info.synthese.tranche,
    };
    const v = ventilerHonoraireCpt(l);
    c.du += l.du;
    c.exigible += l.exigible;
    c.surPrimesEncaissees += v.surPrimesEncaissees;
    c.surPrimesNonEncaissees += v.surPrimesNonEncaissees;
    c.paye += l.paye;
    c.aRegulariser += l.aRegulariser;
    c.avance += l.avance;
    parContrat.set(l.contratId, c);
  }
  const liste = [...parContrat.values()].sort(
    (a, b) =>
      Number(b.aRegulariser > ZERO) - Number(a.aRegulariser > ZERO) ||
      (b.ancienneteClientJours ?? -1) - (a.ancienneteClientJours ?? -1) ||
      a.numPolice.localeCompare(b.numPolice),
  );
  const total = liste.reduce<EtatHonorairesCpt["total"]>(
    (t, c) => ({
      du: t.du + c.du,
      exigible: t.exigible + c.exigible,
      surPrimesEncaissees: t.surPrimesEncaissees + c.surPrimesEncaissees,
      surPrimesNonEncaissees: t.surPrimesNonEncaissees + c.surPrimesNonEncaissees,
      paye: t.paye + c.paye,
      aRegulariser: t.aRegulariser + c.aRegulariser,
      avance: t.avance + c.avance,
    }),
    { du: ZERO, exigible: ZERO, surPrimesEncaissees: ZERO, surPrimesNonEncaissees: ZERO, paye: ZERO, aRegulariser: ZERO, avance: ZERO },
  );
  return { contrats: liste, total };
}
