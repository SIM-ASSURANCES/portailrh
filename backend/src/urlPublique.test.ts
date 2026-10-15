import { describe, expect, it } from "vitest";

import { urlPubliqueSite } from "./urlPublique";

const interfaces = {
  "vEthernet (Default Switch)": [{ address: "172.26.112.1", family: "IPv4" }],
  "Wi-Fi": [{ address: "192.168.1.49", family: "IPv4" }],
};

describe("urlPubliqueSite", () => {
  it("production : l'origine configurée, chemin retiré, AUTH_URL avant NEXTAUTH_URL", () => {
    expect(urlPubliqueSite({ env: { NODE_ENV: "production", AUTH_URL: "https://portail.sim.ci/api/auth", NEXTAUTH_URL: "http://x" }, interfaces })).toBe(
      "https://portail.sim.ci",
    );
  });
  it("production avec seulement AUTH_URL (cas du compose Dokploy, sans NEXTAUTH_URL)", () => {
    expect(urlPubliqueSite({ env: { NODE_ENV: "production", AUTH_URL: "https://portailrh.mysimassurances.com" }, interfaces })).toBe(
      "https://portailrh.mysimassurances.com",
    );
  });
  it("production : une AUTH_URL en localhost est respectée (jamais remplacée par une IP détectée)", () => {
    expect(urlPubliqueSite({ env: { NODE_ENV: "production", AUTH_URL: "http://localhost:3000" }, interfaces })).toBe("http://localhost:3000");
  });
  it("production sans configuration : repli historique", () => {
    expect(urlPubliqueSite({ env: { NODE_ENV: "production" }, interfaces })).toBe("http://localhost:3000");
  });
  it("dev : AUTH_URL en localhost ou absente → adresse du réseau local, carte virtuelle ignorée", () => {
    expect(urlPubliqueSite({ env: { NODE_ENV: "development", AUTH_URL: "http://localhost:3000" }, interfaces })).toBe("http://192.168.1.49:3000");
    expect(urlPubliqueSite({ env: { NODE_ENV: "development" }, interfaces })).toBe("http://192.168.1.49:3000");
  });
  it("dev : le port configuré est conservé, DEV_NETWORK_IP l'emporte", () => {
    expect(urlPubliqueSite({ env: { AUTH_URL: "http://localhost:3100" }, interfaces })).toBe("http://192.168.1.49:3100");
    expect(urlPubliqueSite({ env: { DEV_NETWORK_IP: "192.168.50.2" }, interfaces })).toBe("http://192.168.50.2:3000");
  });
  it("dev : une AUTH_URL déjà en IP réseau ou en domaine est gardée", () => {
    expect(urlPubliqueSite({ env: { AUTH_URL: "http://192.168.1.60:3000" }, interfaces })).toBe("http://192.168.1.60:3000");
    expect(urlPubliqueSite({ env: { AUTH_URL: "https://recette.sim.ci" }, interfaces })).toBe("https://recette.sim.ci");
  });
  it("dev sans aucune interface : localhost", () => {
    expect(urlPubliqueSite({ env: {}, interfaces: {} })).toBe("http://localhost:3000");
  });
});
