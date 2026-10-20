import { describe, expect, it } from "vitest";
import type { StatutCircuitConge } from "./circuitConge";
import { DELAI_RAPPEL_CONGE_MS, messageRappelConge, prioriteRappelConge, rappelCongeDu } from "./congesRappels";

const now = new Date("2026-10-20T08:30:00.000Z");
const ilYA = (ms: number) => new Date(now.getTime() - ms);

describe("rappelCongeDu", () => {
  it("accepte uniquement EN_ATTENTE_RESPONSABLE et EN_ATTENTE_RH, refuse tous les autres statuts", () => {
    const ancien = ilYA(DELAI_RAPPEL_CONGE_MS + 60_000);
    const statuts: Record<StatutCircuitConge, boolean> = {
      EN_ATTENTE_RESPONSABLE: true,
      EN_ATTENTE_RH: true,
      MODIFICATION_DEMANDEE: false,
      VALIDEE: false,
      REJETEE: false,
      ANNULEE: false,
    };
    for (const [statut, attendu] of Object.entries(statuts) as [StatutCircuitConge, boolean][]) {
      expect(rappelCongeDu({ statut, dernierRappelAt: null, etapeDepuis: ancien, now })).toBe(attendu);
    }
  });

  it("avec dernierRappelAt nul : compare etapeDepuis au seuil de 24 h (juste avant / pile / juste après)", () => {
    expect(
      rappelCongeDu({
        statut: "EN_ATTENTE_RESPONSABLE",
        dernierRappelAt: null,
        etapeDepuis: ilYA(DELAI_RAPPEL_CONGE_MS - 1),
        now,
      })
    ).toBe(false);
    expect(
      rappelCongeDu({
        statut: "EN_ATTENTE_RESPONSABLE",
        dernierRappelAt: null,
        etapeDepuis: ilYA(DELAI_RAPPEL_CONGE_MS),
        now,
      })
    ).toBe(true);
    expect(
      rappelCongeDu({
        statut: "EN_ATTENTE_RH",
        dernierRappelAt: null,
        etapeDepuis: ilYA(DELAI_RAPPEL_CONGE_MS + 1),
        now,
      })
    ).toBe(true);
  });

  it("avec dernierRappelAt renseigné : prend dernierRappelAt plutôt que etapeDepuis (juste avant / juste après 24 h)", () => {
    const etapeAncienne = ilYA(5 * DELAI_RAPPEL_CONGE_MS);
    expect(
      rappelCongeDu({
        statut: "EN_ATTENTE_RH",
        dernierRappelAt: ilYA(DELAI_RAPPEL_CONGE_MS - 1),
        etapeDepuis: etapeAncienne,
        now,
      })
    ).toBe(false);
    expect(
      rappelCongeDu({
        statut: "EN_ATTENTE_RH",
        dernierRappelAt: ilYA(DELAI_RAPPEL_CONGE_MS),
        etapeDepuis: etapeAncienne,
        now,
      })
    ).toBe(true);
    expect(
      rappelCongeDu({
        statut: "EN_ATTENTE_RESPONSABLE",
        dernierRappelAt: ilYA(DELAI_RAPPEL_CONGE_MS + 1),
        etapeDepuis: etapeAncienne,
        now,
      })
    ).toBe(true);
  });
});

describe("prioriteRappelConge", () => {
  const aujourdhui = "2026-10-20";

  it("INFO à J+3 et au-delà, IMPORTANT à J+2, J et J-1", () => {
    expect(prioriteRappelConge({ dateDebut: "2026-10-23", aujourdhui })).toBe("INFO");
    expect(prioriteRappelConge({ dateDebut: "2026-10-22", aujourdhui })).toBe("IMPORTANT");
    expect(prioriteRappelConge({ dateDebut: "2026-10-20", aujourdhui })).toBe("IMPORTANT");
    expect(prioriteRappelConge({ dateDebut: "2026-10-19", aujourdhui })).toBe("IMPORTANT");
  });
});

describe("messageRappelConge", () => {
  it("produit une phrase contenant le demandeur, la référence, la nature, les dates et les jours ouvrés", () => {
    const msg = messageRappelConge({
      demandeurNom: "Awa Koné",
      reference: "CNG-202610-0001",
      nature: "CONGE",
      dateDebut: "2026-10-26",
      dateFin: "2026-10-30",
      nbJoursOuvres: 5,
    });
    expect(msg).toBe("Congé CNG-202610-0001 de Awa Koné (du 26/10/2026 au 30/10/2026, 5 jours ouvrés) est en attente de votre décision.");
  });

  it("formate une permission exceptionnelle d'un seul jour au singulier", () => {
    const msg = messageRappelConge({
      demandeurNom: "Moussa Traoré",
      reference: "CNG-202610-0002",
      nature: "PERMISSION_EXCEPTIONNELLE",
      dateDebut: "2026-10-22",
      dateFin: "2026-10-22",
      nbJoursOuvres: 1,
    });
    expect(msg).toBe("Permission exceptionnelle CNG-202610-0002 de Moussa Traoré (le 22/10/2026, 1 jour ouvré) est en attente de votre décision.");
  });
});

