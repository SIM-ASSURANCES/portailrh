import { describe, expect, it } from "vitest";

import {
  nommerArticle,
  notificationRefusLigneDG,
  notificationsAttenteArticles,
  notificationsEtape,
  notificationsRappel,
  rappelDemande,
  rappelDu,
  type ArticleNotification,
  type CandidatNotification,
  type ContexteNotificationCircuit,
} from "./circuitNotifications";

// `toLocaleString("fr-FR")` insère des espaces insécables fines : on compare avec des espaces ordinaires.
const norm = (s: string) => s.replace(/[\u202f\u00a0]/g, " ");
import { resumeArticles } from "./etatArticles";
import type { ManqueArticle } from "./clotureDemande";

// Lot C — notifications et rappels PAR ARTICLE : l'article est nommé (libellé, bénéficiaire, montant), la demande rappelée
// (numéro, demandeur, service), une seule notification par audience même quand plusieurs articles sont traités ensemble.

const candidats: CandidatNotification[] = [
  { id: "fin", permissions: ["treso.decider_finance", "treso.soumettre_dg", "treso.cloturer_demande"] },
  { id: "dg", permissions: ["treso.decider_dg", "treso.approuver_validation_complete"] },
  { id: "assist-1", permissions: ["treso.effectuer_reglement", "treso.receptionner_retour"] },
  { id: "assist-2", permissions: ["treso.effectuer_reglement", "treso.receptionner_retour"] },
];

const manque = (m: Partial<ManqueArticle>): ManqueArticle => ({ resteARegler: 0, retoursEnAttente: 0, resteNonDetaille: 0, solde: 0, ...m });

function art(id: string, o: Partial<ArticleNotification> = {}): ArticleNotification {
  return {
    id,
    libelle: `Article ${id}`,
    beneficiaire: `Bénéf ${id}`,
    beneficiaireUserId: null,
    montant: 100000,
    statut: "EN_ATTENTE",
    etat: "A_DECIDER",
    motif: null,
    manque: null,
    ...o,
  };
}

function ctx(articlesDetail: ArticleNotification[], o: Partial<ContexteNotificationCircuit> = {}): ContexteNotificationCircuit {
  const lignes = articlesDetail.map((a) => ({
    statut: a.statut,
    soumiseAuDG: a.etat !== "A_DECIDER" && a.statut === "EN_ATTENTE",
    decisionDG: a.etat === "VALIDEE_DG_A_CONFIRMER" ? ("VALIDEE" as const) : a.etat === "REFUSEE_DG_A_TRANCHER" ? ("REFUSEE" as const) : null,
  }));
  return {
    demandeId: "d-1",
    reference: "DEM-2026-000007",
    etape: "FINANCE",
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
    montant: 300000,
    montantValide: 0,
    approbationClotureNonRequise: false,
    validationCompleteParDG: false,
    serviceNom: "Commercial",
    statutDemande: "EN_ATTENTE_VALIDATION",
    articles: resumeArticles(lignes, "OPTIONNELLE"),
    articlesDetail,
    ...o,
  };
}

describe("nommer un article et rappeler la demande", () => {
  it("« libellé » (bénéficiaire, montant) et « Demande n° de demandeur (service) »", () => {
    expect(norm(nommerArticle({ libelle: "Formation", beneficiaire: "Kofi", montant: 571000 }))).toBe("« Formation » (bénéficiaire Kofi, 571 000 FCFA)");
    expect(rappelDemande(ctx([]))).toBe("Demande DEM-2026-000007 de Awa Demandeur (service Commercial)");
  });
});

describe("soumission, décision du DG, resoumission : le DG et la Finance voient les articles concernés", () => {
  const A = art("A", { etat: "CHEZ_DG" });
  const B = art("B", { etat: "CHEZ_DG" });
  const C = art("C", { etat: "A_DECIDER" });

  it("soumission de A et B : UNE notification au DG, qui nomme les deux articles et la demande", () => {
    const n = notificationsEtape(ctx([A, B, C], { articlesConcernes: ["A", "B"] }), candidats, "fin", "SOUMISSION_DG");
    expect(n).toHaveLength(1);
    expect(n[0].destinataires).toEqual(["dg"]);
    expect(norm(n[0].message)).toContain("DEM-2026-000007 de Awa Demandeur (service Commercial)");
    expect(norm(n[0].message)).toContain("« Article A » (bénéficiaire Bénéf A, 100 000 FCFA)");
    expect(norm(n[0].message)).toContain("« Article B » (bénéficiaire Bénéf B, 100 000 FCFA)");
    expect(norm(n[0].message)).not.toContain("Article C");
  });

  it("resoumission après refus : le message le dit", () => {
    const n = notificationsEtape(ctx([A, B, C], { articlesResoumis: ["A"] }), candidats, "fin", "SOUMISSION_DG");
    expect(norm(n[0].message)).toContain("dont 1 resoumis après refus");
  });

  it("le DG a fini : la Finance voit l'article validé à confirmer et l'article refusé (avec motif) à resoumettre ou rejeter", () => {
    const validee = art("A", { etat: "VALIDEE_DG_A_CONFIRMER" });
    const refusee = art("B", { etat: "REFUSEE_DG_A_TRANCHER", motif: "Hors budget" });
    const n = notificationsEtape(ctx([validee, refusee, C]), candidats, "dg", "DECISION_DG");
    expect(n).toHaveLength(1);
    expect(n[0].destinataires).toEqual(["fin"]);
    expect(norm(n[0].message)).toContain("« Article A » (bénéficiaire Bénéf A, 100 000 FCFA) — validé par le DG, à confirmer");
    expect(norm(n[0].message)).toContain("— refusé par le DG (motif : Hors budget), à resoumettre ou à rejeter");
    expect(norm(n[0].message)).toContain("« Article C » (bénéficiaire Bénéf C, 100 000 FCFA) — à décider");
  });

  it("refus d'un article par le DG : la Finance est prévenue avec le bénéficiaire et le montant de l'article", () => {
    const n = notificationRefusLigneDG(ctx([A, B, C]), candidats, { libelle: "Article A", motif: "Trop cher", ligneId: "A" }, "dg")!;
    expect(n.destinataires).toEqual(["fin"]);
    expect(norm(n.message)).toContain("« Article A » (bénéficiaire Bénéf A, 100 000 FCFA)");
    expect(norm(n.message)).toContain("DEM-2026-000007 de Awa Demandeur (service Commercial)");
    expect(norm(n.message)).toContain("Trop cher");
  });
});

describe("décision de la Finance : le demandeur et l'Assistant, sans doublon", () => {
  const validee = art("A", { statut: "VALIDEE", etat: "VALIDEE", manque: manque({ resteARegler: 100000 }) });
  const rejetee = art("B", { statut: "REJETEE", etat: "REJETEE", motif: "Doublon" });
  const attente = art("C");

  it("A validé et B rejeté ensemble : UNE notification au demandeur qui détaille les deux, UNE par Assistant avec A à régler", () => {
    const c = ctx([validee, rejetee, attente], { articlesConcernes: ["A", "B"], montantValide: 100000 });
    const n = notificationsEtape(c, candidats, "fin", "DECISION_ARTICLES");
    const demandeur = n.filter((x) => x.destinataires.includes("demandeur"));
    expect(demandeur).toHaveLength(1);
    expect(norm(demandeur[0].message)).toContain("« Article A » (bénéficiaire Bénéf A, 100 000 FCFA) : validé");
    expect(norm(demandeur[0].message)).toContain("« Article B » (bénéficiaire Bénéf B, 100 000 FCFA) : rejeté (motif : Doublon)");
    const regler = n.filter((x) => x.titre === "Demande à régler");
    expect(regler).toHaveLength(1);
    expect(regler[0].destinataires.sort()).toEqual(["assist-1", "assist-2"]);
    expect(norm(regler[0].message)).toContain("« Article A »");
    expect(norm(regler[0].message)).not.toContain("Article B");
    expect(norm(regler[0].message)).toContain("DEM-2026-000007 de Awa Demandeur (service Commercial)");
  });

  it("l'auteur de la décision n'est jamais notifié de sa propre action", () => {
    const n = notificationsEtape(ctx([validee, rejetee, attente], { articlesConcernes: ["A"], montantValide: 100000 }), candidats, "assist-1", "DECISION_ARTICLES");
    expect(n.flatMap((x) => x.destinataires)).not.toContain("assist-1");
  });
});

describe("demande terminée : suivi par article (règlement, retours, dépenses, clôture)", () => {
  const aRegler = art("A", { statut: "VALIDEE", etat: "VALIDEE", manque: manque({ resteARegler: 60000, solde: 0 }) });
  const retour = art("B", { statut: "VALIDEE", etat: "VALIDEE", manque: manque({ retoursEnAttente: 1, resteNonDetaille: 5000, solde: 5000 }) });
  const fini = art("C", { statut: "VALIDEE", etat: "VALIDEE", manque: null });
  const rejete = art("D", { statut: "REJETEE", etat: "REJETEE" });
  const base = (articles: ArticleNotification[], o: Partial<ContexteNotificationCircuit> = {}) =>
    ctx(articles, { etape: "TERMINEE", statutDemande: "REGLEE", montantValide: 300000, ...o });

  it("règlement → Assistants, retours et dépenses → Assistants : chaque article attendu est nommé avec ce qui lui manque", () => {
    const n = notificationsAttenteArticles(base([aRegler, retour, fini, rejete]), candidats);
    const regler = n.find((x) => x.titre === "Articles à régler" && x.destinataires[0] === "assist-1")!;
    expect(norm(regler.message)).toContain("« Article A » (bénéficiaire Bénéf A, 100 000 FCFA) — reste à régler 60 000 FCFA");
    expect(norm(regler.message)).not.toContain("Article B");
    const retours = n.find((x) => x.titre === "Retours de caisse et dépenses à traiter" && x.destinataires[0] === "assist-1")!;
    expect(norm(retours.message)).toContain("« Article B »");
    expect(norm(retours.message)).toContain("1 retour de caisse à réceptionner");
    expect(norm(retours.message)).toContain("dépenses à détailler 5 000 FCFA");
    expect(norm(retours.message)).not.toContain("Article A");
    expect(n.find((x) => x.titre === "Demande prête à être clôturée")).toBeUndefined();
  });

  it("garde 8 par article : un Assistant bénéficiaire d'un article n'est pas prévenu pour CET article, mais l'est pour les autres", () => {
    const miens = art("A", { statut: "VALIDEE", etat: "VALIDEE", beneficiaireUserId: "assist-1", manque: manque({ resteARegler: 1000 }) });
    const autre = art("B", { statut: "VALIDEE", etat: "VALIDEE", manque: manque({ resteARegler: 2000 }) });
    const n = notificationsAttenteArticles(base([miens, autre]), candidats);
    const pour1 = n.find((x) => x.titre === "Articles à régler" && x.destinataires[0] === "assist-1")!;
    expect(norm(pour1.message)).toContain("Article B");
    expect(norm(pour1.message)).not.toContain("Article A");
    const pour2 = n.find((x) => x.titre === "Articles à régler" && x.destinataires[0] === "assist-2")!;
    expect(norm(pour2.message)).toContain("Article A");
    expect(norm(pour2.message)).toContain("Article B");
  });

  it("tous les articles terminés : la Finance est prévenue que la demande peut être clôturée, et le DG si son approbation reste due", () => {
    const n = notificationsAttenteArticles(base([fini, rejete]), candidats);
    expect(n.find((x) => x.titre === "Demande prête à être clôturée")?.destinataires).toEqual(["fin"]);
    expect(n.find((x) => x.titre === "Demande à approuver avant clôture")?.destinataires).toEqual(["dg"]);
    const apresDG = notificationsAttenteArticles(base([fini, rejete], { validationCompleteParDG: true }), candidats);
    expect(apresDG.find((x) => x.titre === "Demande à approuver avant clôture")).toBeUndefined();
  });

  it("demande clôturée, rejetée ou abandonnée : plus aucune relance", () => {
    for (const statutDemande of ["CLOTUREE", "REJETEE", "ABANDONNEE"]) {
      expect(notificationsAttenteArticles(base([aRegler], { statutDemande }), candidats)).toEqual([]);
    }
  });

  it("le rappel d'une demande terminée nomme les articles qui attendent encore une action", () => {
    const t0 = new Date("2026-10-01T08:00:00Z");
    const r = notificationsRappel(base([aRegler, retour, fini]), candidats, t0, new Date(t0.getTime() + 3 * 24 * 3600 * 1000));
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.titre.startsWith("Rappel : "))).toBe(true);
    expect(r.every((x) => x.message.startsWith("En attente depuis 3 jours sans événement sur la demande."))).toBe(true);
    expect(r.some((x) => x.message.includes("« Article A »"))).toBe(true);
    expect(r.some((x) => x.message.includes("« Article B »"))).toBe(true);
    expect(r.every((x) => !x.message.includes("Article C"))).toBe(true);
  });
});

describe("chronomètre : une demande terminée n'est relancée que si elle a un suivi par article", () => {
  const t0 = new Date("2026-10-01T08:00:00Z");
  const plus3j = new Date(t0.getTime() + 3 * 24 * 3600 * 1000);
  it("TERMINEE : relancée seulement avec suiviArticles, jamais sinon (dépense directe, ancienne demande)", () => {
    const d = { etape: "TERMINEE" as const, etapeCircuitDepuis: t0, dernierRappelAt: null };
    expect(rappelDu(d, plus3j)).toBe(false);
    expect(rappelDu({ ...d, suiviArticles: true }, plus3j)).toBe(true);
  });
  it("un événement (règlement, retour…) remet le chrono à zéro : 48 h à compter de l'événement", () => {
    const evenement = new Date(t0.getTime() + 2.5 * 24 * 3600 * 1000);
    expect(rappelDu({ etape: "TERMINEE", etapeCircuitDepuis: evenement, dernierRappelAt: null, suiviArticles: true }, plus3j)).toBe(false);
  });
});
