import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CLASSIFICATION_TABLES,
  ENTITES_HISTORIQUE_CONSERVEES,
  ENTITES_HISTORIQUE_PURGEES,
} from "./reinitialisationClassification";

const RACINE = path.resolve(__dirname, "../..");

function modelesDuSchema(): string[] {
  const schema = readFileSync(path.join(RACINE, "backend/prisma/schema.prisma"), "utf8");
  return [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
}

function fichiersSource(dossier: string, sortie: string[] = []): string[] {
  for (const nom of readdirSync(dossier)) {
    if (nom === "node_modules" || nom === "generated" || nom === ".next") continue;
    const chemin = path.join(dossier, nom);
    if (statSync(chemin).isDirectory()) fichiersSource(chemin, sortie);
    else if (/\.(ts|tsx)$/.test(nom) && !/\.test\.(ts|tsx)$/.test(nom)) sortie.push(chemin);
  }
  return sortie;
}

describe("classification des tables pour la réinitialisation (lot N)", () => {
  it("classe CHAQUE modèle du schéma Prisma, et seulement eux", () => {
    const modeles = modelesDuSchema();
    expect(modeles.length).toBeGreaterThan(50);
    const nonClasses = modeles.filter((m) => !(m in CLASSIFICATION_TABLES));
    const inconnus = Object.keys(CLASSIFICATION_TABLES).filter((m) => !modeles.includes(m));
    expect({ nonClasses, inconnus }).toEqual({ nonClasses: [], inconnus: [] });
  });

  it("chaque classement a un statut valide et une note", () => {
    for (const [modele, c] of Object.entries(CLASSIFICATION_TABLES)) {
      expect(["PURGEE", "PARTIELLE", "CONSERVEE"], modele).toContain(c.statut);
      expect(c.note.length, modele).toBeGreaterThan(5);
    }
  });

  it("toute entité d'historique écrite dans le code est classée (purgée ou conservée)", () => {
    const classees = new Set([...ENTITES_HISTORIQUE_PURGEES, ...ENTITES_HISTORIQUE_CONSERVEES]);
    const trouvees = new Set<string>();
    for (const fichier of [...fichiersSource(path.join(RACINE, "backend/src")), ...fichiersSource(path.join(RACINE, "frontend/src"))]) {
      const texte = readFileSync(fichier, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const m of texte.matchAll(/\bentity:\s*"(\w+)"/g)) trouvees.add(m[1]);
      for (const m of texte.matchAll(/\bENTITE_\w+\s*=\s*"(\w+)"/g)) trouvees.add(m[1]);
    }
    expect(trouvees.size).toBeGreaterThan(10);
    expect([...trouvees].filter((e) => !classees.has(e)).sort()).toEqual([]);
  });

  it("aucune entité d'historique n'est à la fois purgée et conservée", () => {
    const communes = ENTITES_HISTORIQUE_PURGEES.filter((e) => ENTITES_HISTORIQUE_CONSERVEES.includes(e));
    expect(communes).toEqual([]);
  });

  it("la configuration est CONSERVÉE (comptes, rôles, permissions, délégations, services, catégories, budgets, signatures, verrous)", () => {
    for (const m of [
      "User", "Role", "Permission", "RolePermission", "PermissionDelegation", "Service", "Categorie", "Objet",
      "BudgetParametrage", "ParametreTresorerie", "SignatureUtilisateur", "ReinitialisationSysteme", "MarqueurUnique",
    ]) {
      expect(CLASSIFICATION_TABLES[m].statut, m).toBe("CONSERVEE");
    }
  });

  it("les données de test du circuit sont PURGÉES", () => {
    for (const m of [
      "Demande", "LigneDemande", "Reglement", "RetourCaisse", "RetourExterne", "PieceJointe", "BudgetDepassement",
      "JournalCaisse", "Pointage", "JustificationPointage", "Absence", "PlageAbsenceAutorisee", "Feedback",
    ]) {
      expect(CLASSIFICATION_TABLES[m].statut, m).toBe("PURGEE");
    }
  });
});
