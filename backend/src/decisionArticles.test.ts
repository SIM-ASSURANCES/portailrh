import { describe, expect, it } from "vitest";

import {
  actionsPossibles,
  decideursFinanceDemande,
  determinerParcours,
  executionOuverte,
  friseProgression,
  MESSAGE_DEUX_PERSONNES,
  raisonIndisponible,
  refusApprobationCloture,
  transition,
  versLigneCircuit,
  type ActeurCircuit,
  type ActionCircuit,
  type DemandeCircuit,
  type LigneCircuit,
} from "./circuitDemande";
import type { EtapeCircuit } from "./generated/prisma/enums";

/** Lot M : tout envoi de la Finance au DG et toute réponse du DG portent un motif (10 à 300 caractères). */
const MOTIF_TEST = "Motif de test suffisant";

// Lot B (2026-10-15) : décision Finance par article, sous-ensemble d'articles, étape déduite, gardes par article.

const DEMANDEUR = "u-demandeur";
const acteur = (userId: string, permissions: string[]): ActeurCircuit => ({ userId, permissions, estResponsableServiceDuDemandeur: false });
const FINANCE = acteur("u-fin", ["treso.decider_finance", "treso.soumettre_dg"]);
const FINANCE2 = acteur("u-fin2", ["treso.decider_finance", "treso.soumettre_dg"]);
const DG = acteur("u-dg", ["treso.decider_dg", "treso.approuver_validation_complete"]);
const ASSISTANT = acteur("u-assist", ["treso.effectuer_reglement", "treso.receptionner_retour"]);

const ligne = (id: string, p: Partial<LigneCircuit> = {}): LigneCircuit => ({
  id,
  libelle: `Article ${id}`,
  categorisee: true,
  statut: "EN_ATTENTE",
  soumiseAuDG: false,
  decisionDG: null,
  decisionDGParId: null,
  ...p,
});
const validee = (id: string, p: Partial<LigneCircuit> = {}) => ligne(id, { statut: "VALIDEE", ...p });
const rejetee = (id: string) => ligne(id, { statut: "REJETEE" });
const chezDG = (id: string) => ligne(id, { soumiseAuDG: true });
const valideeDG = (id: string) => ligne(id, { soumiseAuDG: true, decisionDG: "VALIDEE", decisionDGParId: DG.userId, decisionDGAt: new Date("2026-10-15T09:00:00Z") });

function demande(lignes: LigneCircuit[], etape: EtapeCircuit = "FINANCE", mode: "OPTIONNELLE" | "OBLIGATOIRE" | "NON_REQUISE" = "OPTIONNELLE"): DemandeCircuit {
  const p = determinerParcours({ estDG: false, estFinance: mode === "OBLIGATOIRE", estResponsableDeSonService: true }, "STANDARD");
  return { etape, createurId: DEMANDEUR, typeDemande: "STANDARD", ...p, modeEtapeDG: mode, lignes };
}
const decider = (decisions: { ligneId: string; statut: "VALIDEE" | "REJETEE" }[]): ActionCircuit => ({ type: "DECIDER_LIGNES", decisions, motifDG: MOTIF_TEST });
function ok(d: DemandeCircuit, qui: ActeurCircuit, action: ActionCircuit) {
  const r = transition(d, qui, action);
  if (!r.ok) throw new Error(`refusé : ${r.message}`);
  return r;
}
function ko(d: DemandeCircuit, qui: ActeurCircuit, action: ActionCircuit): string {
  const r = transition(d, qui, action);
  if (r.ok) throw new Error(`accepté vers ${r.etapeSuivante}`);
  return r.message;
}

describe("décision d'un sous-ensemble d'articles", () => {
  const trois = () => demande([ligne("A"), ligne("B"), ligne("C")]);

  it("la Finance valide A et rejette B sans décider C : la demande reste à l'étape Finance", () => {
    const r = ok(trois(), FINANCE, decider([{ ligneId: "A", statut: "VALIDEE" }, { ligneId: "B", statut: "REJETEE" }]));
    expect(r.etapeSuivante).toBe("FINANCE");
    expect(r.effets.decideurFinance).toBe(true);
  });

  it("un seul article suffit, sans exiger que toutes les lignes soient couvertes", () => {
    expect(ok(trois(), FINANCE, decider([{ ligneId: "C", statut: "REJETEE" }])).etapeSuivante).toBe("FINANCE");
  });

  it("rejeter seul n'enregistre pas de décideur Finance (aucun argent engagé)", () => {
    expect(ok(trois(), FINANCE, decider([{ ligneId: "A", statut: "REJETEE" }])).effets.decideurFinance).toBeUndefined();
  });

  it("à des moments différents : A validé hier, B et C aujourd'hui → Terminée", () => {
    const d = demande([validee("A"), ligne("B"), ligne("C")]);
    const r = ok(d, FINANCE, decider([{ ligneId: "B", statut: "REJETEE" }, { ligneId: "C", statut: "VALIDEE" }]));
    expect(r.etapeSuivante).toBe("TERMINEE");
  });

  it("un article validé ou rejeté est définitif", () => {
    const d = demande([validee("A"), rejetee("B"), ligne("C")]);
    expect(ko(d, FINANCE, decider([{ ligneId: "A", statut: "REJETEE" }]))).toContain("déjà décidée");
    expect(ko(d, FINANCE, decider([{ ligneId: "B", statut: "VALIDEE" }]))).toContain("déjà décidée");
  });

  it("décisions vides, doublon ou article étranger : refusés", () => {
    expect(ko(trois(), FINANCE, decider([]))).toBe("Aucune décision à enregistrer.");
    expect(ko(trois(), FINANCE, decider([{ ligneId: "A", statut: "VALIDEE" }, { ligneId: "A", statut: "REJETEE" }]))).toContain("deux fois");
    expect(ko(trois(), FINANCE, decider([{ ligneId: "Z", statut: "VALIDEE" }]))).toContain("ne fait pas partie");
  });

  it("tous les articles rejetés : la demande repart en correction, niveau Finance", () => {
    const r = ok(trois(), FINANCE, decider([
      { ligneId: "A", statut: "REJETEE" }, { ligneId: "B", statut: "REJETEE" }, { ligneId: "C", statut: "REJETEE" },
    ]));
    expect(r.etapeSuivante).toBe("A_CORRIGER");
    expect(r.effets.niveauRejet).toBe("FINANCE");
  });

  it("le dernier rejet d'une demande déjà en partie validée ne la renvoie pas en correction", () => {
    expect(ok(demande([validee("A"), ligne("B")]), FINANCE, decider([{ ligneId: "B", statut: "REJETEE" }])).etapeSuivante).toBe("TERMINEE");
  });

  it("l'étape Service d'abord : la Finance ne décide pas encore", () => {
    expect(ko(demande([ligne("A")], "SERVICE"), FINANCE, decider([{ ligneId: "A", statut: "VALIDEE" }]))).toBe(
      "En attente de la validation du responsable de service."
    );
  });

  it("permission treso.decider_finance requise", () => {
    expect(ko(trois(), DG, decider([{ ligneId: "A", statut: "VALIDEE" }]))).toBe("Action non autorisée.");
    expect(ko(trois(), ASSISTANT, decider([{ ligneId: "A", statut: "VALIDEE" }]))).toBe("Action non autorisée.");
  });

  it("contrôle seul (bouton) : possible tant qu'un article attend la Finance, sinon la phrase d'attente", () => {
    expect(ok(trois(), FINANCE, { type: "DECIDER_LIGNES", motifDG: MOTIF_TEST }).ok).toBe(true);
    expect(raisonIndisponible(demande([chezDG("A")], "DG"), FINANCE, "DECIDER_LIGNES")).toBe("En attente de la décision du DG.");
    expect(raisonIndisponible(demande([validee("A")], "TERMINEE"), FINANCE, "DECIDER_LIGNES")).toBe("Décision finale prise.");
    expect(actionsPossibles(trois(), FINANCE)).toContain("DECIDER_LIGNES");
  });
});

describe("gardes par article : créateur, bénéficiaire, deux personnes", () => {
  it("le demandeur ne décide pas sa propre demande", () => {
    const d = { ...demande([ligne("A")]), createurId: FINANCE.userId };
    expect(ko(d, FINANCE, decider([{ ligneId: "A", statut: "VALIDEE" }]))).toContain("propre demande");
  });

  it("le bénéficiaire d'un article ne le décide pas, mais décide les autres", () => {
    const d = demande([ligne("A", { beneficiaireUserId: FINANCE.userId }), ligne("B")]);
    expect(ko(d, FINANCE, decider([{ ligneId: "A", statut: "VALIDEE" }]))).toBe("Vous êtes le bénéficiaire de l'article « Article A » : un autre compte le décide.");
    expect(ok(d, FINANCE, decider([{ ligneId: "B", statut: "VALIDEE" }])).ok).toBe(true);
    expect(ok(d, FINANCE2, decider([{ ligneId: "A", statut: "VALIDEE" }])).ok).toBe(true);
  });

  it("contrôle seul : si tous les articles restants lui appartiennent, la raison le dit", () => {
    const d = demande([ligne("A", { beneficiaireUserId: FINANCE.userId })]);
    expect(raisonIndisponible(d, FINANCE, "DECIDER_LIGNES")).toContain("bénéficiaire");
  });

  it("le bénéficiaire effectif vient de l'article, sinon de la demande (versLigneCircuit)", () => {
    const brute = { id: "x", libelle: "x", categorieId: null, statutValidation: "EN_ATTENTE" as const, soumiseAuDG: false, decisionDG: null, decisionDGParId: null };
    expect(versLigneCircuit(brute, { beneficiaireType: "COLLABORATEUR", beneficiaireUserId: "u-demande" }).beneficiaireUserId).toBe("u-demande");
    expect(
      versLigneCircuit({ ...brute, beneficiaireType: "COLLABORATEUR", beneficiaireUserId: "u-article" }, { beneficiaireType: "COLLABORATEUR", beneficiaireUserId: "u-demande" })
        .beneficiaireUserId
    ).toBe("u-article");
    // Article au nom libre : aucun compte, même si la demande en a un.
    expect(
      versLigneCircuit({ ...brute, beneficiaireType: "FOURNISSEUR", beneficiaireNom: "Fournisseur X" }, { beneficiaireType: "COLLABORATEUR", beneficiaireUserId: "u-demande" })
        .beneficiaireUserId
    ).toBeNull();
  });

  it("deux personnes : le décideur Finance d'un article n'approuve pas la clôture ; le DG si", () => {
    const lignes = [validee("A", { decideurFinanceId: FINANCE.userId }), valideeDG("B")];
    const decideurs = decideursFinanceDemande({ decideurFinanceId: null, lignes });
    expect(decideurs).toEqual([FINANCE.userId]);
    const d = { createurId: DEMANDEUR, decideursFinanceIds: decideurs, approbationClotureNonRequise: false };
    expect(refusApprobationCloture(d, FINANCE.userId)).toBe(MESSAGE_DEUX_PERSONNES);
    expect(refusApprobationCloture(d, DG.userId)).toBeNull();
  });

  it("deux personnes : décideurs de plusieurs articles et colonne de la demande, sans doublon", () => {
    expect(
      decideursFinanceDemande({ decideurFinanceId: "x", lignes: [{ decideurFinanceId: "x" }, { decideurFinanceId: "y" }, { decideurFinanceId: null }] }).sort()
    ).toEqual(["x", "y"]);
  });
});

describe("rejet de la demande entière (REJETER)", () => {
  const motif = { type: "REJETER" as const, motif: "Non conforme" };

  it("possible tant qu'aucun article n'est décidé : retour au demandeur", () => {
    const r = ok(demande([ligne("A"), ligne("B")]), FINANCE, motif);
    expect(r.etapeSuivante).toBe("A_CORRIGER");
    expect(r.effets.niveauRejet).toBe("FINANCE");
  });

  it("interdit dès qu'un article est validé", () => {
    expect(ko(demande([validee("A"), ligne("B")]), FINANCE, motif)).toContain("déjà validés");
  });

  it("interdit dès qu'un article est validé par le DG (à confirmer), rejeté, ou chez le DG", () => {
    expect(ko(demande([valideeDG("A"), ligne("B")]), FINANCE, motif)).toContain("déjà validés");
    expect(ko(demande([rejetee("A"), ligne("B")]), FINANCE, motif)).toContain("déjà rejetés");
    expect(ko(demande([chezDG("A"), ligne("B")]), FINANCE, motif)).toContain("soumis au DG");
  });

  it("motif obligatoire", () => {
    expect(ko(demande([ligne("A")]), FINANCE, { type: "REJETER", motif: "x" })).toContain("motif du rejet");
  });
});

describe("demande émise par la Finance (cas b) : le DG décide par sous-ensemble", () => {
  const b = () => demande([ligne("A"), ligne("B")], "DG", "OBLIGATOIRE");
  it("le DG décide A seul : reste à l'étape DG ; puis B : Terminée, approbation de clôture au nom du DG", () => {
    expect(ok(b(), DG, decider([{ ligneId: "A", statut: "VALIDEE" }])).etapeSuivante).toBe("DG");
    const fin = ok(demande([validee("A"), ligne("B")], "DG", "OBLIGATOIRE"), DG, decider([{ ligneId: "B", statut: "VALIDEE" }]));
    expect(fin.etapeSuivante).toBe("TERMINEE");
    expect(fin.effets.approbationClotureParDG).toBe(true);
  });
  it("la Finance n'a rien à y décider ; le DG ne décide pas sa propre demande", () => {
    expect(ko(b(), FINANCE, decider([{ ligneId: "A", statut: "VALIDEE" }]))).toBe("Action non autorisée.");
    expect(ko({ ...b(), createurId: DG.userId }, DG, decider([{ ligneId: "A", statut: "VALIDEE" }]))).toContain("propre demande");
  });
  it("tous rejetés par le DG : à corriger, niveau DG", () => {
    const r = ok(b(), DG, decider([{ ligneId: "A", statut: "REJETEE" }, { ligneId: "B", statut: "REJETEE" }]));
    expect(r.etapeSuivante).toBe("A_CORRIGER");
    expect(r.effets.niveauRejet).toBe("DG");
  });
});

describe("dépense directe (sans article) : comportement d'origine inchangé", () => {
  const dd = (etape: EtapeCircuit): DemandeCircuit => ({
    etape, createurId: FINANCE.userId, typeDemande: "DEPENSE_DIRECTE", etapeServiceRequise: false, etapeFinanceRequise: true, modeEtapeDG: "OPTIONNELLE",
  });
  it("validation du montant par son auteur Finance (exception tracée) → Terminée", () => {
    const r = ok(dd("FINANCE"), FINANCE, { type: "DECIDER_LIGNES", auMoinsUneValidee: true, motifDG: MOTIF_TEST });
    expect(r.etapeSuivante).toBe("TERMINEE");
    expect(r.effets.decisionParAuteurDepenseDirecte).toBe(true);
  });
  it("rejet de la demande entière → à corriger", () => {
    expect(ok(dd("FINANCE"), FINANCE, { type: "REJETER", motif: "Non conforme" }).etapeSuivante).toBe("A_CORRIGER");
  });
});

describe("exécution ouverte à l'Assistant Finance", () => {
  it("dès qu'un article est validé, sans attendre les autres", () => {
    expect(executionOuverte({ etape: "FINANCE", lignes: [{ statut: "VALIDEE" }, { statut: "EN_ATTENTE" }] })).toBe(true);
    expect(executionOuverte({ etape: "FINANCE", lignes: [{ statut: "REJETEE" }, { statut: "EN_ATTENTE" }] })).toBe(false);
  });
  it("sans article : seulement une fois la décision finale prise", () => {
    expect(executionOuverte({ etape: "TERMINEE", lignes: [] })).toBe(true);
    expect(executionOuverte({ etape: "FINANCE" })).toBe(false);
  });
});

describe("frise de progression par articles", () => {
  const frise = (d: DemandeCircuit, soumise = false) => friseProgression({ ...d, soumiseAuDG: soumise });
  const etat = (f: ReturnType<typeof friseProgression>, e: string) => f.find((x) => x.etape === e)!;

  it("Finance et DG peuvent être « en cours » ensemble, avec le compteur d'articles traités", () => {
    const f = frise(demande([validee("A"), ligne("B"), chezDG("C")]), true);
    expect(etat(f, "FINANCE").statut).toBe("EN_COURS");
    expect(etat(f, "FINANCE").detail).toBe("1 article traité sur 3");
    expect(etat(f, "DG").statut).toBe("EN_COURS");
    expect(etat(f, "ASSISTANT").statut).toBe("EN_COURS");
  });

  it("Finance faite, DG en cours : il ne reste que des articles chez le DG", () => {
    const f = frise(demande([validee("A"), chezDG("B")], "DG"), true);
    expect(etat(f, "FINANCE").statut).toBe("FAITE");
    expect(etat(f, "DG").statut).toBe("EN_COURS");
  });

  it("Terminée : Service, Finance, DG faites ; l'Assistant exécute", () => {
    const f = frise(demande([validee("A"), rejetee("B")], "TERMINEE"), false);
    expect(etat(f, "FINANCE").statut).toBe("FAITE");
    expect(etat(f, "DG").statut).toBe("NON_REQUISE");
    expect(etat(f, "ASSISTANT").statut).toBe("EN_COURS");
  });

  it("encore au Service : Finance et DG à venir, l'Assistant aussi", () => {
    const f = frise({ ...demande([ligne("A")], "SERVICE"), etapeServiceRequise: true });
    expect(etat(f, "SERVICE").statut).toBe("EN_COURS");
    expect(etat(f, "FINANCE").statut).toBe("A_VENIR");
    expect(etat(f, "ASSISTANT").statut).toBe("A_VENIR");
  });

  it("à corriger : rien n'est en cours", () => {
    const f = frise(demande([rejetee("A")], "A_CORRIGER"));
    expect(f.every((x) => x.statut !== "EN_COURS")).toBe(true);
  });
});
