import { describe, expect, it } from "vitest";

import { codeErreurPrisma, ErreurEnregistrementFeedback, messageIncidentFeedback } from "./feedbackErreur";

describe("diagnostic d'un échec d'enregistrement FeedbackApp", () => {
  it("ne retient qu'un code Prisma", () => {
    expect(codeErreurPrisma({ code: "P2003", message: "valeur secrète" })).toBe("P2003");
  });

  it.each([undefined, null, "P2003", new Error("valeur secrète"), { code: "23503" }, { code: "P2003 valeur" }, { code: 2003 }])(
    "tout le reste donne INCONNU (%j)",
    (erreur) => {
      expect(codeErreurPrisma(erreur)).toBe("INCONNU");
    }
  );

  it("ni l'erreur relancée ni le message de l'incident ne portent autre chose que l'étape et le code", () => {
    const e = new ErreurEnregistrementFeedback("quota", "P2010");
    expect(e.message).toBe("FeedbackApp : étape quota, code P2010");
    expect(e.cause).toBeUndefined();
    expect(messageIncidentFeedback("avis", "P2003")).toBe(
      "Enregistrement d'un avis FeedbackApp impossible (étape avis, code P2003)."
    );
  });
});
