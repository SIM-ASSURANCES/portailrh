import { describe, expect, it } from "vitest";

import {
  codeSortie,
  doitSigner,
  formaterRapport,
  hoteLocalOuPrive,
  listerDelegationsPointage,
  verifierBudgetsCategories,
  verifierComptesDeTest,
  verifierDateCategorisation,
  verifierEnvironnement,
  verifierMigrations,
  verifierMinimumComptes,
  verifierPermissionsConges,
  verifierResponsablesServices,
  verifierRoleDG,
  verifierRoleFinance,
  verifierServicesDesComptes,
  verifierSeuilsCaisse,
  verifierSignatures,
  type ParametrageLu,
  type RoleConfig,
} from "./miseEnProduction";

const FINANCE_OK: RoleConfig = {
  name: "Finance",
  permissions: ["treso.soumettre_dg", "treso.decider_finance", "treso.cloturer_demande", "treso.modifier_budget_categorie", "treso.reorienter_demande", "treso.valider_demande"],
};
const DG_OK: RoleConfig = { name: "DG", permissions: ["treso.approuver_validation_complete", "systeme.reinitialiser", "treso.valider_budget", "treso.decider_dg"] };

describe("migrations", () => {
  it("OK quand toutes sont appliquées", () => {
    expect(verifierMigrations(["a", "b"], ["a", "b"]).verdict).toBe("OK");
  });
  it("À CORRIGER avec la liste des manquantes ou en échec", () => {
    const p = verifierMigrations(["a", "b", "c"], ["a"]);
    expect(p.verdict).toBe("A_CORRIGER");
    expect(p.elements).toEqual(["non appliquée : b", "non appliquée : c"]);
    expect(verifierMigrations(["a"], ["a"], ["a"]).verdict).toBe("A_CORRIGER");
  });
});

describe("rôle Finance", () => {
  it("OK avec les 5 permissions et sans l'approbation de clôture", () => {
    expect(verifierRoleFinance([FINANCE_OK]).verdict).toBe("OK");
  });
  it("À CORRIGER s'il porte l'approbation de clôture du DG", () => {
    const p = verifierRoleFinance([{ ...FINANCE_OK, permissions: [...FINANCE_OK.permissions, "treso.approuver_validation_complete"] }]);
    expect(p.verdict).toBe("A_CORRIGER");
    expect(p.elements?.[0]).toMatch(/approuver_validation_complete/);
  });
  it("À CORRIGER pour chaque permission requise manquante, ou rôle absent", () => {
    const p = verifierRoleFinance([{ name: "Finance", permissions: ["treso.decider_finance"] }]);
    expect(p.elements).toHaveLength(4);
    expect(verifierRoleFinance([]).verdict).toBe("A_CORRIGER");
  });
});

describe("rôle DG", () => {
  it("OK quand le DG a les trois permissions et détient seul valider_budget", () => {
    expect(verifierRoleDG([DG_OK, FINANCE_OK]).verdict).toBe("OK");
  });
  it("À CORRIGER si valider_budget est aussi détenue par un autre rôle", () => {
    const p = verifierRoleDG([DG_OK, { ...FINANCE_OK, permissions: [...FINANCE_OK.permissions, "treso.valider_budget"] }]);
    expect(p.verdict).toBe("A_CORRIGER");
    expect(p.elements?.[0]).toMatch(/Finance/);
  });
  it("À CORRIGER si une permission du DG manque", () => {
    expect(verifierRoleDG([{ name: "DG", permissions: ["treso.valider_budget"] }]).elements).toHaveLength(2);
  });
});

describe("comptes", () => {
  it("minimum de comptes", () => {
    expect(verifierMinimumComptes("x", "x", ["a", "b"], 2).verdict).toBe("OK");
    expect(verifierMinimumComptes("x", "x", ["a"], 2).verdict).toBe("A_CORRIGER");
  });
  it("service de chaque compte actif", () => {
    const base = { email: "a@x", role: "R", rolePermissions: [] };
    expect(verifierServicesDesComptes([{ ...base, nom: "A", serviceNom: "Finance" }]).verdict).toBe("OK");
    const p = verifierServicesDesComptes([{ ...base, nom: "A", serviceNom: null }]);
    expect(p.verdict).toBe("A_CORRIGER");
    expect(p.elements).toEqual(["A <a@x>"]);
  });
  it("responsable actif de chaque service", () => {
    const services = ["Commercial", "Informatique", "Direction DG", "Finance", "RH", "Technique", "Comptabilité", "Marketing"].map((nom) => ({ nom, responsableNom: "R", responsableActif: true }));
    expect(verifierResponsablesServices(services).verdict).toBe("OK");
    expect(verifierResponsablesServices([...services.slice(1), { nom: "Commercial", responsableNom: null, responsableActif: false }]).verdict).toBe("A_CORRIGER");
    expect(verifierResponsablesServices([...services.slice(1), { nom: "Commercial", responsableNom: "X", responsableActif: false }]).elements?.[0]).toMatch(/désactivé/);
    expect(verifierResponsablesServices(services.slice(1)).verdict).toBe("AVERTISSEMENT");
  });
});

describe("signatures", () => {
  it("doit signer : responsable de service ou permission signataire", () => {
    expect(doitSigner({ rolePermissions: [], responsableDeServices: 1 })).toBe(true);
    expect(doitSigner({ rolePermissions: ["treso.decider_finance"], responsableDeServices: 0 })).toBe(true);
    expect(doitSigner({ rolePermissions: ["treso.creer_demande"], responsableDeServices: 0 })).toBe(false);
  });
  it("liste les signataires sans signature, ignore ceux qui n'ont pas à signer", () => {
    const comptes = [
      { nom: "A", email: "a@x", rolePermissions: ["treso.decider_finance"], responsableDeServices: 0, aSignature: false },
      { nom: "B", email: "b@x", rolePermissions: ["treso.decider_finance"], responsableDeServices: 0, aSignature: true },
      { nom: "C", email: "c@x", rolePermissions: [], responsableDeServices: 0, aSignature: false },
    ];
    const p = verifierSignatures(comptes);
    expect(p.verdict).toBe("A_CORRIGER");
    expect(p.elements).toEqual(["A <a@x>"]);
    expect(verifierSignatures(comptes.filter((c) => c.nom !== "A")).verdict).toBe("OK");
  });
});

const P = (o: Partial<ParametrageLu>): ParametrageLu => ({
  id: "p", portee: "GLOBAL", categorieId: null, categorieNom: null, statut: "VALIDE", repris: false, decideParId: "dg",
  dateDebut: "2026-10-01", dateFin: null, decideAt: "2026-10-01T10:00:00Z", seuilOrange: 100000, seuilRouge: 0, ...o,
});

describe("budgets", () => {
  it("seuils de caisse validés par le DG et en vigueur : OK", () => {
    expect(verifierSeuilsCaisse([P({})], "2026-10-30").verdict).toBe("OK");
  });
  it("absents → À CORRIGER ; en attente → À CORRIGER avec le bon message", () => {
    expect(verifierSeuilsCaisse([], "2026-10-30").verdict).toBe("A_CORRIGER");
    const p = verifierSeuilsCaisse([P({ statut: "EN_ATTENTE", decideParId: null })], "2026-10-30");
    expect(p.verdict).toBe("A_CORRIGER");
    expect(p.detail).toMatch(/attend la validation/);
  });
  it("un seuil futur n'est pas en vigueur", () => {
    expect(verifierSeuilsCaisse([P({ dateDebut: "2026-12-01" })], "2026-10-30").verdict).toBe("A_CORRIGER");
  });
  it("seuil repris par migration (sans décideur) → À CORRIGER, à confirmer par le DG", () => {
    const p = verifierSeuilsCaisse([P({ repris: true, decideParId: null })], "2026-10-30");
    expect(p.verdict).toBe("A_CORRIGER");
    expect(p.detail).toMatch(/migration/);
  });
  it("le paramétrage le plus récent à la date du jour l'emporte", () => {
    const p = verifierSeuilsCaisse([P({ repris: true, decideParId: null }), P({ id: "q", dateDebut: "2026-10-15" })], "2026-10-30");
    expect(p.verdict).toBe("OK");
  });
  it("budgets de catégorie : OK, repris à confirmer, en attente, aucun", () => {
    const cat = (o: Partial<ParametrageLu>) => P({ portee: "CATEGORIE", categorieId: "c1", categorieNom: "Transport", ...o });
    expect(verifierBudgetsCategories([cat({})], "2026-10-30").verdict).toBe("OK");
    const repris = verifierBudgetsCategories([cat({ repris: true, decideParId: null })], "2026-10-30");
    expect(repris.verdict).toBe("A_CORRIGER");
    expect(repris.elements?.[0]).toMatch(/Transport.*à confirmer par le DG/);
    expect(verifierBudgetsCategories([cat({}), cat({ id: "z", statut: "EN_ATTENTE", decideParId: null })], "2026-10-30").verdict).toBe("A_CORRIGER");
    expect(verifierBudgetsCategories([], "2026-10-30").verdict).toBe("AVERTISSEMENT");
  });
});

describe("date de catégorisation obligatoire", () => {
  it("OK dans le futur, avertissement si absente ou déjà atteinte", () => {
    expect(verifierDateCategorisation("2026-12-01", "2026-10-30").verdict).toBe("OK");
    expect(verifierDateCategorisation(null, "2026-10-30").verdict).toBe("AVERTISSEMENT");
    expect(verifierDateCategorisation("2026-10-30", "2026-10-30").verdict).toBe("AVERTISSEMENT");
    expect(verifierDateCategorisation("2026-01-01", "2026-10-30").verdict).toBe("AVERTISSEMENT");
  });
});

describe("environnement", () => {
  const ok = { AUTH_URL: "https://portail.sim-assurances.ci", AUTH_SECRET: "x".repeat(40), CRON_SECRET: "y".repeat(20), DATABASE_URL: "postgresql://u:p@h/db" };
  it("tout OK, sans jamais reprendre une valeur secrète", () => {
    const points = verifierEnvironnement(ok);
    expect(points.every((p) => p.verdict === "OK")).toBe(true);
    const texte = JSON.stringify(points);
    expect(texte).not.toContain(ok.AUTH_SECRET);
    expect(texte).not.toContain(ok.CRON_SECRET);
    expect(texte).not.toContain("postgresql://");
  });
  it("AUTH_URL : http, localhost, adresse privée, invalide, absente → À CORRIGER", () => {
    for (const AUTH_URL of ["http://portail.ci", "https://localhost:3000", "https://192.168.1.49", "n'importe quoi", undefined]) {
      expect(verifierEnvironnement({ ...ok, AUTH_URL })[0].verdict, String(AUTH_URL)).toBe("A_CORRIGER");
    }
  });
  it("secrets absents ou trop courts → À CORRIGER", () => {
    const p = verifierEnvironnement({ AUTH_URL: ok.AUTH_URL, AUTH_SECRET: "court", DATABASE_URL: "" });
    expect(p.filter((x) => x.verdict === "A_CORRIGER").map((x) => x.id)).toEqual(["env-auth-secret", "env-cron-secret", "env-database-url"]);
  });
  it("hôtes locaux ou privés", () => {
    for (const h of ["localhost", "127.0.0.1", "10.0.0.5", "172.20.1.1", "192.168.0.1", "monpc.local"]) expect(hoteLocalOuPrive(h), h).toBe(true);
    for (const h of ["portail.ci", "8.8.8.8", "172.32.0.1"]) expect(hoteLocalOuPrive(h), h).toBe(false);
  });
});

describe("comptes de test et délégations", () => {
  const comptes = [
    { nom: "DG Test", email: "dg@simassurances.test", isActive: true },
    { nom: "Vrai DG", email: "dg@sim.ci", isActive: true },
    { nom: "Ancien", email: "x@SIMASSURANCES.TEST", isActive: false },
  ];
  it("avertissement pendant la préparation, À CORRIGER en vérification finale, seulement pour les comptes ACTIFS", () => {
    expect(verifierComptesDeTest(comptes, false).verdict).toBe("AVERTISSEMENT");
    expect(verifierComptesDeTest(comptes, true).verdict).toBe("A_CORRIGER");
    expect(verifierComptesDeTest(comptes.slice(1), true).verdict).toBe("OK");
    expect(verifierComptesDeTest([comptes[2]], true).verdict).toBe("OK");
    expect(verifierComptesDeTest(comptes, false).elements).toHaveLength(2);
  });
  it("délégations listées pour contrôle manuel", () => {
    expect(listerDelegationsPointage([]).verdict).toBe("OK");
    const p = listerDelegationsPointage([{ donneur: "RH", beneficiaire: "Bob", depuis: "2026-10-01" }]);
    expect(p.verdict).toBe("INFO");
    expect(p.elements).toEqual(["RH → Bob (depuis le 2026-10-01)"]);
  });
});

describe("rapport et code de sortie", () => {
  it("code non nul dès qu'il y a un À CORRIGER, nul sinon (avertissements et infos ne bloquent pas)", () => {
    const ok = verifierMigrations(["a"], ["a"]);
    const aver = verifierDateCategorisation(null, "2026-10-30");
    const ko = verifierMigrations(["a"], []);
    expect(codeSortie([ok, aver, listerDelegationsPointage([{ donneur: "a", beneficiaire: "b", depuis: "d" }])])).toBe(0);
    expect(codeSortie([ok, ko])).toBe(1);
  });
  it("le rapport nomme chaque verdict et le bilan", () => {
    const texte = formaterRapport([verifierMigrations(["a"], ["a"]), verifierMigrations(["a"], [])]);
    expect(texte).toMatch(/\[OK\s*\]/);
    expect(texte).toMatch(/\[À CORRIGER\s*\]/);
    expect(texte).toMatch(/Bilan : 1 OK, 1 À CORRIGER/);
  });
});

describe("permissions du module Congés (lot Q)", () => {
  const CATALOGUE = ["conges.soumettre", "conges.valider_rh", "conges.annuler", "conges.consulter_tous"];
  const RH: RoleConfig = {
    name: "RH",
    permissions: ["pointage.pointer", "pointage.corriger_pointage", "pointage.consulter_tous", "conges.soumettre", "conges.valider_rh", "conges.annuler", "conges.consulter_tous"],
  };
  const DG: RoleConfig = { name: "DG", permissions: ["treso.decider_dg", "conges.soumettre", "conges.consulter_tous"] };
  const COLLAB: RoleConfig = { name: "Collaborateur", permissions: ["pointage.pointer", "treso.creer_demande", "conges.soumettre"] };
  const ADMIN: RoleConfig = { name: "Admin", estAdmin: true, permissions: ["pointage.pointer", "pointage.corriger_pointage", "conges.soumettre"] };
  const rh = (n: number) => ({ nom: `RH ${n}`, email: `rh${n}@x`, rolePermissions: RH.permissions, responsableDeServices: 0 });
  const verdicts = (ps: { id: string; verdict: string }[]) => Object.fromEntries(ps.map((p) => [p.id, p.verdict]));

  it("tout est conforme : catalogue complet, rôles selon les permissions sœurs, deux comptes RH", () => {
    const p = verifierPermissionsConges({ catalogue: CATALOGUE, roles: [RH, DG, COLLAB, ADMIN], comptes: [rh(1), rh(2)] });
    expect(verdicts(p)).toEqual({ "conges-catalogue": "OK", "conges-roles": "OK", "conges-rh": "OK", "conges-responsables": "OK" });
  });

  it("migration non appliquée : un seul À CORRIGER qui les nomme toutes", () => {
    const p = verifierPermissionsConges({ catalogue: ["conges.soumettre"], roles: [RH], comptes: [rh(1), rh(2)] });
    expect(p).toHaveLength(1);
    expect(p[0].verdict).toBe("A_CORRIGER");
    expect(p[0].elements).toEqual(["absente : conges.valider_rh", "absente : conges.annuler", "absente : conges.consulter_tous"]);
  });

  it("RH : une permission sœur non attribuée est signalée avec son rôle", () => {
    const rhSansAnnuler = { ...RH, permissions: RH.permissions.filter((k) => k !== "conges.annuler") };
    const roles = verifierPermissionsConges({ catalogue: CATALOGUE, roles: [rhSansAnnuler, DG], comptes: [rh(1), rh(2)] }).find((x) => x.id === "conges-roles")!;
    expect(roles.verdict).toBe("A_CORRIGER");
    expect(roles.elements).toEqual(["rôle « RH » : n'a pas conges.annuler (à cocher dans /admin/roles)"]);
  });

  it("DG : demande et consulte, mais valider l'étape RH ou annuler est un écart", () => {
    const dgTropPuissant = { ...DG, permissions: [...DG.permissions, "conges.valider_rh", "conges.annuler"] };
    const roles = verifierPermissionsConges({ catalogue: CATALOGUE, roles: [RH, dgTropPuissant], comptes: [rh(1), rh(2)] }).find((x) => x.id === "conges-roles")!;
    expect(roles.verdict).toBe("A_CORRIGER");
    expect(roles.elements).toEqual([
      "rôle « DG » : porte conges.valider_rh (le DG consulte seulement ; à décocher)",
      "rôle « DG » : porte conges.annuler (le DG consulte seulement ; à décocher)",
    ]);
    // Et un DG à qui il manque la demande ou la consultation de tous :
    const dgIncomplet = { ...DG, permissions: ["treso.decider_dg"] };
    const manque = verifierPermissionsConges({ catalogue: CATALOGUE, roles: [RH, dgIncomplet], comptes: [rh(1), rh(2)] }).find((x) => x.id === "conges-roles")!;
    expect(manque.elements).toEqual(["rôle « DG » : n'a pas conges.soumettre (à cocher dans /admin/roles)", "rôle « DG » : n'a pas conges.consulter_tous (à cocher dans /admin/roles)"]);
  });

  it("rôle d'administration : seul le droit de demande est attendu (pas décider ni consulter tout)", () => {
    const adminSansDemande = { ...ADMIN, permissions: ["pointage.pointer", "pointage.corriger_pointage"] };
    const ok = verifierPermissionsConges({ catalogue: CATALOGUE, roles: [RH, ADMIN], comptes: [rh(1), rh(2)] }).find((x) => x.id === "conges-roles")!;
    expect(ok.verdict).toBe("OK");
    const ko = verifierPermissionsConges({ catalogue: CATALOGUE, roles: [RH, adminSansDemande], comptes: [rh(1), rh(2)] }).find((x) => x.id === "conges-roles")!;
    expect(ko.elements).toEqual(["rôle « Admin » : n'a pas conges.soumettre (à cocher dans /admin/roles)"]);
  });

  it("aucun rôle ne peut valider l'étape RH : À CORRIGER", () => {
    const roles = verifierPermissionsConges({ catalogue: CATALOGUE, roles: [{ name: "RH", permissions: [] }, COLLAB], comptes: [] }).find((x) => x.id === "conges-roles")!;
    expect(roles.verdict).toBe("A_CORRIGER");
    expect(roles.elements?.at(-1)).toMatch(/personne ne peut valider l'étape RH/);
  });

  it("continuité : moins de deux comptes actifs pouvant valider l'étape RH est À CORRIGER", () => {
    expect(verifierPermissionsConges({ catalogue: CATALOGUE, roles: [RH], comptes: [rh(1)] }).find((x) => x.id === "conges-rh")!.verdict).toBe("A_CORRIGER");
    expect(verifierPermissionsConges({ catalogue: CATALOGUE, roles: [RH], comptes: [rh(1), rh(2), { nom: "C", email: "c@x", rolePermissions: COLLAB.permissions, responsableDeServices: 0 }] }).find((x) => x.id === "conges-rh")!.verdict).toBe("OK");
  });

  it("responsable de service sans conges.soumettre : avertissement (il décide mais ne peut pas demander son congé)", () => {
    const resp = { nom: "Resp", email: "resp@x", rolePermissions: ["treso.creer_demande"], responsableDeServices: 1 };
    const p = verifierPermissionsConges({ catalogue: CATALOGUE, roles: [RH], comptes: [rh(1), rh(2), resp] }).find((x) => x.id === "conges-responsables")!;
    expect(p.verdict).toBe("AVERTISSEMENT");
    expect(p.elements).toEqual(["Resp <resp@x>"]);
    const respOk = { ...resp, rolePermissions: COLLAB.permissions };
    expect(verifierPermissionsConges({ catalogue: CATALOGUE, roles: [RH], comptes: [rh(1), rh(2), respOk] }).find((x) => x.id === "conges-responsables")!.verdict).toBe("OK");
  });
});
