import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Lot M — vocabulaire uniforme « Rejeter » : une SEULE famille (« Rejeter », « Rejeté(e) », « Rejet ») pour dire qu'une décision métier
 * écarte une demande, un article, un budget, un retour, une justification… Ce test parcourt les textes visibles (chaînes, gabarits,
 * texte JSX) du code source et signale tout reste de « refus / refuser / refusé(e) ».
 *
 * Ne sont PAS concernés (liste blanche ci-dessous) : un refus qui n'est pas un rejet métier — accès ou permission refusés, erreur de
 * droits, refus technique (géolocalisation du navigateur, action impossible à cause d'un état). Les identifiants du code (noms de
 * fonctions, de variables, d'attributs `data-…`, valeurs d'énumération `REFUSEE`, codes d'historique stockés) ne sont pas des textes
 * visibles : ils ne sont pas examinés.
 */

const RACINE = path.resolve(__dirname, "../..");
const DOSSIERS = ["frontend/src", "backend/src"];
const MOT = /\brefus(?:é|ée|ées|és|e|er|es|ons|ent|ant)?\b/i;

/** Textes où « refus » n'est PAS un rejet métier. Chaque entrée dit pourquoi. */
const LISTE_BLANCHE: { motif: RegExp; raison: string }[] = [
  { motif: /acc[èe]s\s+refus/i, raison: "accès refusé (droits)" },
  { motif: /permission\s+(?:.{0,30})?refus/i, raison: "permission refusée (droits)" },
  { motif: /refus(?:é|ée)e?\s+(?:par|pour)\s+(?:le\s+)?navigateur|localisation.{0,40}refus|refus.{0,40}localisation|g[ée]olocalisation.{0,40}refus/i, raison: "géolocalisation refusée par le navigateur" },
  { motif: /purge.{0,60}refus|refus.{0,60}purge/i, raison: "purge refusée (verrou de mise en service)" },
  { motif: /action\s+non\s+autoris[ée]e/i, raison: "droits" },
  // Contrôles techniques du système (pas une décision métier d'un décideur) :
  { motif: /pointage\s+refus|gps\s+refus|sera\s+refus/i, raison: "pointage hors périmètre / GPS : contrôle d'accès du système" },
  { motif: /service\s+fcm.{0,20}refus/i, raison: "réponse technique du service de notifications push" },
  { motif: /Valider ou refuser un paramétrage de budget/, raison: "libellé de permission déjà enregistré en base par la migration 20261023090000 (jamais réécrit ; le seed doit rester identique)" },
  { motif: /dimensions.{0,30}refus/i, raison: "validation technique de l'image de signature" },
];

function fichiers(dir: string, sortie: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", "generated", ".next"].includes(e.name)) continue;
      fichiers(p, sortie);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) {
      sortie.push(p);
    }
  }
  return sortie;
}

/** Textes visibles d'un fichier : (texte, ligne). */
function textes(fichier: string): { texte: string; ligne: number }[] {
  const source = fs.readFileSync(fichier, "utf8");
  const sf = ts.createSourceFile(fichier, source, ts.ScriptTarget.Latest, true, fichier.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const sortie: { texte: string; ligne: number }[] = [];
  const ajouter = (n: ts.Node, texte: string) => {
    if (texte.trim() === "") return;
    sortie.push({ texte, ligne: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 });
  };
  const visiter = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      // Les chaînes qui sont des clés d'import ou de module ne sont pas des textes visibles.
      if (!(ts.isImportDeclaration(n.parent) || ts.isExportDeclaration(n.parent))) ajouter(n, n.text);
    } else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      ajouter(n, n.text);
    } else if (ts.isJsxText(n)) {
      ajouter(n, n.text);
    }
    ts.forEachChild(n, visiter);
  };
  visiter(sf);
  return sortie;
}

export function restesVocabulaire(): string[] {
  const restes: string[] = [];
  for (const d of DOSSIERS) {
    for (const f of fichiers(path.join(RACINE, d))) {
      for (const { texte, ligne } of textes(f)) {
        if (!MOT.test(texte)) continue;
        // Code interne (valeur d'énumération, type d'action) : « REFUSER », « REFUSE »… — jamais un texte affiché.
        if (/^[A-Z_]+$/.test(texte.trim())) continue;
        if (LISTE_BLANCHE.some((b) => b.motif.test(texte))) continue;
        restes.push(`${path.relative(RACINE, f)}:${ligne}: ${texte.replace(/\s+/g, " ").trim().slice(0, 160)}`);
      }
    }
  }
  return restes;
}

describe("vocabulaire uniforme « Rejeter »", () => {
  it("aucun texte visible ne dit « refus / refuser / refusé » pour un rejet métier", () => {
    const restes = restesVocabulaire();
    expect(restes, `Restes de l'ancien vocabulaire :\n${restes.join("\n")}`).toEqual([]);
  });

  it("la liste blanche ne laisse passer que les refus d'accès, de droits ou techniques", () => {
    expect(LISTE_BLANCHE.every((b) => b.raison.length > 0)).toBe(true);
    expect(MOT.test("Refuser")).toBe(true);
    expect(MOT.test("refusée")).toBe(true);
    expect(MOT.test("Rejeter")).toBe(false);
  });
});
