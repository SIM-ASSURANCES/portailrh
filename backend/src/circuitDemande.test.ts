import { describe, expect, it } from "vitest";

import {
  actionsPossibles,
  casDemandeur,
  decisionFinalePrise,
  determinerParcours,
  etapeInitiale,
  friseProgression,
  MESSAGE_DEUX_PERSONNES,
  messageAttente,
  refusApprobationCloture,
  transition,
  type ActeurCircuit,
  type ActionCircuit,
  type DemandeCircuit,

  type ProfilDemandeur,
} from "./circuitDemande";
import type { EtapeCircuit } from "./generated/prisma/enums";

const PROFIL: Record<string, ProfilDemandeur> = {
  collaborateur: { estDG: false, estFinance: false, estResponsableDeSonService: false },
  responsable: { estDG: false, estFinance: false, estResponsableDeSonService: true },
  finance: { estDG: false, estFinance: true, estResponsableDeSonService: false },
  financeResponsable: { estDG: false, estFinance: true, estResponsableDeSonService: true },
  dgResponsable: { estDG: true, estFinance: false, estResponsableDeSonService: true },
  dgNonResponsable: { estDG: true, estFinance: false, estResponsableDeSonService: false },
  dgEtFinance: { estDG: true, estFinance: true, estResponsableDeSonService: true },
};

const DEMANDEUR = "u-demandeur";
const acteur = (userId: string, permissions: string[] = [], estResponsableServiceDuDemandeur = false): ActeurCircuit => ({
  userId,
  permissions,
  estResponsableServiceDuDemandeur,
});
const RESPONSABLE = acteur("u-resp", [], true);
const FINANCE = acteur("u-fin", ["treso.decider_finance", "treso.soumettre_dg", "treso.categoriser_demande"]);
const DG = acteur("u-dg", ["treso.decider_dg", "treso.approuver_validation_complete"]);
const ASSISTANT = acteur("u-assist", ["treso.effectuer_reglement", "treso.receptionner_retour", "treso.modifier_description"]);
const AUTEUR = acteur(DEMANDEUR);

function demande(etape: EtapeCircuit, profil: ProfilDemandeur = PROFIL.collaborateur, type: "STANDARD" | "DEPENSE_DIRECTE" = "STANDARD"): DemandeCircuit {
  const p = determinerParcours(profil, type);
  return { etape, createurId: DEMANDEUR, typeDemande: type, ...p };
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

describe("cas du demandeur (ordre de priorité a > b > c > d)", () => {
  it("(d) tous les autres : Service puis Finance, DG optionnelle", () => {
    const p = determinerParcours(PROFIL.collaborateur, "STANDARD");
    expect(p).toEqual({ cas: "AUTRE", etapeServiceRequise: true, etapeFinanceRequise: true, modeEtapeDG: "OPTIONNELLE", approbationClotureNonRequise: false });
    expect(etapeInitiale(p)).toBe("SERVICE");
  });
  it("(c) responsable de service : Service non requise", () => {
    const p = determinerParcours(PROFIL.responsable, "STANDARD");
    expect(p.cas).toBe("RESPONSABLE");
    expect(p.etapeServiceRequise).toBe(false);
    expect(p.modeEtapeDG).toBe("OPTIONNELLE");
    expect(etapeInitiale(p)).toBe("FINANCE");
  });
  it("(b) Finance / Assistant / service Finance : Service et Finance non requises, DG obligatoire", () => {
    const p = determinerParcours(PROFIL.finance, "STANDARD");
    expect(p).toEqual({ cas: "FINANCE", etapeServiceRequise: false, etapeFinanceRequise: false, modeEtapeDG: "OBLIGATOIRE", approbationClotureNonRequise: false });
    expect(etapeInitiale(p)).toBe("DG");
  });
  it("(b) l'emporte sur (c) : un responsable du service Finance va au DG", () => {
    expect(casDemandeur(PROFIL.financeResponsable, "STANDARD")).toBe("FINANCE");
    expect(etapeInitiale(determinerParcours(PROFIL.financeResponsable, "STANDARD"))).toBe("DG");
  });
  it("(a) DG : DG non requise, Finance décide, approbation de clôture non requise", () => {
    const p = determinerParcours(PROFIL.dgResponsable, "STANDARD");
    expect(p).toEqual({ cas: "DG", etapeServiceRequise: false, etapeFinanceRequise: true, modeEtapeDG: "NON_REQUISE", approbationClotureNonRequise: true });
    expect(etapeInitiale(p)).toBe("FINANCE");
  });
  it("(a) l'emporte sur (b) et (c)", () => {
    expect(casDemandeur(PROFIL.dgEtFinance, "STANDARD")).toBe("DG");
  });
  it("(a) un DG qui n'est pas responsable de son service passe par l'étape Service", () => {
    expect(etapeInitiale(determinerParcours(PROFIL.dgNonResponsable, "STANDARD"))).toBe("SERVICE");
  });
  it("dépense directe : Finance, Service non requise, DG optionnelle, quel que soit l'auteur", () => {
    for (const profil of Object.values(PROFIL)) {
      const p = determinerParcours(profil, "DEPENSE_DIRECTE");
      expect(p).toEqual({ cas: "DEPENSE_DIRECTE", etapeServiceRequise: false, etapeFinanceRequise: true, modeEtapeDG: "OPTIONNELLE", approbationClotureNonRequise: false });
    }
  });
});

describe("étape Service", () => {
  const d = demande("SERVICE");
  it("le responsable valide → Finance", () => {
    expect(ok(d, RESPONSABLE, { type: "VALIDER_SERVICE" })).toEqual({ ok: true, etapeSuivante: "FINANCE", effets: {} });
  });
  it("le responsable rejette avec motif → À corriger (niveau Service)", () => {
    const r = ok(d, RESPONSABLE, { type: "REJETER", motif: "Pas prioritaire" });
    expect(r.etapeSuivante).toBe("A_CORRIGER");
    expect(r.effets.niveauRejet).toBe("SERVICE");
  });
  it("rejet sans motif refusé", () => {
    expect(ko(d, RESPONSABLE, { type: "REJETER", motif: " a " })).toContain("motif");
  });
  it("Finance, DG, Assistant et le demandeur ne peuvent pas agir", () => {
    for (const qui of [FINANCE, DG, ASSISTANT, AUTEUR]) {
      expect(ko(d, qui, { type: "VALIDER_SERVICE" })).toContain("responsable du service");
    }
  });
  it("Finance ne peut ni soumettre au DG ni décider les lignes", () => {
    expect(ko(d, FINANCE, { type: "SOUMETTRE_DG" })).toBe(messageAttente("SERVICE"));
    expect(ko(d, FINANCE, { type: "DECIDER_LIGNES", auMoinsUneValidee: true })).toBe(messageAttente("SERVICE"));
  });
  it("un responsable qui serait aussi le demandeur est refusé (défense en profondeur)", () => {
    expect(ko(d, acteur(DEMANDEUR, [], true), { type: "VALIDER_SERVICE" })).toContain("propre demande");
  });
});

describe("étape Finance", () => {
  const d = demande("FINANCE");
  it("décide les lignes, au moins une validée → Terminée", () => {
    expect(ok(d, FINANCE, { type: "DECIDER_LIGNES", auMoinsUneValidee: true }).etapeSuivante).toBe("TERMINEE");
  });
  it("toutes les lignes rejetées → À corriger (niveau Finance)", () => {
    const r = ok(d, FINANCE, { type: "DECIDER_LIGNES", auMoinsUneValidee: false });
    expect(r.etapeSuivante).toBe("A_CORRIGER");
    expect(r.effets.niveauRejet).toBe("FINANCE");
  });
  it("rejet de la demande entière → À corriger (jamais REJETEE)", () => {
    expect(ok(d, FINANCE, { type: "REJETER", motif: "Budget épuisé" }).etapeSuivante).toBe("A_CORRIGER");
  });
  it("soumet au DG → étape DG", () => {
    expect(ok(d, FINANCE, { type: "SOUMETTRE_DG" })).toEqual({ ok: true, etapeSuivante: "DG", effets: { soumiseAuDG: true } });
  });
  it("le DG, l'Assistant, le responsable et le demandeur ne décident pas", () => {
    for (const qui of [DG, ASSISTANT, RESPONSABLE, AUTEUR]) {
      expect(transition(d, qui, { type: "DECIDER_LIGNES", auMoinsUneValidee: true }).ok).toBe(false);
      expect(transition(d, qui, { type: "SOUMETTRE_DG" }).ok).toBe(false);
    }
  });
  it("un compte Finance ne décide pas sa propre demande", () => {
    const sienne: DemandeCircuit = { ...d, createurId: FINANCE.userId };
    expect(ko(sienne, FINANCE, { type: "DECIDER_LIGNES", auMoinsUneValidee: true })).toContain("propre demande");
    expect(ko(sienne, FINANCE, { type: "REJETER", motif: "abc" })).toContain("propre demande");
  });
  it("demande du DG (cas a) : la soumission au DG est refusée", () => {
    expect(ko(demande("FINANCE", PROFIL.dgResponsable), FINANCE, { type: "SOUMETTRE_DG" })).toContain("émise par le DG");
  });
});

describe("étape DG (soumise par Finance)", () => {
  const d = demande("DG");
  it("le DG valide → décision finale Finance, et cela vaut approbation de clôture", () => {
    expect(ok(d, DG, { type: "VALIDER_DG" })).toEqual({ ok: true, etapeSuivante: "DECISION_FINALE", effets: { approbationClotureParDG: true } });
  });
  it("le DG rejette avec motif → Rejet DG (retour Finance)", () => {
    const r = ok(d, DG, { type: "REJETER_DG", motif: "Montant trop élevé" });
    expect(r.etapeSuivante).toBe("REJET_DG");
    expect(r.effets.niveauRejet).toBe("DG");
  });
  it("rejet DG sans motif refusé", () => {
    expect(ko(d, DG, { type: "REJETER_DG", motif: "" })).toContain("motif");
  });
  it("Finance a tous ses boutons grisés", () => {
    expect(actionsPossibles(d, FINANCE)).toEqual([]);
    expect(ko(d, FINANCE, { type: "DECIDER_LIGNES", auMoinsUneValidee: true })).toBe(messageAttente("DG"));
  });
  it("le DG ne décide pas ligne par ligne une demande simplement soumise", () => {
    expect(transition(d, DG, { type: "DECIDER_LIGNES", auMoinsUneValidee: true }).ok).toBe(false);
  });
  it("le DG ne peut agir que sur une demande soumise", () => {
    expect(ko(demande("FINANCE"), DG, { type: "VALIDER_DG" })).toBe(messageAttente("FINANCE"));
  });
});

describe("Rejet DG (retour Finance)", () => {
  const d = demande("REJET_DG");
  it("Finance resoumet → DG", () => {
    expect(ok(d, FINANCE, { type: "RESOUMETTRE_DG" }).etapeSuivante).toBe("DG");
  });
  it("Finance renvoie au demandeur → À corriger (niveau Finance)", () => {
    const r = ok(d, FINANCE, { type: "REJETER", motif: "Voir avec le DG" });
    expect(r.etapeSuivante).toBe("A_CORRIGER");
    expect(r.effets.niveauRejet).toBe("FINANCE");
  });
  it("Finance ne peut pas valider après un rejet du DG", () => {
    expect(transition(d, FINANCE, { type: "DECIDER_LIGNES", auMoinsUneValidee: true }).ok).toBe(false);
  });
  it("actions possibles de Finance : rejeter, resoumettre", () => {
    expect(actionsPossibles(d, FINANCE).sort()).toEqual(["REJETER", "RESOUMETTRE_DG"]);
  });
  it("resoumettre est refusé ailleurs qu'après un rejet du DG", () => {
    expect(ko(demande("FINANCE"), FINANCE, { type: "RESOUMETTRE_DG" })).toContain("pas été rejetée");
  });
});

describe("décision finale Finance (après approbation du DG)", () => {
  const d = demande("DECISION_FINALE");
  it("décide les lignes → Terminée, ou À corriger si tout est rejeté", () => {
    expect(ok(d, FINANCE, { type: "DECIDER_LIGNES", auMoinsUneValidee: true }).etapeSuivante).toBe("TERMINEE");
    expect(ok(d, FINANCE, { type: "DECIDER_LIGNES", auMoinsUneValidee: false }).etapeSuivante).toBe("A_CORRIGER");
  });
  it("« Soumettre au DG » est grisé", () => {
    expect(actionsPossibles(d, FINANCE)).not.toContain("SOUMETTRE_DG");
  });
});

describe("cas (b) : le DG décide ligne par ligne, décision finale", () => {
  const d = demande("DG", PROFIL.finance);
  it("au moins une ligne validée → Terminée, vaut approbation de clôture", () => {
    expect(ok(d, DG, { type: "DECIDER_LIGNES", auMoinsUneValidee: true })).toEqual({ ok: true, etapeSuivante: "TERMINEE", effets: { approbationClotureParDG: true } });
  });
  it("toutes rejetées → À corriger (niveau DG)", () => {
    const r = ok(d, DG, { type: "DECIDER_LIGNES", auMoinsUneValidee: false });
    expect(r.etapeSuivante).toBe("A_CORRIGER");
    expect(r.effets.niveauRejet).toBe("DG");
  });
  it("le DG peut rejeter la demande entière → À corriger (niveau DG)", () => {
    expect(ok(d, DG, { type: "REJETER", motif: "Hors budget" }).effets.niveauRejet).toBe("DG");
  });
  it("valider/rejeter « en bloc » (VALIDER_DG/REJETER_DG) refusés : décision ligne par ligne", () => {
    expect(ko(d, DG, { type: "VALIDER_DG" })).toContain("ligne par ligne");
  });
  it("Finance ne décide pas une demande de l'Assistant Finance (elle peut seulement la catégoriser)", () => {
    expect(transition(d, FINANCE, { type: "DECIDER_LIGNES", auMoinsUneValidee: true }).ok).toBe(false);
    expect(transition(d, FINANCE, { type: "REJETER", motif: "abc" }).ok).toBe(false);
    expect(actionsPossibles(d, FINANCE)).toEqual([]);
  });
});

describe("cas (a) : demande du DG", () => {
  it("Finance décide ; le DG ne peut jamais décider sa propre demande", () => {
    const d: DemandeCircuit = { ...demande("FINANCE", PROFIL.dgResponsable), createurId: DG.userId };
    expect(ok(d, FINANCE, { type: "DECIDER_LIGNES", auMoinsUneValidee: true }).etapeSuivante).toBe("TERMINEE");
    expect(transition(d, DG, { type: "DECIDER_LIGNES", auMoinsUneValidee: true }).ok).toBe(false);
    expect(transition({ ...d, etape: "DG" }, DG, { type: "VALIDER_DG" }).ok).toBe(false);
  });
});

describe("À corriger, Abandonnée, Terminée", () => {
  const d = demande("A_CORRIGER");
  it("le demandeur resoumet → première étape applicable, parcours recalculé", () => {
    const r = ok(d, AUTEUR, { type: "RESOUMETTRE_CORRECTION" });
    expect(r.etapeSuivante).toBe("SERVICE");
    expect(r.effets.recalculerParcours).toBe(true);
    expect(ok(demande("A_CORRIGER", PROFIL.responsable), AUTEUR, { type: "RESOUMETTRE_CORRECTION" }).etapeSuivante).toBe("FINANCE");
    expect(ok(demande("A_CORRIGER", PROFIL.finance), AUTEUR, { type: "RESOUMETTRE_CORRECTION" }).etapeSuivante).toBe("DG");
  });
  it("le demandeur abandonne → Abandonnée", () => {
    expect(ok(d, AUTEUR, { type: "ABANDONNER" }).etapeSuivante).toBe("ABANDONNEE");
  });
  it("personne d'autre ne corrige ni n'abandonne", () => {
    for (const qui of [FINANCE, DG, RESPONSABLE, ASSISTANT]) {
      expect(ko(d, qui, { type: "RESOUMETTRE_CORRECTION" })).toContain("Seul le demandeur");
      expect(actionsPossibles(d, qui)).toEqual([]);
    }
  });
  it("le demandeur ne peut rien faire hors de « À corriger »", () => {
    for (const e of ["SERVICE", "FINANCE", "DG", "REJET_DG", "DECISION_FINALE", "TERMINEE", "ABANDONNEE"] as const) {
      expect(actionsPossibles(demande(e), AUTEUR)).toEqual([]);
    }
  });
  it("Abandonnée et Terminée sont finales pour le circuit", () => {
    for (const qui of [FINANCE, DG, RESPONSABLE, ASSISTANT, AUTEUR]) {
      expect(actionsPossibles(demande("ABANDONNEE"), qui)).toEqual([]);
      expect(actionsPossibles(demande("TERMINEE"), qui)).toEqual([]);
    }
  });
});

describe("Assistant Finance", () => {
  it("n'a aucune action de circuit, quelle que soit l'étape", () => {
    for (const e of ["SERVICE", "FINANCE", "DG", "REJET_DG", "DECISION_FINALE", "TERMINEE", "A_CORRIGER", "ABANDONNEE"] as const) {
      expect(actionsPossibles(demande(e), ASSISTANT)).toEqual([]);
    }
  });
  it("décision finale prise seulement à « Terminée » (débloque règlement et modification de description)", () => {
    expect(decisionFinalePrise("TERMINEE")).toBe(true);
    for (const e of ["SERVICE", "FINANCE", "DG", "REJET_DG", "DECISION_FINALE", "A_CORRIGER", "ABANDONNEE"] as const) {
      expect(decisionFinalePrise(e)).toBe(false);
    }
  });
});

describe("dépense directe (exception tracée : son auteur Finance la décide)", () => {
  const d: DemandeCircuit = { ...demande("FINANCE", PROFIL.finance, "DEPENSE_DIRECTE"), createurId: FINANCE.userId };
  it("l'auteur Finance décide, l'exception est signalée", () => {
    const r = ok(d, FINANCE, { type: "DECIDER_LIGNES", auMoinsUneValidee: true });
    expect(r.etapeSuivante).toBe("TERMINEE");
    expect(r.effets.decisionParAuteurDepenseDirecte).toBe(true);
  });
  it("l'auteur Finance peut la soumettre au DG", () => {
    expect(ok(d, FINANCE, { type: "SOUMETTRE_DG" }).etapeSuivante).toBe("DG");
  });
  it("un autre compte Finance la décide sans exception", () => {
    const autre = acteur("u-fin2", FINANCE.permissions as string[]);
    expect(ok(d, autre, { type: "DECIDER_LIGNES", auMoinsUneValidee: true }).effets.decisionParAuteurDepenseDirecte).toBe(false);
  });
});

describe("frise de progression", () => {
  const frise = (e: EtapeCircuit, profil = PROFIL.collaborateur, soumiseAuDG = false) =>
    Object.fromEntries(friseProgression({ ...demande(e, profil), soumiseAuDG }).map((x) => [x.etape, x.statut]));
  it("(d) à l'étape Service", () => {
    expect(frise("SERVICE")).toEqual({ SERVICE: "EN_COURS", FINANCE: "A_VENIR", DG: "NON_REQUISE", ASSISTANT: "A_VENIR" });
  });
  it("soumise au DG", () => {
    expect(frise("DG", PROFIL.collaborateur, true)).toEqual({ SERVICE: "FAITE", FINANCE: "FAITE", DG: "EN_COURS", ASSISTANT: "A_VENIR" });
  });
  it("décision finale après DG", () => {
    expect(frise("DECISION_FINALE", PROFIL.collaborateur, true)).toEqual({ SERVICE: "FAITE", FINANCE: "EN_COURS", DG: "FAITE", ASSISTANT: "A_VENIR" });
  });
  it("rejet DG : Finance reprend, DG à refaire", () => {
    expect(frise("REJET_DG", PROFIL.collaborateur, true)).toEqual({ SERVICE: "FAITE", FINANCE: "EN_COURS", DG: "A_VENIR", ASSISTANT: "A_VENIR" });
  });
  it("(b) Service et Finance non requises", () => {
    expect(frise("DG", PROFIL.finance)).toEqual({ SERVICE: "NON_REQUISE", FINANCE: "NON_REQUISE", DG: "EN_COURS", ASSISTANT: "A_VENIR" });
  });
  it("(a) demande du DG terminée", () => {
    expect(frise("TERMINEE", PROFIL.dgResponsable)).toEqual({ SERVICE: "NON_REQUISE", FINANCE: "FAITE", DG: "NON_REQUISE", ASSISTANT: "EN_COURS" });
  });
  it("À corriger : tout est à refaire", () => {
    expect(frise("A_CORRIGER")).toEqual({ SERVICE: "A_VENIR", FINANCE: "A_VENIR", DG: "NON_REQUISE", ASSISTANT: "A_VENIR" });
  });
});

describe("deux personnes distinctes pour une validation complète (Finance ≠ DG, jamais le demandeur)", () => {
  // Un seul compte portant toutes les permissions de décision.
  const CUMUL = acteur("u-cumul", ["treso.decider_finance", "treso.soumettre_dg", "treso.decider_dg", "treso.approuver_validation_complete"]);

  it("valide à l'étape DG puis tente la décision Finance : refusé", () => {
    const d = demande("FINANCE");
    expect(ok(d, CUMUL, { type: "SOUMETTRE_DG" }).etapeSuivante).toBe("DG");
    expect(ok({ ...d, etape: "DG" }, CUMUL, { type: "VALIDER_DG" }).etapeSuivante).toBe("DECISION_FINALE");
    const apresDG: DemandeCircuit = { ...d, etape: "DECISION_FINALE", approbateurDGId: CUMUL.userId };
    expect(ko(apresDG, CUMUL, { type: "DECIDER_LIGNES", auMoinsUneValidee: true })).toBe(MESSAGE_DEUX_PERSONNES);
    expect(actionsPossibles(apresDG, CUMUL)).not.toContain("DECIDER_LIGNES");
    // Un autre compte Finance peut, lui, décider.
    expect(ok(apresDG, FINANCE, { type: "DECIDER_LIGNES", auMoinsUneValidee: true }).effets.decideurFinance).toBe(true);
  });

  it("décide comme Finance puis tente l'approbation de clôture : refusé", () => {
    const d = demande("FINANCE");
    const r = ok(d, CUMUL, { type: "DECIDER_LIGNES", auMoinsUneValidee: true });
    expect(r.effets.decideurFinance).toBe(true);
    const decidee = { createurId: d.createurId, decideurFinanceId: CUMUL.userId, approbationClotureNonRequise: false };
    expect(refusApprobationCloture(decidee, CUMUL.userId)).toBe(MESSAGE_DEUX_PERSONNES);
    expect(refusApprobationCloture(decidee, DG.userId)).toBeNull();
  });

  it("le décideur Finance ne peut pas non plus agir à l'étape DG (cas b, ou tour ultérieur)", () => {
    const d: DemandeCircuit = { ...demande("DG"), decideurFinanceId: CUMUL.userId };
    expect(ko(d, CUMUL, { type: "VALIDER_DG" })).toBe(MESSAGE_DEUX_PERSONNES);
    const b: DemandeCircuit = { ...demande("DG", PROFIL.finance), decideurFinanceId: CUMUL.userId };
    expect(ko(b, CUMUL, { type: "DECIDER_LIGNES", auMoinsUneValidee: true })).toBe(MESSAGE_DEUX_PERSONNES);
  });

  it("le demandeur n'approuve jamais la clôture de sa propre demande", () => {
    expect(refusApprobationCloture({ createurId: DG.userId, decideurFinanceId: FINANCE.userId, approbationClotureNonRequise: false }, DG.userId)).toContain("propre demande");
  });

  it("demande émise par le DG : approbation non requise", () => {
    expect(refusApprobationCloture({ createurId: "x", decideurFinanceId: null, approbationClotureNonRequise: true }, DG.userId)).toContain("n'est pas requise");
  });

  it("un rejet n'est pas une décision Finance (n'enregistre pas de décideur)", () => {
    expect(ok(demande("FINANCE"), CUMUL, { type: "DECIDER_LIGNES", auMoinsUneValidee: false }).effets.decideurFinance).toBeUndefined();
  });
});
