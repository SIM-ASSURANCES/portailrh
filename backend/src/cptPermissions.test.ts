import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CPT_MODULE_KEY,
  CPT_MODULE_LABEL,
  CPT_PERMISSION_MISE_EN_SERVICE,
  CPT_PERMISSIONS,
  CPT_PERMISSIONS_DECISION,
  CPT_PERMISSIONS_DEPOT_PIECE_JOINTE,
  CPT_ROLES_DEPART,
} from "./cptPermissions";

const RACINE = path.resolve(__dirname, "../..");
const cles = (nom: string) => (CPT_ROLES_DEPART.find((r) => r.name.endsWith(nom))!.permissions as string[]);
const roles = (cle: string) => CPT_ROLES_DEPART.filter((r) => (r.permissions as string[]).includes(cle)).map((r) => r.name.replace("Compta – ", ""));

describe("Gestion Compta — module et permissions (conception §4)", () => {
  it("clé de module `compta`, libellé « Gestion Compta »", () => {
    expect(CPT_MODULE_KEY).toBe("compta");
    expect(CPT_MODULE_LABEL).toBe("Gestion Compta");
  });

  it("18 permissions de module + la mise en service = 19, toutes uniques et préfixées `cpt.`", () => {
    const toutes = [...CPT_PERMISSIONS.map((p) => p.key as string), CPT_PERMISSION_MISE_EN_SERVICE.key];
    expect(CPT_PERMISSIONS).toHaveLength(18);
    expect(toutes).toHaveLength(19);
    expect(new Set(toutes).size).toBe(19);
    for (const k of toutes) expect(k, k).toMatch(/^cpt\.[a-z_]+$/);
  });

  it("libellés au vocabulaire du portail : jamais « refus », « refuser » ni « refusé »", () => {
    for (const p of [...CPT_PERMISSIONS, CPT_PERMISSION_MISE_EN_SERVICE]) {
      expect(p.label, p.key).toMatch(/^Gestion Compta : /);
      expect(p.label, p.key).not.toMatch(/refus/i);
    }
  });

  it("la mise en service n'est dans aucun rôle de départ (module technique, DG seul, migration GC-1c)", () => {
    expect(roles(CPT_PERMISSION_MISE_EN_SERVICE.key)).toEqual([]);
    expect(CPT_PERMISSIONS.map((p) => p.key as string)).not.toContain(CPT_PERMISSION_MISE_EN_SERVICE.key);
  });

  it("le dépôt d'une pièce jointe est ouvert à toute permission d'écriture, jamais à la seule consultation", () => {
    expect(CPT_PERMISSIONS_DEPOT_PIECE_JOINTE).not.toContain("cpt.consulter");
    expect(CPT_PERMISSIONS_DEPOT_PIECE_JOINTE).toHaveLength(17);
  });
});

describe("Gestion Compta — rôles de départ (profils du cahier §2, provisoires jusqu'à la réponse Q5)", () => {
  it("cinq rôles préfixés « Compta – », tous avec la consultation, uniquement des permissions connues", () => {
    expect(CPT_ROLES_DEPART.map((r) => r.name)).toEqual([
      "Compta – Production",
      "Compta – Commercial",
      "Compta – RFCRH",
      "Compta – Comptable",
      "Compta – Direction",
    ]);
    const connues = new Set<string>(CPT_PERMISSIONS.map((p) => p.key));
    for (const r of CPT_ROLES_DEPART) {
      expect(r.permissions, r.name).toContain("cpt.consulter");
      expect(new Set(r.permissions).size, `doublon dans ${r.name}`).toBe(r.permissions.length);
      for (const k of r.permissions) expect(connues.has(k), `${r.name} : permission inconnue ${k}`).toBe(true);
    }
  });

  it("comptes de test uniques, en `.test`, jamais créés en production", () => {
    const emails = CPT_ROLES_DEPART.map((r) => r.compteTest.email);
    expect(new Set(emails).size).toBe(5);
    for (const e of emails) expect(e).toMatch(/^compta-[a-z]+@simassurances\.test$/);
  });

  it("DEUX ÉTAPES (V3) : seul le commercial confirme, seul le RFCRH valide ; le RFCRH ne peut pas sauter l'étape 1", () => {
    expect(roles("cpt.confirmer_rattachement")).toEqual(["Commercial"]);
    expect(roles("cpt.valider_rattachement")).toEqual(["RFCRH"]);
    expect(cles("RFCRH")).not.toContain("cpt.confirmer_rattachement");
    expect(cles("Commercial")).not.toContain("cpt.valider_rattachement");
  });

  it("RG-02 : seul le RFCRH déclare et paie la taxe, règle et compense les partenaires, clôture, paramètre", () => {
    for (const k of [
      "cpt.declarer_tca",
      "cpt.payer_tca",
      "cpt.regler_partenaire",
      "cpt.compenser",
      "cpt.cloturer_periode",
      "cpt.parametrer",
      "cpt.gerer_conventions",
      "cpt.classer_pas_une_prime",
    ]) {
      expect(roles(k), k).toEqual(["RFCRH"]);
    }
  });

  it("la production saisit les contrats, le commercial et le RFCRH identifient, le comptable importe les relevés", () => {
    expect(roles("cpt.saisir_contrat")).toEqual(["Production"]);
    expect(roles("cpt.identifier_encaissement")).toEqual(["Commercial", "RFCRH"]);
    expect(roles("cpt.importer_releves")).toEqual(["Comptable"]);
    expect(roles("cpt.importer_production")).toEqual(["Production", "Comptable"]);
  });

  it("le comptable (stagiaire) ne valide ni ne paramètre ; la production ne valide pas un rattachement", () => {
    for (const k of CPT_PERMISSIONS_DECISION) {
      expect(cles("Comptable"), `Comptable ${k}`).not.toContain(k);
      expect(cles("Production"), `Production ${k}`).not.toContain(k);
      expect(cles("Commercial"), `Commercial ${k}`).not.toContain(k);
    }
    expect(cles("Comptable")).not.toContain("cpt.parametrer");
  });

  it("la direction consulte et tranche les litiges, sans aucune saisie", () => {
    expect(cles("Direction")).toEqual(["cpt.consulter", "cpt.trancher_litige"]);
  });
});

describe("Gestion Compta — décisions non délégables (indépendance du module)", () => {
  it("les permissions de décision existent toutes, et la confirmation du commercial n'en fait pas partie", () => {
    const connues = new Set<string>(CPT_PERMISSIONS.map((p) => p.key));
    for (const k of CPT_PERMISSIONS_DECISION) expect(connues.has(k), k).toBe(true);
    expect(CPT_PERMISSIONS_DECISION as readonly string[]).not.toContain("cpt.confirmer_rattachement");
    expect(CPT_PERMISSIONS_DECISION).toHaveLength(8);
  });

  it("`compta` ne figure dans AUCUNE liste de modules délégables : ses permissions ne sont délégables à personne", () => {
    for (const fichier of [
      "frontend/src/app/(dashboard)/delegations/actions.ts",
      "frontend/src/app/(dashboard)/delegations/page.tsx",
    ]) {
      const texte = readFileSync(path.join(RACINE, fichier), "utf8");
      const declaration = /const MODULES_DELEGABLES = \[([^\]]*)\]/.exec(texte)?.[1] ?? "";
      expect(declaration.length, `${fichier} : déclaration introuvable`).toBeGreaterThan(0);
      expect(declaration, fichier).not.toContain(CPT_MODULE_KEY);
    }
  });
});
