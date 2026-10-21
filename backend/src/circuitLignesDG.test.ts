import { describe, expect, it } from "vitest";

import {
  approbateurClotureParLignesDG,
  detailLignesDG,
  determinerParcours,
  etatLigneDG,
  friseProgression,
  MESSAGE_DEUX_PERSONNES,
  raisonIndisponible,
  refusSoumissionLignes,
  transition,
  type ActeurCircuit,
  type ActionCircuit,
  type DemandeCircuit,
  type LigneCircuit,
} from "./circuitDemande";
import { notificationRefusLigneDG, notificationsEtape, type ContexteNotificationCircuit } from "./circuitNotifications";
import type { EtapeCircuit } from "./generated/prisma/enums";

/** Lot M : tout envoi de la Finance au DG et toute réponse du DG portent un motif (10 à 300 caractères). */
const MOTIF_TEST = "Motif de test suffisant";

// Soumission au DG ligne par ligne (2026-10-10).

const DEMANDEUR = "u-demandeur";
const acteur = (userId: string, permissions: string[]): ActeurCircuit => ({ userId, permissions, estResponsableServiceDuDemandeur: false });
const FINANCE = acteur("u-fin", ["treso.decider_finance", "treso.soumettre_dg"]);
const FINANCE2 = acteur("u-fin2", ["treso.decider_finance", "treso.soumettre_dg"]);
const DG = acteur("u-dg", ["treso.decider_dg", "treso.approuver_validation_complete"]);
const ASSISTANT = acteur("u-assist", ["treso.effectuer_reglement", "treso.receptionner_retour"]);
const TOUT = acteur("u-tout", ["treso.decider_finance", "treso.soumettre_dg", "treso.decider_dg"]);

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
const enAttente = (id: string) => ligne(id, { soumiseAuDG: true });
const valideeDG = (id: string, par = DG.userId, at = new Date("2026-10-10T09:00:00Z")) =>
  ligne(id, { soumiseAuDG: true, decisionDG: "VALIDEE", decisionDGParId: par, decisionDGAt: at });
const refuseeDG = (id: string) => ligne(id, { soumiseAuDG: true, decisionDG: "REFUSEE", decisionDGParId: DG.userId });

function demande(etape: EtapeCircuit, lignes: LigneCircuit[]): DemandeCircuit {
  const p = determinerParcours({ estDG: false, estFinance: false, estResponsableDeSonService: true }, "STANDARD");
  return { etape, createurId: DEMANDEUR, typeDemande: "STANDARD", ...p, lignes };
}
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

describe("soumission partielle (règle 1)", () => {
  const lignes = [ligne("a"), ligne("b"), ligne("c")];

  // RÉÉCRIT (lot B) : l'étape se déduit des articles ; la Finance garde l'étape tant qu'un article l'attend.
  it("la Finance soumet une partie des lignes : la demande reste à l'étape Finance (l'article b l'attend encore)", () => {
    const r = ok(demande("FINANCE", lignes), FINANCE, { type: "SOUMETTRE_LIGNES_DG", ligneIds: ["a", "c"], motif: MOTIF_TEST });
    expect(r.etapeSuivante).toBe("FINANCE");
    expect(r.effets.soumiseAuDG).toBe(true);
  });

  it("la Finance soumet TOUS ses articles : la demande passe à l'étape DG", () => {
    const r = ok(demande("FINANCE", [ligne("a"), ligne("b")]), FINANCE, { type: "SOUMETTRE_LIGNES_DG", ligneIds: ["a", "b"], motif: MOTIF_TEST });
    expect(r.etapeSuivante).toBe("DG");
  });

  it("permission treso.soumettre_dg requise", () => {
    expect(ko(demande("FINANCE", lignes), DG, { type: "SOUMETTRE_LIGNES_DG", ligneIds: ["a"], motif: MOTIF_TEST })).toBe("Action non autorisée.");
  });

  it("une ligne sans catégorie ne peut pas être soumise", () => {
    const d = demande("FINANCE", [ligne("a"), ligne("b", { categorisee: false })]);
    expect(ko(d, FINANCE, { type: "SOUMETTRE_LIGNES_DG", ligneIds: ["b"], motif: MOTIF_TEST })).toContain("Catégorisez la ligne « Ligne b »");
  });

  it("sélection vide, ligne étrangère, ligne déjà en attente ou déjà validée par le DG : refusées", () => {
    const d = [ligne("a"), enAttente("b"), valideeDG("c")];
    expect(refusSoumissionLignes(d, [])).toContain("au moins une ligne");
    expect(refusSoumissionLignes(d, ["zz"])).toContain("ne fait pas partie");
    expect(refusSoumissionLignes(d, ["b"])).toContain("attend déjà");
    expect(refusSoumissionLignes(d, ["c"])).toContain("déjà été validée");
    expect(refusSoumissionLignes(d, ["a"])).toBeNull();
  });

  it("soumission complémentaire pendant que le DG décide : tous les articles chez le DG, étape DG", () => {
    const r = ok(demande("DG", [enAttente("a"), ligne("b")]), FINANCE, { type: "SOUMETTRE_LIGNES_DG", ligneIds: ["b"], motif: MOTIF_TEST });
    expect(r.etapeSuivante).toBe("DG");
  });

  it("le demandeur ne soumet pas sa propre demande", () => {
    const d = { ...demande("FINANCE", lignes), createurId: FINANCE.userId };
    expect(ko(d, FINANCE, { type: "SOUMETTRE_LIGNES_DG", ligneIds: ["a"], motif: MOTIF_TEST })).toContain("propre demande");
  });

  it("l'ancienne soumission de la demande entière est remplacée par la sélection", () => {
    expect(ko(demande("FINANCE", lignes), FINANCE, { type: "SOUMETTRE_DG", motif: MOTIF_TEST })).toBe("Choisissez les lignes à soumettre au DG.");
  });

  // RÉÉCRIT (lot B) : le DG du cas b décide un SOUS-ENSEMBLE d'articles, à des moments différents (décision définitive).
  it("cas b (DG obligatoire) : pas de sélection, le DG décide les articles par sous-ensemble", () => {
    const p = determinerParcours({ estDG: false, estFinance: true, estResponsableDeSonService: false }, "STANDARD");
    const d: DemandeCircuit = { etape: "DG", createurId: DEMANDEUR, typeDemande: "STANDARD", ...p, lignes };
    expect(ko(d, FINANCE, { type: "SOUMETTRE_LIGNES_DG", ligneIds: ["a"], motif: MOTIF_TEST })).toContain("soumission d'office");
    const partiel = ok(d, DG, { type: "DECIDER_LIGNES", decisions: [{ ligneId: "a", statut: "VALIDEE" }], motifDG: MOTIF_TEST });
    expect(partiel.etapeSuivante).toBe("DG");
    expect(partiel.effets.approbationClotureParDG).toBeUndefined();
    const fin = ok(d, DG, {
      type: "DECIDER_LIGNES",
      decisions: [
        { ligneId: "a", statut: "VALIDEE" },
        { ligneId: "b", statut: "REJETEE" },
        { ligneId: "c", statut: "VALIDEE" },
      ],
      motifDG: MOTIF_TEST,
    });
    expect(fin.etapeSuivante).toBe("TERMINEE");
    expect(fin.effets.approbationClotureParDG).toBe(true);
  });
});

describe("décision du DG ligne par ligne (règle 2)", () => {
  // RÉÉCRIT (lot B) : plus d'étape « décision finale » : un article validé par le DG attend la confirmation de la
  // Finance, qui a donc quelque chose à faire dès la première décision du DG — l'étape déduite est Finance.
  it("le DG valide une ligne soumise ; il en reste une chez lui : la Finance a un article à confirmer (étape Finance)", () => {
    const d = demande("DG", [enAttente("a"), enAttente("b"), ligne("c")]);
    expect(ok(d, DG, { type: "DECIDER_LIGNE_DG", ligneId: "a", valider: true, motif: MOTIF_TEST }).etapeSuivante).toBe("FINANCE");
  });

  it("le DG décide pendant que la Finance traite d'autres articles : il n'est pas bloqué", () => {
    const d = demande("FINANCE", [enAttente("a"), ligne("c")]);
    expect(ok(d, DG, { type: "DECIDER_LIGNE_DG", ligneId: "a", valider: true, motif: MOTIF_TEST }).etapeSuivante).toBe("FINANCE");
  });

  it("dernière ligne en attente décidée : la Finance reprend la main", () => {
    const d = demande("DG", [valideeDG("a"), enAttente("b"), ligne("c")]);
    expect(ok(d, DG, { type: "DECIDER_LIGNE_DG", ligneId: "b", valider: false, motif: MOTIF_TEST }).etapeSuivante).toBe("FINANCE");
  });

  it("le DG ne décide qu'une ligne soumise et en attente", () => {
    const d = demande("DG", [enAttente("a"), ligne("c"), valideeDG("v")]);
    expect(ko(d, DG, { type: "DECIDER_LIGNE_DG", ligneId: "c", valider: true, motif: MOTIF_TEST })).toContain("n'attend pas votre décision");
    expect(ko(d, DG, { type: "DECIDER_LIGNE_DG", ligneId: "v", valider: true, motif: MOTIF_TEST })).toContain("n'attend pas votre décision");
  });

  it("refus sans motif : refusé", () => {
    const d = demande("DG", [enAttente("a")]);
    expect(ko(d, DG, { type: "DECIDER_LIGNE_DG", ligneId: "a", valider: false, motif: "x" })).toContain("motif");
    expect(ko(d, DG, { type: "DECIDER_LIGNE_DG", ligneId: "a", valider: false, motif: "x" })).toContain("rejet du DG");
  });

  it("permission treso.decider_dg requise ; jamais sa propre demande", () => {
    const d = demande("DG", [enAttente("a")]);
    expect(ko(d, FINANCE, { type: "DECIDER_LIGNE_DG", ligneId: "a", valider: true, motif: MOTIF_TEST })).toBe("Action non autorisée.");
    expect(ko({ ...d, createurId: DG.userId }, DG, { type: "DECIDER_LIGNE_DG", ligneId: "a", valider: true, motif: MOTIF_TEST })).toContain("propre demande");
  });

  it("le bénéficiaire d'un article ne le décide pas (garde par article)", () => {
    const d = demande("DG", [{ ...enAttente("a"), beneficiaireUserId: DG.userId }, enAttente("b")]);
    expect(ko(d, DG, { type: "DECIDER_LIGNE_DG", ligneId: "a", valider: true, motif: MOTIF_TEST })).toContain("bénéficiaire de l'article « Ligne a »");
    expect(ok(d, DG, { type: "DECIDER_LIGNE_DG", ligneId: "b", valider: true, motif: MOTIF_TEST }).ok).toBe(true);
  });

  it("l'ancienne décision du DG sur la demande entière ne s'applique plus aux demandes à lignes", () => {
    const d = demande("DG", [enAttente("a")]);
    expect(ko(d, DG, { type: "VALIDER_DG", motif: MOTIF_TEST })).toContain("une par une");
  });
});

describe("refus du DG puis nouvelle soumission (règle 3)", () => {
  it("une ligne refusée revient à la Finance, qui peut la resoumettre", () => {
    const d = demande("FINANCE", [valideeDG("a"), refuseeDG("b")]);
    expect(etatLigneDG(d.lignes![1])).toBe("REFUSEE_DG");
    // RÉÉCRIT (lot B) : « a » (validé par le DG) attend toujours la confirmation de la Finance : étape Finance.
    expect(ok(d, FINANCE, { type: "SOUMETTRE_LIGNES_DG", ligneIds: ["b"], motif: MOTIF_TEST }).etapeSuivante).toBe("FINANCE");
  });

  it("ou la rejeter définitivement (jamais la valider seule)", () => {
    const d = demande("FINANCE", [valideeDG("a"), refuseeDG("b")]);
    const ok1 = ok(d, FINANCE, {
      type: "DECIDER_LIGNES",
      decisions: [{ ligneId: "a", statut: "VALIDEE" }, { ligneId: "b", statut: "REJETEE" }],
    });
    expect(ok1.etapeSuivante).toBe("TERMINEE");
    expect(ko(d, FINANCE, { type: "DECIDER_LIGNES", decisions: [{ ligneId: "b", statut: "VALIDEE" }], motifDG: MOTIF_TEST })).toContain("rejetée par le DG");
  });

  it("une ligne validée par le DG reste validée (DG définitif)", () => {
    const d = demande("FINANCE", [valideeDG("a"), ligne("b")]);
    expect(ko(d, FINANCE, { type: "DECIDER_LIGNES", decisions: [{ ligneId: "a", statut: "REJETEE" }], motifDG: MOTIF_TEST })).toContain("reste validée");
  });

  it("la Finance ne rejette plus la demande entière quand le DG a validé ou refusé des lignes", () => {
    const d = demande("FINANCE", [valideeDG("a"), refuseeDG("b")]);
    expect(ko(d, FINANCE, { type: "REJETER", motif: "Motif" })).toContain("déjà validés");
    expect(ko(demande("FINANCE", [refuseeDG("b"), ligne("c")]), FINANCE, { type: "REJETER", motif: "Motif" })).toContain("soumis au DG");
  });
});

// RÉÉCRIT (lot B) : la règle 4 (« décision finale bloquée tant qu'une ligne attend le DG ») DISPARAÎT. La Finance décide
// les articles qu'elle ne soumet pas pendant que le DG examine les autres ; seuls les articles chez le DG lui échappent.
describe("la Finance n'est plus bloquée par le DG (règle 4 supprimée)", () => {
  it("décision d'un article non soumis pendant qu'un autre attend le DG : acceptée", () => {
    const d = demande("FINANCE", [enAttente("a"), ligne("b")]);
    const r = ok(d, FINANCE, { type: "DECIDER_LIGNES", decisions: [{ ligneId: "b", statut: "VALIDEE" }], motifDG: MOTIF_TEST });
    expect(r.etapeSuivante).toBe("DG");
    expect(r.effets.decideurFinance).toBe(true);
  });

  it("mais un article qui attend le DG ne se décide pas à sa place", () => {
    const d = demande("FINANCE", [enAttente("a"), ligne("b")]);
    expect(ko(d, FINANCE, { type: "DECIDER_LIGNES", decisions: [{ ligneId: "a", statut: "VALIDEE" }], motifDG: MOTIF_TEST })).toContain("attend la décision du DG");
  });

  it("deux personnes : le DG qui a décidé un article ne prend pas de décision Finance", () => {
    const d = demande("FINANCE", [valideeDG("a", TOUT.userId), ligne("b")]);
    expect(ko(d, TOUT, { type: "DECIDER_LIGNES", decisions: [{ ligneId: "b", statut: "VALIDEE" }], motifDG: MOTIF_TEST })).toBe(MESSAGE_DEUX_PERSONNES);
    expect(ok(d, FINANCE2, { type: "DECIDER_LIGNES", decisions: [{ ligneId: "b", statut: "VALIDEE" }], motifDG: MOTIF_TEST }).etapeSuivante).toBe("FINANCE");
  });

  it("deux personnes, sens inverse : le décideur Finance d'un article ne décide pas comme DG", () => {
    const d = demande("FINANCE", [ligne("a", { statut: "VALIDEE", decideurFinanceId: TOUT.userId }), enAttente("b")]);
    expect(ko(d, TOUT, { type: "DECIDER_LIGNE_DG", ligneId: "b", valider: true, motif: MOTIF_TEST })).toBe(MESSAGE_DEUX_PERSONNES);
    expect(ok(d, DG, { type: "DECIDER_LIGNE_DG", ligneId: "b", valider: true, motif: MOTIF_TEST }).ok).toBe(true);
  });

  it("l'Assistant Finance attend le DG quand seuls des articles sont chez lui (comportement inchangé)", () => {
    const d = demande("DG", [enAttente("a")]);
    expect(raisonIndisponible(d, ASSISTANT, "DECIDER_LIGNES")).toBe("En attente de la décision du DG.");
  });
});

describe("règle de clôture (règle 5)", () => {
  it("toutes les lignes validées l'ont été par le DG : son approbation de clôture est acquise", () => {
    const finales = [
      { ...valideeDG("a", "dg-1", new Date("2026-10-10T08:00:00Z")), statut: "VALIDEE" as const },
      { ...valideeDG("b", "dg-2", new Date("2026-10-10T10:00:00Z")), statut: "VALIDEE" as const },
      { ...refuseeDG("c"), statut: "REJETEE" as const },
    ];
    expect(approbateurClotureParLignesDG(finales)).toBe("dg-2");
  });

  it("mixte (une ligne validée par la Finance seule) : le DG approuvera la clôture à la fin", () => {
    const finales = [
      { ...valideeDG("a"), statut: "VALIDEE" as const },
      { ...ligne("b"), statut: "VALIDEE" as const },
    ];
    expect(approbateurClotureParLignesDG(finales)).toBeNull();
  });

  it("aucune ligne validée par le DG : rien d'acquis", () => {
    expect(approbateurClotureParLignesDG([{ ...ligne("a"), statut: "VALIDEE" }])).toBeNull();
  });

  // RÉÉCRIT (lot B) : l'approbation est calculée par le moteur sur les articles finaux (plus d'argument de l'appelant).
  it("la dernière décision de la Finance applique l'approbation acquise, au nom du DG", () => {
    const d = demande("FINANCE", [valideeDG("a")]);
    const r = ok(d, FINANCE, { type: "DECIDER_LIGNES", decisions: [{ ligneId: "a", statut: "VALIDEE" }], motifDG: MOTIF_TEST });
    expect(r.etapeSuivante).toBe("TERMINEE");
    expect(r.effets.approbationClotureParDG).toBe(true);
    expect(r.effets.approbateurDGId).toBe(DG.userId);
  });

  it("mixte (un article validé par la Finance seule) : pas d'approbation acquise, le DG approuvera à la fin", () => {
    const d = demande("FINANCE", [valideeDG("a"), ligne("b")]);
    const r = ok(d, FINANCE, {
      type: "DECIDER_LIGNES",
      decisions: [{ ligneId: "a", statut: "VALIDEE" }, { ligneId: "b", statut: "VALIDEE" }],
    });
    expect(r.etapeSuivante).toBe("TERMINEE");
    expect(r.effets.approbationClotureParDG).toBeUndefined();
  });
});

describe("frise : état partiel de l'étape DG", () => {
  it("lignes soumises, en attente, validées et refusées", () => {
    const d = { ...demande("DG", [enAttente("a"), valideeDG("b"), refuseeDG("c"), ligne("d")]), soumiseAuDG: true };
    expect(detailLignesDG(d)).toBe("3 lignes sur 4 soumises · 1 en attente · 1 validée · 1 rejetée");
    const dg = friseProgression(d).find((e) => e.etape === "DG")!;
    expect(dg.statut).toBe("EN_COURS");
    expect(dg.detail).toContain("1 en attente");
  });

  it("aucune ligne soumise : pas de détail", () => {
    expect(detailLignesDG(demande("FINANCE", [ligne("a")]))).toBeUndefined();
  });
});

describe("notifications de la soumission ligne par ligne", () => {
  const articles = { total: 3, traites: 0, validees: 0, rejetees: 0, pourFinance: 1, valideesDGAConfirmer: 0, refuseesDGATrancher: 0, chezDG: 2 };
  const ctx = (p: Partial<ContexteNotificationCircuit> = {}): ContexteNotificationCircuit => ({
    demandeId: "d1",
    reference: "DEM-2026-000001",
    etape: "FINANCE",
    typeDemande: "STANDARD",
    createurId: DEMANDEUR,
    createurNom: "Collab",
    beneficiaireUserId: null,
    modeEtapeDG: "OPTIONNELLE",
    decideurFinanceId: null,
    dgApprobateurId: null,
    responsableServiceId: null,
    niveauRejet: null,
    motifRejet: null,
    montant: 30000,
    montantValide: null,
    approbationClotureNonRequise: false,
    validationCompleteParDG: false,
    articles,
    ...p,
  });
  const candidats = [
    { id: FINANCE.userId, permissions: ["treso.decider_finance", "treso.soumettre_dg"] },
    { id: "u-soumet", permissions: ["treso.soumettre_dg"] },
    { id: DG.userId, permissions: ["treso.decider_dg"] },
    { id: DEMANDEUR, permissions: ["treso.soumettre_dg"] },
  ];

  it("soumission : seul le DG est notifié (même si la Finance a d'autres articles), avec le nombre d'articles", () => {
    const n = notificationsEtape(ctx(), candidats, FINANCE.userId, "SOUMISSION_DG");
    expect(n).toHaveLength(1);
    expect(n[0].destinataires).toEqual([DG.userId]);
    expect(n[0].message).toContain("2 articles de la demande");
  });

  it("refus d'une ligne : la Finance qui peut agir, jamais le DG ni le demandeur", () => {
    const n = notificationRefusLigneDG(ctx(), candidats, { libelle: "Repas", motif: "Trop cher" }, DG.userId)!;
    expect(n.destinataires.sort()).toEqual([FINANCE.userId, "u-soumet"].sort());
    expect(n.message).toContain("« Repas »");
    expect(n.message).toContain("Trop cher");
  });

  it("le DG a fini son examen : la Finance est prévenue, avec les articles à confirmer et à trancher", () => {
    const [n] = notificationsEtape(
      ctx({ articles: { ...articles, chezDG: 0, pourFinance: 2, valideesDGAConfirmer: 1, refuseesDGATrancher: 1, traites: 1, validees: 1 } }),
      candidats,
      DG.userId,
      "DECISION_DG"
    );
    expect(n.destinataires.sort()).toEqual([FINANCE.userId, "u-soumet"].sort());
    expect(n.message).toContain("1 article validé par le DG à confirmer");
    expect(n.message).toContain("1 article rejeté par le DG");
  });

  it("le DG décide un article alors qu'il lui en reste : la Finance n'est pas prévenue (seuls les refus notifient)", () => {
    expect(notificationsEtape(ctx(), candidats, DG.userId, "DECISION_DG")).toEqual([]);
  });
});
