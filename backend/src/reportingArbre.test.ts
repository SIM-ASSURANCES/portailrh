import { describe, expect, it } from "vitest";
import {
  aplatirArbres,
  construireArbreDemande,
  COLONNES_ARBRE,
  COLONNES_TOTAUX,
  ligneRetourExterneHorsDemande,
  totauxParDevise,
  type ArticleArbreSource,
  type DemandeArbreSource,
  type LigneArbre,
  type ReglementArbreSource,
  type RetourArbreSource,
} from "./reportingArbre";

const d = (iso: string) => new Date(`${iso}T10:00:00Z`);

function article(id: string, libelle: string, extra: Partial<ArticleArbreSource> = {}): ArticleArbreSource {
  return {
    id,
    libelle,
    motif: "besoin",
    libelleOrigine: `${libelle} (version du demandeur)`,
    quantite: 1,
    prixUnitaire: 100_000,
    categorie: "Fournitures",
    objet: "Bureau",
    beneficiaire: "Awa Koné",
    statut: "VALIDEE",
    motifRejet: null,
    decidePar: "Finance Test",
    decideLe: d("2026-10-02"),
    decideurFinance: "Finance Test",
    soumiseAuDG: false,
    decisionDG: null,
    decisionDGPar: null,
    decisionDGLe: null,
    motifRefusDG: null,
    dateLivraison: d("2026-10-20"),
    ...extra,
  };
}

function retour(extra: Partial<RetourArbreSource> = {}): RetourArbreSource {
  return {
    montantARetourner: 0,
    estReceptionne: false,
    receptionneLe: null,
    receptionnePar: null,
    declarant: "Awa Koné",
    declareLe: d("2026-10-06"),
    attendu: true,
    creeParAssistant: false,
    versementBancaire: false,
    complementSignalement: false,
    reouvertureExceptionnelle: false,
    depenses: [],
    remboursements: [],
    ...extra,
  };
}

function reglement(id: string, ligneDemandeId: string | null, mode: "CAISSE" | "BANQUE", montant: number, extra: Partial<ReglementArbreSource> = {}): ReglementArbreSource {
  return {
    id,
    ligneDemandeId,
    montant,
    mode,
    estConfirme: true,
    estAnnule: false,
    motifAnnulation: null,
    auteur: "Assistant Test",
    creeLe: d("2026-10-03"),
    confirmeLe: d("2026-10-04"),
    retours: [],
    ...extra,
  };
}

/** Demande de référence du lot F : A réglé en caisse + retour, B réglé par banque + retour externe rattaché, C rejeté. */
function demandeTrois(extra: Partial<DemandeArbreSource> = {}): DemandeArbreSource {
  return {
    reference: "DEM-2026-000001",
    creeLe: d("2026-10-01"),
    gere: null,
    typeDemande: "STANDARD",
    statutLibelle: "Partiellement réglée",
    etapeCircuit: "Terminée",
    demandeur: "Awa Koné",
    service: "Commercial",
    beneficiaire: "Awa Koné",
    devise: "XOF",
    description: null,
    categorie: null,
    objet: null,
    montantDemande: 300_000,
    montantValide: 200_000,
    validationService: { par: "Resp Commercial", le: d("2026-10-01") },
    articles: [
      article("A", "Article A"),
      article("B", "Article B"),
      article("C", "Article C", { statut: "REJETEE", motifRejet: "hors budget", decidePar: "Finance Test", decideurFinance: null }),
    ],
    reglements: [
      reglement("RA", "A", "CAISSE", 100_000, {
        retours: [
          retour({
            id: "RET-A",
            estReceptionne: true,
            montantARetourner: 30_000,
            receptionneLe: d("2026-10-07"),
            receptionnePar: "Assistant Test",
            depenses: [
              { libelle: "Ramettes", montant: 60_000, justification: "FACTURE", motifNonJustifie: null, date: d("2026-10-05") },
              { libelle: "Transport", montant: 10_000, justification: "SANS_PIECE", motifNonJustifie: "ticket perdu", date: d("2026-10-05") },
            ],
          }),
        ],
      }),
      reglement("RB", "B", "BANQUE", 100_000, {
        retours: [
          // Fiche de détail des dépenses d'un fonds bancaire : jamais un retour attendu.
          retour({
            attendu: false,
            montantARetourner: 15_000,
            depenses: [{ libelle: "Prestation", montant: 85_000, justification: "FACTURE", motifNonJustifie: null, date: d("2026-10-05") }],
          }),
        ],
      }),
    ],
    mouvementsBanque: [{ reglementId: "RB", type: "SORTIE", montant: 100_000, creeLe: d("2026-10-04"), auteur: "Assistant Test", bordereau: false }],
    retoursExceptionnels: [],
    retoursExternes: [{ ligneDemandeId: "B", personne: "Awa Koné", montant: 15_000, motif: "chèque rendu", creePar: "Finance Test", creeLe: d("2026-10-08"), pieceRetourId: "pj-retour", pieceChequeId: "pj-cheque" }],
    clotureForcee: null,
    ...extra,
  };
}

const parType = (lignes: LigneArbre[], type: string) => lignes.filter((l) => l.type === type);

describe("reportingArbre — structure", () => {
  const arbre = construireArbreDemande(demandeTrois());
  const lignes = aplatirArbres([arbre]);

  it("ordre de lecture : demande, puis chaque article suivi de ses événements", () => {
    expect(lignes[0].type).toBe("DEMANDE");
    expect(lignes[0].niveau).toBe(0);
    expect(lignes[0].article).toBe("(Demande entière)");
    expect(arbre.articles.map((a) => a.article.article)).toEqual(["Article A", "Article B", "Article C"]);
    const idxA = lignes.findIndex((l) => l.type === "ARTICLE" && l.article === "Article A");
    const idxB = lignes.findIndex((l) => l.type === "ARTICLE" && l.article === "Article B");
    expect(lignes.slice(idxA + 1, idxB).every((l) => l.niveau === 2 && l.article === "Article A")).toBe(true);
    expect(lignes.filter((l) => l.niveau === 1)).toHaveLength(3);
  });

  it("référence, article, devise, demandeur et service répétés sur CHAQUE ligne", () => {
    for (const l of lignes) {
      expect(l.reference).toBe("DEM-2026-000001");
      expect(l.devise).toBe("XOF");
      expect(l.demandeur).toBe("Awa Koné");
      expect(l.service).toBe("Commercial");
      expect(l.article).not.toBe("");
    }
  });

  it("les événements portent l'article de leur ligne : règlements, mouvement banque, retours, dépenses, retour externe", () => {
    const duB = lignes.filter((l) => l.niveau === 2 && l.article === "Article B").map((l) => l.type);
    expect(duB).toEqual(["REGLEMENT", "MOUVEMENT_BANQUE", "RETOUR_CAISSE", "DEPENSE", "RETOUR_EXTERNE"]);
    const duA = lignes.filter((l) => l.niveau === 2 && l.article === "Article A").map((l) => l.type);
    expect(duA).toEqual(["REGLEMENT", "RETOUR_CAISSE", "DEPENSE", "DEPENSE"]);
    expect(lignes.filter((l) => l.niveau === 2 && l.article === "Article C")).toHaveLength(0);
  });

  it("une seule ligne qui compte dans les totaux : la demande", () => {
    expect(lignes.filter((l) => l.compte === "Oui").map((l) => l.type)).toEqual(["DEMANDE"]);
  });

  it("colonnes : une seule colonne « Réglé » (pas de doublon) et clés distinctes", () => {
    const cles = COLONNES_ARBRE.map((c) => c.cle);
    expect(new Set(cles).size).toBe(cles.length);
    expect(COLONNES_ARBRE.filter((c) => c.longue).map((c) => c.cle)).toEqual(["circuitEvenements", "motif"]);
  });
});

describe("reportingArbre — chiffres et absence de double comptage", () => {
  const arbre = construireArbreDemande(demandeTrois());
  const lignes = aplatirArbres([arbre]);
  const [demande] = lignes;
  const articles = lignes.filter((l) => l.type === "ARTICLE");

  it("la somme des articles égale la demande (réglé, dépensé, retourné, solde, caisse, banque)", () => {
    for (const cle of ["montantRegle", "regleCaisse", "regleBanque", "depense", "retourne", "solde", "montantDemande", "montantValide"] as const) {
      const s = articles.reduce((t, a) => t + (a[cle] ?? 0), 0);
      expect(Math.round(s * 100)).toBe(Math.round((demande[cle] ?? 0) * 100));
    }
  });

  it("valeurs attendues : A soldé en caisse, B soldé par banque + retour externe, C rien", () => {
    const [a, b, c] = articles;
    expect([a.montantRegle, a.regleCaisse, a.regleBanque, a.depense, a.retourne, a.solde]).toEqual([100_000, 100_000, 0, 70_000, 30_000, 0]);
    expect([b.montantRegle, b.regleCaisse, b.regleBanque, b.depense, b.retourne, b.solde]).toEqual([100_000, 0, 100_000, 85_000, 15_000, 0]);
    expect([c.montantDemande, c.montantValide, c.montantRegle, c.solde]).toEqual([100_000, 0, 0, 0]);
    expect(demande.montantRegle).toBe(200_000);
    expect(demande.regleCaisse).toBe(100_000);
    expect(demande.regleBanque).toBe(100_000);
    expect(demande.nbArticles).toBe(3);
  });

  it("le total général = la ligne DEMANDE, jamais recompté par les articles ni les événements", () => {
    const parDevise = totauxParDevise(lignes);
    expect(parDevise).toHaveLength(1);
    expect(parDevise[0].devise).toBe("XOF");
    const t = parDevise[0].totaux;
    for (const cle of COLONNES_TOTAUX) expect(t[cle]).toBe((demande[cle] as number) ?? 0);
    expect(t.montantRegle).toBe(200_000);
  });

  it("deux demandes : le total est la somme des deux lignes DEMANDE", () => {
    const autre = construireArbreDemande(demandeTrois({ reference: "DEM-2026-000002" }));
    const [{ totaux: t }] = totauxParDevise(aplatirArbres([arbre, autre]));
    expect(t.montantRegle).toBe(400_000);
    expect(t.solde).toBe(0);
  });

  it("un règlement Banque est compté comme fonds remis mais jamais en caisse", () => {
    const b = articles[1];
    expect(b.montantRegle).toBe(100_000);
    expect(b.regleCaisse).toBe(0);
    const reglB = lignes.find((l) => l.type === "REGLEMENT" && l.article === "Article B")!;
    expect(reglB.mode).toBe("Banque");
  });

  it("un règlement annulé ou en brouillon ne compte pas dans le réglé", () => {
    const src = demandeTrois();
    src.reglements.push(reglement("RX", "A", "CAISSE", 50_000, { estAnnule: true, motifAnnulation: "erreur" }));
    src.reglements.push(reglement("RY", "A", "CAISSE", 40_000, { estConfirme: false, confirmeLe: null }));
    const l = aplatirArbres([construireArbreDemande(src)]);
    expect(l[0].montantRegle).toBe(200_000);
    expect(l[0].regleCaisse).toBe(100_000);
    const annule = l.find((x) => x.type === "REGLEMENT" && x.statut === "Annulé")!;
    expect(annule.motif).toContain("erreur");
    expect(annule.montantOperation).toBe(50_000);
    expect(l.find((x) => x.type === "REGLEMENT" && x.statut === "Brouillon")).toBeDefined();
  });
});

describe("reportingArbre — cas particuliers", () => {
  it("retour nul constaté : historique seulement, statut dédié et montant 0", () => {
    const src = demandeTrois();
    src.reglements[0].retours = [retour({ estReceptionne: true, montantARetourner: 0, receptionneLe: d("2026-10-07"), receptionnePar: "Assistant Test", depenses: [{ libelle: "Tout dépensé", montant: 100_000, justification: "FACTURE", motifNonJustifie: null, date: d("2026-10-05") }] })];
    const l = aplatirArbres([construireArbreDemande(src)]);
    const nul = l.find((x) => x.type === "RETOUR_CAISSE" && x.article === "Article A")!;
    expect(nul.statut).toBe("Retour nul constaté");
    expect(nul.montantOperation).toBe(0);
    const a = l.find((x) => x.type === "ARTICLE" && x.article === "Article A")!;
    expect(a.retourne).toBe(0);
    expect(a.solde).toBe(0);
  });

  it("demande en cours : statut « En cours (x/n traités) » et article à décider", () => {
    const src = demandeTrois();
    src.articles[2] = article("C", "Article C", { statut: "EN_ATTENTE", decideLe: null, decidePar: null, decideurFinance: null });
    const l = aplatirArbres([construireArbreDemande(src)]);
    expect(l[0].statut).toBe("En cours (2/3 traités)");
    expect(l.find((x) => x.type === "ARTICLE" && x.article === "Article C")!.statut).toBe("À décider (Finance)");
  });

  it("clôture forcée : mention, motif et solde restant sur la demande et sur l'article non régularisé", () => {
    const src = demandeTrois({
      statutLibelle: "Clôturée",
      clotureForcee: {
        motif: "collaborateur parti, dossier ancien",
        par: "Finance Test",
        le: d("2026-10-12"),
        articles: [{ ligneId: "B", libelle: "Article B", beneficiaire: "Awa Koné", montantValide: 100_000, resteARegler: 0, solde: 20_000, manques: ["solde à régulariser"] }],
      },
    });
    // Le retour externe est retiré : l'article B garde alors un solde de 15 000.
    src.retoursExternes = [];
    const l = aplatirArbres([construireArbreDemande(src)]);
    expect(l[0].cloture).toContain("Clôturée de force");
    expect(l[0].cloture).toContain("collaborateur parti, dossier ancien");
    expect(l[0].cloture).toContain("Article B");
    const b = l.find((x) => x.type === "ARTICLE" && x.article === "Article B")!;
    expect(b.cloture).toContain("Clôturé sans régularisation");
    expect(b.cloture).toContain("15 000");
    expect(l.find((x) => x.type === "ARTICLE" && x.article === "Article A")!.cloture).toBe("");
  });

  it("article jamais réglé d'une clôture forcée : « reste à régler », pas « solde restant 0 »", () => {
    const src = demandeTrois({
      clotureForcee: { motif: "abandon du fournisseur", par: "Finance Test", le: d("2026-10-12"), articles: [{ ligneId: "B", libelle: "Article B", beneficiaire: "Awa Koné", montantValide: 100_000, resteARegler: 100_000, solde: 0, manques: ["reste à régler"] }] },
    });
    src.reglements = src.reglements.filter((r) => r.id !== "RB");
    src.mouvementsBanque = [];
    src.retoursExternes = [];
    const l = aplatirArbres([construireArbreDemande(src)]);
    const b = l.find((x) => x.type === "ARTICLE" && x.article === "Article B")!;
    expect(b.cloture).toContain("reste à régler 100 000 FCFA");
    expect(b.cloture).not.toContain("solde restant 0");
  });

  it("devise non XOF : reportée telle quelle sur toutes les lignes", () => {
    const l = aplatirArbres([construireArbreDemande(demandeTrois({ devise: "EUR" }))]);
    expect(new Set(l.map((x) => x.devise))).toEqual(new Set(["EUR"]));
  });

  it("dépense directe (sans article) : une ligne « Dépense directe » qui porte règlements et retours", () => {
    const src: DemandeArbreSource = {
      ...demandeTrois(),
      reference: "DEM-2026-000009",
      typeDemande: "DEPENSE_DIRECTE",
      description: "Prime de stage",
      categorie: "Primes",
      objet: "Stage",
      articles: [],
      montantDemande: 50_000,
      montantValide: 50_000,
      reglements: [reglement("RD", null, "CAISSE", 50_000, { retours: [retour({ estReceptionne: true, montantARetourner: 10_000, receptionneLe: d("2026-10-07"), depenses: [{ libelle: "Prime", montant: 40_000, justification: "FACTURE", motifNonJustifie: null, date: d("2026-10-05") }] })] })],
      mouvementsBanque: [],
      retoursExternes: [],
    };
    const arbre = construireArbreDemande(src);
    const l = aplatirArbres([arbre]);
    expect(arbre.articles).toHaveLength(1);
    expect(arbre.articles[0].article.article).toBe("Dépense directe");
    expect(l[0].nbArticles).toBe(0);
    expect(l[0].montantRegle).toBe(50_000);
    expect(arbre.articles[0].article.montantRegle).toBe(50_000);
    expect(arbre.articles[0].article.solde).toBe(0);
    expect(l[0].solde).toBe(0);
    expect(parType(l, "REGLEMENT")[0].article).toBe("Dépense directe");
  });

  it("règlement ancien non rattaché sur une demande à articles : ligne « Non rattaché à un article », totaux de la demande intacts", () => {
    const src = demandeTrois();
    src.reglements.push(reglement("RZ", null, "CAISSE", 20_000));
    const arbre = construireArbreDemande(src);
    const nr = arbre.articles.find((a) => a.article.article === "Non rattaché à un article")!;
    expect(nr.article.montantRegle).toBe(20_000);
    expect(nr.evenements.map((e) => e.type)).toEqual(["REGLEMENT"]);
    const l = aplatirArbres([arbre]);
    expect(l[0].montantRegle).toBe(220_000);
    const somme = l.filter((x) => x.type === "ARTICLE").reduce((t, a) => t + (a.montantRegle ?? 0), 0);
    expect(somme).toBe(220_000);
  });

  it("retour externe sans demande : ligne de niveau 0, hors des totaux", () => {
    const ligne = ligneRetourExterneHorsDemande({ personne: "Client X", montant: 25_000, motif: "chèque rendu", creePar: "Finance Test", creeLe: d("2026-10-09"), estExterne: true, pieceRetourId: "pj-r", pieceChequeId: null });
    expect(ligne.niveau).toBe(0);
    expect(ligne.compte).toBe("Non");
    expect(ligne.article).toBe("Hors demande");
    expect(ligne.montantOperation).toBe(25_000);
    const [{ totaux: t }] = totauxParDevise([...aplatirArbres([construireArbreDemande(demandeTrois())]), ligne]);
    expect(t.montantRegle).toBe(200_000);
    expect(ligne.lienJustificatifRetour).toBe("/api/treso/pieces-jointes/pj-r");
    expect(ligne.lienJustificatifCheque).toBe("");
  });

  it("retour exceptionnel validé : comptabilisé comme retour reçu de son article, ligne d'événement", () => {
    const src = demandeTrois();
    src.reglements[0].retours = [retour({ estReceptionne: true, montantARetourner: 0, receptionneLe: d("2026-10-07"), depenses: [{ libelle: "Ramettes", montant: 100_000, justification: "FACTURE", motifNonJustifie: null, date: d("2026-10-05") }] })];
    src.retoursExceptionnels = [{ ligneDemandeId: "A", montant: 5_000, statut: "VALIDE", saisiPar: "Assistant Test", saisiLe: d("2026-10-10"), validePar: "Finance Test", valideLe: d("2026-10-11"), motifRejet: null }];
    const l = aplatirArbres([construireArbreDemande(src)]);
    const a = l.find((x) => x.type === "ARTICLE" && x.article === "Article A")!;
    expect(a.retourne).toBe(5_000);
    expect(a.solde).toBe(-5_000);
    expect(l.find((x) => x.type === "RETOUR_EXCEPTIONNEL")!.statut).toBe("Validé");
  });

  it("remboursement validé : ligne d'événement sous l'article, déduit des retours reçus", () => {
    const src = demandeTrois();
    src.reglements[0].retours[0].remboursements = [{ montant: 5_000, statut: "VALIDE", proposePar: "Assistant Test", proposeLe: d("2026-10-09"), validePar: "Finance Test", valideLe: d("2026-10-10"), motifRejet: null }];
    const l = aplatirArbres([construireArbreDemande(src)]);
    expect(l.find((x) => x.type === "REMBOURSEMENT")!.article).toBe("Article A");
    expect(l.find((x) => x.type === "ARTICLE" && x.article === "Article A")!.retourne).toBe(25_000);
  });
});

describe("reportingArbre — totaux par devise (lot F bis)", () => {
  const xof = aplatirArbres([construireArbreDemande(demandeTrois())]);
  const eur = aplatirArbres([construireArbreDemande(demandeTrois({ reference: "DEM-2026-000002", devise: "EUR" }))]);

  it("une seule devise : un seul total", () => {
    expect(totauxParDevise(xof).map((x) => x.devise)).toEqual(["XOF"]);
  });

  it("deux devises : un total par devise, jamais additionnées", () => {
    const res = totauxParDevise([...xof, ...eur]);
    expect(res.map((x) => x.devise)).toEqual(["EUR", "XOF"]);
    for (const r of res) {
      expect(r.totaux.montantRegle).toBe(200_000);
      expect(r.totaux.montantDemande).toBe(300_000);
      expect(r.totaux.nbArticles).toBe(3);
    }
  });

  it("les montants d'une devise ne contaminent jamais l'autre", () => {
    const petit = demandeTrois({ reference: "DEM-2026-000003", devise: "EUR" });
    petit.reglements = [];
    petit.mouvementsBanque = [];
    petit.retoursExternes = [];
    const res = totauxParDevise([...xof, ...aplatirArbres([construireArbreDemande(petit)])]);
    const parDev = Object.fromEntries(res.map((r) => [r.devise, r.totaux]));
    expect(parDev.XOF.montantRegle).toBe(200_000);
    expect(parDev.EUR.montantRegle).toBe(0);
    expect(parDev.EUR.montantDemande).toBe(300_000);
  });

  it("un retour externe hors demande (sans devise) n'entre dans aucun total", () => {
    const ligne = ligneRetourExterneHorsDemande({ personne: "X", montant: 5_000, motif: "m", creePar: "F", creeLe: d("2026-10-09"), estExterne: true, pieceRetourId: null, pieceChequeId: null });
    expect(totauxParDevise([...xof, ligne])).toHaveLength(1);
  });
});

describe("reportingArbre — justificatifs et libellé d'origine (lot F bis)", () => {
  const lignes = aplatirArbres([construireArbreDemande(demandeTrois())]);

  it("retour externe rattaché : liens vers la route de téléchargement existante, retour et chèque", () => {
    const x = lignes.find((l) => l.type === "RETOUR_EXTERNE")!;
    expect(x.lienJustificatifRetour).toBe("/api/treso/pieces-jointes/pj-retour");
    expect(x.lienJustificatifCheque).toBe("/api/treso/pieces-jointes/pj-cheque");
  });

  it("sans droit de téléchargement (identifiants non fournis) : aucun lien", () => {
    const src = demandeTrois();
    src.retoursExternes = src.retoursExternes.map((x) => ({ ...x, pieceRetourId: null, pieceChequeId: null }));
    const x = aplatirArbres([construireArbreDemande(src)]).find((l) => l.type === "RETOUR_EXTERNE")!;
    expect(x.lienJustificatifRetour).toBe("");
    expect(x.lienJustificatifCheque).toBe("");
  });

  it("aucune autre ligne ne porte de lien", () => {
    expect(lignes.filter((l) => l.type !== "RETOUR_EXTERNE").every((l) => l.lienJustificatifRetour === "" && l.lienJustificatifCheque === "")).toBe(true);
  });

  it("libellé d'origine du demandeur : sur les seules lignes ARTICLE", () => {
    const a = lignes.find((l) => l.type === "ARTICLE" && l.article === "Article A")!;
    expect(a.libelleOrigine).toBe("Article A (version du demandeur)");
    expect(lignes.filter((l) => l.type !== "ARTICLE").every((l) => l.libelleOrigine === "")).toBe(true);
  });

  it("les colonnes existent, de genre lien / texte", () => {
    const col = (cle: string) => COLONNES_ARBRE.find((c) => c.cle === cle);
    expect(col("lienJustificatifRetour")?.genre).toBe("lien");
    expect(col("lienJustificatifCheque")?.genre).toBe("lien");
    expect(col("libelleOrigine")?.genre).toBe("texte");
  });
});

describe("motif / nature du règlement (lot I)", () => {
  it("colonne dédiée : le motif sur les lignes RÈGLEMENT, « Non renseigné » pour un ancien règlement, vide ailleurs", () => {
    const src = demandeTrois();
    src.reglements.push(reglement("RM", "A", "CAISSE", 10_000, { motif: "Achat de fournitures" }));
    const l = aplatirArbres([construireArbreDemande(src)]);
    expect(COLONNES_ARBRE.some((c) => c.cle === "motifReglement" && c.titre === "Motif / nature du règlement")).toBe(true);
    const avecMotif = l.find((x) => x.type === "REGLEMENT" && x.montantOperation === 10_000)!;
    expect(avecMotif.motifReglement).toBe("Achat de fournitures");
    const anciens = l.filter((x) => x.type === "REGLEMENT" && x.montantOperation !== 10_000);
    expect(anciens.length).toBeGreaterThan(0);
    for (const a of anciens) expect(a.motifReglement).toBe("Non renseigné");
    for (const x of l.filter((y) => y.type !== "REGLEMENT")) expect(x.motifReglement).toBe("");
  });
});


describe("reportingArbre — signatures (lots L et L bis : lien par identifiant)", () => {
  const mise = d("2026-09-30");
  const sig = (
    id: string,
    action: string,
    signataire: string,
    quand: Date,
    extra: Partial<{ auNomDe: string | null; signatureId: string; entiteId: string | null }> = {}
  ) => ({
    id,
    action,
    creeAt: quand,
    signataire,
    auNomDe: null,
    signatureId: "sig-1",
    entiteId: null,
    ...extra,
  });
  const lien = (entity: string, entityId: string, action: string, actionSigneeId: string, quand: Date) => ({ entity, entityId, action, actionSigneeId, createdAt: quand });

  it("la ligne de règlement, de retour et la décision de l'article portent la signature de leur action, retrouvée par identifiant", () => {
    const arbre = construireArbreDemande(
      demandeTrois({
        miseEnServiceSignatures: mise,
        signatures: [
          sig("as-1", "confirmation_reglement", "Assistant Test", d("2026-10-04"), { signatureId: "sig-assistant", entiteId: "RA" }),
          sig("as-2", "reception_retour", "Assistant Test", d("2026-10-07"), { signatureId: "sig-assistant", entiteId: "RET-A" }),
          sig("as-3", "decision_lignes", "Finance Test", d("2026-10-02"), { signatureId: "sig-finance" }),
        ],
        liensSignature: [lien("LigneDemande", "A", "validation_ligne", "as-3", d("2026-10-02"))],
      })
    );
    const lignes = aplatirArbres([arbre]);
    const regl = lignes.find((l) => l.type === "REGLEMENT" && l.mode === "Caisse")!;
    expect(regl.signePar).toBe("signé par Assistant Test");
    expect(regl.signatureId).toBe("sig-assistant");
    expect(regl.signeLe).not.toBe("");
    expect(lignes.find((l) => l.type === "RETOUR_CAISSE")!.signatureId).toBe("sig-assistant");
    const articleA = lignes.find((l) => l.type === "ARTICLE" && l.article === "Article A")!;
    expect(articleA.signePar).toBe("signé par Finance Test");
    expect(articleA.signatureId).toBe("sig-finance");
  });

  it("deux actions du MÊME compte à quelques secondes d'écart, deux versions de signature : chaque événement garde la sienne", () => {
    const t = d("2026-10-04");
    const arbre = construireArbreDemande(
      demandeTrois({
        miseEnServiceSignatures: mise,
        // Deux articles décidés par le même compte à 2 secondes d'intervalle, avec deux versions de signature différentes.
        signatures: [
          sig("as-A", "decision_lignes", "Finance Test", new Date(t.getTime()), { signatureId: "sig-v1" }),
          sig("as-B", "decision_lignes", "Finance Test", new Date(t.getTime() + 2000), { signatureId: "sig-v2" }),
        ],
        liensSignature: [lien("LigneDemande", "A", "validation_ligne", "as-A", t), lien("LigneDemande", "B", "validation_ligne", "as-B", new Date(t.getTime() + 2000))],
      })
    );
    const lignes = aplatirArbres([arbre]);
    expect(lignes.find((l) => l.type === "ARTICLE" && l.article === "Article A")!.signatureId).toBe("sig-v1");
    expect(lignes.find((l) => l.type === "ARTICLE" && l.article === "Article B")!.signatureId).toBe("sig-v2");
  });

  it("une action par délégation dit « au nom de »", () => {
    const arbre = construireArbreDemande(
      demandeTrois({
        miseEnServiceSignatures: mise,
        signatures: [sig("as-1", "confirmation_reglement", "Assistant Test", d("2026-10-04"), { auNomDe: "Moussa Traoré", entiteId: "RA" })],
      })
    );
    const regl = aplatirArbres([arbre]).find((l) => l.type === "REGLEMENT" && l.mode === "Caisse")!;
    expect(regl.signePar).toBe("signé par Assistant Test, au nom de Moussa Traoré");
    expect(regl.signeAuNomDe).toBe("Moussa Traoré");
  });

  it("une action d'avant la mise en service est « Antérieur à la signature », sans image", () => {
    const arbre = construireArbreDemande(demandeTrois({ miseEnServiceSignatures: d("2026-11-01"), signatures: [] }));
    const regl = aplatirArbres([arbre]).find((l) => l.type === "REGLEMENT" && l.mode === "Caisse")!;
    expect(regl.signePar).toBe("Antérieur à la signature");
    expect(regl.signatureId).toBe("");
  });

  it("après la mise en service sans lien : « Signature non rattachée » (sans image) ; sans repère de mise en service : aucune colonne remplie", () => {
    const apres = aplatirArbres([construireArbreDemande(demandeTrois({ miseEnServiceSignatures: mise, signatures: [] }))]);
    expect(apres.every((l) => l.signatureId === "")).toBe(true);
    expect(apres.find((l) => l.type === "REGLEMENT")!.signePar).toBe("Signature non rattachée");
    const sansRepere = aplatirArbres([construireArbreDemande(demandeTrois())]);
    expect(sansRepere.every((l) => l.signePar === "")).toBe(true);
  });

  it("la signature d'un autre règlement, d'une autre action ou d'un autre compte n'est jamais prise : seul l'identifiant compte", () => {
    const arbre = construireArbreDemande(
      demandeTrois({
        miseEnServiceSignatures: mise,
        signatures: [
          sig("as-1", "confirmation_reglement", "Finance Test", d("2026-10-04"), { entiteId: "AUTRE-REGLEMENT" }),
          sig("as-2", "annulation_reglement", "Assistant Test", d("2026-10-04"), { entiteId: "RA" }),
        ],
      })
    );
    const regl = aplatirArbres([arbre]).find((l) => l.type === "REGLEMENT" && l.mode === "Caisse")!;
    expect(regl.signePar).toBe("Signature non rattachée");
    expect(regl.signatureId).toBe("");
  });

  it("les colonnes « Signé par », « Signé le », « Au nom de » et « Signature » existent, dans cet ordre, après l'auteur", () => {
    const cles = COLONNES_ARBRE.map((c) => c.cle);
    const i = cles.indexOf("auteur");
    expect(cles.slice(i + 1, i + 5)).toEqual(["signePar", "signeLe", "signeAuNomDe", "signatureId"]);
    expect(COLONNES_ARBRE.find((c) => c.cle === "signatureId")!.genre).toBe("image");
  });
});
