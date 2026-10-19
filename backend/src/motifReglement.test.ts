import { describe, expect, it } from "vitest";

import {
  libelleMotifReglement,
  motifPourModification,
  MOTIF_REGLEMENT_MAX,
  MOTIF_REGLEMENT_NON_RENSEIGNE,
  nettoyerMotifReglement,
  refusMotifReglement,
} from "./motifReglement";

describe("refusMotifReglement (nouveau règlement)", () => {
  it("refuse un motif absent, vide ou fait d'espaces", () => {
    expect(refusMotifReglement(undefined)).not.toBeNull();
    expect(refusMotifReglement(null)).not.toBeNull();
    expect(refusMotifReglement("")).not.toBeNull();
    expect(refusMotifReglement("      ")).not.toBeNull();
  });
  it("refuse moins de 5 caractères, espaces de bord non comptés", () => {
    expect(refusMotifReglement("abcd")).not.toBeNull();
    expect(refusMotifReglement("  abcd  ")).not.toBeNull();
    expect(refusMotifReglement("a  b  c")).toBeNull(); // espaces internes réduits : « a b c » = 5
  });
  it("accepte exactement 5 caractères et plus", () => {
    expect(refusMotifReglement("abcde")).toBeNull();
    expect(refusMotifReglement("Achat de fournitures")).toBeNull();
  });
  it("refuse un motif démesuré", () => {
    expect(refusMotifReglement("x".repeat(MOTIF_REGLEMENT_MAX + 1))).not.toBeNull();
    expect(refusMotifReglement("x".repeat(MOTIF_REGLEMENT_MAX))).toBeNull();
  });
});

describe("motifPourModification (brouillons)", () => {
  it("un brouillon ancien sans motif n'est jamais bloqué", () => {
    expect(motifPourModification(null, "")).toEqual({ ok: true, motif: null });
    expect(motifPourModification(null, undefined)).toEqual({ ok: true, motif: null });
    expect(motifPourModification("", "  ")).toEqual({ ok: true, motif: null });
  });
  it("un brouillon ancien peut recevoir un motif, validé comme un nouveau", () => {
    expect(motifPourModification(null, "Achat matériel")).toEqual({ ok: true, motif: "Achat matériel" });
    expect(motifPourModification(null, "abc").ok).toBe(false);
  });
  it("un brouillon qui a un motif ne peut pas le vider ni le raccourcir", () => {
    expect(motifPourModification("Achat matériel", "").ok).toBe(false);
    expect(motifPourModification("Achat matériel", "abcd").ok).toBe(false);
    expect(motifPourModification("Achat matériel", " Nouveau motif ")).toEqual({ ok: true, motif: "Nouveau motif" });
  });
});

describe("libelleMotifReglement (anciens règlements)", () => {
  it("affiche « Non renseigné » sans motif", () => {
    expect(libelleMotifReglement(null)).toBe(MOTIF_REGLEMENT_NON_RENSEIGNE);
    expect(libelleMotifReglement(undefined)).toBe("Non renseigné");
    expect(libelleMotifReglement("   ")).toBe("Non renseigné");
  });
  it("affiche le motif nettoyé sinon", () => {
    expect(libelleMotifReglement("  Frais   de mission ")).toBe("Frais de mission");
    expect(nettoyerMotifReglement(" a \n b ")).toBe("a b");
  });
});
