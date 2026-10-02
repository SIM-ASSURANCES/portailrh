import { describe, expect, it } from "vitest";

import { jourCalendaire, montant } from "./encCalcul";
import type { LigneFichierProduction } from "./encImportLecture";
import {
  analyserLigne,
  estIdentifiantWave,
  type ContexteContrat,
  type EncaissementExistantResume,
  type LigneAAnalyser,
  type OptionsReglesImport,
} from "./encImportRegles";

const AUJOURDHUI = jourCalendaire(2026, 9, 30);

const OPTIONS_BASE: OptionsReglesImport = {
  origineImport: "EQUIPE_TECHNIQUE",
  aujourdHui: AUJOURDHUI,
  toleranceIncoherenceFcfa: montant("1"),
  branchesConnues: null,
  brancheParDefaut: null,
};

const CONTEXTE_NOUVELLE: ContexteContrat = { existant: null };

/** Ligne complète et cohérente (CDC 9.1 : prime TTC 1 500, prime nette 1 398,60, accessoires 0, taxes 101,40,
 *  commission 251,75, honoraires 34,97), avec un paiement complet et valide. */
function ligneBase(overrides: Partial<LigneFichierProduction & { indicateurAnnulation: boolean }> = {}): LigneAAnalyser {
  return {
    numeroLigne: 1,
    dateEnregistrement: jourCalendaire(2026, 9, 1),
    paiementIdFichier: "TECH-000001",
    numPolice: "TST-2026-000001",
    brancheCode: null,
    typeContrat: "Individuel",
    produitLibelle: "Assurance Auto",
    produitCode: "AUTO01",
    typeOperation: "Nouvelle affaire",
    clientId: "CLI-001",
    clientNom: "Client Test",
    partenaireNom: "Partenaire Test",
    datePaiement: jourCalendaire(2026, 9, 10),
    mode: "WAVE",
    reference: "T_ABCDEFGHIJKLMNOP",
    dateEffet: jourCalendaire(2026, 9, 1),
    dateEcheance: jourCalendaire(2027, 9, 1),
    S: montant("1500"),
    T: montant("1398.60"),
    U: montant("0"),
    V: montant("101.40"),
    W: montant("251.75"),
    X: montant("34.97"),
    typePolice: "Standard",
    Z: montant("500"),
    ...overrides,
  };
}

function existant(overrides: Partial<EncaissementExistantResume> = {}): EncaissementExistantResume {
  return {
    id: "enc-existant-1",
    paiementIdFichier: null,
    reference: "T_EXISTANT0001",
    datePaiement: jourCalendaire(2026, 9, 1),
    montant: montant("500"),
    statut: "CONFIRME",
    ...overrides,
  };
}

function contexteConnue(encaissements: EncaissementExistantResume[] = [], montants: Partial<Record<"S" | "T" | "U" | "V" | "W" | "X", string>> = {}): ContexteContrat {
  return {
    existant: {
      S: montant(montants.S ?? "1500"),
      T: montant(montants.T ?? "1398.60"),
      U: montant(montants.U ?? "0"),
      V: montant(montants.V ?? "101.40"),
      W: montant(montants.W ?? "251.75"),
      X: montant(montants.X ?? "34.97"),
      encaissements,
    },
  };
}

describe("analyserLigne — cas de recette du cahier", () => {
  it("9.2 — paiement du fichier technique : ajouté « à confirmer », aucun signalement bloquant", () => {
    const decision = analyserLigne(ligneBase({ Z: montant("500") }), CONTEXTE_NOUVELLE, OPTIONS_BASE);
    expect(decision.paiementACreer?.montant.toFixed(2)).toBe("500.00");
    expect(decision.signalements).toEqual([{ analyse: "AJOUTE", niveau: "INFO", detail: "Paiement ajouté, à confirmer." }]);
  });

  it("9.3 — doublon : paiement Wave 400 FCFA le 03/09 signalé « doublon possible » avec la référence de l'existant (400 FCFA le 31/08)", () => {
    const contexte = contexteConnue([
      existant({ id: "enc-manuel", reference: "T_MANUEL12345A", datePaiement: jourCalendaire(2026, 8, 31), montant: montant("400"), statut: "CONFIRME" }),
    ]);
    const ligne = ligneBase({
      numPolice: "TST-2026-000001",
      datePaiement: jourCalendaire(2026, 9, 3),
      reference: "T_TECHREF6789B",
      Z: montant("400"),
    });
    const decision = analyserLigne(ligne, contexte, OPTIONS_BASE);
    expect(decision.paiementACreer).toBeNull();
    expect(decision.signalements).toEqual([
      {
        analyse: "DOUBLON_POSSIBLE",
        niveau: "A_TRAITER",
        detail: "Doublon possible : même montant (± 1 FCFA) à 7 jours près d'un encaissement existant (référence « T_MANUEL12345A »).",
        encaissementExistantId: "enc-manuel",
      },
    ]);
  });
});

describe("analyserLigne — tableau F1.4", () => {
  it("déjà présent : même référence qu'un encaissement existant (y compris NON_RECU, V2-A12/D12)", () => {
    const contexte = contexteConnue([existant({ id: "enc-x", reference: "T_ABCDEFGHIJKLMNOP", statut: "NON_RECU" })]);
    const decision = analyserLigne(ligneBase({ reference: "T_ABCDEFGHIJKLMNOP" }), contexte, OPTIONS_BASE);
    expect(decision.paiementACreer).toBeNull();
    expect(decision.signalements).toEqual([
      { analyse: "DEJA_PRESENT", niveau: "INFO", detail: "Paiement déjà présent (même PaiementID, même référence, ou même date et même montant qu'un encaissement existant).", encaissementExistantId: "enc-x" },
    ]);
  });

  it("déjà présent NE compare PAS un « non reçu » pour le doublon possible (D12 : confirmés + à confirmer seulement)", () => {
    // Même montant à 3 jours près qu'un NON_RECU, mais référence/date/PaiementID différents : ne doit matcher NI
    // "déjà présent" NI "doublon possible" (le NON_RECU est explicitement hors périmètre du doublon possible).
    const contexte = contexteConnue([existant({ id: "enc-non-recu", reference: "T_AUTRE00000001", datePaiement: jourCalendaire(2026, 9, 8), montant: montant("500"), statut: "NON_RECU" })]);
    const decision = analyserLigne(ligneBase(), contexte, OPTIONS_BASE);
    expect(decision.paiementACreer).not.toBeNull();
    expect(decision.signalements.map((s) => s.analyse)).toEqual(["AJOUTE"]);
  });

  it("à compléter : montant manquant (date/mode/montant seulement, F1.4 — la référence n'en fait plus partie)", () => {
    const decision = analyserLigne(ligneBase({ Z: null }), CONTEXTE_NOUVELLE, OPTIONS_BASE);
    expect(decision.paiementACreer).toBeNull();
    expect(decision.signalements).toEqual([{ analyse: "A_COMPLETER", niveau: "A_TRAITER", detail: "Date, mode ou montant manquant : paiement non créé." }]);
  });

  it("référence manquante (décision 2026-09-30, PAS « à compléter ») : ajouté à confirmer, signalé À TRAITER", () => {
    const decision = analyserLigne(ligneBase({ reference: null }), CONTEXTE_NOUVELLE, OPTIONS_BASE);
    expect(decision.paiementACreer).not.toBeNull();
    expect(decision.paiementACreer?.reference).toBeNull();
    expect(decision.paiementACreer?.montant.toFixed(2)).toBe("500.00");
    expect(decision.signalements).toEqual([
      { analyse: "REFERENCE_MANQUANTE", niveau: "A_TRAITER", detail: "Référence de paiement manquante : ajouté à confirmer, le rapprochement (groupe 3) en tiendra compte." },
    ]);
  });

  it("référence manquante : le doublon possible (fuzzy) reste vérifié — ordre corrigé le 2026-09-30 (déjà présent → doublon possible → à compléter → référence manquante)", () => {
    // Même montant et à 3 jours près d'un existant confirmé : DOIT être classée "doublon possible" (non ajoutée),
    // même sans référence — le groupe 3 du rapprochement (CDC F5) sert pour ce que CE contrôle ne détecte pas, pas
    // pour remplacer ce contrôle.
    const contexte = contexteConnue([existant({ id: "enc-proche", reference: "T_AUTRE00000002", datePaiement: jourCalendaire(2026, 9, 11), montant: montant("500"), statut: "CONFIRME" })]);
    const decision = analyserLigne(ligneBase({ reference: null }), contexte, OPTIONS_BASE);
    expect(decision.paiementACreer).toBeNull();
    expect(decision.signalements).toEqual([
      {
        analyse: "DOUBLON_POSSIBLE",
        niveau: "A_TRAITER",
        detail: "Doublon possible : même montant (± 1 FCFA) à 7 jours près d'un encaissement existant (référence « T_AUTRE00000002 »).",
        encaissementExistantId: "enc-proche",
      },
    ]);
  });

  it("référence manquante, AUCUN doublon détecté : ajoutée à confirmer, signalée « référence manquante »", () => {
    const decision = analyserLigne(ligneBase({ reference: null }), CONTEXTE_NOUVELLE, OPTIONS_BASE);
    expect(decision.paiementACreer).not.toBeNull();
    expect(decision.signalements.map((s) => s.analyse)).toEqual(["REFERENCE_MANQUANTE"]);
  });

  it("référence manquante : « déjà présent » reste vérifié en premier (via PaiementID, exact) — priorité du tableau F1.4", () => {
    const contexte = contexteConnue([existant({ id: "enc-meme-fichier", paiementIdFichier: "TECH-000001", reference: null, datePaiement: jourCalendaire(2026, 1, 1), montant: montant("999"), statut: "CONFIRME" })]);
    const decision = analyserLigne(ligneBase({ reference: null, paiementIdFichier: "TECH-000001" }), contexte, OPTIONS_BASE);
    expect(decision.paiementACreer).toBeNull();
    expect(decision.signalements).toEqual([
      { analyse: "DEJA_PRESENT", niveau: "INFO", detail: "Paiement déjà présent (même PaiementID, même référence, ou même date et même montant qu'un encaissement existant).", encaissementExistantId: "enc-meme-fichier" },
    ]);
  });

  it("référence Wave non conforme : ajouté « à confirmer » quand même, signalé", () => {
    const decision = analyserLigne(ligneBase({ mode: "WAVE", reference: "CHEQUE-1234" }), contexteConnue(), OPTIONS_BASE);
    expect(decision.paiementACreer?.reference).toBe("CHEQUE-1234");
    expect(decision.signalements).toEqual([
      { analyse: "REF_WAVE_NON_CONFORME", niveau: "A_TRAITER", detail: "Paiement Wave dont la référence n'est pas un identifiant de transaction (T_…) : il ne pourra pas être rapproché automatiquement." },
    ]);
  });

  it("autre cas : mode non-Wave avec une référence quelconque, ajouté « à confirmer », pour information", () => {
    const decision = analyserLigne(ligneBase({ mode: "CHQ", reference: "CHQ-000123" }), CONTEXTE_NOUVELLE, OPTIONS_BASE);
    expect(decision.paiementACreer).not.toBeNull();
    expect(decision.signalements).toEqual([{ analyse: "AJOUTE", niveau: "INFO", detail: "Paiement ajouté, à confirmer." }]);
  });

  it("police revenue sans aucune information de paiement : « à vérifier » (police déjà connue seulement)", () => {
    const ligneSansPaiement = ligneBase({ datePaiement: null, mode: null, reference: null, Z: null });
    const decisionConnue = analyserLigne(ligneSansPaiement, contexteConnue(), OPTIONS_BASE);
    expect(decisionConnue.paiementACreer).toBeNull();
    expect(decisionConnue.signalements).toEqual([{ analyse: "SANS_PAIEMENT", niveau: "A_TRAITER", detail: "Police revenue sans aucune information de paiement : à vérifier." }]);

    const decisionNouvelle = analyserLigne(ligneSansPaiement, CONTEXTE_NOUVELLE, OPTIONS_BASE);
    expect(decisionNouvelle.paiementACreer).toBeNull();
    expect(decisionNouvelle.signalements).toEqual([]);
    expect(decisionNouvelle.contrat).not.toBeNull();
  });
});

describe("analyserLigne — V2-A10 (paiement incomplet sur police nouvelle, D13)", () => {
  it("le contrat est créé normalement, seul le paiement est signalé « à compléter »", () => {
    const decision = analyserLigne(ligneBase({ mode: null }), CONTEXTE_NOUVELLE, OPTIONS_BASE);
    expect(decision.policeConnue).toBe(false);
    expect(decision.contrat).toEqual({ S: montant("1500"), T: montant("1398.60"), U: montant("0"), V: montant("101.40"), W: montant("251.75"), X: montant("34.97") });
    expect(decision.paiementACreer).toBeNull();
    expect(decision.signalements[0].analyse).toBe("A_COMPLETER");
  });
});

describe("analyserLigne — V2-A28 (date de paiement future, D15)", () => {
  it("contrat importé, paiement NON créé, signalé « à compléter »", () => {
    const decision = analyserLigne(ligneBase({ datePaiement: jourCalendaire(2026, 10, 1) }), CONTEXTE_NOUVELLE, OPTIONS_BASE);
    expect(decision.contrat).not.toBeNull();
    expect(decision.paiementACreer).toBeNull();
    expect(decision.signalements).toEqual([{ analyse: "A_COMPLETER", niveau: "A_TRAITER", detail: "Date de paiement dans le futur : paiement non créé, à corriger." }]);
  });

  it("la date du jour elle-même reste acceptée (jamais exclue, même convention que le reste du projet)", () => {
    const decision = analyserLigne(ligneBase({ datePaiement: AUJOURDHUI }), CONTEXTE_NOUVELLE, OPTIONS_BASE);
    expect(decision.paiementACreer).not.toBeNull();
  });
});

describe("analyserLigne — avenant (prime modifiée, D8)", () => {
  it("signale « avenant possible » quand un montant du contrat a changé, avec l'avant/après", () => {
    const contexte = contexteConnue([], { S: "1400" });
    const decision = analyserLigne(ligneBase(), contexte, OPTIONS_BASE);
    expect(decision.avenant).toBe(true);
    const signalementAvenant = decision.signalements.find((s) => s.analyse === "PRIME_MODIFIEE");
    expect(signalementAvenant?.primeAvant?.S.toFixed(2)).toBe("1400.00");
    expect(signalementAvenant?.primeApres?.S.toFixed(2)).toBe("1500.00");
  });

  it("aucun signalement si les 6 montants sont strictement identiques", () => {
    const decision = analyserLigne(ligneBase(), contexteConnue(), OPTIONS_BASE);
    expect(decision.avenant).toBe(false);
    expect(decision.signalements.some((s) => s.analyse === "PRIME_MODIFIEE")).toBe(false);
  });
});

describe("analyserLigne — incohérence T + U + V ≠ S", () => {
  it("signale un écart au-delà de la tolérance", () => {
    // T + U + V = 1398.60 + 0 + 101.40 = 1500.00 exactement (CDC 9.1) ; S forcé à 2000 -> écart de 500.00 FCFA.
    const decision = analyserLigne(ligneBase({ S: montant("2000") }), CONTEXTE_NOUVELLE, OPTIONS_BASE);
    const signalement = decision.signalements.find((s) => s.analyse === "INCOHERENCE");
    expect(signalement?.detail).toContain("500.00");
  });

  it("ne signale rien dans la tolérance (1 FCFA par défaut ici)", () => {
    const decision = analyserLigne(ligneBase({ S: montant("1500.50") }), CONTEXTE_NOUVELLE, { ...OPTIONS_BASE, toleranceIncoherenceFcfa: montant("1") });
    expect(decision.signalements.some((s) => s.analyse === "INCOHERENCE")).toBe(false);
  });
});

describe("analyserLigne — écart de taux de contrôle, comparé en MONTANT (décision du 2026-09-30, corrige un premier essai en points de pourcentage)", () => {
  it("signale un écart de taux de commission hors tolérance (montant attendu vs montant réel)", () => {
    const options: OptionsReglesImport = { ...OPTIONS_BASE, tauxControle: { tauxCommission: montant("0.10") } };
    const decision = analyserLigne(ligneBase(), CONTEXTE_NOUVELLE, options);
    // Montant attendu = 10 % × T (1398.60) = 139.86 ; réel W = 251.75 -> écart 111.89 FCFA, bien au-delà de la
    // tolérance de 1 FCFA (OPTIONS_BASE.toleranceIncoherenceFcfa).
    expect(decision.signalements.some((s) => s.analyse === "ECART_TAUX" && s.detail.includes("commission"))).toBe(true);
  });

  it("aucun taux de contrôle fourni : aucun écart signalé (jamais un défaut deviné)", () => {
    const decision = analyserLigne(ligneBase(), CONTEXTE_NOUVELLE, OPTIONS_BASE);
    expect(decision.signalements.some((s) => s.analyse === "ECART_TAUX")).toBe(false);
  });

  it("accessoires (décision 2026-09-30, PROVISOIRE) : montant réel U comparé au montant attendu (taux × T)", () => {
    // U = 139.86 (10 % de T = 1398.60, avec S/V ajustés pour rester cohérent) -> attendu 5 % × T = 69.93, écart
    // 69.93 FCFA, bien au-delà de la tolérance de 1 FCFA.
    const ligne = ligneBase({ S: montant("1639.86"), U: montant("139.86") });
    const options: OptionsReglesImport = { ...OPTIONS_BASE, tauxControle: { tauxAccessoires: montant("0.05") } };
    const decision = analyserLigne(ligne, CONTEXTE_NOUVELLE, options);
    expect(decision.signalements.some((s) => s.analyse === "ECART_TAUX" && s.detail.includes("accessoires"))).toBe(true);
  });

  it("détecte un écart réel même quand l'ancienne tolérance en points l'aurait laissé passer (20 % attendu, 18 % réel)", () => {
    // Exactement l'exemple ayant motivé la correction : W/T = 251.75/1398.60 ≈ 18 %, attendu 20 % — seulement 2
    // points de pourcentage d'écart (une ancienne tolérance de 2 points l'aurait laissé passer), mais 27.97 FCFA de
    // différence réelle, largement au-delà du 1 FCFA de tolérance appliqué au MONTANT.
    const options: OptionsReglesImport = { ...OPTIONS_BASE, tauxControle: { tauxCommission: montant("0.20") } };
    const decision = analyserLigne(ligneBase(), CONTEXTE_NOUVELLE, options);
    const signalement = decision.signalements.find((s) => s.analyse === "ECART_TAUX" && s.detail.includes("commission"));
    expect(signalement).toBeDefined();
    expect(signalement?.detail).toContain("27.97");
  });

  it("ne signale rien si le montant attendu est dans la tolérance de 1 FCFA du montant réel", () => {
    const ligne = ligneBase({ T: montant("1000"), W: montant("200") });
    const options: OptionsReglesImport = { ...OPTIONS_BASE, tauxControle: { tauxCommission: montant("0.20") } };
    const decision = analyserLigne(ligne, CONTEXTE_NOUVELLE, options);
    // Montant attendu = 20 % × 1000 = 200.00, exactement égal au réel -> écart nul, jamais signalé.
    expect(decision.signalements.some((s) => s.analyse === "ECART_TAUX")).toBe(false);
  });
});

describe("analyserLigne — branche inconnue", () => {
  it("signale une branche absente de la liste paramétrée par la Finance", () => {
    const decision = analyserLigne(ligneBase({ brancheCode: "INCONNUE" }), CONTEXTE_NOUVELLE, { ...OPTIONS_BASE, branchesConnues: ["AUTO", "VIE"] });
    expect(decision.signalements.some((s) => s.analyse === "BRANCHE_INCONNUE")).toBe(true);
  });

  it("aucun signalement si la liste des branches n'est pas fournie (branchesConnues: null)", () => {
    const decision = analyserLigne(ligneBase({ brancheCode: "INCONNUE" }), CONTEXTE_NOUVELLE, OPTIONS_BASE);
    expect(decision.signalements.some((s) => s.analyse === "BRANCHE_INCONNUE")).toBe(false);
  });
});

describe("analyserLigne — V2-A14 (annulation), point d'extension SEULEMENT (D14)", () => {
  it("fichier Finance : ligne rejetée entièrement, ni contrat ni paiement", () => {
    const decision = analyserLigne(ligneBase({ indicateurAnnulation: true }), contexteConnue(), { ...OPTIONS_BASE, origineImport: "FINANCE" });
    expect(decision.contrat).toBeNull();
    expect(decision.paiementACreer).toBeNull();
    expect(decision.signalements).toEqual([
      { analyse: "LIGNE_ANNULEE_REJETEE", niveau: "A_TRAITER", detail: "Ligne marquée annulée dans un fichier importé par la Finance : rejetée entièrement (annulation réservée à l'équipe technique)." },
    ]);
  });

  it("fichier Équipe technique : contrat importé normalement + paiement créé, signalement « en attente L4 » en plus", () => {
    const decision = analyserLigne(ligneBase({ indicateurAnnulation: true }), CONTEXTE_NOUVELLE, { ...OPTIONS_BASE, origineImport: "EQUIPE_TECHNIQUE" });
    expect(decision.contrat).not.toBeNull();
    expect(decision.paiementACreer).not.toBeNull();
    expect(decision.signalements.some((s) => s.analyse === "ANNULATION_EN_ATTENTE_L4")).toBe(true);
    // Le paiement suit par ailleurs sa propre analyse normale (ici "AJOUTE") : l'annulation n'a pas court-circuité le reste.
    expect(decision.signalements.some((s) => s.analyse === "AJOUTE")).toBe(true);
  });

  it("aucune colonne ne renseigne indicateurAnnulation aujourd'hui : un vrai résultat de lireTableur() n'a jamais ce champ à true", () => {
    const decision = analyserLigne(ligneBase(), CONTEXTE_NOUVELLE, OPTIONS_BASE);
    expect(decision.signalements.some((s) => s.analyse === "LIGNE_ANNULEE_REJETEE" || s.analyse === "ANNULATION_EN_ATTENTE_L4")).toBe(false);
  });
});

describe("estIdentifiantWave", () => {
  it.each([
    ["T_BFOSCYZTWBILN62K", true],
    ["T_ABCDEFGHIJ", true],
    ["T_ABC", false], // moins de 10 caractères après T_
    ["CHEQUE-1234", false],
    ["", false],
  ])("%s -> %s", (reference, attendu) => {
    expect(estIdentifiantWave(reference)).toBe(attendu);
  });
});
