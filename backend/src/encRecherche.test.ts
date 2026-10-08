import { describe, expect, it } from "vitest";

import {
  decouperRecherche,
  echapperLike,
  normaliserTexteRecherche,
  RECHERCHE_MOTS_MAX,
  motsIndexes,
  ressembleIdentifiant,
} from "./encRecherche";

describe("normaliserTexteRecherche — option C (2026-10-02)", () => {
  it("minuscules, accents français retirés", () => {
    expect(normaliserTexteRecherche("Kouamé Éloïse ÇA Où Âge Île")).toBe("kouame eloise ca ou age ile");
  });

  it("apostrophes (droite et typographique) et tirets ignorés", () => {
    expect(normaliserTexteRecherche("N'Guessan")).toBe("nguessan");
    expect(normaliserTexteRecherche("N’Guessan")).toBe("nguessan");
    expect(normaliserTexteRecherche("TEST-0004")).toBe("test0004");
  });
});

describe("decouperRecherche", () => {
  it("plusieurs mots, espaces multiples, doublons retirés", () => {
    expect(decouperRecherche("  Kouamé   AUTO kouame ")).toEqual(["kouame", "auto"]);
  });

  it("saisie vide ou blanche : aucun mot", () => {
    expect(decouperRecherche("   ")).toEqual([]);
    expect(decouperRecherche("' - '")).toEqual([]);
  });

  it(`au plus ${RECHERCHE_MOTS_MAX} mots`, () => {
    expect(decouperRecherche("a b c d e f g h")).toHaveLength(RECHERCHE_MOTS_MAX);
  });
});

describe("echapperLike", () => {
  it("les jokers saisis sont cherchés tels quels", () => {
    expect(echapperLike("50%_a\\b")).toBe("50\\%\\_a\\\\b");
  });
});

describe("ressembleIdentifiant — chemin rapide (index)", () => {
  it("n° de police et références de paiement", () => {
    for (const s of ["TEST-0001", "pol/2026/00042", "T_ABCDEF1234567", " CHQ-1001 ", "wave-778899"]) {
      expect(ressembleIdentifiant(s)).toBe(true);
    }
  });

  it("noms, plusieurs mots, saisies trop courtes ou sans chiffre : balayage complet", () => {
    for (const s of ["nguessan", "N'Guessan", "kouame 4999", "A1", "automobile", ""]) {
      expect(ressembleIdentifiant(s)).toBe(false);
    }
  });
});

describe("motsIndexes — index de recherche (5a-bis)", () => {
  it("mot normalisé et ses parties", () => {
    expect(motsIndexes(["N'Guessan Kouamé", "POL-0031337", "pol/2026/00042"]).sort()).toEqual(
      ["0031337", "00042", "2026", "guessan", "kouame", "n", "nguessan", "pol", "pol/2026/00042", "pol0031337"].sort()
    );
  });

  it("textes vides ignorés, aucun doublon", () => {
    expect(motsIndexes([null, undefined, "", "  Auto  auto "])).toEqual(["auto"]);
  });
});
