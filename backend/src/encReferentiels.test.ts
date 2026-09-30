import { describe, expect, it } from "vitest";

import { choisirTauxAccessoires, jourCalendaire, montant, partagerAccessoires } from "./encCalcul";
import {
  beneficiaireHonorairesEnVigueur,
  ENC_BENEFICIAIRE_HONORAIRES_INITIAL,
  EncReferentielError,
  normaliserCodeBranche,
  normaliserNomPartenaire,
  pourcentagePartenaireVersFraction,
  verifierCleTauxControle,
} from "./encReferentiels";

describe("Branches (P1, provisoire) : normalisation du code", () => {
  it("majuscule, espaces retirés", () => {
    expect(normaliserCodeBranche(" auto ")).toBe("AUTO");
    expect(normaliserCodeBranche("Vie-Groupe")).toBe("VIE-GROUPE");
  });

  it("refuse un code vide, trop long, ou avec un caractère interdit", () => {
    expect(() => normaliserCodeBranche("")).toThrow(EncReferentielError);
    expect(() => normaliserCodeBranche("A")).toThrow(EncReferentielError);
    expect(() => normaliserCodeBranche("A".repeat(21))).toThrow(EncReferentielError);
    expect(() => normaliserCodeBranche("AUTO ASSURANCE")).toThrow(EncReferentielError);
  });
});

describe("Partenaires : normalisation du nom (clé de rapprochement)", () => {
  it("majuscules, ponctuation et espaces multiples réduits — même partenaire sous deux graphies", () => {
    expect(normaliserNomPartenaire("Wiassur")).toBe(normaliserNomPartenaire(" WIASSUR  "));
    expect(normaliserNomPartenaire("Wi-Assur S.A.")).toBe("WI ASSUR S A");
  });

  it("refuse un nom vide (même après normalisation)", () => {
    expect(() => normaliserNomPartenaire("   ")).toThrow(EncReferentielError);
    expect(() => normaliserNomPartenaire(" . , ")).toThrow(EncReferentielError);
  });
});

describe("Bénéficiaire des honoraires (CDC §3.6) : en vigueur à une date", () => {
  const novelia = { nom: "NOVELIA", dateDebut: jourCalendaire(2000, 1, 1) };
  const suivant = { nom: "AUTRE COURTIER", dateDebut: jourCalendaire(2027, 3, 1) };

  it("une seule ligne (NOVELIA posée par la migration) : toujours en vigueur pour toute date postérieure", () => {
    expect(beneficiaireHonorairesEnVigueur([novelia], jourCalendaire(2026, 9, 29))?.nom).toBe("NOVELIA");
    expect(beneficiaireHonorairesEnVigueur([novelia], jourCalendaire(2099, 1, 1))?.nom).toBe("NOVELIA");
  });

  it("un changement de bénéficiaire ne modifie pas les encaissements antérieurs (CDC §3.6)", () => {
    expect(beneficiaireHonorairesEnVigueur([novelia, suivant], jourCalendaire(2027, 2, 28))?.nom).toBe("NOVELIA");
    expect(beneficiaireHonorairesEnVigueur([novelia, suivant], jourCalendaire(2027, 3, 1))?.nom).toBe("AUTRE COURTIER");
    expect(beneficiaireHonorairesEnVigueur([novelia, suivant], jourCalendaire(2030, 1, 1))?.nom).toBe("AUTRE COURTIER");
  });

  it("aucune ligne ne précède la date : null (ne doit jamais arriver une fois la migration appliquée)", () => {
    expect(beneficiaireHonorairesEnVigueur([suivant], jourCalendaire(2000, 1, 1))).toBeNull();
    expect(beneficiaireHonorairesEnVigueur([], jourCalendaire(2026, 1, 1))).toBeNull();
  });

  it("l'ordre de la liste n'a pas d'importance (recherche du maximum, pas du premier trouvé)", () => {
    expect(beneficiaireHonorairesEnVigueur([suivant, novelia], jourCalendaire(2026, 1, 1))?.nom).toBe("NOVELIA");
  });

  it("valeur initiale posée par la migration : date choisie au 2000-01-01, NOVELIA", () => {
    expect(ENC_BENEFICIAIRE_HONORAIRES_INITIAL).toEqual({ nom: "NOVELIA", dateDebut: "2000-01-01" });
  });
});

describe("Partage des accessoires : conversion pourcentage → fraction, branchée sur le moteur (encCalcul.ts)", () => {
  it("40 % devient 0.400000, directement consommable par choisirTauxAccessoires/partagerAccessoires", () => {
    const fraction = pourcentagePartenaireVersFraction(40);
    expect(fraction).toBe("0.400000");
    const { taux, source } = choisirTauxAccessoires({ partenaire: fraction, defaut: "0" });
    expect([taux.toFixed(2), source]).toEqual(["0.40", "PARTENAIRE"]);
    const part = partagerAccessoires("100", taux);
    expect([part.partPartenaire.toFixed(2), part.partSim.toFixed(2)]).toEqual(["40.00", "60.00"]);
  });

  it("null = pas de taux propre (retombe sur le niveau suivant, jamais 0 par erreur)", () => {
    expect(pourcentagePartenaireVersFraction(null)).toBeNull();
    const { source } = choisirTauxAccessoires({ partenaire: pourcentagePartenaireVersFraction(null), defaut: "0.10" });
    expect(source).toBe("DEFAUT");
  });

  it("0 % et 100 % acceptés (bornes incluses) ; hors bornes ou non fini refusé", () => {
    expect(pourcentagePartenaireVersFraction(0)).toBe("0.000000");
    expect(pourcentagePartenaireVersFraction(100)).toBe("1.000000");
    expect(() => pourcentagePartenaireVersFraction(-0.01)).toThrow(/entre 0 et 100/);
    expect(() => pourcentagePartenaireVersFraction(100.01)).toThrow(/entre 0 et 100/);
    expect(() => pourcentagePartenaireVersFraction(Number.NaN)).toThrow(/entre 0 et 100/);
  });

  it("interopérable avec Prisma.Decimal en sortie de partagerAccessoires (même garantie que le moteur)", () => {
    const part = partagerAccessoires(montant("33.33"), pourcentagePartenaireVersFraction(50)!);
    expect(part.partPartenaire.plus(part.partSim).toFixed(2)).toBe("33.33");
  });
});

describe("Taux de contrôle (CDC §3.6, F9) : au moins un axe renseigné", () => {
  it("produit seul, partenaire seul, ou les deux : acceptés", () => {
    expect(() => verifierCleTauxControle({ produitCode: "AUTO", partenaireId: null })).not.toThrow();
    expect(() => verifierCleTauxControle({ produitCode: null, partenaireId: "p1" })).not.toThrow();
    expect(() => verifierCleTauxControle({ produitCode: "AUTO", partenaireId: "p1" })).not.toThrow();
  });

  it("aucun des deux : refusé (aucun contrôle « global » décrit par le cahier)", () => {
    expect(() => verifierCleTauxControle({ produitCode: null, partenaireId: null })).toThrow(EncReferentielError);
  });
});
