import { describe, expect, it } from "vitest";

import { choisirAdresseReseau, portDepuisHost, urlReseauDev } from "./reseauLocal";

const ifaces = {
  "vEthernet (WSL)": [{ address: "172.26.112.1", family: "IPv4" }],
  "Wi-Fi": [
    { address: "fe80::1", family: "IPv6" },
    { address: "192.168.1.42", family: "IPv4" },
  ],
  Loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
};

describe("choisirAdresseReseau", () => {
  it("ignore la carte virtuelle WSL même si elle est listée en premier", () => {
    expect(choisirAdresseReseau(ifaces)).toBe("192.168.1.42");
  });
  it("préfère 192.168 à 10. puis 172.16-31", () => {
    expect(
      choisirAdresseReseau({
        a: [{ address: "172.20.0.5", family: "IPv4" }],
        b: [{ address: "10.0.0.7", family: "IPv4" }],
        c: [{ address: "192.168.0.9", family: "IPv4" }],
      }),
    ).toBe("192.168.0.9");
  });
  it("garde une carte virtuelle faute de mieux, jamais une adresse publique ou link-local", () => {
    expect(choisirAdresseReseau({ "vEthernet (WSL)": [{ address: "172.26.112.1", family: "IPv4" }] })).toBe("172.26.112.1");
    expect(choisirAdresseReseau({ x: [{ address: "169.254.1.1", family: "IPv4" }, { address: "8.8.8.8", family: "IPv4" }] })).toBeNull();
  });
  it("accepte family numérique (Node récents)", () => {
    expect(choisirAdresseReseau({ Ethernet: [{ address: "10.1.1.1", family: 4 }] })).toBe("10.1.1.1");
  });
});

describe("urlReseauDev", () => {
  it("utilise le port de l'hôte au lieu de 3000", () => {
    expect(portDepuisHost("localhost:3100")).toBe("3100");
    expect(portDepuisHost("localhost")).toBe("3000");
    expect(urlReseauDev({ host: "localhost:3100", interfaces: ifaces }).networkUrl).toBe("http://192.168.1.42:3100");
  });
  it("reprend l'hôte quand la page est déjà ouverte par l'IP privée", () => {
    expect(urlReseauDev({ host: "192.168.1.42:3000", interfaces: ifaces }).networkUrl).toBe("http://192.168.1.42:3000");
  });
  it("DEV_NETWORK_IP l'emporte sur la détection", () => {
    expect(urlReseauDev({ host: "localhost:3000", interfaces: ifaces, ipForcee: "192.168.50.2" }).networkUrl).toBe("http://192.168.50.2:3000");
  });
  it("retombe sur localhost sans adresse", () => {
    expect(urlReseauDev({ host: "localhost:3000", interfaces: {} }).networkUrl).toBe("http://localhost:3000");
  });
});
