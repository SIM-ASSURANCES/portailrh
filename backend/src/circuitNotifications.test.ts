import { describe, expect, it } from "vitest";

import { determinerParcours, etapeInitiale } from "./circuitDemande";
import {
  destinatairesApprobationCloture,
  destinatairesEtape,
  DELAI_RAPPEL_MS,
  INTERVALLE_RAPPEL_MS,
  notificationRappel,
  notificationsEtape,
  rappelDu,
  reserverRappelsDus,
  type CandidatNotification,
  type ContexteNotificationCircuit,
} from "./circuitNotifications";
import type { EtapeCircuit } from "./generated/prisma/enums";

// Comptes : demandeur, responsable du service, deux Finance, DG, Assistant, et un Admin qui porte aussi
// l'approbation de clôture (cas de la production).
const candidats: CandidatNotification[] = [
  { id: "resp", permissions: [] },
  { id: "fin-1", permissions: ["treso.decider_finance", "treso.soumettre_dg"] },
  { id: "fin-2", permissions: ["treso.decider_finance", "treso.soumettre_dg", "treso.approuver_validation_complete"] },
  { id: "dg", permissions: ["treso.decider_dg", "treso.approuver_validation_complete"] },
  { id: "assist", permissions: ["treso.effectuer_reglement"] },
  { id: "admin", permissions: ["treso.approuver_validation_complete"] },
];

function ctx(etape: EtapeCircuit, autres: Partial<ContexteNotificationCircuit> = {}): ContexteNotificationCircuit {
  return {
    demandeId: "d-1",
    reference: "DEM-2026-000001",
    etape,
    typeDemande: "STANDARD",
    createurId: "demandeur",
    createurNom: "Awa Demandeur",
    beneficiaireUserId: "demandeur",
    modeEtapeDG: "OPTIONNELLE",
    decideurFinanceId: null,
    dgApprobateurId: null,
    responsableServiceId: "resp",
    niveauRejet: null,
    motifRejet: null,
    montant: 100000,
    montantValide: null,
    approbationClotureNonRequise: false,
    validationCompleteParDG: false,
    ...autres,
  };
}

const destinataires = (n: ReturnType<typeof notificationsEtape>) => n.flatMap((x) => x.destinataires).sort();

describe("destinataires par étape", () => {
  it("Service : le responsable du service du demandeur, seul", () => {
    expect(destinatairesEtape(ctx("SERVICE"), candidats)).toEqual(["resp"]);
  });

  it("Service : personne si le responsable est désactivé (absent des candidats) ou manquant", () => {
    expect(destinatairesEtape(ctx("SERVICE"), candidats.filter((c) => c.id !== "resp"))).toEqual([]);
    expect(destinatairesEtape(ctx("SERVICE", { responsableServiceId: null }), candidats)).toEqual([]);
  });

  it("Finance : les comptes Finance, jamais le DG, l'Assistant ni l'Admin", () => {
    expect(destinatairesEtape(ctx("FINANCE"), candidats).sort()).toEqual(["fin-1", "fin-2"]);
  });

  it("Finance : jamais le demandeur, sauf l'auteur d'une dépense directe", () => {
    const finDemandeur = ctx("FINANCE", { createurId: "fin-1" });
    expect(destinatairesEtape(finDemandeur, candidats)).toEqual(["fin-2"]);
    expect(destinatairesEtape({ ...finDemandeur, typeDemande: "DEPENSE_DIRECTE" }, candidats).sort()).toEqual(["fin-1", "fin-2"]);
  });

  it("DG : le DG, jamais le décideur Finance (deux personnes) ni le demandeur", () => {
    expect(destinatairesEtape(ctx("DG"), candidats)).toEqual(["dg"]);
    expect(destinatairesEtape(ctx("DG", { decideurFinanceId: "dg" }), candidats)).toEqual([]);
    expect(destinatairesEtape(ctx("DG", { createurId: "dg" }), candidats)).toEqual([]);
  });

  it("Rejet DG : la Finance, qui peut resoumettre ou renvoyer au demandeur", () => {
    const n = notificationsEtape(ctx("REJET_DG", { niveauRejet: "DG", motifRejet: "Budget insuffisant" }), candidats, "dg");
    expect(destinataires(n)).toEqual(["fin-1", "fin-2"]);
    expect(n[0].message).toMatch(/Motif : Budget insuffisant. Resoumettez-la au DG ou renvoyez-la au demandeur/);
  });

  it("Décision finale après validation du DG : la Finance, jamais le DG qui a validé", () => {
    const n = notificationsEtape(ctx("DECISION_FINALE", { dgApprobateurId: "fin-2" }), candidats, "fin-2");
    expect(destinataires(n)).toEqual(["fin-1"]);
  });

  it("Rejet à n'importe quel niveau : le demandeur seul, avec le motif", () => {
    for (const niveau of ["SERVICE", "FINANCE", "DG"] as const) {
      const n = notificationsEtape(ctx("A_CORRIGER", { niveauRejet: niveau, motifRejet: "Devis manquant" }), candidats, "x");
      expect(destinataires(n)).toEqual(["demandeur"]);
      expect(n[0].message).toContain("Motif : Devis manquant");
      expect(n[0].priority).toBe("CRITIQUE");
    }
  });

  it("Abandon : personne", () => {
    expect(notificationsEtape(ctx("ABANDONNEE"), candidats, "demandeur")).toEqual([]);
  });

  it("l'auteur de l'action n'est jamais notifié de sa propre action", () => {
    expect(destinataires(notificationsEtape(ctx("FINANCE"), candidats, "fin-1"))).toEqual(["fin-2"]);
  });
});

describe("décision finale (Terminée)", () => {
  it("le demandeur et l'Assistant Finance ; approbation de clôture due : ceux qui peuvent la donner", () => {
    const n = notificationsEtape(ctx("TERMINEE", { montantValide: 100000, decideurFinanceId: "fin-1" }), candidats, "fin-1");
    expect(n.map((x) => x.titre)).toEqual(["Demande validée", "Demande à régler", "Demande à approuver avant clôture"]);
    expect(n[0].destinataires).toEqual(["demandeur"]);
    expect(n[1].destinataires).toEqual(["assist"]);
    expect(n[2].destinataires.sort()).toEqual(["admin", "dg", "fin-2"]);
  });

  it("validation partielle : le message du demandeur donne les deux montants", () => {
    const n = notificationsEtape(ctx("TERMINEE", { montantValide: 40000 }), candidats, "fin-1");
    expect(n[0].titre).toBe("Demande validée partiellement");
    expect(n[0].message).toMatch(/40\s000 FCFA sur 100\s000 FCFA/);
  });

  it("pas de « à approuver » quand le DG a déjà validé à l'étape DG, ni pour une demande du DG", () => {
    expect(destinatairesApprobationCloture(ctx("TERMINEE", { validationCompleteParDG: true }), candidats)).toEqual([]);
    expect(destinatairesApprobationCloture(ctx("TERMINEE", { approbationClotureNonRequise: true }), candidats)).toEqual([]);
    const n = notificationsEtape(ctx("TERMINEE", { montantValide: 1, validationCompleteParDG: true }), candidats, "fin-1");
    expect(n.map((x) => x.titre)).not.toContain("Demande à approuver avant clôture");
  });

  it("l'Assistant demandeur ou bénéficiaire n'est pas notifié pour régler", () => {
    const n = notificationsEtape(ctx("TERMINEE", { montantValide: 1, beneficiaireUserId: "assist" }), candidats, "fin-1");
    expect(n.find((x) => x.titre === "Demande à régler")).toBeUndefined();
  });
});

describe("étape sautée : aucune notification", () => {
  it("demandeur responsable de son service : l'étape Service est sautée, le responsable n'est pas notifié", () => {
    const parcours = determinerParcours({ estDG: false, estFinance: false, estResponsableDeSonService: true }, "STANDARD");
    const n = notificationsEtape(ctx(etapeInitiale(parcours), { responsableServiceId: "demandeur" }), candidats, "demandeur");
    expect(destinataires(n)).toEqual(["fin-1", "fin-2"]);
  });

  it("demande de la Finance : étapes Service et Finance sautées, seul le DG est notifié", () => {
    const parcours = determinerParcours({ estDG: false, estFinance: true, estResponsableDeSonService: false }, "STANDARD");
    expect(etapeInitiale(parcours)).toBe("DG");
    const n = notificationsEtape(ctx("DG", { createurId: "fin-1", modeEtapeDG: "OBLIGATOIRE" }), candidats, "fin-1");
    expect(destinataires(n)).toEqual(["dg"]);
    expect(n[0].message).toMatch(/ligne par ligne/);
  });

  it("collaborateur : seul le responsable de service est notifié à la création, pas la Finance", () => {
    const parcours = determinerParcours({ estDG: false, estFinance: false, estResponsableDeSonService: false }, "STANDARD");
    expect(destinataires(notificationsEtape(ctx(etapeInitiale(parcours)), candidats, "demandeur"))).toEqual(["resp"]);
  });
});

describe("rappels à 48 h", () => {
  const t0 = new Date("2026-10-01T08:00:00Z");
  const apres = (ms: number) => new Date(t0.getTime() + ms);

  it("rien avant 48 h, rappel à 48 h", () => {
    const d = { etape: "FINANCE" as const, etapeCircuitDepuis: t0, dernierRappelAt: null };
    expect(rappelDu(d, apres(DELAI_RAPPEL_MS - 1))).toBe(false);
    expect(rappelDu(d, apres(DELAI_RAPPEL_MS))).toBe(true);
  });

  it("au plus un rappel par 24 h : rien 1 h ni 23 h 59 après, second rappel 24 h après", () => {
    const heure = 60 * 60 * 1000;
    expect(INTERVALLE_RAPPEL_MS).toBe(24 * heure);
    const dernier = apres(DELAI_RAPPEL_MS);
    const d = { etape: "FINANCE" as const, etapeCircuitDepuis: t0, dernierRappelAt: dernier };
    expect(rappelDu(d, new Date(dernier.getTime() + heure))).toBe(false);
    expect(rappelDu(d, new Date(dernier.getTime() + 24 * heure - 1))).toBe(false);
    expect(rappelDu(d, new Date(dernier.getTime() + 24 * heure))).toBe(true);
  });

  it("jamais pour une demande terminée ou abandonnée", () => {
    for (const etape of ["TERMINEE", "ABANDONNEE"] as const) {
      expect(rappelDu({ etape, etapeCircuitDepuis: t0, dernierRappelAt: null }, apres(10 * DELAI_RAPPEL_MS))).toBe(false);
    }
  });

  it("message de rappel : même destinataire que l'étape, avec la durée d'attente", () => {
    const n = notificationRappel(ctx("SERVICE"), candidats, t0, apres(3 * 24 * 3600 * 1000));
    expect(n?.destinataires).toEqual(["resp"]);
    expect(n?.titre).toBe("Rappel : demande à valider (service)");
    expect(n?.message).toMatch(/^En attente depuis 3 jours à l'étape Service\./);
  });

  it("deux affichages simultanés : la demande n'est réservée qu'une fois (puis plus pendant 24 h)", async () => {
    type Ligne = { id: string; etapeCircuit: EtapeCircuit; etapeCircuitDepuis: Date; dernierRappelAt: Date | null };
    const lignes: Ligne[] = [
      { id: "vieille", etapeCircuit: "FINANCE", etapeCircuitDepuis: t0, dernierRappelAt: null },
      { id: "recente", etapeCircuit: "FINANCE", etapeCircuitDepuis: apres(DELAI_RAPPEL_MS), dernierRappelAt: null },
      { id: "finie", etapeCircuit: "TERMINEE", etapeCircuitDepuis: t0, dernierRappelAt: null },
    ];
    type Where = {
      id?: string;
      etapeCircuit?: EtapeCircuit | { in: EtapeCircuit[] };
      etapeCircuitDepuis?: Date | { lte: Date };
      OR?: ({ dernierRappelAt: null } | { dernierRappelAt: { lte: Date } })[];
    };
    const correspond = (l: Ligne, w: Where) =>
      (!w.id || l.id === w.id) &&
      (!w.etapeCircuit ||
        (typeof w.etapeCircuit === "string" ? l.etapeCircuit === w.etapeCircuit : w.etapeCircuit.in.includes(l.etapeCircuit))) &&
      (!w.etapeCircuitDepuis ||
        (w.etapeCircuitDepuis instanceof Date
          ? l.etapeCircuitDepuis.getTime() === w.etapeCircuitDepuis.getTime()
          : l.etapeCircuitDepuis <= w.etapeCircuitDepuis.lte)) &&
      (!w.OR ||
        w.OR.some((o) =>
          o.dernierRappelAt === null ? l.dernierRappelAt === null : l.dernierRappelAt !== null && l.dernierRappelAt <= o.dernierRappelAt.lte
        ));
    const db = {
      demande: {
        findMany: async ({ where }: { where: Where }) => lignes.filter((l) => correspond(l, where)).map((l) => ({ ...l })),
        updateMany: async ({ where, data }: { where: Where; data: { dernierRappelAt: Date } }) => {
          const touchees = lignes.filter((l) => correspond(l, where));
          for (const l of touchees) l.dernierRappelAt = data.dernierRappelAt;
          return { count: touchees.length };
        },
      },
    } as unknown as Parameters<typeof reserverRappelsDus>[0];

    const maintenant = apres(DELAI_RAPPEL_MS + 1000);
    // Les deux lectures ont lieu avant la première réservation : seule une des deux réserve la demande.
    const [a, b] = await Promise.all([reserverRappelsDus(db, maintenant), reserverRappelsDus(db, maintenant)]);
    expect([...a, ...b].map((r) => r.id)).toEqual(["vieille"]);
    // Une heure après, puis juste avant 24 h : plus rien ; 24 h après : à nouveau.
    const heure = 60 * 60 * 1000;
    expect(await reserverRappelsDus(db, new Date(maintenant.getTime() + heure))).toEqual([]);
    expect(await reserverRappelsDus(db, new Date(maintenant.getTime() + 24 * heure - 1))).toEqual([]);
    expect((await reserverRappelsDus(db, new Date(maintenant.getTime() + 24 * heure))).map((r) => r.id)).toEqual([
      "vieille",
    ]);
  });
});
