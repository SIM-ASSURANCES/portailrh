import { describe, expect, it } from "vitest";

import { Prisma } from "./generated/prisma/client";
import { CptAuditError, ecrireAudit, preparerAudit, premierDuMois, versJsonAudit } from "./cptAudit";

describe("Audit Gestion Compta — préparation d'une ligne", () => {
  it("sérialise montants, dates et BigInt en JSON stockable", () => {
    const json = versJsonAudit({ montant: new Prisma.Decimal("55944.06"), le: new Date("2026-09-12T10:00:00Z"), n: BigInt(7) });
    expect(json).toEqual({ montant: "55944.06", le: "2026-09-12T10:00:00.000Z", n: "7" });
    expect(versJsonAudit(undefined)).toBeUndefined();
    expect(versJsonAudit(null)).toBeUndefined();
  });

  it("ramène le mois de rattachement au 1er du mois (UTC)", () => {
    expect(premierDuMois(new Date("2026-09-27T23:30:00Z")).toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(() => premierDuMois(new Date("invalide"))).toThrow(CptAuditError);
  });

  it("exige entité, identifiant, action et auteur ; un motif vide devient null", () => {
    const ligne = preparerAudit({ entite: " CptContrat ", entiteId: "c1", action: "creation", userId: "u1", motif: "  " });
    expect(ligne).toMatchObject({ entite: "CptContrat", entiteId: "c1", action: "creation", motif: null, mois: null, ip: null });
    expect(() => preparerAudit({ entite: "", entiteId: "c1", action: "creation", userId: "u1" })).toThrow(CptAuditError);
    expect(() => preparerAudit({ entite: "CptContrat", entiteId: "c1", action: "creation", userId: "" })).toThrow(/auteur/);
  });

  it("conserve le motif nettoyé, l'adresse IP et le mois (ramené au 1er)", () => {
    const ligne = preparerAudit({
      entite: "CptRattachement",
      entiteId: "r1",
      action: "validation",
      userId: "u1",
      motif: "  contrôle du reçu  ",
      ip: "10.0.0.5",
      mois: new Date("2026-10-18T08:00:00Z"),
      avant: { statut: "CONFIRME" },
      apres: { statut: "VALIDE" },
    });
    expect(ligne.motif).toBe("contrôle du reçu");
    expect(ligne.ip).toBe("10.0.0.5");
    expect((ligne.mois as Date).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(ligne.avant).toEqual({ statut: "CONFIRME" });
    expect(ligne.apres).toEqual({ statut: "VALIDE" });
  });
});

describe("Audit Gestion Compta — écriture", () => {
  it("écrit exactement une ligne dans CptAudit, avec les données préparées (aucune autre table)", async () => {
    const appels: unknown[] = [];
    const db = {
      cptAudit: {
        create: (arg: unknown) => {
          appels.push(arg);
          return Promise.resolve({ id: BigInt(1) });
        },
      },
    } as never;
    await ecrireAudit(db, { entite: "CptPeriode", entiteId: "p1", action: "cloture", userId: "u1" });
    expect(appels).toHaveLength(1);
    expect(appels[0]).toMatchObject({ data: { entite: "CptPeriode", entiteId: "p1", action: "cloture", userId: "u1" } });
  });

  it("n'écrit rien quand la ligne est incomplète", async () => {
    let appels = 0;
    const db = { cptAudit: { create: () => { appels++; return Promise.resolve({}); } } } as never;
    await expect(ecrireAudit(db, { entite: "CptPeriode", entiteId: "", action: "cloture", userId: "u1" })).rejects.toThrow(CptAuditError);
    expect(appels).toBe(0);
  });
});
