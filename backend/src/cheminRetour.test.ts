import { describe, expect, it } from "vitest";

import { cheminRetourConnexion } from "./cheminRetour";

describe("cheminRetourConnexion", () => {
  it("chemin relatif conservé", () => {
    expect(cheminRetourConnexion("/pointage/pointer?source=QR_CODE", "portail.test")).toBe("/pointage/pointer?source=QR_CODE");
  });

  it("URL absolue du même hôte : réduite à son chemin (lien de l'email)", () => {
    expect(cheminRetourConnexion("http://localhost:3100/pointage/justifier/abc", "localhost:3100")).toBe(
      "/pointage/justifier/abc"
    );
    expect(cheminRetourConnexion("https://portail.test/pointage/justifier/abc?x=1", "portail.test")).toBe(
      "/pointage/justifier/abc?x=1"
    );
  });

  it("autre hôte, hôte inconnu, protocole relatif, /login ou texte illisible : accueil", () => {
    expect(cheminRetourConnexion("https://pirate.test/pointage", "portail.test")).toBe("/");
    expect(cheminRetourConnexion("https://portail.test/pointage", null)).toBe("/");
    expect(cheminRetourConnexion("//pirate.test/x", "portail.test")).toBe("/");
    expect(cheminRetourConnexion("/login?error=1", "portail.test")).toBe("/");
    expect(cheminRetourConnexion("https://portail.test/login", "portail.test")).toBe("/");
    expect(cheminRetourConnexion("javascript:alert(1)", "portail.test")).toBe("/");
    expect(cheminRetourConnexion("pas une url", "portail.test")).toBe("/");
  });
});
