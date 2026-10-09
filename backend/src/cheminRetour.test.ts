import { describe, expect, it } from "vitest";

import { cheminRetourConnexion, LONGUEUR_MAX_CHEMIN_RETOUR, origineSiteConfiguree, seSouvenirDeMoiParDefaut } from "./cheminRetour";

// Audit open redirect (2026-10-10) : la validation ne renvoie jamais qu'un chemin interne autorisé, sinon « / ».
const ORIGINE = "http://localhost:3000";
const ok = (valeur: unknown, attendu: string, origine: string | null = ORIGINE) =>
  expect(cheminRetourConnexion(valeur, origine)).toBe(attendu);
const refuse = (valeur: unknown, origine: string | null = ORIGINE) => expect(cheminRetourConnexion(valeur, origine)).toBe("/");

describe("cheminRetourConnexion — acceptés", () => {
  it("chemins internes", () => {
    ok("/pointage/pointer", "/pointage/pointer");
    ok("/pointage/justifier/abc123?x=1", "/pointage/justifier/abc123?x=1");
    ok("/treso/demandes/xyz", "/treso/demandes/xyz");
    ok("/pointage/pointer?source=QR_CODE", "/pointage/pointer?source=QR_CODE");
    ok("/", "/");
  });
  it("sans origine configurée, les chemins relatifs passent toujours", () => {
    ok("/pointage/pointer", "/pointage/pointer", null);
  });
  it("URL absolue vers l'origine configurée (lien posé par le middleware) : réduite à son chemin", () => {
    ok("http://localhost:3000/pointage/justifier/abc?x=1", "/pointage/justifier/abc?x=1");
    ok("https://portail.sim.ci/treso/demandes/xyz", "/treso/demandes/xyz", "https://portail.sim.ci");
  });
  it("le fragment est retiré", () => {
    ok("/treso/demandes/xyz#lignes", "/treso/demandes/xyz");
  });
});

describe("cheminRetourConnexion — refusés", () => {
  it("protocole relatif et barres obliques inverses", () => {
    for (const v of ["//evil.com", "///evil.com", "/\\evil.com", "\\\\evil.com", "/\\/evil.com", "\\/evil.com", "/pointage\\..\\..\\//evil.com"]) refuse(v);
  });
  it("URL absolues vers un autre site", () => {
    for (const v of ["https://evil.com", "http://evil.com", "//evil.com/pointage/", "https://evil.com/pointage/pointer"]) refuse(v);
  });
  it("schémas dangereux", () => {
    for (const v of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)", "/javascript:alert(1)/x"]) refuse(v);
  });
  it("variantes encodées, y compris double encodage", () => {
    for (const v of ["%2F%2Fevil.com", "%5Cevil.com", "/%2Fevil.com", "/%5Cevil.com", "%252F%252Fevil.com", "/%252F%252Fevil.com", "/%25252F%25252Fevil.com", "/%2F%2Fevil.com", "/%09/evil.com", "/%00/evil.com", "/%E0%A4%A"]) refuse(v);
  });
  it("caractères de contrôle et espaces", () => {
    for (const v of ["/\t/evil.com", "/\n/evil.com", "/\r/evil.com", " //evil.com", "/ /evil.com", "/pointage\u0000/evil.com", "\u0000//evil.com", "/\u00A0/evil.com", "/\u2028/evil.com", "/\uFEFF/evil.com", "/pointage/pointer "]) refuse(v);
  });
  it("même hôte avec autre port, autre schéma, identifiants ou @", () => {
    for (const v of [
      "http://localhost:3000@evil.com",
      "http://localhost:3000@evil.com/pointage",
      "http://localhost:3001/pointage/pointer",
      "https://localhost:3000/pointage/pointer",
      "https://user:pass@evil.com",
      "http://user:pass@localhost:3000/pointage/pointer",
      "http://localhost:3000.evil.com/pointage",
    ])
      refuse(v);
  });
  it("URL absolue vers le même hôte sans origine explicitement autorisée", () => {
    refuse("http://localhost:3000/pointage/pointer", null);
  });
  it("valeur vide, absente, trop longue ou non-chaîne", () => {
    for (const v of ["", undefined, null, 42, true, {}, ["/pointage/pointer"], () => "/pointage"]) refuse(v);
    refuse(`/pointage/${"a".repeat(LONGUEUR_MAX_CHEMIN_RETOUR)}`);
  });
  it("pas de boucle sur la connexion ni de route hors du portail", () => {
    for (const v of ["/login", "/login?callbackUrl=/pointage", "/loginx", "http://localhost:3000/login", "/api/auth/signout", "/invitation/abc", "/forgot-password", "/reset-password/x", "/_next/static/x", "/pointagex", "/inconnu"]) refuse(v);
  });
  it("traversée de chemin qui sortirait des préfixes internes", () => {
    refuse("/pointage/../login");
    refuse("/treso/../../api/auth/signout");
  });
  it("texte quelconque", () => {
    refuse("pas une url");
    refuse("evil.com");
  });
});

describe("callback redirect d'Auth.js (déconnexion vers /login)", () => {
  it("/login accepté seulement avec l'option, toujours soumis aux mêmes contrôles", () => {
    expect(cheminRetourConnexion("/login", ORIGINE, { autoriserConnexion: true })).toBe("/login");
    expect(cheminRetourConnexion("/login?error=inactivite", ORIGINE, { autoriserConnexion: true })).toBe("/login?error=inactivite");
    expect(cheminRetourConnexion("/login", ORIGINE)).toBe("/");
    for (const v of ["//evil.com", "/\\evil.com", "https://evil.com/login", "/loginx", "/login/../../evil"]) {
      expect(cheminRetourConnexion(v, ORIGINE, { autoriserConnexion: true })).toBe("/");
    }
  });
});

describe("origineSiteConfiguree", () => {
  it("lit l'origine de AUTH_URL (configuration), jamais un en-tête", () => {
    expect(origineSiteConfiguree({ AUTH_URL: "https://portail.sim.ci/api/auth" })).toBe("https://portail.sim.ci");
    expect(origineSiteConfiguree({ NEXTAUTH_URL: "http://localhost:3000" })).toBe("http://localhost:3000");
    expect(origineSiteConfiguree({})).toBeNull();
    expect(origineSiteConfiguree({ AUTH_URL: "pas une url" })).toBeNull();
  });
});

describe("seSouvenirDeMoiParDefaut (lot 6) — décidé sur le chemin validé", () => {
  const coche = (valeur: unknown) => seSouvenirDeMoiParDefaut(cheminRetourConnexion(valeur, ORIGINE));
  it("cochée pour un retour vers le pointage", () => {
    expect(coche("/pointage/pointer")).toBe(true);
    expect(coche("/pointage/pointer?source=QR_CODE")).toBe(true);
    expect(coche("/pointage/justifier/abc")).toBe(true);
    expect(coche("http://localhost:3000/pointage/justifier/abc")).toBe(true);
  });
  it("décochée ailleurs, sans valeur ou pour une valeur refusée", () => {
    expect(coche("/treso/demandes/x")).toBe(false);
    expect(coche(undefined)).toBe(false);
    expect(coche("")).toBe(false);
    expect(coche("/")).toBe(false);
    expect(coche("/pointage")).toBe(false);
    for (const v of ["//evil.com/pointage/pointer", "/\\evil.com/pointage/", "https://evil.com/pointage/pointer", "/pointage/../login", "/%2F%2Fevil.com/pointage/"]) {
      expect(coche(v)).toBe(false);
    }
  });
});
