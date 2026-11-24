import { describe, expect, it } from "vitest";

import {
  CHAMPS_PRODUCTION_CPT,
  centimesSignes,
  comparerAvecImportPrecedent,
  controlerLigneProduction,
  controlerLotProduction,
  indexerProduitsProduction,
  ligneImportable,
  ligneProductionDepuisValeurs,
  modePaiementDepuisTexte,
  natureContratDepuisTexte,
  normaliserLibelleProduction,
  typeActeDepuisTexte,
  type ContexteControleProduction,
  type ContratConnuProduction,
  type LigneProduction,
} from "./cptProduction";

const contexte = (surcharge: Partial<ContexteControleProduction> = {}): ContexteControleProduction => ({
  produits: indexerProduitsProduction([
    { code: "RELAXMOTO", libelle: "Relax Moto", tarifReference: BigInt(250000) },
    { code: "SANTE-1", libelle: "Santé Famille", tarifReference: null },
  ]),
  partenaires: new Set([normaliserLibelleProduction("Courtier Alpha")]),
  referencesUtilisees: new Map(),
  aujourdhui: "2026-08-20",
  enSaisie: false,
  ...surcharge,
});

const valeurs = (v: Record<string, string | null> = {}): Record<string, string | null> => ({
  numPolice: "POL-1",
  produit: "RELAXMOTO",
  typeOperation: "Affaire nouvelle",
  dateEffet: "2026-08-01",
  dateEcheance: "2027-07-31",
  primeTtc: "2500.00",
  ...v,
});
const ligne = (v: Record<string, string | null> = {}, n = 2): LigneProduction => ligneProductionDepuisValeurs(n, valeurs(v));
const codes = (l: LigneProduction, c = contexte()) => controlerLigneProduction(l, c).map((s) => s.code);

describe("champs et normalisation", () => {
  it("cinq champs obligatoires seulement", () => {
    expect(CHAMPS_PRODUCTION_CPT.filter((c) => c.obligatoire).map((c) => c.champ)).toEqual(["numPolice", "produit", "dateEffet", "dateEcheance", "primeTtc"]);
  });

  it("libellés sans accent ni casse, valeurs reconnues", () => {
    expect(normaliserLibelleProduction("  Santé   FAMILLE ")).toBe("sante famille");
    expect(natureContratDepuisTexte("Groupe")).toBe("GROUPE");
    expect(natureContratDepuisTexte("individuelle")).toBe("INDIVIDUEL");
    expect(natureContratDepuisTexte("autre")).toBeNull();
    expect(typeActeDepuisTexte("Renouvellement")).toBe("RENOUVELLEMENT");
    expect(typeActeDepuisTexte("Avenant d'incorporation")).toBe("AVENANT_INCORPORATION");
    expect(typeActeDepuisTexte("Annulation")).toBe("ANNULATION");
    expect(typeActeDepuisTexte("n'importe quoi")).toBeNull();
    expect(modePaiementDepuisTexte("Wave CI")).toBe("WAVE");
    expect(modePaiementDepuisTexte("Chèque")).toBe("CHEQUE");
    expect(modePaiementDepuisTexte("Orange Money")).toBe("ORANGE_MONEY");
    expect(modePaiementDepuisTexte("troc")).toBe("AUTRE");
  });

  it("montants signés en centimes, illisible = null", () => {
    expect(centimesSignes("2500.00")).toBe(BigInt(250000));
    expect(centimesSignes("-1398.60")).toBe(BigInt(-139860));
    expect(centimesSignes("abc")).toBeNull();
    expect(centimesSignes(null)).toBeNull();
  });

  it("ligne typée : texte nettoyé, référence normalisée, type d'opération inconnu conservé", () => {
    const l = ligne({ referencePaiement: " t_abc 123456789 ", typeOperation: "Mystère", client: "  Aya   Koné " });
    expect(l).toMatchObject({ numPolice: "POL-1", referencePaiement: "T_ABC123456789", typeActe: null, typeOperationBrut: "Mystère", client: "Aya Koné", primeTtc: BigInt(250000) });
  });
});

describe("ligne correcte", () => {
  it("aucun signalement bloquant ni alerte", () => {
    expect(codes(ligne())).toEqual([]);
  });
});

describe("éléments obligatoires (bloquants)", () => {
  it("numéro de police, produit, dates et prime", () => {
    const s = controlerLigneProduction(ligne({ numPolice: null, produit: null, dateEffet: null, dateEcheance: null, primeTtc: null }), contexte());
    expect(s.filter((x) => x.gravite === "BLOQUANT").map((x) => x.code).sort()).toEqual(["DATE_MANQUANTE", "DATE_MANQUANTE", "NUM_POLICE_MANQUANT", "PRIME_MANQUANTE", "PRODUIT_MANQUANT"]);
    expect(ligneImportable(s)).toBe(false);
  });

  it("produit inconnu, date invalide, échéance avant l'effet", () => {
    expect(codes(ligne({ produit: "FANTOME" }))).toContain("PRODUIT_INCONNU");
    expect(codes(ligne({ dateEffet: "2026-02-30" }))).toContain("DATE_INVALIDE");
    expect(codes(ligne({ dateEcheance: "2026-07-31" }))).toContain("DATES_INCOHERENTES");
  });

  it("le produit se retrouve par son libellé, sans accent ni casse", () => {
    expect(codes(ligne({ produit: "santé famille" }))).not.toContain("PRODUIT_INCONNU");
  });
});

describe("alertes", () => {
  it("partenaire inconnu, avec le partenaire connu sans signalement", () => {
    expect(codes(ligne({ partenaire: "Inconnu SA" }))).toContain("PARTENAIRE_INCONNU");
    expect(codes(ligne({ partenaire: "COURTIER ALPHA" }))).not.toContain("PARTENAIRE_INCONNU");
  });

  it("montant différent du tarif du produit, jamais pour un produit sans tarif", () => {
    expect(codes(ligne({ primeTtc: "3000" }))).toContain("MONTANT_DIFFERENT_TARIF");
    expect(codes(ligne({ primeTtc: "2500" }))).not.toContain("MONTANT_DIFFERENT_TARIF");
    expect(codes(ligne({ produit: "SANTE-1", primeTtc: "3000" }))).not.toContain("MONTANT_DIFFERENT_TARIF");
  });

  it("prime offerte signalée (information)", () => {
    const s = controlerLigneProduction(ligne({ primeTtc: "0" }), contexte());
    expect(s.find((x) => x.code === "PRIME_OFFERTE")?.gravite).toBe("INFO");
    expect(ligneImportable(s)).toBe(true);
  });

  it("TTC différent de hors taxe + accessoires + taxe, dans la tolérance d'un FCFA ou au-delà", () => {
    expect(codes(ligne({ primeTtc: "2500", primeHt: "2000", accessoires: "300", taxe: "200" }))).not.toContain("MONTANTS_INCOHERENTS");
    expect(codes(ligne({ primeTtc: "2500", primeHt: "2000", accessoires: "300", taxe: "100" }))).toContain("MONTANTS_INCOHERENTS");
    expect(codes(ligne({ primeTtc: "2500", primeHt: "2000", accessoires: "300", taxe: "199.5" }))).not.toContain("MONTANTS_INCOHERENTS");
  });

  it("montant négatif accepté pour un retrait, signalé sinon", () => {
    expect(codes(ligne({ typeOperation: "Retrait", primeTtc: "-1000" }))).not.toContain("MONTANT_NEGATIF");
    expect(codes(ligne({ primeTtc: "-1000" }))).toContain("MONTANT_NEGATIF");
  });

  it("type d'opération inconnu ou absent", () => {
    expect(codes(ligne({ typeOperation: "Autre chose" }))).toContain("TYPE_OPERATION_INCONNU");
    expect(codes(ligne({ typeOperation: null }))).toContain("TYPE_OPERATION_MANQUANT");
  });

  it("montant payé supérieur à la prime, date de paiement future", () => {
    expect(codes(ligne({ montantPaye: "4500", referencePaiement: "T_ABCDEFGHIJ", modePaiement: "Wave" }))).toContain("MONTANT_PAYE_SUPERIEUR_PRIME");
    expect(codes(ligne({ datePaiement: "2026-09-01", referencePaiement: "X1" }))).toContain("DATE_PAIEMENT_FUTURE");
  });

  it("ligne datée dans un mois déjà clôturé", () => {
    expect(codes(ligne({ dateEffet: "2026-06-15", dateEcheance: "2027-06-14" }), contexte({ dernierMoisCloture: "2026-06-01" }))).toContain("SAISIE_APRES_CLOTURE");
    expect(codes(ligne({ dateEffet: "2026-07-01" }), contexte({ dernierMoisCloture: "2026-06-01" }))).not.toContain("SAISIE_APRES_CLOTURE");
  });
});

describe("paiement déclaré : référence et mode", () => {
  it("référence obligatoire pour un contrat déclaré payé : alerte à l'import, bloquant à la saisie", () => {
    const payee = ligne({ montantPaye: "2500" });
    expect(controlerLigneProduction(payee, contexte()).find((x) => x.code === "REFERENCE_MANQUANTE")?.gravite).toBe("ALERTE");
    expect(controlerLigneProduction(payee, contexte({ enSaisie: true })).find((x) => x.code === "REFERENCE_MANQUANTE")?.gravite).toBe("BLOQUANT");
    expect(codes(ligne())).not.toContain("REFERENCE_MANQUANTE");
  });

  it("T2 : référence Wave saisie comme chèque", () => {
    const l = ligne({ montantPaye: "2500", modePaiement: "Chèque", referencePaiement: "T_ABCDEFGHIJKL" });
    expect(controlerLigneProduction(l, contexte()).find((x) => x.code === "MODE_INCOHERENT_REFERENCE")?.gravite).toBe("ALERTE");
    expect(controlerLigneProduction(l, contexte({ enSaisie: true })).find((x) => x.code === "MODE_INCOHERENT_REFERENCE")?.gravite).toBe("BLOQUANT");
  });

  it("mode Wave avec une référence qui n'a pas la forme Wave, et PeyaPay saisi autrement", () => {
    expect(codes(ligne({ montantPaye: "2500", modePaiement: "Wave", referencePaiement: "12345" }))).toContain("REFERENCE_WAVE_NON_CONFORME");
    expect(codes(ligne({ montantPaye: "2500", modePaiement: "Wave", referencePaiement: "T_ABCDEFGHIJKL" }))).toEqual([]);
    expect(codes(ligne({ montantPaye: "2500", modePaiement: "Virement", referencePaiement: "API-PEYAPAY-998877" }))).toContain("MODE_INCOHERENT_REFERENCE");
  });

  it("T4 : référence déjà utilisée par un autre contrat (bloquant à la saisie), pas par le même contrat", () => {
    const utilisees = new Map([["T_ABCDEFGHIJKL", ["POL-9"]]]);
    const l = ligne({ montantPaye: "2500", modePaiement: "Wave", referencePaiement: "T_ABCDEFGHIJKL" });
    expect(controlerLigneProduction(l, contexte({ referencesUtilisees: utilisees, enSaisie: true })).find((x) => x.code === "REFERENCE_DEJA_UTILISEE")?.gravite).toBe("BLOQUANT");
    expect(codes(l, contexte({ referencesUtilisees: new Map([["T_ABCDEFGHIJKL", ["POL-1"]]]) }))).not.toContain("REFERENCE_DEJA_UTILISEE");
  });
});

describe("contrôles d'un fichier entier", () => {
  const paire = (idA: string | null, idB: string | null) => [
    ligne({ numPolice: "POL-1", montantPaye: "2500", modePaiement: "Wave", referencePaiement: "T_GROUPEGROUPE", paiementId: idA }, 2),
    ligne({ numPolice: "POL-2", montantPaye: "2500", modePaiement: "Wave", referencePaiement: "T_GROUPEGROUPE", paiementId: idB }, 3),
  ];

  it("même référence sur deux contrats sans paiement groupé déclaré : signalée sur les deux lignes", () => {
    const r = controlerLotProduction(paire(null, null), contexte());
    expect(r.parLigne.get(2)?.map((x) => x.code)).toContain("REFERENCE_DEJA_UTILISEE");
    expect(r.parLigne.get(3)?.map((x) => x.code)).toContain("REFERENCE_DEJA_UTILISEE");
    expect(r.nbAlertes).toBe(2);
  });

  it("paiement groupé déclaré (même PaiementID) : aucun signalement", () => {
    const r = controlerLotProduction(paire("PAY-1", "PAY-1"), contexte());
    expect(r.parLigne.size).toBe(0);
    expect(controlerLotProduction(paire("PAY-1", "PAY-2"), contexte()).nbAlertes).toBe(2);
  });

  it("même police, même opération, même date d'effet : ligne en double", () => {
    const r = controlerLotProduction([ligne({}, 2), ligne({}, 3), ligne({ typeOperation: "Renouvellement" }, 4)], contexte());
    expect(r.parLigne.get(3)?.map((x) => x.code)).toEqual(["LIGNE_EN_DOUBLE"]);
    expect(r.parLigne.has(4)).toBe(false);
  });

  it("décompte par gravité", () => {
    const r = controlerLotProduction([ligne({ numPolice: "POL-1", produit: "FANTOME" }, 2), ligne({ numPolice: "POL-2", primeTtc: "0" }, 3), ligne({ numPolice: "POL-3", partenaire: "Inconnu" }, 4)], contexte());
    expect({ b: r.nbBloquants, a: r.nbAlertes, i: r.nbInfos }).toEqual({ b: 1, a: 1, i: 1 });
  });
});

describe("comparaison avec l'import précédent", () => {
  const connu = (numPolice: string, surcharge: Partial<ContratConnuProduction> = {}): ContratConnuProduction => ({
    numPolice,
    produit: "RELAXMOTO",
    partenaire: null,
    client: "Aya Koné",
    dateEffet: "2026-08-01",
    dateEcheance: "2027-07-31",
    primeTtc: BigInt(250000),
    primeHt: null,
    accessoires: null,
    taxe: null,
    ...surcharge,
  });

  it("nouvelles, modifiées, inchangées et absentes du fichier", () => {
    const connus = new Map([["POL-1", connu("POL-1")], ["POL-2", connu("POL-2")], ["POL-3", connu("POL-3")]]);
    const lignes = [
      ligne({ numPolice: "POL-1", client: "AYA KONÉ" }, 2), // inchangée (casse et accents ignorés pour un texte)
      ligne({ numPolice: "POL-2", primeTtc: "3000" }, 3), // modifiée
      ligne({ numPolice: "POL-9" }, 4), // nouvelle
    ];
    const r = comparerAvecImportPrecedent(lignes, connus);
    expect(r.nouvelles).toEqual([{ numPolice: "POL-9", numeroLigne: 4 }]);
    expect(r.modifiees).toEqual([{ numPolice: "POL-2", numeroLigne: 3, champs: ["prime TTC"] }]);
    expect(r.inchangees).toBe(1);
    expect(r.absentes).toEqual(["POL-3"]);
  });

  it("une valeur absente du fichier n'est jamais une modification", () => {
    const r = comparerAvecImportPrecedent([ligne({ numPolice: "POL-1", client: null, partenaire: null }, 2)], new Map([["POL-1", connu("POL-1")]]));
    expect(r.modifiees).toEqual([]);
    expect(r.inchangees).toBe(1);
  });

  it("une police répétée dans le fichier n'est comparée qu'une fois", () => {
    const r = comparerAvecImportPrecedent([ligne({ numPolice: "POL-9" }, 2), ligne({ numPolice: "POL-9" }, 3)], new Map());
    expect(r.nouvelles).toHaveLength(1);
  });
});
