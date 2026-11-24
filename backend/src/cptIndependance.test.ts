import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Règle d'INDÉPENDANCE de Gestion Compta (décision V1, docs/compta-conception.md §2) : le code du module n'importe JAMAIS
// un fichier métier d'un autre module (Encaissements, Trésorerie, Pointage, Congés, FeedbackApp). Seule l'infrastructure
// générique est utilisable (session, prisma, notifications, planificateur, signature, composants UI, montants).
// Ce test garde la règle dans le temps : il échoue dès qu'un fichier `cpt*` ou une page `compta` importe un autre module.

const RACINE = path.resolve(__dirname, "../..");

/** Nom de fichier (sans dossier ni extension) d'un module métier autre que Gestion Compta. */
const AUTRE_MODULE =
  /^(enc[A-Z][\w-]*|tresorerie|treso[\w-]*|circuit[\w-]*|budgets[\w-]*|cloture[\w-]*|reglement[\w-]*|regularisation[\w-]*|retour[\w-]*|parcours[\w-]*|reporting[\w-]*|dashboardFinance|pointage[\w-]*|justification[\w-]*|conges[\w-]*|feedback[\w-]*|equipe|absences|planification[\w-]*)$/;
/** Dossiers d'un autre module, quel que soit le fichier. */
const AUTRE_DOSSIER = /(^|\/)(encaissements|treso|tresorerie|pointage|conges|feedback)(\/|$)/;

function fichiers(dossier: string, accepte: (nom: string) => boolean, sortie: string[] = []): string[] {
  if (!existsSync(dossier)) return sortie;
  for (const nom of readdirSync(dossier)) {
    if (nom === "node_modules" || nom === "generated" || nom === ".next") continue;
    const chemin = path.join(dossier, nom);
    if (statSync(chemin).isDirectory()) fichiers(chemin, accepte, sortie);
    else if (accepte(nom)) sortie.push(chemin);
  }
  return sortie;
}

function importsDe(fichier: string): string[] {
  const texte = readFileSync(fichier, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return [...texte.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
}

function estInterdit(spec: string): boolean {
  const base = spec.split("/").pop()!.replace(/\.(ts|tsx)$/, "");
  return AUTRE_MODULE.test(base) || AUTRE_DOSSIER.test(spec);
}

function violations(fichier: string): string[] {
  return importsDe(fichier).filter((spec) => {
    const interne = spec.startsWith(".") || spec.startsWith("@/") || spec === "backend" || spec.startsWith("backend/");
    return interne && estInterdit(spec);
  });
}

describe("Gestion Compta — indépendance vis-à-vis des autres modules (V1)", () => {
  const backend = fichiers(path.join(RACINE, "backend/src"), (n) => /^cpt[A-Z]\w*\.ts$/.test(n) && !/\.test\.ts$/.test(n));
  const frontend = [
    "frontend/src/app/(dashboard)/compta",
    "frontend/src/app/api/compta",
    "frontend/src/components/compta",
    "frontend/src/lib/compta",
  ].flatMap((d) => fichiers(path.join(RACINE, d), (n) => /\.(ts|tsx)$/.test(n)));

  it("le module a bien des fichiers à contrôler (sinon ce test ne vérifierait plus rien)", () => {
    expect(backend.length).toBeGreaterThanOrEqual(4);
  });

  it("aucun fichier backend `cpt*` n'importe un fichier d'un autre module", () => {
    const fautes = backend.flatMap((f) => violations(f).map((v) => `${path.relative(RACINE, f)} → ${v}`));
    expect(fautes).toEqual([]);
  });

  it("aucun fichier frontend de Gestion Compta n'importe un fichier d'un autre module", () => {
    const fautes = frontend.flatMap((f) => violations(f).map((v) => `${path.relative(RACINE, f)} → ${v}`));
    expect(fautes).toEqual([]);
  });

  it("le détecteur reconnaît bien les imports interdits (garde-fou du test lui-même)", () => {
    for (const interdit of [
      "./encCalcul",
      "./encAudit",
      "./tresorerie",
      "./circuitDemande",
      "./pointage-utils",
      "./congesDb",
      "./feedback-constants",
      "@/lib/encaissements/pieceJointe",
      "@/components/tresorerie/devise",
      "@/app/(dashboard)/treso/finance/actions",
    ]) {
      expect(estInterdit(interdit), interdit).toBe(true);
    }
    for (const autorise of ["./generated/prisma/client", "./prisma", "./cptAudit", "@/components/ui", "@/lib/auth", "@/lib/hooks/useActionFeedback", "react"]) {
      expect(estInterdit(autorise), autorise).toBe(false);
    }
  });
});
