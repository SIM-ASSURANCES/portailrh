import { describe, expect, it } from "vitest";

import { MESSAGE_ATTENTE_VALIDATION_FINALE, transition, type ActeurCircuit, type DemandeCircuit, type LigneCircuit } from "./circuitDemande";
import {
  bandeauEtapeDG,
  MESSAGE_ARTICLE_SANS_CATEGORIE_DG,
  MESSAGE_AUCUN_ARTICLE_SOUMETTABLE,
  MESSAGE_BANDEAU_ETAPE_DG,
  MESSAGE_COCHER_UN_ARTICLE,
  MESSAGE_DG_DECIDE_D_OFFICE,
  MESSAGE_PERMISSION_SOUMETTRE_DG,
  MESSAGE_SOUMISSION_DG_NON_REQUISE,
  raisonBoutonGlobalSoumission,
  raisonSoumissionArticle,
  raisonSoumissionDemande,
} from "./soumissionDGEcran";

// Lot 2 : phrases affichées sous les boutons « Soumettre au DG » grisés. Aucune règle métier nouvelle : on vérifie
// surtout que l'écran ne contredit jamais le moteur (`transition`).

const ligne = (id: string, o: Partial<LigneCircuit> = {}): LigneCircuit => ({
  id,
  libelle: id,
  categorisee: true,
  statut: "EN_ATTENTE",
  soumiseAuDG: false,
  decisionDG: null,
  decisionDGParId: null,
  ...o,
});
const demande = (o: Partial<DemandeCircuit> = {}): DemandeCircuit => ({
  etape: "FINANCE",
  createurId: "u-collab",
  typeDemande: "STANDARD",
  etapeServiceRequise: true,
  etapeFinanceRequise: true,
  modeEtapeDG: "OPTIONNELLE",
  decideurFinanceId: null,
  approbateurDGId: null,
  lignes: [ligne("A"), ligne("B"), ligne("C", { categorisee: false })],
  ...o,
});
const acteur = (permissions: string[], userId = "u-fin"): ActeurCircuit => ({ userId, permissions, estResponsableServiceDuDemandeur: false });
const FINANCE = acteur(["treso.decider_finance", "treso.soumettre_dg"]);
const SANS_DG = acteur(["treso.decider_finance"]);
const ASSISTANT = acteur(["treso.effectuer_reglement", "treso.receptionner_retour"], "u-assist");

describe("raisonSoumissionDemande", () => {
  it("Finance avec la permission, demande à l'étape Finance : aucune raison", () => {
    expect(raisonSoumissionDemande(demande(), FINANCE, "LIGNES")).toBeNull();
  });
  it("cas A : sans treso.soumettre_dg, phrase explicite", () => {
    expect(raisonSoumissionDemande(demande(), SANS_DG, "LIGNES")).toBe(MESSAGE_PERMISSION_SOUMETTRE_DG);
    expect(raisonSoumissionDemande(demande(), SANS_DG, "DEMANDE")).toBe(MESSAGE_PERMISSION_SOUMETTRE_DG);
    expect(MESSAGE_PERMISSION_SOUMETTRE_DG).toBe("Votre rôle n'a pas la permission de soumettre au DG. Contactez un administrateur.");
  });
  it("cas D : l'Assistant Finance attend la validation finale", () => {
    expect(raisonSoumissionDemande(demande(), ASSISTANT, "LIGNES")).toBe(MESSAGE_ATTENTE_VALIDATION_FINALE);
  });
  // RÉÉCRIT (lot B) : l'Assistant n'attend plus la décision de TOUS les articles — dès qu'un article est validé, il agit.
  it("cas D : dès qu'un article est validé, l'Assistant n'est plus « en attente »", () => {
    const d = demande({ lignes: [ligne("A", { statut: "VALIDEE" }), ligne("B"), ligne("C", { categorisee: false })] });
    expect(raisonSoumissionDemande(d, ASSISTANT, "LIGNES")).toBe(MESSAGE_PERMISSION_SOUMETTRE_DG);
  });
  it("cas C : demande émise par la Finance ou par le DG, phrase qui explique", () => {
    expect(raisonSoumissionDemande(demande({ modeEtapeDG: "OBLIGATOIRE", etape: "DG" }), FINANCE, "DEMANDE")).toBe(MESSAGE_DG_DECIDE_D_OFFICE);
    expect(raisonSoumissionDemande(demande({ modeEtapeDG: "NON_REQUISE" }), FINANCE, "DEMANDE")).toBe(MESSAGE_SOUMISSION_DG_NON_REQUISE);
  });
  it("autres raisons de la demande : phrase du moteur (étape Service, auteur)", () => {
    expect(raisonSoumissionDemande(demande({ etape: "SERVICE" }), FINANCE, "LIGNES")).toMatch(/responsable de service/);
    expect(raisonSoumissionDemande(demande({ createurId: "u-fin" }), FINANCE, "LIGNES")).toMatch(/votre propre demande/);
  });
  it("à l'étape DG, la soumission complémentaire reste possible (règle du moteur)", () => {
    expect(raisonSoumissionDemande(demande({ etape: "DG" }), FINANCE, "LIGNES")).toBeNull();
  });
  it("ne contredit jamais le moteur : raison nulle ⇔ transition acceptée pour un article soumettable", () => {
    const etapes = ["SERVICE", "FINANCE", "DG", "REJET_DG", "DECISION_FINALE", "TERMINEE", "A_CORRIGER", "ABANDONNEE"] as const;
    for (const etape of etapes) {
      for (const mode of ["OPTIONNELLE", "OBLIGATOIRE", "NON_REQUISE"] as const) {
        for (const a of [FINANCE, SANS_DG, ASSISTANT, acteur(["treso.soumettre_dg"], "u-collab")]) {
          const d = demande({ etape, modeEtapeDG: mode });
          const raison = raisonSoumissionDemande(d, a, "LIGNES");
          const ok = transition(d, a, { type: "SOUMETTRE_LIGNES_DG", ligneIds: ["A"] }).ok;
          expect(raison === null, `${etape}/${mode}/${a.userId}: ${raison}`).toBe(ok);
        }
      }
    }
  });
});

describe("raisonSoumissionArticle", () => {
  it("article catégorisé et libre : aucune raison", () => {
    expect(raisonSoumissionArticle(ligne("A"), null)).toBeNull();
  });
  it("article non catégorisé : phrase demandée", () => {
    expect(raisonSoumissionArticle(ligne("C", { categorisee: false }), null)).toBe(MESSAGE_ARTICLE_SANS_CATEGORIE_DG);
  });
  it("article déjà soumis, validé par le DG, déjà décidé : phrase du moteur", () => {
    expect(raisonSoumissionArticle(ligne("A", { soumiseAuDG: true }), null)).toMatch(/attend déjà la décision du DG/);
    expect(raisonSoumissionArticle(ligne("A", { soumiseAuDG: true, decisionDG: "VALIDEE" }), null)).toMatch(/déjà été validée par le DG/);
    expect(raisonSoumissionArticle(ligne("A", { statut: "VALIDEE" }), null)).toMatch(/déjà décidée/);
  });
  it("article refusé par le DG : resoumettable", () => {
    expect(raisonSoumissionArticle(ligne("A", { soumiseAuDG: true, decisionDG: "REFUSEE" }), null)).toBeNull();
  });
  it("la raison de la demande l'emporte sur celle de l'article", () => {
    expect(raisonSoumissionArticle(ligne("C", { categorisee: false }), MESSAGE_PERMISSION_SOUMETTRE_DG)).toBe(MESSAGE_PERMISSION_SOUMETTRE_DG);
  });
});

describe("raisonBoutonGlobalSoumission", () => {
  const lignes = [ligne("A"), ligne("C", { categorisee: false })];
  it("sans sélection : « Cochez au moins un article. »", () => {
    expect(raisonBoutonGlobalSoumission(null, lignes, 0)).toBe(MESSAGE_COCHER_UN_ARTICLE);
    expect(MESSAGE_COCHER_UN_ARTICLE).toBe("Cochez au moins un article.");
  });
  it("avec une sélection : bouton actif", () => {
    expect(raisonBoutonGlobalSoumission(null, lignes, 1)).toBeNull();
  });
  it("aucun article soumettable : phrase dédiée", () => {
    expect(raisonBoutonGlobalSoumission(null, [ligne("C", { categorisee: false })], 0)).toBe(MESSAGE_AUCUN_ARTICLE_SOUMETTABLE);
  });
  it("la raison de la demande prime", () => {
    expect(raisonBoutonGlobalSoumission(MESSAGE_PERMISSION_SOUMETTRE_DG, lignes, 2)).toBe(MESSAGE_PERMISSION_SOUMETTRE_DG);
  });
});

describe("bandeauEtapeDG", () => {
  // RÉÉCRIT (lot B) : les autres articles ne sont plus bloqués ; le bandeau le dit, à l'étape Finance comme à l'étape DG.
  it("affiché quand un article attend le DG, sans bloquer les autres articles", () => {
    expect(bandeauEtapeDG("DG", [ligne("A", { soumiseAuDG: true }), ligne("B")])).toBe(MESSAGE_BANDEAU_ETAPE_DG);
    expect(bandeauEtapeDG("FINANCE", [ligne("A", { soumiseAuDG: true }), ligne("B")])).toBe(MESSAGE_BANDEAU_ETAPE_DG);
    expect(MESSAGE_BANDEAU_ETAPE_DG).toMatch(/^Des articles de cette demande attendent la décision du DG\. Les autres articles ne sont pas bloqués/);
  });
  it("absent sans article chez le DG, ou à l'étape Service / correction", () => {
    expect(bandeauEtapeDG("FINANCE", [ligne("A")])).toBeNull();
    expect(bandeauEtapeDG("FINANCE", [ligne("A", { soumiseAuDG: true, decisionDG: "VALIDEE" })])).toBeNull();
    expect(bandeauEtapeDG("SERVICE", [ligne("A", { soumiseAuDG: true })])).toBeNull();
  });
});
