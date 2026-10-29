import { describe, expect, it } from "vitest";
import { PERMISSIONS_CATALOGUE, ROLES_CIBLES } from "./rolesCibles";
import { comparaisonVide, comparerAvecCible, genererMarkdownBase, type PermissionLue, type RoleLu } from "./rolesComparaison";

const permissions: PermissionLue[] = PERMISSIONS_CATALOGUE.map((p) => ({ key: p.key, label: p.label, moduleKey: p.moduleKey }));
const rolesConformes = (): RoleLu[] =>
  ROLES_CIBLES.map((r) => ({
    name: r.name,
    description: r.description,
    estAdmin: r.estAdmin,
    peutEtreBeneficiaireDelegation: r.peutEtreBeneficiaireDelegation,
    peutRecevoirFeedback: r.peutRecevoirFeedback,
    nbComptesActifs: 1,
    permissions: [...r.permissions],
  }));

describe("comparerAvecCible", () => {
  it("une base conforme n'a aucun écart", () => {
    expect(comparaisonVide(comparerAvecCible(rolesConformes(), permissions))).toBe(true);
  });

  it("signale les permissions manquantes ou en trop d'un rôle", () => {
    const roles = rolesConformes();
    const rh = roles.find((r) => r.name === "RH")!;
    rh.permissions = rh.permissions.filter((k) => k !== "pointage.gerer_horaires").concat("treso.voir_reporting");
    const c = comparerAvecCible(roles, permissions);
    expect(c.ecarts).toHaveLength(1);
    expect(c.ecarts[0]).toMatchObject({ role: "RH", manquantes: ["pointage.gerer_horaires"], enTrop: ["treso.voir_reporting"] });
  });

  it("signale les réglages de rôle différents", () => {
    const roles = rolesConformes();
    roles.find((r) => r.name === "Admin")!.peutRecevoirFeedback = true;
    const c = comparerAvecCible(roles, permissions);
    expect(c.ecarts[0].reglages[0]).toContain("Peut recevoir un feedback");
  });

  it("alerte sur Finance ou Admin qui porte l'approbation de clôture", () => {
    const roles = rolesConformes();
    roles.find((r) => r.name === "Finance")!.permissions.push("treso.approuver_validation_complete");
    roles.find((r) => r.name === "Admin")!.permissions.push("treso.approuver_validation_complete");
    const c = comparerAvecCible(roles, permissions);
    expect(c.alertes.filter((a) => a.includes("treso.approuver_validation_complete")).length).toBeGreaterThanOrEqual(2);
    expect(c.alertes.some((a) => a.includes("« Finance »"))).toBe(true);
    expect(c.alertes.some((a) => a.includes("« Admin »"))).toBe(true);
  });

  it("alerte sur une permission réservée au DG portée par un rôle créé à la main", () => {
    const roles = rolesConformes();
    roles.push({ name: "Directeur adjoint", description: null, estAdmin: false, peutEtreBeneficiaireDelegation: false, peutRecevoirFeedback: true, nbComptesActifs: 0, permissions: ["treso.valider_budget"] });
    const c = comparerAvecCible(roles, permissions);
    expect(c.rolesInconnus).toEqual(["Directeur adjoint"]);
    expect(c.alertes.some((a) => a.includes("Directeur adjoint") && a.includes("treso.valider_budget"))).toBe(true);
  });

  it("une permission absente = migration non appliquée ; un rôle absent est listé", () => {
    const c = comparerAvecCible(
      rolesConformes().filter((r) => r.name !== "RH"),
      permissions.filter((p) => p.key !== "treso.valider_budget")
    );
    expect(c.permissionsAbsentes).toEqual(["treso.valider_budget"]);
    expect(c.rolesAbsents).toEqual(["RH"]);
  });
});

describe("genererMarkdownBase", () => {
  it("liste chaque rôle et ses permissions, sans donnée personnelle", () => {
    const roles = rolesConformes();
    const md = genererMarkdownBase(roles, permissions, comparerAvecCible(roles, permissions), "2026-10-22 10:00 UTC");
    for (const r of roles) expect(md).toContain(`### ${r.name}`);
    expect(md).toContain("- [x] `systeme.reinitialiser`");
    expect(md).toContain("Aucun écart");
    expect(md).not.toContain("@");
  });
});
