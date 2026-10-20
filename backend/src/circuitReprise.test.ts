import { describe, expect, it } from "vitest";

import { determinerParcours, raisonRepriseIndisponible, transition, type ActeurCircuit, type DemandeCircuit, type LigneCircuit } from "./circuitDemande";
import { notificationsReprise, type ContexteNotificationCircuit } from "./circuitNotifications";
import { detailReprise, evaluerReprise, MOTIF_REPRISE_MIN, refusMotifReprise, type DemandeReprise, type LigneReprise } from "./circuitReprise";
import { retirerCouvertureArticle } from "./budgets";
import type { EtapeCircuit, ModeEtapeDG, StatutDemande } from "./generated/prisma/enums";

// Lot K, partie 2 — reprise (retour à l'étape précédente), motif obligatoire.

const DEMANDEUR = "u-demandeur";
const MOTIF = "Une pièce justificative manque au dossier";
const acteur = (userId: string, permissions: string[]): ActeurCircuit => ({ userId, permissions, estResponsableServiceDuDemandeur: false });
const FINANCE = acteur("u-fin", ["treso.decider_finance", "treso.soumettre_dg"]);
const DG = acteur("u-dg", ["treso.decider_dg"]);
const ASSISTANT = acteur("u-assist", ["treso.effectuer_reglement", "treso.receptionner_retour"]);

const ligne = (id: string, p: Partial<LigneCircuit> = {}): LigneCircuit => ({
  id,
  libelle: `Article ${id}`,
  categorisee: true,
  statut: "EN_ATTENTE",
  soumiseAuDG: false,
  decisionDG: null,
  decisionDGParId: null,
  nbReglementsActifs: 0,
  ...p,
});
const validee = (id: string, p: Partial<LigneCircuit> = {}) => ligne(id, { statut: "VALIDEE", decideurFinanceId: "u-fin", ...p });
const chezDG = (id: string) => ligne(id, { soumiseAuDG: true });
const valideeParDG = (id: string) => ligne(id, { statut: "VALIDEE", soumiseAuDG: true, decisionDG: "VALIDEE", decisionDGParId: "u-dg" });

function demande(etape: EtapeCircuit, lignes: LigneCircuit[], p: { statut?: StatutDemande; mode?: ModeEtapeDG; service?: boolean } = {}): DemandeCircuit {
  const parcours = determinerParcours({ estDG: false, estFinance: false, estResponsableDeSonService: false }, "STANDARD");
  return {
    etape,
    createurId: DEMANDEUR,
    typeDemande: "STANDARD",
    ...parcours,
    ...(p.mode ? { modeEtapeDG: p.mode } : {}),
    ...(p.service === false ? { etapeServiceRequise: false } : {}),
    statutDemande: p.statut ?? "EN_ATTENTE_VALIDATION",
    lignes,
  };
}
const reprendre = (d: DemandeCircuit, qui: ActeurCircuit, ligneId?: string, motif = MOTIF) => transition(d, qui, { type: "REPRENDRE", motif, ligneId });
const ok = (d: DemandeCircuit, qui: ActeurCircuit, ligneId?: string) => {
  const r = reprendre(d, qui, ligneId);
  if (!r.ok) throw new Error(`refusé : ${r.message}`);
  return r;
};
const ko = (d: DemandeCircuit, qui: ActeurCircuit, ligneId?: string, motif = MOTIF) => {
  const r = reprendre(d, qui, ligneId, motif);
  if (r.ok) throw new Error(`accepté vers ${r.etapeSuivante}`);
  return r.message;
};

describe("motif obligatoire", () => {
  it("10 caractères minimum, pour toute reprise", () => {
    expect(MOTIF_REPRISE_MIN).toBe(10);
    expect(refusMotifReprise("court")).not.toBeNull();
    expect(refusMotifReprise("   ")).not.toBeNull();
    expect(refusMotifReprise(MOTIF)).toBeNull();
    expect(ko(demande("FINANCE", [ligne("a")]), FINANCE, undefined, "pas assez")).toMatch(/motif de la reprise est obligatoire/);
    expect(ko(demande("DG", [chezDG("a")]), DG, "a", "")).toMatch(/obligatoire/);
  });
});

describe("Finance → Service (demande entière)", () => {
  it("possible tant qu'aucun article n'est décidé ni soumis", () => {
    const r = ok(demande("FINANCE", [ligne("a"), ligne("b")]), FINANCE);
    expect(r.etapeSuivante).toBe("SERVICE");
    expect(r.effets.reprise).toEqual({ type: "FINANCE_VERS_SERVICE", ligneId: null });
  });
  it("le DG (décideur de l'étape suivante) le peut aussi au niveau du moteur", () => {
    expect(ok(demande("FINANCE", [ligne("a")]), DG).etapeSuivante).toBe("SERVICE");
  });
  it("refusée dès qu'un article est validé, rejeté, chez le DG ou refusé par le DG", () => {
    for (const l of [validee("b"), ligne("b", { statut: "REJETEE" }), chezDG("b"), ligne("b", { soumiseAuDG: true, decisionDG: "REFUSEE" })]) {
      expect(ko(demande("FINANCE", [ligne("a"), l]), FINANCE)).toMatch(/déjà été décidés ou soumis/);
    }
  });
  it("refusée sans étape Service au parcours (demande d'un responsable, de la Finance…)", () => {
    expect(ko(demande("FINANCE", [ligne("a")], { service: false }), FINANCE)).toMatch(/pas passée par l'étape Service/);
  });
  it("refusée hors de l'étape Finance", () => {
    expect(ko(demande("SERVICE", [ligne("a")]), FINANCE)).toMatch(/pas à l'étape Finance/);
    expect(ko(demande("DG", [chezDG("a")]), FINANCE)).toMatch(/pas à l'étape Finance/);
  });
});

describe("DG → Finance (article soumis au DG)", () => {
  it("le DG renvoie l'article à la Finance, ou la Finance le retire avant sa décision", () => {
    for (const qui of [DG, FINANCE]) {
      const r = ok(demande("DG", [chezDG("a")]), qui, "a");
      expect(r.etapeSuivante).toBe("FINANCE");
      expect(r.effets.reprise).toEqual({ type: "DG_VERS_FINANCE", ligneId: "a" });
    }
  });
  it("les autres articles gardent leur état : étape déduite des articles", () => {
    const d = demande("DG", [chezDG("a"), valideeParDG("b")]);
    expect(ok(d, DG, "a").etapeSuivante).toBe("FINANCE");
  });
  it("refusée pour un article validé par le DG (définitif), refusé par le DG, ou déjà chez la Finance", () => {
    expect(ko(demande("TERMINEE", [valideeParDG("a")]), FINANCE, "a")).toMatch(/validé par le DG/);
    expect(ko(demande("FINANCE", [ligne("a", { soumiseAuDG: true, decisionDG: "VALIDEE", decisionDGParId: "u-dg" })]), FINANCE, "a")).toMatch(/validé par le DG/);
    expect(ko(demande("FINANCE", [ligne("a", { soumiseAuDG: true, decisionDG: "REFUSEE" })]), FINANCE, "a")).toMatch(/attend déjà la décision de la Finance/);
    expect(ko(demande("FINANCE", [ligne("a")]), FINANCE, "a")).toMatch(/attend déjà la décision de la Finance/);
  });
  it("cas (b), DG d'office : pas d'étape précédente", () => {
    expect(ko(demande("DG", [chezDG("a")], { mode: "OBLIGATOIRE" }), DG, "a")).toMatch(/décide d'office/);
  });
});

describe("validation de la Finance → à décider (article validé)", () => {
  it("reprise possible d'un article validé par la Finance seule, sans règlement : la demande revient à la Finance", () => {
    const d = demande("TERMINEE", [validee("a"), validee("b")], { statut: "VALIDEE_NON_REGLEE" });
    const r = ok(d, FINANCE, "a");
    expect(r.etapeSuivante).toBe("FINANCE");
    expect(r.effets.reprise).toEqual({ type: "VALIDATION_VERS_FINANCE", ligneId: "a" });
    expect(ok(d, DG, "b").etapeSuivante).toBe("FINANCE");
  });
  it("refusée pour un article réglé, même en partie ou en brouillon", () => {
    const d = demande("TERMINEE", [validee("a", { nbReglementsActifs: 1 })], { statut: "PARTIELLEMENT_REGLEE" });
    expect(ko(d, FINANCE, "a")).toMatch(/déjà un règlement/);
  });
  it("refusée si le nombre de règlements est inconnu (jamais de devinette)", () => {
    expect(ko(demande("TERMINEE", [validee("a", { nbReglementsActifs: undefined })]), FINANCE, "a")).toMatch(/pas pu être vérifiés/);
  });
  it("refusée pour un article rejeté (définitif)", () => {
    expect(ko(demande("FINANCE", [ligne("a", { statut: "REJETEE" }), ligne("b")]), FINANCE, "a")).toMatch(/rejet est définitif/);
  });
  it("refusée si la validation a transité par le DG, ou si le DG décide d'office", () => {
    expect(ko(demande("TERMINEE", [valideeParDG("a")]), DG, "a")).toMatch(/validé par le DG/);
    expect(ko(demande("TERMINEE", [validee("a")], { mode: "OBLIGATOIRE" }), DG, "a")).toMatch(/validé par le DG/);
  });
});

describe("interdits communs", () => {
  it("demande clôturée, rejetée ou abandonnée", () => {
    for (const statut of ["CLOTUREE", "REJETEE", "ABANDONNEE"] as const) {
      expect(ko(demande("TERMINEE", [validee("a")], { statut }), FINANCE, "a")).toMatch(/clôturée, rejetée ou abandonnée/);
    }
  });
  it("demande en correction chez le demandeur", () => {
    expect(ko(demande("A_CORRIGER", [ligne("a", { statut: "REJETEE" })]), FINANCE)).toMatch(/en correction/);
  });
  it("sans permission de décision (Assistant Finance, collaborateur) : non autorisée", () => {
    expect(ko(demande("FINANCE", [ligne("a")]), ASSISTANT)).toBe("Action non autorisée.");
    expect(ko(demande("FINANCE", [ligne("a")]), acteur("u-x", []))).toBe("Action non autorisée.");
  });
  it("garde 8 : jamais le demandeur, jamais le bénéficiaire de l'article repris", () => {
    expect(ko(demande("FINANCE", [ligne("a")]), acteur(DEMANDEUR, ["treso.decider_finance"]))).toMatch(/propre demande/);
    const d = demande("TERMINEE", [validee("a", { beneficiaireUserId: "u-fin" })]);
    expect(ko(d, FINANCE, "a")).toMatch(/bénéficiaire/);
    // Le bénéficiaire d'un AUTRE article peut reprendre celui-ci.
    const d2 = demande("TERMINEE", [validee("a"), validee("b", { beneficiaireUserId: "u-fin" })]);
    expect(ok(d2, FINANCE, "a").etapeSuivante).toBe("FINANCE");
  });
  it("article inconnu", () => {
    expect(ko(demande("FINANCE", [ligne("a")]), FINANCE, "zzz")).toMatch(/ne fait pas partie/);
  });
  it("dépense directe : pas d'étape précédente", () => {
    const d: DemandeCircuit = { ...demande("FINANCE", []), typeDemande: "DEPENSE_DIRECTE" };
    expect(ko(d, FINANCE)).toMatch(/Une dépense directe/);
  });
  it("la raison affichée sur le bouton grisé est celle du serveur", () => {
    expect(raisonRepriseIndisponible(demande("FINANCE", [ligne("a")]), FINANCE)).toBeNull();
    expect(raisonRepriseIndisponible(demande("TERMINEE", [validee("a", { nbReglementsActifs: 2 })]), FINANCE, "a")).toMatch(/déjà un règlement/);
  });
});

describe("evaluerReprise : même résultat que le moteur", () => {
  it("renvoie le type de reprise", () => {
    const d: DemandeReprise = {
      etape: "DG",
      createurId: DEMANDEUR,
      typeDemande: "STANDARD",
      etapeServiceRequise: true,
      modeEtapeDG: "OPTIONNELLE",
      lignes: [{ id: "a", libelle: "A", statut: "EN_ATTENTE", soumiseAuDG: true, decisionDG: null } as LigneReprise],
    };
    expect(evaluerReprise(d, DG, "a", MOTIF)).toMatchObject({ ok: true, type: "DG_VERS_FINANCE", etapeSuivante: "FINANCE" });
  });
  it("historique : de quelle étape à quelle étape, quel article, quel motif", () => {
    const t = detailReprise({ type: "VALIDATION_VERS_FINANCE", motif: ` ${MOTIF} `, libelleArticle: "Formation", etapeAvant: "Terminée", etapeApres: "Finance" });
    expect(t).toContain("article « Formation »");
    expect(t).toContain("Validé par la Finance → À décider par la Finance");
    expect(t).toContain(`motif : ${MOTIF}`);
    expect(t).toContain("Terminée → Finance");
    expect(detailReprise({ type: "FINANCE_VERS_SERVICE", motif: MOTIF, etapeAvant: "Finance", etapeApres: "Service" })).toContain("demande entière");
  });
});

describe("budgets : confirmation de dépassement d'un article repris", () => {
  it("sa part de la couverture devient caduque, celle des autres articles reste", () => {
    const couv = [
      { ligneId: "a", categorieId: "c1", montant: 120000 },
      { ligneId: "b", categorieId: "c1", montant: 30000 },
      { ligneId: "a", categorieId: "c2", montant: 5000.5 },
    ];
    const { restante, retire } = retirerCouvertureArticle(couv, "a");
    expect(retire).toBe(125000.5);
    expect(restante).toEqual([{ ligneId: "b", categorieId: "c1", montant: 30000 }]);
  });
  it("article non couvert : rien n'est retiré", () => {
    const couv = [{ ligneId: "b", categorieId: "c1", montant: 30000 }];
    expect(retirerCouvertureArticle(couv, "a")).toEqual({ restante: couv, retire: 0 });
  });
});

describe("notifications de reprise", () => {
  const ctx = {
    demandeId: "d1",
    reference: "DEM-2026-000001",
    createurId: DEMANDEUR,
    createurNom: "Aïcha",
    serviceNom: "Commercial",
    responsableServiceId: "u-resp",
    montant: 50000,
  } as unknown as ContexteNotificationCircuit;
  const candidats = [
    { id: "u-fin", permissions: ["treso.decider_finance", "treso.soumettre_dg"] },
    { id: "u-fin2", permissions: ["treso.decider_finance"] },
    { id: "u-dg", permissions: ["treso.decider_dg"] },
  ];
  it("Finance → Service : le responsable du service est prévenu avec le motif, pas l'auteur", () => {
    const n = notificationsReprise(ctx, candidats, { acteurId: "u-fin", type: "FINANCE_VERS_SERVICE", motif: MOTIF });
    expect(n[0].destinataires).toEqual(["u-resp"]);
    expect(n[0].message).toContain(MOTIF);
    expect(n[0].lien).toBe("/treso/service/d1");
  });
  it("DG → Finance : la Finance est prévenue, pas le DG qui renvoie", () => {
    const n = notificationsReprise(ctx, candidats, { acteurId: "u-dg", type: "DG_VERS_FINANCE", motif: MOTIF, libelleArticle: "Formation" });
    expect(n[0].destinataires.sort()).toEqual(["u-fin", "u-fin2"]);
    expect(n[0].message).toContain("Formation");
  });
  it("la Finance qui retire un article de l'étape DG : le DG est prévenu aussi", () => {
    const n = notificationsReprise(ctx, candidats, { acteurId: "u-fin", type: "DG_VERS_FINANCE", motif: MOTIF });
    expect(n.flatMap((x) => x.destinataires)).toContain("u-dg");
    expect(n.flatMap((x) => x.destinataires)).not.toContain("u-fin");
  });
  it("le demandeur est informé de tout retour en arrière, sauf s'il en est l'auteur", () => {
    const n = notificationsReprise(ctx, candidats, { acteurId: "u-fin", type: "VALIDATION_VERS_FINANCE", motif: MOTIF });
    expect(n.at(-1)!.destinataires).toEqual([DEMANDEUR]);
  });
});
