import { describe, expect, it } from "vitest";

import {
  approbateurClotureParLignesDG,
  detailLignesDG,
  determinerParcours,
  etatLigneDG,
  friseProgression,
  MESSAGE_DEUX_PERSONNES,
  MESSAGE_LIGNES_EN_ATTENTE_DG,
  raisonIndisponible,
  refusDecisionsFinales,
  refusSoumissionLignes,
  transition,
  type ActeurCircuit,
  type ActionCircuit,
  type DemandeCircuit,
  type LigneCircuit,
} from "./circuitDemande";
import { notificationRefusLigneDG, notificationsEtape, type ContexteNotificationCircuit } from "./circuitNotifications";
import type { EtapeCircuit } from "./generated/prisma/enums";

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

  it("la Finance soumet une partie des lignes : la demande passe à l'étape DG", () => {
    const r = ok(demande("FINANCE", lignes), FINANCE, { type: "SOUMETTRE_LIGNES_DG", ligneIds: ["a", "c"] });
    expect(r.etapeSuivante).toBe("DG");
    expect(r.effets.soumiseAuDG).toBe(true);
  });

  it("permission treso.soumettre_dg requise", () => {
    expect(ko(demande("FINANCE", lignes), DG, { type: "SOUMETTRE_LIGNES_DG", ligneIds: ["a"] })).toBe("Action non autorisée.");
  });

  it("une ligne sans catégorie ne peut pas être soumise", () => {
    const d = demande("FINANCE", [ligne("a"), ligne("b", { categorisee: false })]);
    expect(ko(d, FINANCE, { type: "SOUMETTRE_LIGNES_DG", ligneIds: ["b"] })).toContain("Catégorisez la ligne « Ligne b »");
  });

  it("sélection vide, ligne étrangère, ligne déjà en attente ou déjà validée par le DG : refusées", () => {
    const d = [ligne("a"), enAttente("b"), valideeDG("c")];
    expect(refusSoumissionLignes(d, [])).toContain("au moins une ligne");
    expect(refusSoumissionLignes(d, ["zz"])).toContain("ne fait pas partie");
    expect(refusSoumissionLignes(d, ["b"])).toContain("attend déjà");
    expect(refusSoumissionLignes(d, ["c"])).toContain("déjà été validée");
    expect(refusSoumissionLignes(d, ["a"])).toBeNull();
  });

  it("soumission complémentaire pendant que le DG décide : la demande reste à l'étape DG", () => {
    const r = ok(demande("DG", [enAttente("a"), ligne("b")]), FINANCE, { type: "SOUMETTRE_LIGNES_DG", ligneIds: ["b"] });
    expect(r.etapeSuivante).toBe("DG");
  });

  it("le demandeur ne soumet pas sa propre demande", () => {
    const d = { ...demande("FINANCE", lignes), createurId: FINANCE.userId };
    expect(ko(d, FINANCE, { type: "SOUMETTRE_LIGNES_DG", ligneIds: ["a"] })).toContain("propre demande");
  });

  it("l'ancienne soumission de la demande entière est remplacée par la sélection", () => {
    expect(ko(demande("FINANCE", lignes), FINANCE, { type: "SOUMETTRE_DG" })).toBe("Choisissez les lignes à soumettre au DG.");
  });

  it("cas b (DG obligatoire) : pas de sélection, le DG décide toutes les lignes", () => {
    const p = determinerParcours({ estDG: false, estFinance: true, estResponsableDeSonService: false }, "STANDARD");
    const d: DemandeCircuit = { etape: "DG", createurId: DEMANDEUR, typeDemande: "STANDARD", ...p, lignes };
    expect(ko(d, FINANCE, { type: "SOUMETTRE_LIGNES_DG", ligneIds: ["a"] })).toContain("soumission d'office");
    expect(ok(d, DG, { type: "DECIDER_LIGNES", auMoinsUneValidee: true }).etapeSuivante).toBe("TERMINEE");
  });
});

describe("décision du DG ligne par ligne (règle 2)", () => {
  it("le DG valide une ligne soumise ; il en reste une : la demande reste à l'étape DG", () => {
    const d = demande("DG", [enAttente("a"), enAttente("b"), ligne("c")]);
    expect(ok(d, DG, { type: "DECIDER_LIGNE_DG", ligneId: "a", valider: true }).etapeSuivante).toBe("DG");
  });

  it("dernière ligne en attente décidée : la Finance reprend la main (décision finale)", () => {
    const d = demande("DG", [valideeDG("a"), enAttente("b"), ligne("c")]);
    expect(ok(d, DG, { type: "DECIDER_LIGNE_DG", ligneId: "b", valider: false, motif: "Hors budget" }).etapeSuivante).toBe("DECISION_FINALE");
  });

  it("le DG ne décide qu'une ligne soumise et en attente", () => {
    const d = demande("DG", [enAttente("a"), ligne("c"), valideeDG("v")]);
    expect(ko(d, DG, { type: "DECIDER_LIGNE_DG", ligneId: "c", valider: true })).toContain("n'attend pas votre décision");
    expect(ko(d, DG, { type: "DECIDER_LIGNE_DG", ligneId: "v", valider: true })).toContain("n'attend pas votre décision");
  });

  it("refus sans motif : refusé", () => {
    const d = demande("DG", [enAttente("a")]);
    expect(ko(d, DG, { type: "DECIDER_LIGNE_DG", ligneId: "a", valider: false, motif: "x" })).toContain("motif du refus");
  });

  it("permission treso.decider_dg requise ; jamais sa propre demande", () => {
    const d = demande("DG", [enAttente("a")]);
    expect(ko(d, FINANCE, { type: "DECIDER_LIGNE_DG", ligneId: "a", valider: true })).toBe("Action non autorisée.");
    expect(ko({ ...d, createurId: DG.userId }, DG, { type: "DECIDER_LIGNE_DG", ligneId: "a", valider: true })).toContain("propre demande");
  });

  it("l'ancienne décision du DG sur la demande entière ne s'applique plus aux demandes à lignes", () => {
    const d = demande("DG", [enAttente("a")]);
    expect(ko(d, DG, { type: "VALIDER_DG" })).toContain("une par une");
  });
});

describe("refus du DG puis nouvelle soumission (règle 3)", () => {
  it("une ligne refusée revient à la Finance, qui peut la resoumettre", () => {
    const d = demande("DECISION_FINALE", [valideeDG("a"), refuseeDG("b")]);
    expect(etatLigneDG(d.lignes![1])).toBe("REFUSEE_DG");
    expect(ok(d, FINANCE, { type: "SOUMETTRE_LIGNES_DG", ligneIds: ["b"] }).etapeSuivante).toBe("DG");
  });

  it("ou la refuser définitivement à la décision finale (jamais la valider seule)", () => {
    const lignes = [valideeDG("a"), refuseeDG("b")];
    expect(refusDecisionsFinales(lignes, [{ ligneId: "a", statut: "VALIDEE" }, { ligneId: "b", statut: "REJETEE" }])).toBeNull();
    expect(refusDecisionsFinales(lignes, [{ ligneId: "a", statut: "VALIDEE" }, { ligneId: "b", statut: "VALIDEE" }])).toContain("refusée par le DG");
  });

  it("une ligne validée par le DG reste validée (DG définitif)", () => {
    const lignes = [valideeDG("a"), ligne("b")];
    expect(refusDecisionsFinales(lignes, [{ ligneId: "a", statut: "REJETEE" }, { ligneId: "b", statut: "VALIDEE" }])).toContain("reste validée");
  });

  it("la Finance ne rejette plus la demande entière quand le DG a validé des lignes", () => {
    const d = demande("DECISION_FINALE", [valideeDG("a"), refuseeDG("b")]);
    expect(ko(d, FINANCE, { type: "REJETER", motif: "Motif" })).toContain("Le DG a validé des lignes");
  });
});

describe("blocage de la décision finale (règle 4)", () => {
  it("décision finale refusée tant qu'une ligne soumise attend le DG", () => {
    const d = demande("DG", [enAttente("a"), ligne("b")]);
    expect(ko(d, FINANCE, { type: "DECIDER_LIGNES", auMoinsUneValidee: true })).toBe(MESSAGE_LIGNES_EN_ATTENTE_DG);
    expect(raisonIndisponible(d, FINANCE, "DECIDER_LIGNES")).toBe(MESSAGE_LIGNES_EN_ATTENTE_DG);
    expect(refusDecisionsFinales(d.lignes!, [])).toBe(MESSAGE_LIGNES_EN_ATTENTE_DG);
  });

  it("débloquée dès que le DG a tout décidé", () => {
    const d = demande("DECISION_FINALE", [valideeDG("a"), ligne("b")]);
    expect(ok(d, FINANCE, { type: "DECIDER_LIGNES", auMoinsUneValidee: true }).etapeSuivante).toBe("TERMINEE");
  });

  it("deux personnes : le DG qui a décidé une ligne ne prend pas la décision finale", () => {
    const d = demande("DECISION_FINALE", [valideeDG("a", TOUT.userId), ligne("b")]);
    expect(ko(d, TOUT, { type: "DECIDER_LIGNES", auMoinsUneValidee: true })).toBe(MESSAGE_DEUX_PERSONNES);
    expect(ok(d, FINANCE2, { type: "DECIDER_LIGNES", auMoinsUneValidee: true }).etapeSuivante).toBe("TERMINEE");
  });

  it("l'Assistant Finance attend le DG (comportement inchangé)", () => {
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

  it("la décision finale applique l'approbation acquise, au nom du DG", () => {
    const d = demande("DECISION_FINALE", [valideeDG("a")]);
    const r = ok(d, FINANCE, { type: "DECIDER_LIGNES", auMoinsUneValidee: true, approbateurClotureId: DG.userId });
    expect(r.effets.approbationClotureParDG).toBe(true);
    expect(r.effets.approbateurDGId).toBe(DG.userId);
    const sans = ok(d, FINANCE, { type: "DECIDER_LIGNES", auMoinsUneValidee: true, approbateurClotureId: null });
    expect(sans.effets.approbationClotureParDG).toBeUndefined();
  });
});

describe("frise : état partiel de l'étape DG", () => {
  it("lignes soumises, en attente, validées et refusées", () => {
    const d = { ...demande("DG", [enAttente("a"), valideeDG("b"), refuseeDG("c"), ligne("d")]), soumiseAuDG: true };
    expect(detailLignesDG(d)).toBe("3 lignes sur 4 soumises · 1 en attente · 1 validée · 1 refusée");
    const dg = friseProgression(d).find((e) => e.etape === "DG")!;
    expect(dg.statut).toBe("EN_COURS");
    expect(dg.detail).toContain("1 en attente");
  });

  it("aucune ligne soumise : pas de détail", () => {
    expect(detailLignesDG(demande("FINANCE", [ligne("a")]))).toBeUndefined();
  });
});

describe("notifications de la soumission ligne par ligne", () => {
  const ctx = (p: Partial<ContexteNotificationCircuit> = {}): ContexteNotificationCircuit => ({
    demandeId: "d1",
    reference: "DEM-2026-000001",
    etape: "DG",
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
    lignesDG: { soumises: 2, enAttente: 2, validees: 0, refusees: 0 },
    ...p,
  });
  const candidats = [
    { id: FINANCE.userId, permissions: ["treso.decider_finance", "treso.soumettre_dg"] },
    { id: "u-soumet", permissions: ["treso.soumettre_dg"] },
    { id: DG.userId, permissions: ["treso.decider_dg"] },
    { id: DEMANDEUR, permissions: ["treso.soumettre_dg"] },
  ];

  it("soumission : seul le DG est notifié, avec le nombre de lignes", () => {
    const [n] = notificationsEtape(ctx(), candidats, FINANCE.userId);
    expect(n.destinataires).toEqual([DG.userId]);
    expect(n.message).toContain("2 lignes de la demande");
  });

  it("refus d'une ligne : la Finance qui peut agir, jamais le DG ni le demandeur", () => {
    const n = notificationRefusLigneDG(ctx(), candidats, { libelle: "Repas", motif: "Trop cher" }, DG.userId)!;
    expect(n.destinataires.sort()).toEqual([FINANCE.userId, "u-soumet"].sort());
    expect(n.message).toContain("« Repas »");
    expect(n.message).toContain("Trop cher");
  });

  it("dernière décision du DG : la décision finale annonce validées et refusées", () => {
    const [n] = notificationsEtape(
      ctx({ etape: "DECISION_FINALE", lignesDG: { soumises: 2, enAttente: 0, validees: 1, refusees: 1 } }),
      candidats,
      DG.userId
    );
    expect(n.destinataires).toEqual([FINANCE.userId]);
    expect(n.message).toContain("1 validée(s), 1 refusée(s)");
  });
});
