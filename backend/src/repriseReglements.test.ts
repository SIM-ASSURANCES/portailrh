import { describe, expect, it } from "vitest";

import { classerDemande, refusRattachement, type DemandeARattacher } from "./repriseReglements";
import type { ArticleReglable } from "./reglementArticle";

const art = (id: string, prix: number, statutValidation: ArticleReglable["statutValidation"] = "VALIDEE"): ArticleReglable => ({
  id,
  libelle: id,
  quantite: 1,
  prixUnitaire: prix,
  statutValidation,
  categorieId: null,
});
const reg = (id: string, ligneDemandeId: string | null, montant: number, o: { estConfirme?: boolean; estAnnule?: boolean } = {}) => ({
  id,
  ligneDemandeId,
  montant,
  mode: "CAISSE" as const,
  estConfirme: true,
  estAnnule: false,
  ...o,
});
const demande = (articles: ArticleReglable[], reglements: ReturnType<typeof reg>[]): DemandeARattacher => ({ id: "d", reference: "DEM-1", articles, reglements });

describe("reprise des règlements : classement", () => {
  it("un seul article validé : tous les règlements sans article lui sont rattachés", () => {
    const c = classerDemande(demande([art("a", 100), art("b", 50, "REJETEE")], [reg("r1", null, 40), reg("r2", null, 10, { estAnnule: true })]));
    expect(c).toEqual({ classe: "AUTOMATIQUE", ligneId: "a", reglementIds: ["r1", "r2"] });
  });

  it("deux articles validés ou plus et un règlement sans article : ambigu, jamais rattaché tout seul", () => {
    const c = classerDemande(demande([art("a", 100), art("b", 50)], [reg("r1", null, 40), reg("r2", null, 10, { estAnnule: true })]));
    expect(c).toEqual({ classe: "AMBIGU", reglementIds: ["r1"] });
  });

  it("rien à faire : règlements déjà rattachés, règlements annulés seuls, demande sans règlement ni article", () => {
    expect(classerDemande(demande([art("a", 100), art("b", 50)], [reg("r1", "a", 40)])).classe).toBe("RIEN");
    expect(classerDemande(demande([art("a", 100), art("b", 50)], [reg("r1", null, 40, { estAnnule: true })])).classe).toBe("RIEN");
    expect(classerDemande(demande([], [reg("r1", null, 40)])).classe).toBe("RIEN");
  });
});

describe("reprise des règlements : rattachement manuel", () => {
  const d = demande([art("a", 100), art("b", 50), art("c", 70, "EN_ATTENTE")], [reg("r1", null, 40), reg("r2", null, 60), reg("r3", "a", 80), reg("r4", null, 5, { estAnnule: true })]);

  it("permis quand l'article est validé et que son plafond tient", () => {
    expect(refusRattachement(d, "r1", "b")).toBeNull();
  });
  it("refusé si le total réglé de l'article dépasserait son montant validé", () => {
    expect(refusRattachement(d, "r2", "a")).toContain("dépasserait");
    expect(refusRattachement(d, "r1", "a")).toContain("dépasserait");
  });
  it("refusé pour un article non validé, étranger, un règlement déjà rattaché, annulé ou inconnu", () => {
    expect(refusRattachement(d, "r1", "c")).toContain("pas validé");
    expect(refusRattachement(d, "r1", "z")).toContain("n'appartient pas");
    expect(refusRattachement(d, "r3", "b")).toContain("déjà rattaché");
    expect(refusRattachement(d, "r4", "b")).toContain("annulé");
    expect(refusRattachement(d, "rX", "b")).toContain("introuvable");
  });
});
