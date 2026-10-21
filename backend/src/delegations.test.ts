import { describe, expect, it } from "vitest";

import { delegationCompte, utilisateursAvecPermission } from "./delegations";

/** Faux client minimal : comptes avec leur rôle, délégations avec leur donneur. */
interface FauxCompte { id: string; isActive: boolean; permissions: string[] }
interface FausseDelegation { beneficiaireId: string; donneurId: string; permission: string; estActive: boolean }

function faux(comptes: FauxCompte[], delegations: FausseDelegation[]) {
  const parId = new Map(comptes.map((c) => [c.id, c]));
  return {
    user: {
      findMany: async ({ where }: { where: { isActive: boolean; id?: { not: string }; role: { permissions: { some: { permission: { key: string } } } } } }) =>
        comptes
          .filter((c) => c.isActive === where.isActive)
          .filter((c) => !where.id || c.id !== where.id.not)
          .filter((c) => c.permissions.includes(where.role.permissions.some.permission.key))
          .map((c) => ({ id: c.id })),
    },
    permissionDelegation: {
      findMany: async ({ where }: { where: { permission: { key: string }; beneficiaire: { isActive: boolean; id?: { not: string } } } }) =>
        delegations
          .filter((d) => d.estActive && d.permission === where.permission.key)
          .filter((d) => parId.get(d.beneficiaireId)?.isActive && (!where.beneficiaire.id || d.beneficiaireId !== where.beneficiaire.id.not))
          .filter((d) => parId.get(d.donneurId)?.isActive)
          .map((d) => ({
            beneficiaireId: d.beneficiaireId,
            donneur: {
              isActive: parId.get(d.donneurId)!.isActive,
              role: { permissions: parId.get(d.donneurId)!.permissions.map((k) => ({ permission: { key: k } })) },
            },
          })),
    },
  } as unknown as Parameters<typeof utilisateursAvecPermission>[0];
}

const P = "pointage.corriger_pointage";

describe("delegationCompte", () => {
  it("compte si le donneur est actif et a encore la permission par son rôle", () => {
    expect(delegationCompte(P, { isActive: true, permissionsRole: [P] })).toBe(true);
  });
  it("ne compte pas si le donneur est désactivé ou a perdu la permission", () => {
    expect(delegationCompte(P, { isActive: false, permissionsRole: [P] })).toBe(false);
    expect(delegationCompte(P, { isActive: true, permissionsRole: ["autre"] })).toBe(false);
  });
  it("ne compte jamais une permission de décision du circuit", () => {
    expect(delegationCompte("treso.decider_dg", { isActive: true, permissionsRole: ["treso.decider_dg"] })).toBe(false);
  });
});

describe("utilisateursAvecPermission (notifyByPermission)", () => {
  const rh = { id: "rh", isActive: true, permissions: [P] };
  const delegue = { id: "delegue", isActive: true, permissions: [] };

  it("inclut le titulaire par le rôle ET le délégué actif", async () => {
    const db = faux([rh, delegue], [{ beneficiaireId: "delegue", donneurId: "rh", permission: P, estActive: true }]);
    expect((await utilisateursAvecPermission(db, P)).sort()).toEqual(["delegue", "rh"]);
  });
  it("n'inclut pas le délégué avec inclureDelegues: false (décision lue sur le rôle seul)", async () => {
    const db = faux([rh, delegue], [{ beneficiaireId: "delegue", donneurId: "rh", permission: P, estActive: true }]);
    expect(await utilisateursAvecPermission(db, P, { inclureDelegues: false })).toEqual(["rh"]);
  });
  it("ignore une délégation révoquée, un délégué désactivé, un donneur désactivé ou qui a perdu la permission", async () => {
    const db = faux(
      [rh, delegue, { id: "inactif", isActive: false, permissions: [] }, { id: "ancien", isActive: true, permissions: [] }],
      [
        { beneficiaireId: "delegue", donneurId: "rh", permission: P, estActive: false },
        { beneficiaireId: "inactif", donneurId: "rh", permission: P, estActive: true },
        { beneficiaireId: "delegue", donneurId: "ancien", permission: P, estActive: true }, // donneur sans la permission
      ]
    );
    expect(await utilisateursAvecPermission(db, P)).toEqual(["rh"]);
  });
  it("retire l'exclu et ne produit aucun doublon", async () => {
    const db = faux([rh, delegue], [
      { beneficiaireId: "rh", donneurId: "rh", permission: P, estActive: true },
      { beneficiaireId: "delegue", donneurId: "rh", permission: P, estActive: true },
    ]);
    expect(await utilisateursAvecPermission(db, P, { excludeUserId: "delegue" })).toEqual(["rh"]);
    expect((await utilisateursAvecPermission(db, P)).sort()).toEqual(["delegue", "rh"]);
  });
  it("ne notifie jamais un délégué d'une permission de décision non délégable", async () => {
    const dg = { id: "dg", isActive: true, permissions: ["treso.decider_dg"] };
    const db = faux([dg, delegue], [{ beneficiaireId: "delegue", donneurId: "dg", permission: "treso.decider_dg", estActive: true }]);
    expect(await utilisateursAvecPermission(db, "treso.decider_dg")).toEqual(["dg"]);
  });
});
