import { describe, expect, it } from "vitest";

import { parcoursArticle, type EntreeParcours, type ParcoursReglement } from "./parcoursArticle";

const reglement = (o: Partial<ParcoursReglement> = {}): ParcoursReglement => ({
  id: "r1",
  montant: 100000,
  mode: "CAISSE",
  estConfirme: true,
  estAnnule: false,
  confirmeAt: new Date("2026-10-16T10:00:00Z"),
  solde: 100000,
  retours: [],
  ...o,
});
const base = (o: Partial<EntreeParcours> = {}): EntreeParcours => ({
  statut: "VALIDEE",
  etat: "VALIDEE",
  montant: 100000,
  beneficiaire: "Bob",
  decidePar: "Finance Test",
  decideAt: new Date("2026-10-15T09:00:00Z"),
  confirmeParFinance: null,
  motifRejet: null,
  reglements: [],
  ...o,
});
const cles = (p: ReturnType<typeof parcoursArticle>) => p.etapes.map((e) => e.cle);

describe("parcours d'un article", () => {
  it("en attente : badge « En attente » avec l'état fin, aucune étape ni montant", () => {
    const p = parcoursArticle(base({ statut: "EN_ATTENTE", etat: "CHEZ_DG" }));
    expect(p.badge).toBe("EN_ATTENTE");
    expect(p.precision).toBe("Chez le DG");
    expect(p.etapes).toEqual([]);
    expect(p.montants.valide).toBe(0);
  });

  it("rejeté : badge « Rejeté », motif et auteur, aucun montant", () => {
    const p = parcoursArticle(base({ statut: "REJETEE", etat: "REJETEE", motifRejet: "Trop cher" }));
    expect(p.badge).toBe("REJETE");
    expect(cles(p)).toEqual(["REJETE"]);
    expect(p.etapes[0].lignes.join(" ")).toContain("Trop cher");
    expect(p.montants.valide).toBe(0);
  });

  it("validé, rien réglé : seule l'étape « Validé » (par qui, quand, montant), jamais Réglé ni Retour", () => {
    const p = parcoursArticle(base());
    expect(p.badge).toBe("VALIDE");
    expect(cles(p)).toEqual(["VALIDE"]);
    expect(p.etapes[0].lignes.join(" ")).toContain("Finance Test");
    expect(p.montants).toMatchObject({ valide: 100000, regle: 0, reste: 100000, retourAttendu: null, retourRecu: null });
  });

  it("un article validé par le DG et confirmé par la Finance nomme les deux", () => {
    const p = parcoursArticle(base({ decidePar: "DG Test", confirmeParFinance: "Finance Test" }));
    expect(p.etapes[0].lignes.join(" ")).toContain("Confirmé par la Finance : Finance Test");
  });

  it("règlement partiel : « Partiellement réglé », le réglé et le reste", () => {
    const p = parcoursArticle(base({ reglements: [reglement({ montant: 40000, mode: "BANQUE", solde: null })] }));
    expect(p.badge).toBe("PARTIELLEMENT_REGLE");
    expect(cles(p)).toEqual(["VALIDE", "REGLE"]);
    expect(p.montants).toMatchObject({ regle: 40000, reste: 60000 });
  });

  it("réglé en Banque, solde non calculé : « Réglé », pas « Régularisé »", () => {
    const p = parcoursArticle(base({ reglements: [reglement({ mode: "BANQUE", solde: null })] }));
    expect(p.badge).toBe("REGLE");
    expect(cles(p)).not.toContain("REGULARISE");
  });

  it("lot G — réglé en Banque avec un solde à régulariser : « Réglé » ; solde nul après dépenses : « Régularisé »", () => {
    expect(parcoursArticle(base({ reglements: [reglement({ mode: "BANQUE", solde: 100000 })] })).badge).toBe("REGLE");
    const p = parcoursArticle(base({ reglements: [reglement({ mode: "BANQUE", solde: 0 })] }));
    expect(p.badge).toBe("REGULARISE");
    expect(cles(p)).toContain("REGULARISE");
  });

  it("lot G — 60 000 Caisse + 40 000 Banque : réglé = 100 000, retours des deux modes comptés, régularisé seulement si les deux soldes sont nuls", () => {
    const mixte = (soldeBanque: number) =>
      parcoursArticle(
        base({
          reglements: [
            reglement({ id: "c", montant: 60000, mode: "CAISSE", solde: 0, retours: [{ estReceptionne: true, montantARetourner: 10000 }] }),
            reglement({ id: "b", montant: 40000, mode: "BANQUE", solde: soldeBanque, retours: [{ estReceptionne: false, montantARetourner: 5000 }] }),
          ],
        })
      );
    const p = mixte(0);
    expect(p.montants).toMatchObject({ regle: 100000, reste: 0, retourAttendu: 15000, retourRecu: 10000 });
    expect(p.badge).toBe("RETOUR_EN_ATTENTE");
    expect(mixte(0).etapes.find((x) => x.cle === "REGLE")!.lignes.join(" ")).toMatch(/Caisse/);
    expect(mixte(0).etapes.find((x) => x.cle === "REGLE")!.lignes.join(" ")).toMatch(/Banque/);
    // Sans retour en attente : le solde Banque non nul empêche « Régularisé ».
    const sansAttente = (soldeBanque: number) =>
      parcoursArticle(
        base({
          reglements: [
            reglement({ id: "c", montant: 60000, solde: 0 }),
            reglement({ id: "b", montant: 40000, mode: "BANQUE", solde: soldeBanque }),
          ],
        })
      );
    expect(sansAttente(40000).badge).toBe("REGLE");
    expect(sansAttente(0).badge).toBe("REGULARISE");
  });

  it("un règlement brouillon ou annulé ne compte pas", () => {
    const p = parcoursArticle(base({ reglements: [reglement({ estConfirme: false }), reglement({ estAnnule: true })] }));
    expect(p.badge).toBe("VALIDE");
    expect(p.montants.regle).toBe(0);
  });

  it("retour déclaré non reçu : « Retour en attente », attendu / reçu", () => {
    const p = parcoursArticle(base({ reglements: [reglement({ retours: [{ estReceptionne: false, montantARetourner: 30000 }] })] }));
    expect(p.badge).toBe("RETOUR_EN_ATTENTE");
    expect(cles(p)).toEqual(["VALIDE", "REGLE", "RETOUR"]);
    expect(p.montants).toMatchObject({ retourAttendu: 30000, retourRecu: 0 });
  });

  it("retour reçu et solde nul : « Régularisé », avec l'étape Régularisé", () => {
    const p = parcoursArticle(base({ reglements: [reglement({ solde: 0, retours: [{ estReceptionne: true, montantARetourner: 30000 }] })] }));
    expect(p.badge).toBe("REGULARISE");
    expect(cles(p)).toEqual(["VALIDE", "REGLE", "RETOUR", "REGULARISE"]);
    expect(p.montants).toMatchObject({ retourAttendu: 30000, retourRecu: 30000 });
  });

  it("réglé en Caisse avec un solde à régulariser : « Réglé », pas « Régularisé »", () => {
    expect(parcoursArticle(base({ reglements: [reglement({ solde: 20000 })] })).badge).toBe("REGLE");
  });

  it("régularisation indéterminée (retour exceptionnel au niveau de la demande) : jamais « Régularisé », note explicative", () => {
    const p = parcoursArticle(base({ regularisationIndeterminee: true, reglements: [reglement({ solde: 0 })] }));
    expect(p.badge).toBe("REGLE");
    expect(p.note).toContain("retour exceptionnel");
  });

  it("deux règlements Caisse d'un même article : régularisé seulement si les deux soldes sont nuls", () => {
    const deux = (s2: number) =>
      parcoursArticle(base({ reglements: [reglement({ id: "r1", montant: 60000, solde: 0 }), reglement({ id: "r2", montant: 40000, solde: s2 })] }));
    expect(deux(0).badge).toBe("REGULARISE");
    expect(deux(10).badge).toBe("REGLE");
  });
  it("retour externe rattaché (fonds versé par banque) : étape dédiée, fonds rendus à la caisse", () => {
    const p = parcoursArticle(
      base({
        reglements: [reglement({ mode: "BANQUE", montant: 40000, solde: 0 })],
        retoursExternes: [{ montant: 15000, creeAt: new Date("2026-10-19T08:00:00Z") }],
      })
    );
    expect(cles(p)).toContain("RETOUR_EXTERNE");
    const etape = p.etapes.find((e) => e.cle === "RETOUR_EXTERNE")!;
    expect(etape.lignes.join(" ")).toMatch(/15.000 FCFA — fonds versé par banque, rendu à la caisse/);
    // Sans retour externe : pas d'étape.
    expect(cles(parcoursArticle(base({ reglements: [reglement({ mode: "BANQUE", montant: 40000 })] })))).not.toContain("RETOUR_EXTERNE");
  });
});
