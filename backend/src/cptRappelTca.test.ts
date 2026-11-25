import { describe, expect, it } from "vitest";
import { cleRappelTcaCpt, creneauRappelTcaCpt, messageRappelTcaCpt, moisConcerneRappelCpt, rappelAttenduCpt } from "./cptRappelTca";

describe("rappels de la taxe (GC-8f)", () => {
  it("le mois concerné est le mois précédent", () => {
    expect(moisConcerneRappelCpt("2026-11-10")).toBe("2026-10-01");
    expect(moisConcerneRappelCpt("2027-01-17")).toBe("2026-12-01");
  });
  it("créneau : 10 et 17, une tâche rattrapée vaut le créneau précédent", () => {
    expect(creneauRappelTcaCpt("2026-11-09")).toBeNull();
    expect(creneauRappelTcaCpt("2026-11-10")).toBe(10);
    expect(creneauRappelTcaCpt("2026-11-12")).toBe(10);
    expect(creneauRappelTcaCpt("2026-11-17")).toBe(17);
    expect(creneauRappelTcaCpt("2026-11-30")).toBe(17);
  });
  it("rappel attendu : déclarer, payer, ou rien", () => {
    expect(rappelAttenduCpt({ aDeLaTaxe: true, declare: false, paye: false })).toBe("DECLARER");
    expect(rappelAttenduCpt({ aDeLaTaxe: true, declare: true, paye: false })).toBe("PAYER");
    expect(rappelAttenduCpt({ aDeLaTaxe: true, declare: true, paye: true })).toBeNull();
    expect(rappelAttenduCpt({ aDeLaTaxe: false, declare: false, paye: false })).toBeNull();
  });
  it("clé de réservation unique par mois, créneau et type", () => {
    expect(cleRappelTcaCpt("2026-10-01", 10, "DECLARER")).toBe("compta.rappel_tca.2026-10.10.DECLARER");
    expect(cleRappelTcaCpt("2026-10-01", 17, "PAYER")).toBe("compta.rappel_tca.2026-10.17.PAYER");
  });
  it("message : jours restants avant le jour limite", () => {
    const m = messageRappelTcaCpt({ type: "DECLARER", mois: "2026-10-01", jour: "2026-11-10", jourLimite: 20 });
    expect([m.dateLimite, m.joursRestants]).toEqual(["2026-11-20", 10]);
    expect(m.message).toMatch(/avant le 20\/11\/2026 \(il reste 10 jours\)/);
    expect(messageRappelTcaCpt({ type: "PAYER", mois: "2026-10-01", jour: "2026-11-17", jourLimite: 20 }).message).toMatch(/il reste 3 jours/);
    expect(messageRappelTcaCpt({ type: "PAYER", mois: "2026-10-01", jour: "2026-11-20", jourLimite: 20 }).message).toMatch(/dernier jour/);
    expect(messageRappelTcaCpt({ type: "PAYER", mois: "2026-10-01", jour: "2026-11-22", jourLimite: 20 }).message).toMatch(/dépassé de 2 jour/);
  });
});
