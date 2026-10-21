import { describe, expect, it } from "vitest";

import {
  determinerParcours,
  transition,
  type ActeurCircuit,
  type ActionCircuit,
  type DemandeCircuit,
  type LigneCircuit,
} from "./circuitDemande";
import type { EtapeCircuit } from "./generated/prisma/enums";
import {
  aideMotifEchange,
  detailHistoriqueEchange,
  ECHANGES_FINANCE_DG,
  LIBELLE_MOTIF_NON_RENSEIGNE,
  motifEchangeValide,
  motifOuNonRenseigne,
  MOTIF_ECHANGE_MAX,
  MOTIF_ECHANGE_MIN,
  nettoyerMotifEchange,
  refusMotifEchange,
  suffixeMotifEchange,
} from "./motifEchange";
import { refusMotifReprise } from "./circuitReprise";

const OK = "Motif de test suffisant";
const TROP_COURT = "trop bref";
const TROP_LONG = "x".repeat(MOTIF_ECHANGE_MAX + 1);

describe("règle du motif d'échange (10 à 300 caractères)", () => {
  it("accepte 10 et 300 caractères, après nettoyage des espaces de bord", () => {
    expect(refusMotifEchange("a".repeat(10))).toBeNull();
    expect(refusMotifEchange("a".repeat(300))).toBeNull();
    expect(refusMotifEchange(`   ${"a".repeat(10)}   `)).toBeNull();
  });
  it("refuse l'absent, le vide, les espaces, le trop court et le trop long", () => {
    for (const m of [undefined, null, "", "      ", TROP_COURT, TROP_LONG, 12, {}]) {
      expect(refusMotifEchange(m)).not.toBeNull();
      expect(motifEchangeValide(m)).toBe(false);
    }
    expect(refusMotifEchange("a".repeat(9))).toContain("10 caractères");
    expect(refusMotifEchange(TROP_LONG)).toContain("300 caractères");
    expect(refusMotifEchange("", "la validation du DG")).toContain("pour la validation du DG");
  });
  it("nettoyage, aide et affichage « Non renseigné »", () => {
    expect(nettoyerMotifEchange("  abc  ")).toBe("abc");
    expect(nettoyerMotifEchange(null)).toBe("");
    expect(aideMotifEchange("  12345  ")).toBe(`${MOTIF_ECHANGE_MIN} à ${MOTIF_ECHANGE_MAX} caractères (5 saisis).`);
    expect(motifOuNonRenseigne(null)).toBe(LIBELLE_MOTIF_NON_RENSEIGNE);
    expect(motifOuNonRenseigne("  ")).toBe("Non renseigné");
    expect(motifOuNonRenseigne("Pour la direction")).toBe("Pour la direction");
    expect(suffixeMotifEchange(undefined)).toBe(" — motif : Non renseigné");
  });
  it("le renvoi à la Finance (reprise) suit la même règle, plafond compris", () => {
    expect(refusMotifReprise(undefined)).not.toBeNull();
    expect(refusMotifReprise(TROP_COURT)).not.toBeNull();
    expect(refusMotifReprise(TROP_LONG)).not.toBeNull();
    expect(refusMotifReprise(OK)).toBeNull();
  });
  it("la liste des échanges couvre les deux sens, sans doublon de code", () => {
    const codes = ECHANGES_FINANCE_DG.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(ECHANGES_FINANCE_DG.some((e) => e.sens === "FINANCE_VERS_DG")).toBe(true);
    expect(ECHANGES_FINANCE_DG.some((e) => e.sens === "DG_VERS_FINANCE")).toBe(true);
  });
});

describe("historique : échanges antérieurs au lot M", () => {
  it("un échange sans motif affiche « motif : Non renseigné », jamais réécrit", () => {
    expect(detailHistoriqueEchange("validation_dg", "Validée par le DG")).toBe("Validée par le DG — motif : Non renseigné");
    expect(detailHistoriqueEchange("budget_refuse", "Rejeté — motif : trop cher")).toBe("Rejeté — motif : trop cher");
    expect(detailHistoriqueEchange("soumission_dg", null)).toBe("Motif : Non renseigné");
  });
  it("une action qui n'est pas un échange Finance ↔ DG reste inchangée", () => {
    expect(detailHistoriqueEchange("reglement", "Règlement confirmé")).toBe("Règlement confirmé");
    expect(detailHistoriqueEchange("reglement", null)).toBeNull();
  });
});

// --- Le moteur du circuit refuse chaque échange sans motif valable --------------------------------------------------

const acteur = (userId: string, permissions: string[]): ActeurCircuit => ({ userId, permissions, estResponsableServiceDuDemandeur: false });
const FINANCE = acteur("u-fin", ["treso.decider_finance", "treso.soumettre_dg"]);
const DG = acteur("u-dg", ["treso.decider_dg", "treso.approuver_validation_complete"]);
const ligne = (id: string, p: Partial<LigneCircuit> = {}): LigneCircuit => ({
  id,
  libelle: `Ligne ${id}`,
  categorisee: true,
  statut: "EN_ATTENTE",
  soumiseAuDG: false,
  decisionDG: null,
  decisionDGParId: null,
  ...p,
});

function demande(etape: EtapeCircuit, profil = { estDG: false, estFinance: false, estResponsableDeSonService: false }, type: "STANDARD" | "DEPENSE_DIRECTE" = "STANDARD", lignes?: LigneCircuit[]): DemandeCircuit {
  const p = determinerParcours(profil, type);
  return { etape, createurId: "u-demandeur", typeDemande: type, ...p, ...(lignes ? { lignes } : {}) };
}

interface Cas {
  nom: string;
  d: DemandeCircuit;
  qui: ActeurCircuit;
  /** Construit l'action avec le motif essayé. */
  action: (motif: string | undefined) => ActionCircuit;
}

const CAS: Cas[] = [
  // Finance → DG
  { nom: "soumission de la demande au DG", d: demande("FINANCE", undefined, "DEPENSE_DIRECTE"), qui: FINANCE, action: (m) => ({ type: "SOUMETTRE_DG", motif: m as string }) },
  { nom: "resoumission au DG après un rejet", d: demande("REJET_DG"), qui: FINANCE, action: (m) => ({ type: "RESOUMETTRE_DG", motif: m as string }) },
  {
    nom: "soumission d'articles au DG",
    d: demande("FINANCE", undefined, "STANDARD", [ligne("a"), ligne("b")]),
    qui: FINANCE,
    action: (m) => ({ type: "SOUMETTRE_LIGNES_DG", ligneIds: ["a"], motif: m }),
  },
  // DG → Finance
  { nom: "validation de la demande par le DG", d: demande("DG"), qui: DG, action: (m) => ({ type: "VALIDER_DG", motif: m as string }) },
  { nom: "rejet de la demande par le DG", d: demande("DG"), qui: DG, action: (m) => ({ type: "REJETER_DG", motif: m as string }) },
  {
    nom: "validation d'un article soumis (DG)",
    d: demande("DG", undefined, "STANDARD", [ligne("a", { soumiseAuDG: true })]),
    qui: DG,
    action: (m) => ({ type: "DECIDER_LIGNE_DG", ligneId: "a", valider: true, motif: m }),
  },
  {
    nom: "rejet d'un article soumis (DG)",
    d: demande("DG", undefined, "STANDARD", [ligne("a", { soumiseAuDG: true })]),
    qui: DG,
    action: (m) => ({ type: "DECIDER_LIGNE_DG", ligneId: "a", valider: false, motif: m }),
  },
  {
    nom: "décision du DG sur les articles de la demande de la Finance (cas b)",
    d: demande("DG", { estDG: false, estFinance: true, estResponsableDeSonService: false }, "STANDARD", [ligne("a"), ligne("b")]),
    qui: DG,
    action: (m) => ({ type: "DECIDER_LIGNES", decisions: [{ ligneId: "a", statut: "VALIDEE" }], motifDG: m }),
  },
  {
    nom: "rejet de la demande entière par le DG (cas b)",
    d: demande("DG", { estDG: false, estFinance: true, estResponsableDeSonService: false }),
    qui: DG,
    action: (m) => ({ type: "REJETER", motif: m as string }),
  },
];

describe("le moteur refuse chaque échange Finance ↔ DG sans motif valable", () => {
  for (const c of CAS) {
    describe(c.nom, () => {
      it("accepté avec un motif valable", () => {
        const r = transition(c.d, c.qui, c.action(OK));
        expect(r.ok, r.ok ? "" : r.message).toBe(true);
      });
      for (const [libelle, motif] of [
        ["absent", undefined],
        ["vide", ""],
        ["espaces seuls", "          "],
        ["trop court (9 caractères)", "123456789"],
        ["trop long (301 caractères)", TROP_LONG],
      ] as const) {
        it(`refusé : motif ${libelle}`, () => {
          const r = transition(c.d, c.qui, c.action(motif));
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.message.toLowerCase()).toContain("motif");
        });
      }
    });
  }
});
