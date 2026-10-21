import path from "node:path";
import { describe, expect, it } from "vitest";

import { analyserArguments, confirmationValide, problemesAvantPurge } from "./reinitialisationCli";

const OK = { verrouActif: false, utilisateurTrouve: true, utilisateurActif: true, utilisateurAPermission: true };

describe("analyserArguments", () => {
  it("sans --appliquer c'est une simulation", () => {
    expect(analyserArguments([], {}, "/x").appliquer).toBe(false);
  });
  it("lit les options avec espace ou signe égal, et les variables d'environnement par défaut", () => {
    const a = analyserArguments(["--appliquer", "--utilisateur", "dg@x.ci", "--confirmation=REINITIALISER", "--uploads", "u"], { REINITIALISATION_DOSSIER_SAUVEGARDE: "sauv" }, "/base");
    expect(a).toMatchObject({ appliquer: true, utilisateur: "dg@x.ci", confirmation: "REINITIALISER" });
    expect(a.dossierSauvegarde).toBe(path.resolve("/base", "sauv"));
    expect(a.dossierUploads).toBe(path.resolve("/base", "u"));
  });
  it("une option sans valeur n'avale pas l'option suivante", () => {
    expect(analyserArguments(["--utilisateur", "--appliquer"], {}, "/x").utilisateur).toBeNull();
  });
});

describe("confirmationValide", () => {
  it("exige la phrase exacte, casse comprise", () => {
    expect(confirmationValide("REINITIALISER")).toBe(true);
    for (const v of ["reinitialiser", "REINITIALISER ", "", null, undefined, "REINITIALISER-POINTAGE"]) expect(confirmationValide(v)).toBe(false);
  });
});

describe("problemesAvantPurge", () => {
  const args = analyserArguments(["--appliquer", "--utilisateur", "dg@x.ci"], {}, "/x");
  it("aucun problème quand tout est en règle", () => {
    expect(problemesAvantPurge(args, OK)).toEqual([]);
  });
  it("refuse si le verrou est actif", () => {
    expect(problemesAvantPurge(args, { ...OK, verrouActif: true })[0]).toMatch(/verrou/);
  });
  it("refuse sans compte, compte inconnu, désactivé ou sans la permission du rôle", () => {
    expect(problemesAvantPurge(analyserArguments(["--appliquer"], {}, "/x"), OK)[0]).toMatch(/--utilisateur/);
    expect(problemesAvantPurge(args, { ...OK, utilisateurTrouve: false })[0]).toMatch(/introuvable/);
    expect(problemesAvantPurge(args, { ...OK, utilisateurActif: false })[0]).toMatch(/désactivé/);
    expect(problemesAvantPurge(args, { ...OK, utilisateurAPermission: false })[0]).toMatch(/systeme\.reinitialiser/);
  });
});
