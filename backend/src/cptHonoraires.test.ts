import { describe, expect, it } from "vitest";

import { syntheseContratCreanceCpt } from "./cptCreances";
import { etatHonorairesCpt, ventilerHonoraireCpt } from "./cptHonoraires";
import { lignesContratCpt, type ContratRemunerationCpt, type ConventionRemunerationCpt, type LigneRemunerationCalculeeCpt } from "./cptRemuneration";

const F = (fcfa: number) => BigInt(fcfa) * BigInt(100);
const AUJOURDHUI = "2026-11-26";

// T6 bis : NOVELIA gère deux contrats santé de 100 000 FCFA, honoraires 8 %. L'un est apporté par SIM (exigible à l'émission),
// l'autre par NOVELIA elle-même (exigible à l'encaissement, C-4).
const conventions: ConventionRemunerationCpt[] = [
  { id: "emission", partenaireId: "novelia", beneficiaireId: null, produitCode: null, apporteurId: null, nature: "HONORAIRES", taux: "0.080000", base: "TTC", faitGenerateur: "EMISSION", modeReglement: "EN_UNE_FOIS", dateEffet: "2020-01-01", dateFin: null },
  { id: "encaissement", partenaireId: "novelia", beneficiaireId: null, produitCode: null, apporteurId: "novelia", nature: "HONORAIRES", taux: "0.080000", base: "TTC", faitGenerateur: "ENCAISSEMENT", modeReglement: "EN_UNE_FOIS", dateEffet: "2020-01-01", dateFin: null },
];

function contrat(id: string, apporteurId: string | null, regle: number, statut = "EN_COURS"): ContratRemunerationCpt {
  const etat = statut === "ANNULE" ? "ANNULEE" : regle >= 100000 ? "SOLDEE" : "OUVERTE";
  return {
    id,
    numPolice: `POL-${id}`,
    statut,
    produitCode: "SANTE",
    apporteurId,
    dateEffet: "2026-01-01",
    echeances: [{ id: `${id}-e1`, rang: 1, datePrevue: "2026-07-01", etat, primeHt: F(100000), accessoires: BigInt(0), primeTtc: F(100000), montantDu: F(100000), montantRegle: F(regle) }],
  };
}

function etat(contrats: ContratRemunerationCpt[]) {
  const lignes: LigneRemunerationCalculeeCpt[] = contrats.flatMap((c) => lignesContratCpt({ contrat: c, conventions }).lignes);
  const infos = new Map(
    contrats.map((c) => [
      c.id,
      {
        clientNom: `Client ${c.id}`,
        synthese: syntheseContratCreanceCpt(
          { statut: c.statut, declarePaye: false, echeances: c.echeances.map((e) => ({ rang: e.rang, etat: e.etat, datePrevue: e.datePrevue, montantDu: Number(e.montantDu) / 100, montantRegle: Number(e.montantRegle) / 100 })) },
          AUJOURDHUI,
        ),
      },
    ]),
  );
  return etatHonorairesCpt(lignes, infos);
}
const du = (e: ReturnType<typeof etat>, id: string) => e.contrats.find((c) => c.contratId === id)!;

describe("GC-9c — T6 bis : deux contrats santé gérés par NOVELIA", () => {
  it("non encaissés : honoraires exigibles sur le contrat SIM (colonne « non encaissées »), rien sur le contrat NOVELIA", () => {
    const e = etat([contrat("SIM", null, 0), contrat("NOV", "novelia", 0)]);
    expect(du(e, "SIM")).toMatchObject({ du: F(8000), exigible: F(8000), surPrimesEncaissees: BigInt(0), surPrimesNonEncaissees: F(8000) });
    expect(du(e, "NOV")).toMatchObject({ du: F(8000), exigible: BigInt(0), surPrimesEncaissees: BigInt(0), surPrimesNonEncaissees: BigInt(0) });
    expect(e.total).toMatchObject({ exigible: F(8000), surPrimesNonEncaissees: F(8000) });
    // Reste dû et ancienneté du client, lus dans le calcul des créances.
    expect(du(e, "SIM")).toMatchObject({ resteDuClient: F(100000), ancienneteClientJours: 148, trancheClient: "T91_180" });
  });

  it("bascule à l'encaissement : tout passe « sur primes encaissées », le contrat NOVELIA devient exigible", () => {
    const e = etat([contrat("SIM", null, 100000), contrat("NOV", "novelia", 100000)]);
    for (const id of ["SIM", "NOV"]) {
      expect(du(e, id)).toMatchObject({ exigible: F(8000), surPrimesEncaissees: F(8000), surPrimesNonEncaissees: BigInt(0), resteDuClient: BigInt(0), ancienneteClientJours: null });
    }
  });

  it("encaissement partiel : le contrat SIM se partage entre les deux colonnes, le contrat NOVELIA n'a que la part encaissée", () => {
    const e = etat([contrat("SIM", null, 25000), contrat("NOV", "novelia", 25000)]);
    expect(du(e, "SIM")).toMatchObject({ exigible: F(8000), surPrimesEncaissees: F(2000), surPrimesNonEncaissees: F(6000) });
    expect(du(e, "NOV")).toMatchObject({ exigible: F(2000), surPrimesEncaissees: F(2000), surPrimesNonEncaissees: BigInt(0) });
  });

  it("prime jamais encaissée (contrat annulé) : honoraires signalés « à régulariser », en tête de liste", () => {
    const e = etat([contrat("NOV", "novelia", 0), contrat("ANN", null, 0, "ANNULE")]);
    expect(e.contrats[0]).toMatchObject({ contratId: "ANN", du: BigInt(0), exigible: BigInt(0), aRegulariser: F(8000), resteDuClient: BigInt(0) });
    expect(e.total.aRegulariser).toBe(F(8000));
  });

  it("la ventilation ne dépasse jamais l'exigible", () => {
    expect(ventilerHonoraireCpt({ du: F(1000), exigible: F(200), primeDue: F(100), primeEncaissee: F(100) })).toEqual({ surPrimesEncaissees: F(200), surPrimesNonEncaissees: BigInt(0) });
  });
});
