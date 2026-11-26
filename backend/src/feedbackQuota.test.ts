import { describe, expect, it } from "vitest";

import {
  CIBLE_CONDITIONS_TRAVAIL,
  cibleQuotaFeedback,
  empreinteQuotaFeedback,
  messageQuotaFeedback,
} from "./feedbackQuota";

// Secret FICTIF de test (jamais la valeur réelle).
const base = { secret: "secret-fictif-de-test", auteurId: "auteur-abc123", cible: "cible-def456", jour: "2026-11-26" };

describe("empreinteQuotaFeedback", () => {
  it("même entrée → même clé, en hexadécimal de 64 caractères", () => {
    expect(empreinteQuotaFeedback(base)).toBe(empreinteQuotaFeedback({ ...base }));
    expect(empreinteQuotaFeedback(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["l'auteur", { auteurId: "auteur-abc124" }],
    ["la cible", { cible: CIBLE_CONDITIONS_TRAVAIL }],
    ["le jour", { jour: "2026-11-27" }],
    ["le secret", { secret: "autre-secret-fictif" }],
  ])("changer %s change la clé", (_nom, modification) => {
    expect(empreinteQuotaFeedback({ ...base, ...modification })).not.toBe(empreinteQuotaFeedback(base));
  });

  it("la clé ne contient ni l'auteur ni la cible en clair", () => {
    const cle = empreinteQuotaFeedback(base);
    expect(cle).not.toContain(base.auteurId);
    expect(cle).not.toContain(base.cible);
    expect(cle).not.toContain(Buffer.from(base.auteurId).toString("hex"));
  });

  it.each([undefined, null, "", "   "])("refus sans AUTH_SECRET (%j), sans citer les entrées dans l'erreur", (secret) => {
    expect(() => empreinteQuotaFeedback({ ...base, secret })).toThrow(/AUTH_SECRET absent/);
    try {
      empreinteQuotaFeedback({ ...base, secret });
    } catch (e) {
      expect(String(e)).not.toContain(base.auteurId);
      expect(String(e)).not.toContain(base.cible);
    }
  });
});

describe("cible et messages", () => {
  it("la cible est le destinataire en collaboration, une constante pour les conditions de travail", () => {
    expect(cibleQuotaFeedback("COLLABORATION", "u1")).toBe("u1");
    expect(cibleQuotaFeedback("CONDITIONS_TRAVAIL", "u1")).toBe("CONDITIONS_TRAVAIL");
    expect(() => cibleQuotaFeedback("COLLABORATION", null)).toThrow();
  });

  it("un message par type", () => {
    expect(messageQuotaFeedback("COLLABORATION")).toBe(
      "Vous avez déjà donné un avis sur ce collègue aujourd'hui. Vous pourrez recommencer demain."
    );
    expect(messageQuotaFeedback("CONDITIONS_TRAVAIL")).toBe(
      "Vous avez déjà donné votre avis sur les conditions de travail aujourd'hui. Vous pourrez recommencer demain."
    );
  });
});
