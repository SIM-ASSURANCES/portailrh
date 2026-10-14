import { describe, expect, it } from "vitest";
import { contexteAssaini, incidentRepete, messageAssaini } from "./journalTechnique";

describe("messageAssaini", () => {
  it("masque les adresses e-mail et garde la première ligne", () => {
    expect(messageAssaini("Recipient address rejected: jean.dupont@sim-assurances.ci\nstack")).toBe("Recipient address rejected: <email>");
  });
  it("tronque à 300 caractères", () => {
    expect(messageAssaini("x".repeat(500)).length).toBe(300);
  });
});

describe("contexteAssaini", () => {
  it("ne garde que les clés autorisées : jamais mot de passe, contenu d'e-mail ni jeton entier", () => {
    const sortie = contexteAssaini({
      userId: "u1",
      notificationId: "n1",
      password: "secret",
      pass: "secret",
      html: "<p>contenu</p>",
      token: "AAAA-jeton-fcm-complet",
      tache: "ABSENCES",
      echecs: 3,
    });
    expect(sortie).toEqual({ userId: "u1", notificationId: "n1", tache: "ABSENCES", echecs: 3 });
    expect(JSON.stringify(sortie)).not.toMatch(/secret|contenu|jeton/);
  });
  it("ignore les valeurs non simples et tronque les textes", () => {
    const sortie = contexteAssaini({ userId: { a: 1 }, fcmCode: "y".repeat(500) });
    expect(sortie).toEqual({ fcmCode: "y".repeat(200) });
  });
  it("rien à conserver : undefined", () => {
    expect(contexteAssaini({ autre: "x" })).toBeUndefined();
    expect(contexteAssaini(undefined)).toBeUndefined();
  });
});

describe("incidentRepete", () => {
  const t = new Date(2026, 9, 14, 10, 0, 0);
  it("une ligne par code et par minute", () => {
    expect(incidentRepete(null, t)).toBe(false);
    expect(incidentRepete(new Date(t.getTime() - 59_000), t)).toBe(true);
    expect(incidentRepete(new Date(t.getTime() - 60_000), t)).toBe(false);
  });
});
