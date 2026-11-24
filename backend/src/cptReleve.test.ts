import { describe, expect, it } from "vitest";

import { CptImportLectureError } from "./cptImportLecture";
import { validerDefinitionFormat } from "./cptFormatImport";
import {
  CHAMPS_RELEVE_CPT,
  TYPES_RELEVE_CPT,
  controlerLigneReleve,
  controlerLotReleve,
  estTypeReleveCpt,
  formatReleveProposeCpt,
  ligneReleveDepuisValeurs,
  ligneReleveImportable,
  lireReleveCpt,
  moisCouvertsReleve,
  moisPrincipalReleve,
  normaliserTelephoneReleve,
  totauxReleve,
  verifierFormatReleveCpt,
  type LigneReleve,
} from "./cptReleve";

const c = (n: number) => BigInt(n) * BigInt(100);
const CTX = { aujourdhui: "2026-03-31" };

function ligne(partiel: Partial<LigneReleve> = {}): LigneReleve {
  return {
    numeroLigne: 2,
    reference: "T_ABC1234567",
    dateValeur: "2026-03-02",
    montant: c(100000),
    frais: null,
    net: null,
    typeSource: null,
    payeur: null,
    telephone: null,
    referenceClient: null,
    libelle: null,
    sessionPaiement: null,
    ...partiel,
  };
}

describe("formats proposés", () => {
  it.each([...TYPES_RELEVE_CPT])("%s : format valide et utilisable", (type) => {
    const format = formatReleveProposeCpt(type);
    expect(validerDefinitionFormat(format).ok).toBe(true);
    expect(verifierFormatReleveCpt(format)).toEqual([]);
  });

  it("les champs d'un format proposé existent tous parmi les champs d'un relevé, avec le bon type", () => {
    for (const type of TYPES_RELEVE_CPT) {
      for (const colonne of formatReleveProposeCpt(type).colonnes) {
        const attendu = CHAMPS_RELEVE_CPT.find((d) => d.champ === colonne.champ);
        expect(attendu, `${type} : ${colonne.champ}`).toBeDefined();
        expect(colonne.type).toBe(attendu!.type);
      }
    }
  });

  it("reconnaît les types de relevé et refuse les autres", () => {
    expect(estTypeReleveCpt("RELEVE_BANQUE")).toBe(true);
    expect(estTypeReleveCpt("PRODUCTION")).toBe(false);
  });
});

describe("verifierFormatReleveCpt", () => {
  const base = formatReleveProposeCpt("RELEVE_WAVE_BUSINESS");

  it("signale ensemble la référence, la date et le montant manquants", () => {
    const erreurs = verifierFormatReleveCpt({ ligneEntete: 1, colonnes: [{ entete: "Libellé", champ: "libelle", type: "texte", obligatoire: false }] });
    expect(erreurs).toHaveLength(3);
  });

  it("accepte crédit et débit à la place d'un montant signé", () => {
    expect(verifierFormatReleveCpt(formatReleveProposeCpt("RELEVE_BANQUE"))).toEqual([]);
  });

  it("accepte un crédit seul (relevé qui ne liste que des entrées)", () => {
    const f = { ligneEntete: 1, colonnes: base.colonnes.filter((x) => !["montant", "frais", "net"].includes(x.champ)).concat([{ entete: "Crédit", champ: "credit", type: "montant" as const, obligatoire: false }]) };
    expect(verifierFormatReleveCpt(f)).toEqual([]);
  });

  it("refuse un champ inconnu et un type incohérent", () => {
    const erreurs = verifierFormatReleveCpt({
      ligneEntete: 1,
      colonnes: [
        ...base.colonnes.filter((x) => x.champ !== "telephone"),
        { entete: "Divers", champ: "divers", type: "texte", obligatoire: false },
        { entete: "Heure", champ: "telephone", type: "montant", obligatoire: false },
      ],
    });
    expect(erreurs.some((e) => e.includes("divers"))).toBe(true);
    expect(erreurs.some((e) => e.includes("telephone"))).toBe(true);
  });
});

describe("ligneReleveDepuisValeurs", () => {
  it("lit un montant signé, des frais positifs, une référence normalisée", () => {
    const l = ligneReleveDepuisValeurs(5, { reference: " t_abc 1234567 ", dateValeur: "2026-03-02", montant: "-2000.00", frais: "-40", net: "-2040" });
    expect(l.numeroLigne).toBe(5);
    expect(l.reference).toBe("T_ABC1234567");
    expect(l.montant).toBe(-c(2000));
    expect(l.frais).toBe(c(40));
    expect(l.net).toBe(-c(2040));
  });

  it("calcule crédit − débit quand il n'y a pas de colonne signée", () => {
    expect(ligneReleveDepuisValeurs(2, { credit: "150000", debit: null }).montant).toBe(c(150000));
    expect(ligneReleveDepuisValeurs(2, { credit: null, debit: "5000" }).montant).toBe(-c(5000));
    expect(ligneReleveDepuisValeurs(2, { credit: "", debit: "5000" }).montant).toBe(-c(5000));
  });

  it("un débit écrit en négatif donne le même montant qu'un débit écrit en positif", () => {
    expect(ligneReleveDepuisValeurs(2, { debit: "-5000" }).montant).toBe(-c(5000));
  });

  it("le montant signé l'emporte sur crédit et débit", () => {
    expect(ligneReleveDepuisValeurs(2, { montant: "100", credit: "999", debit: "1" }).montant).toBe(c(100));
  });

  it("montant absent ou illisible = null ; texte vide = null", () => {
    const l = ligneReleveDepuisValeurs(2, { montant: null, libelle: "   ", payeur: "  Awa   Kone " });
    expect(l.montant).toBeNull();
    expect(l.libelle).toBeNull();
    expect(l.payeur).toBe("Awa Kone");
    expect(ligneReleveDepuisValeurs(2, { montant: "abc" }).montant).toBeNull();
  });

  it("normalise le téléphone : chiffres seulement, « + » de tête conservé", () => {
    expect(normaliserTelephoneReleve("+225 07 00 00 00 01")).toBe("+2250700000001");
    expect(normaliserTelephoneReleve("07.00.00.00.01")).toBe("0700000001");
    expect(normaliserTelephoneReleve("  ")).toBeNull();
    expect(normaliserTelephoneReleve("n/a")).toBeNull();
    expect(normaliserTelephoneReleve(null)).toBeNull();
  });
});

describe("controlerLigneReleve", () => {
  it("une ligne complète n'a aucun signalement", () => {
    expect(controlerLigneReleve(ligne(), CTX)).toEqual([]);
  });

  it("bloque sans référence, sans date, sans montant", () => {
    const s = controlerLigneReleve(ligne({ reference: null, dateValeur: null, montant: null }), CTX);
    expect(s.map((x) => x.code).sort()).toEqual(["DATE_MANQUANTE", "MONTANT_MANQUANT", "REFERENCE_MANQUANTE"]);
    expect(s.every((x) => x.gravite === "BLOQUANT")).toBe(true);
    expect(ligneReleveImportable(s)).toBe(false);
  });

  it("un montant nul est une alerte, la ligne reste importable", () => {
    const s = controlerLigneReleve(ligne({ montant: BigInt(0) }), CTX);
    expect(s.map((x) => x.code)).toEqual(["MONTANT_NUL"]);
    expect(ligneReleveImportable(s)).toBe(true);
  });

  it("alerte quand les frais dépassent le montant", () => {
    const s = controlerLigneReleve(ligne({ montant: c(100), frais: c(150) }), CTX);
    expect(s.map((x) => x.code)).toContain("FRAIS_SUPERIEURS_AU_MONTANT");
  });

  it("contrôle le net d'un crédit : brut − frais, tolérance de 1 FCFA", () => {
    expect(controlerLigneReleve(ligne({ montant: c(100000), frais: c(1000), net: c(99000) }), CTX)).toEqual([]);
    expect(controlerLigneReleve(ligne({ montant: c(100000), frais: c(1000), net: c(99000) + BigInt(100) }), CTX)).toEqual([]);
    const s = controlerLigneReleve(ligne({ montant: c(100000), frais: c(1000), net: c(98000) }), CTX);
    expect(s.map((x) => x.code)).toEqual(["NET_INCOHERENT"]);
  });

  it("sans frais, le net attendu est le brut", () => {
    expect(controlerLigneReleve(ligne({ montant: c(5000), net: c(4000) }), CTX).map((x) => x.code)).toEqual(["NET_INCOHERENT"]);
  });

  it("ne contrôle pas le net d'un débit", () => {
    expect(controlerLigneReleve(ligne({ montant: -c(2000), frais: c(40), net: -c(9999) }), CTX)).toEqual([]);
  });

  it("alerte pour une date dans le futur (le jour même est accepté)", () => {
    expect(controlerLigneReleve(ligne({ dateValeur: "2026-03-31" }), CTX)).toEqual([]);
    expect(controlerLigneReleve(ligne({ dateValeur: "2026-04-01" }), CTX).map((x) => x.code)).toEqual(["DATE_FUTURE"]);
  });

  it("alerte pour une date hors du mois du relevé", () => {
    const ctx = { ...CTX, periode: "2026-03-01" };
    expect(controlerLigneReleve(ligne({ dateValeur: "2026-03-31" }), ctx)).toEqual([]);
    expect(controlerLigneReleve(ligne({ dateValeur: "2026-02-28" }), ctx).map((x) => x.code)).toEqual(["HORS_PERIODE"]);
  });
});

describe("controlerLotReleve", () => {
  it("la première occurrence d'une référence reste importable, les suivantes sont bloquées", () => {
    const lignes = [ligne({ numeroLigne: 2 }), ligne({ numeroLigne: 3, montant: c(5) }), ligne({ numeroLigne: 4, reference: "T_AUTRE00001" }), ligne({ numeroLigne: 5 })];
    const r = controlerLotReleve(lignes, CTX);
    expect(r.parLigne.get(2)).toBeUndefined();
    expect(r.parLigne.get(3)?.[0].code).toBe("REFERENCE_EN_DOUBLE");
    expect(r.parLigne.get(3)?.[0].message).toContain("ligne 2");
    expect(r.parLigne.get(4)).toBeUndefined();
    expect(r.parLigne.get(5)?.[0].message).toContain("ligne 2");
    expect(r.nbBloquants).toBe(2);
    expect(ligneReleveImportable(r.parLigne.get(3))).toBe(false);
  });

  it("compte les bloquants et les alertes", () => {
    const r = controlerLotReleve([ligne({ numeroLigne: 2, montant: BigInt(0) }), ligne({ numeroLigne: 3, reference: null })], CTX);
    expect(r.nbAlertes).toBe(1);
    expect(r.nbBloquants).toBe(1);
    expect(r.nbInfos).toBe(0);
  });

  it("plusieurs lignes sans référence ne sont pas des doublons entre elles", () => {
    const r = controlerLotReleve([ligne({ numeroLigne: 2, reference: null }), ligne({ numeroLigne: 3, reference: null })], CTX);
    expect(r.parLigne.get(2)?.map((x) => x.code)).toEqual(["REFERENCE_MANQUANTE"]);
    expect(r.parLigne.get(3)?.map((x) => x.code)).toEqual(["REFERENCE_MANQUANTE"]);
  });
});

describe("mois couverts et totaux", () => {
  const lignes = [
    ligne({ numeroLigne: 2, dateValeur: "2026-03-30" }),
    ligne({ numeroLigne: 3, reference: "B", dateValeur: "2026-03-31" }),
    ligne({ numeroLigne: 4, reference: "C", dateValeur: "2026-04-01" }),
    ligne({ numeroLigne: 5, reference: "D", dateValeur: null }),
  ];

  it("liste les mois du plus ancien au plus récent avec leur nombre de lignes", () => {
    expect(moisCouvertsReleve(lignes)).toEqual([
      { mois: "2026-03-01", nbLignes: 2 },
      { mois: "2026-04-01", nbLignes: 1 },
    ]);
  });

  it("le mois principal est le plus chargé, à égalité le plus ancien", () => {
    expect(moisPrincipalReleve(lignes)).toBe("2026-03-01");
    expect(moisPrincipalReleve([ligne({ dateValeur: "2026-05-02" }), ligne({ reference: "Z", dateValeur: "2026-04-02" })])).toBe("2026-04-01");
    expect(moisPrincipalReleve([ligne({ dateValeur: null })])).toBeNull();
    expect(moisPrincipalReleve([])).toBeNull();
  });

  it("totalise crédits, débits et frais", () => {
    const t = totauxReleve([
      ligne({ montant: c(100000), frais: c(1000) }),
      ligne({ reference: "B", montant: c(50000), frais: c(500) }),
      ligne({ reference: "C", montant: -c(2000) }),
      ligne({ reference: "D", montant: null }),
    ]);
    expect(t).toEqual({ nbLignes: 4, totalCredits: c(150000), totalDebits: c(2000), totalFrais: c(1500) });
  });
});

describe("lireReleveCpt", () => {
  const entete = "Horodatage,Identifiant de transaction,Type de transaction,Montant brut,Frais,Montant net,Contrepartie,Téléphone,Identifiant de session,Référence client";
  const wave = (...lignes: string[]) => Buffer.from([entete, ...lignes].join("\n"), "utf8");

  it("lit un relevé Wave Business synthétique (crédit, remboursement, transaction test)", () => {
    const contenu = wave(
      "2026-03-02 10:15:00,T_AAAAAAAAAA1,merchant_payment,100000,1000,99000,Awa Kone,+225 07 00 00 00 01,cos-1a2b3c,POL-1",
      "2026-03-03 11:00:00,T_AAAAAAAAAA2,refund,-2000,0,-2000,Yao Brou,,,",
      "2026-03-04 12:00:00,T_AAAAAAAAAA3,api_checkout,100,2,98,TEST,,cos-9z,"
    );
    const r = lireReleveCpt(contenu, formatReleveProposeCpt("RELEVE_WAVE_BUSINESS"));
    expect(r.lignes).toHaveLength(3);
    expect(r.lecture.nbAnomalies).toBe(0);
    const [a, b, t] = r.lignes;
    expect(a).toMatchObject({
      numeroLigne: 2,
      reference: "T_AAAAAAAAAA1",
      dateValeur: "2026-03-02",
      montant: c(100000),
      frais: c(1000),
      net: c(99000),
      typeSource: "merchant_payment",
      payeur: "Awa Kone",
      telephone: "+2250700000001",
      sessionPaiement: "COS-1A2B3C".toLowerCase(),
      referenceClient: "POL-1",
    });
    expect(b.montant).toBe(-c(2000));
    expect(b.typeSource).toBe("refund");
    expect(t.payeur).toBe("TEST");
    expect(controlerLotReleve(r.lignes, CTX).nbBloquants).toBe(0);
    expect(moisPrincipalReleve(r.lignes)).toBe("2026-03-01");
    expect(totauxReleve(r.lignes)).toMatchObject({ totalCredits: c(100100), totalDebits: c(2000), totalFrais: c(1002) });
  });

  it("lit un relevé bancaire à colonnes débit et crédit", () => {
    const csv = ["Date de valeur,Référence,Libellé,Débit,Crédit", "2026-03-05,VIR-0001,VIREMENT RECU,,300000", "2026-03-06,PRL-0002,PRELEVEMENT FRAIS,1500,"].join("\n");
    const r = lireReleveCpt(Buffer.from(csv, "utf8"), formatReleveProposeCpt("RELEVE_BANQUE"));
    expect(r.lignes.map((l) => l.montant)).toEqual([c(300000), -c(1500)]);
    expect(r.lignes[0].libelle).toBe("VIREMENT RECU");
  });

  it("signale une cellule illisible sans arrêter la lecture, et le contrôle bloque la ligne", () => {
    const r = lireReleveCpt(wave("2026-03-02 10:15:00,T_AAAAAAAAAA1,merchant_payment,beaucoup,,,,,,", "2026-03-03 10:00:00,T_AAAAAAAAAA2,merchant_payment,500,,,,,,"), formatReleveProposeCpt("RELEVE_WAVE_BUSINESS"));
    expect(r.lecture.nbAnomalies).toBeGreaterThan(0);
    expect(r.lignes[0].montant).toBeNull();
    const lot = controlerLotReleve(r.lignes, CTX);
    expect(ligneReleveImportable(lot.parLigne.get(2))).toBe(false);
    expect(ligneReleveImportable(lot.parLigne.get(3))).toBe(true);
  });

  it("refuse un format qui n'alimente ni la référence, ni la date, ni le montant", () => {
    expect(() => lireReleveCpt(wave("x"), { ligneEntete: 1, colonnes: [{ entete: "Libellé", champ: "libelle", type: "texte", obligatoire: false }] })).toThrow(CptImportLectureError);
  });

  it("arrête la lecture quand un en-tête obligatoire du format est absent du fichier", () => {
    const csv = ["Date,Montant", "2026-03-02,100"].join("\n");
    expect(() => lireReleveCpt(Buffer.from(csv, "utf8"), formatReleveProposeCpt("RELEVE_WAVE_BUSINESS"))).toThrow(/introuvable/);
  });

  it("une date écrite JJ/MM/AAAA se lit selon l'ordre déclaré par le format, jamais deviné", () => {
    const format = {
      ligneEntete: 1,
      colonnes: [
        { entete: "Date", champ: "dateValeur", type: "date" as const, obligatoire: true, formatDate: "JJ/MM/AAAA" as const },
        { entete: "Référence", champ: "reference", type: "texte" as const, obligatoire: true },
        { entete: "Montant", champ: "montant", type: "montant" as const, obligatoire: false },
      ],
    };
    const r = lireReleveCpt(Buffer.from(["Date,Référence,Montant", "03/04/2026,R1,1000"].join("\n"), "utf8"), format);
    expect(r.lignes[0].dateValeur).toBe("2026-04-03");
  });
});
