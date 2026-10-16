// B1 (consignes du 2026-10-16, art. 12 du règlement) : le congé annuel s'ouvre après 12 mois de service.
// Le contrôle `verifierAnciennete` (référence = date de début du congé) s'applique tel quel au type.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { verifierAnciennete } from "./congesCalcul";
import { TYPES_CONGE_DEFAUT } from "./congesDefauts";

const annuel = TYPES_CONGE_DEFAUT.find((t) => t.code === "ANNUEL")!;

describe("Congé annuel : 12 mois de service (art. 12)", () => {
  it("le type ANNUEL exige 12 mois d'ancienneté", () => {
    expect(annuel.ancienneteMinimumMois).toBe(12);
  });

  it("un salarié à 11 mois et 30 jours est refusé", () => {
    // Embauché le 2025-10-17 : au 2026-10-16, il lui manque un jour pour 12 mois révolus.
    const r = verifierAnciennete({ dateEmbauche: "2025-10-17", moisRequis: annuel.ancienneteMinimumMois, reference: "2026-10-16" });
    expect(r.eligible).toBe(false);
    if (!r.eligible) expect(r.moisAnciennete).toBe(11);
  });

  it("le même salarié, à 12 mois révolus, est accepté", () => {
    const r = verifierAnciennete({ dateEmbauche: "2025-10-17", moisRequis: annuel.ancienneteMinimumMois, reference: "2026-10-17" });
    expect(r.eligible).toBe(true);
  });

  it("la référence est la date de DÉBUT du congé : demandé avant, posé après 12 mois", () => {
    expect(verifierAnciennete({ dateEmbauche: "2025-12-01", moisRequis: 12, reference: "2026-11-30" }).eligible).toBe(false);
    expect(verifierAnciennete({ dateEmbauche: "2025-12-01", moisRequis: 12, reference: "2026-12-01" }).eligible).toBe(true);
  });

  it("la migration insère le type ANNUEL avec la même ancienneté que la source unique", () => {
    const sql = readFileSync(path.resolve(__dirname, "../prisma/migrations/20261021090000_conges_permissions_absence/migration.sql"), "utf8");
    const ligne = sql.split("\n").find((l) => l.includes("('ANNUEL'"));
    expect(ligne).toBeDefined();
    expect(ligne!.trim()).toMatch(/, 12\),?$/);
  });
});
