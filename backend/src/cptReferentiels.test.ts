import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  BASES_CONVENTION_CPT,
  BRANCHES_CPT,
  chronologieTauxTcaCpt,
  controlerChevauchementConventionCpt,
  controlerCoherenceTauxTca,
  controlerDoublonTauxTca,
  controlerNouvelleFinConventionCpt,
  type ConventionLigne,
  conventionEnVigueurCpt,
  conventionsEnChevauchementCpt,
  estDateIsoCpt,
  faitGenerateurSuggereCpt,
  FAITS_GENERATEURS_CPT,
  fractionVersPourcentCpt,
  lirePourcentageCpt,
  MODES_REGLEMENT_CPT,
  NATURES_CONTRAT_CPT,
  NATURES_REMUNERATION_CPT,
  normaliserTelephoneCpt,
  periodesSeRecouvrentCpt,
  TYPES_COMPTE_CPT,
  type TauxTcaLigne,
  tauxTcaEnVigueur,
  validerClientCpt,
  validerCompteCpt,
  validerConventionCpt,
  validerPartenaireCpt,
  validerProduitCpt,
  validerTauxTcaCpt,
} from "./cptReferentiels";

const erreursDe = (r: { ok: boolean; erreurs?: Record<string, string> }) => (r.ok ? {} : (r.erreurs as Record<string, string>));

describe("énumérations : synchronisées avec schema.prisma", () => {
  const schema = readFileSync(fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url)), "utf8");
  const valeursDe = (nom: string) => {
    const bloc = new RegExp(`enum ${nom} \\{([^}]*)\\}`).exec(schema)?.[1] ?? "";
    return [...bloc.matchAll(/^\s*([A-Z_]+)\s*$/gm)].map((m) => m[1]).sort();
  };
  it.each([
    ["CptBranche", BRANCHES_CPT],
    ["CptNatureContrat", NATURES_CONTRAT_CPT],
    ["CptTypeCompte", TYPES_COMPTE_CPT],
    ["CptNatureRemuneration", NATURES_REMUNERATION_CPT],
    ["CptBaseConvention", BASES_CONVENTION_CPT],
    ["CptFaitGenerateur", FAITS_GENERATEURS_CPT],
    ["CptModeReglement", MODES_REGLEMENT_CPT],
  ] as const)("%s", (nom, constantes) => {
    expect(valeursDe(nom)).toEqual([...constantes].sort());
  });
});

describe("pourcentages : fractions exactes, jamais de flottant", () => {
  it.each([
    ["7,25", "0.072500", "7,25"],
    ["7.25 %", "0.072500", "7,25"],
    ["12,5", "0.125000", "12,5"],
    ["1,5", "0.015000", "1,5"],
    ["4", "0.040000", "4"],
    ["0", "0.000000", "0"],
    ["100", "1.000000", "100"],
    ["7,2525", "0.072525", "7,2525"],
    [12.5, "0.125000", "12,5"],
    [0.1, "0.001000", "0,1"],
  ])("« %s » → %s", (saisie, fraction, pourcent) => {
    expect(lirePourcentageCpt(saisie)).toEqual({ ok: true, fraction, pourcent });
  });

  it.each(["", "abc", "100,1", "101", "7,12345", "-1", "7,2,5", "1e2", "   "])("« %s » n'est pas un pourcentage valide", (saisie) => {
    expect(lirePourcentageCpt(saisie).ok).toBe(false);
  });

  it("0,3 % reste exactement 0.003000 (aucun résidu de flottant)", () => {
    expect(lirePourcentageCpt("0,3")).toMatchObject({ ok: true, fraction: "0.003000" });
  });

  it("affiche une fraction stockée en pourcentage, quelle que soit sa longueur", () => {
    expect(fractionVersPourcentCpt("0.0725")).toBe("7,25");
    expect(fractionVersPourcentCpt("0.072500")).toBe("7,25");
    expect(fractionVersPourcentCpt("0.015")).toBe("1,5");
    expect(fractionVersPourcentCpt("0")).toBe("0");
    expect(fractionVersPourcentCpt("1")).toBe("100");
    expect(fractionVersPourcentCpt(0.04)).toBe("4");
    expect(fractionVersPourcentCpt("1.5")).toBeNull();
    expect(fractionVersPourcentCpt("n'importe quoi")).toBeNull();
  });

  it("aller-retour : saisie → fraction → affichage", () => {
    for (const p of ["7,25", "1,5", "12,5", "4", "0", "100", "0,0001"]) {
      const lu = lirePourcentageCpt(p);
      expect(lu.ok && fractionVersPourcentCpt(lu.fraction)).toBe(p);
    }
  });
});

describe("dates", () => {
  it("accepte une vraie date, rejette le reste", () => {
    for (const d of ["2026-10-26", "2028-02-29", "2000-01-01"]) expect(estDateIsoCpt(d), d).toBe(true);
    for (const d of ["2026-02-30", "2027-02-29", "26-10-2026", "2026/10/26", "1999-12-31", "2101-01-01", "", null, 20261026]) expect(estDateIsoCpt(d), String(d)).toBe(false);
  });
});

describe("partenaire", () => {
  it("accepte une saisie complète et nettoie les espaces", () => {
    const r = validerPartenaireCpt({ nom: "  NOVELIA   Assurances ", estGestionnaire: "on", estBeneficiaire: true, coordonnees: " Abidjan ", tiersOdoo: "" });
    expect(r).toEqual({
      ok: true,
      valeur: { nom: "NOVELIA Assurances", estApporteur: false, estBeneficiaire: true, estGestionnaire: true, estClient: false, coordonnees: "Abidjan", tiersOdoo: null },
    });
  });
  it("signale ensemble le nom trop court et l'absence de rôle", () => {
    const e = erreursDe(validerPartenaireCpt({ nom: "A" }));
    expect(Object.keys(e).sort()).toEqual(["nom", "roles"]);
  });
  it("un objet n'est jamais pris pour un texte", () => {
    expect(erreursDe(validerPartenaireCpt({ nom: { a: 1 }, estClient: true })).nom).toMatch(/2 caractères au moins/);
  });
});

describe("client et téléphone", () => {
  it("normalise le téléphone", () => {
    expect(normaliserTelephoneCpt("07 08 09 10 11")).toBe("0708091011");
    expect(normaliserTelephoneCpt("+225 07.08.09.10.11")).toBe("+2250708091011");
    expect(normaliserTelephoneCpt("(225) 0708091011")).toBe("2250708091011");
    expect(normaliserTelephoneCpt("123")).toBeNull();
    expect(normaliserTelephoneCpt("07-08-AB-10-11")).toBeNull();
    expect(normaliserTelephoneCpt("1234567890123456")).toBeNull();
  });
  it("valide un client, téléphone facultatif", () => {
    expect(validerClientCpt({ nom: "Kouassi Yao" })).toMatchObject({ ok: true, valeur: { telephone: null } });
    expect(validerClientCpt({ nom: "Kouassi Yao", telephone: "07 08 09 10 11" })).toMatchObject({ ok: true, valeur: { telephone: "0708091011" } });
    expect(erreursDe(validerClientCpt({ nom: "Kouassi Yao", telephone: "12" })).telephone).toMatch(/8 à 15 chiffres/);
  });
});

describe("produit", () => {
  it("met le code en majuscules et lit le tarif", () => {
    expect(validerProduitCpt({ code: " securpro ", libelle: "Sécur Pro", branche: "ACCIDENTS", tarifReference: "25 000" })).toEqual({
      ok: true,
      valeur: { code: "SECURPRO", libelle: "Sécur Pro", branche: "ACCIDENTS", tarifReference: "25000", compteOdoo: null },
    });
  });
  it("signale un code mal formé, une branche inconnue, un tarif négatif", () => {
    const e = erreursDe(validerProduitCpt({ code: "S", libelle: "X", branche: "AUTO", tarifReference: "-5" }));
    expect(Object.keys(e).sort()).toEqual(["branche", "code", "libelle", "tarifReference"]);
    expect(erreursDe(validerProduitCpt({ code: "a b", libelle: "Produit", branche: "SANTE" })).code).toMatch(/Code/);
  });
});

describe("compte d'encaissement", () => {
  it("valide un compte et signale un type inconnu", () => {
    expect(validerCompteCpt({ libelle: "Wave principal", type: "WAVE_BUSINESS", journalOdoo: "WAV" })).toMatchObject({ ok: true, valeur: { type: "WAVE_BUSINESS", journalOdoo: "WAV", compteOdoo: null } });
    expect(erreursDe(validerCompteCpt({ libelle: "Compte", type: "VIREMENT" })).type).toMatch(/Type de compte/);
  });
});

describe("taux de TCA : saisie et cohérence", () => {
  const saisie = { branche: "ACCIDENTS", taux: "7,25", dateEffet: "2026-01-01" };
  it("convertit le pourcentage en fraction", () => {
    expect(validerTauxTcaCpt(saisie)).toEqual({ ok: true, valeur: { branche: "ACCIDENTS", produitCode: null, natureContrat: null, taux: "0.072500", dateEffet: "2026-01-01" } });
  });
  it("signale ensemble taux, date et branche invalides", () => {
    expect(Object.keys(erreursDe(validerTauxTcaCpt({ branche: "AUTO", taux: "150", dateEffet: "2026-13-01" }))).sort()).toEqual(["branche", "dateEffet", "taux"]);
  });
  it("le produit doit exister et appartenir à la branche", () => {
    const valide = validerTauxTcaCpt({ ...saisie, produitCode: "p1" });
    if (!valide.ok) throw new Error("saisie valide attendue");
    expect(valide.valeur.produitCode).toBe("P1");
    expect(controlerCoherenceTauxTca(valide.valeur, [{ code: "P1", branche: "ACCIDENTS" }])).toBeNull();
    expect(controlerCoherenceTauxTca(valide.valeur, [{ code: "P1", branche: "SANTE" }])?.branche).toMatch(/Santé/);
    expect(controlerCoherenceTauxTca(valide.valeur, [])?.produitCode).toMatch(/n'existe pas/);
    expect(controlerCoherenceTauxTca({ ...valide.valeur, produitCode: null }, [])).toBeNull();
  });
  it("un doublon (même portée, même date) est signalé, une autre date non", () => {
    const existants: TauxTcaLigne[] = [{ id: "t1", branche: "ACCIDENTS", produitCode: null, natureContrat: null, taux: "0.0725", dateEffet: "2026-01-01" }];
    const base = { branche: "ACCIDENTS" as const, produitCode: null, natureContrat: null, taux: "0.040000" };
    expect(controlerDoublonTauxTca(existants, { ...base, dateEffet: "2026-01-01" })).toMatch(/un taux ne se modifie pas/);
    expect(controlerDoublonTauxTca(existants, { ...base, dateEffet: "2026-07-01" })).toBeNull();
    expect(controlerDoublonTauxTca(existants, { ...base, produitCode: "P1", dateEffet: "2026-01-01" })).toBeNull();
  });
});

describe("taux de TCA en vigueur (C-10) : date de valeur, spécificité", () => {
  const ligne = (
    id: string,
    taux: string,
    dateEffet: string,
    produitCode: string | null = null,
    natureContrat: "INDIVIDUEL" | "GROUPE" | null = null,
    branche: "ACCIDENTS" | "DECES" = "ACCIDENTS"
  ): TauxTcaLigne => ({ id, branche, produitCode, natureContrat, taux, dateEffet });
  const lignes = [
    ligne("b1", "0.0725", "2026-01-01"),
    ligne("b2", "0.04", "2026-07-01"),
    ligne("p1", "0.015", "2026-01-01", "P1"),
    ligne("p1g", "0.125", "2026-01-01", "P1", "GROUPE"),
    ligne("g", "0.10", "2026-01-01", null, "GROUPE"),
    ligne("d", "0", "2026-01-01", null, null, "DECES"),
  ];
  const id = (c: Parameters<typeof tauxTcaEnVigueur>[1]) => tauxTcaEnVigueur(lignes, c)?.id ?? null;

  it("prend la dernière date d'effet passée à la date de valeur ; l'ancienne ligne sert pour une date antérieure", () => {
    expect(id({ branche: "ACCIDENTS", date: "2026-03-01" })).toBe("b1");
    expect(id({ branche: "ACCIDENTS", date: "2026-06-30" })).toBe("b1");
    expect(id({ branche: "ACCIDENTS", date: "2026-07-01" })).toBe("b2");
    expect(id({ branche: "ACCIDENTS", date: "2027-01-01" })).toBe("b2");
  });
  it("aucun taux avant la première date d'effet : jamais un zéro deviné", () => {
    expect(id({ branche: "ACCIDENTS", date: "2025-12-31" })).toBeNull();
    expect(id({ branche: "SANTE", date: "2026-03-01" })).toBeNull();
  });
  it("le produit l'emporte sur la branche, même avec une date plus ancienne", () => {
    expect(id({ branche: "ACCIDENTS", produitCode: "P1", natureContrat: "INDIVIDUEL", date: "2026-08-01" })).toBe("p1");
  });
  it("produit + nature l'emporte sur le produit seul", () => {
    expect(id({ branche: "ACCIDENTS", produitCode: "P1", natureContrat: "GROUPE", date: "2026-08-01" })).toBe("p1g");
  });
  it("la nature seule l'emporte sur la branche seule, un autre produit retombe sur la branche", () => {
    expect(id({ branche: "ACCIDENTS", produitCode: "P2", natureContrat: "GROUPE", date: "2026-08-01" })).toBe("g");
    expect(id({ branche: "ACCIDENTS", produitCode: "P2", natureContrat: "INDIVIDUEL", date: "2026-08-01" })).toBe("b2");
    expect(id({ branche: "ACCIDENTS", date: "2026-08-01" })).toBe("b2");
  });
  it("le décès à 0 % est un taux, pas une absence de taux", () => {
    expect(tauxTcaEnVigueur(lignes, { branche: "DECES", date: "2026-03-01" })).toMatchObject({ id: "d", taux: "0" });
  });
  it("chronologie d'une portée : remplacé, en vigueur, à venir", () => {
    const portee = { branche: "ACCIDENTS" as const, produitCode: null, natureContrat: null };
    const avecFutur = [...lignes, ligne("b3", "0.05", "2027-01-01")];
    expect(chronologieTauxTcaCpt(avecFutur, portee, "2026-10-26").map((l) => [l.ligne.id, l.etat])).toEqual([
      ["b1", "REMPLACE"],
      ["b2", "EN_VIGUEUR"],
      ["b3", "A_VENIR"],
    ]);
    expect(chronologieTauxTcaCpt(avecFutur, portee, "2025-01-01").map((l) => l.etat)).toEqual(["A_VENIR", "A_VENIR", "A_VENIR"]);
  });
});

describe("conventions : validation", () => {
  const saisie = {
    partenaireId: "p-a",
    nature: "COMMISSION",
    taux: "15",
    base: "PRIME_NETTE",
    faitGenerateur: "ENCAISSEMENT",
    modeReglement: "AU_PRORATA",
    dateEffet: "2026-01-01",
  };
  it("valide une convention ouverte", () => {
    expect(validerConventionCpt(saisie)).toEqual({
      ok: true,
      valeur: { partenaireId: "p-a", produitCode: null, nature: "COMMISSION", taux: "0.150000", base: "PRIME_NETTE", faitGenerateur: "ENCAISSEMENT", apporteurId: null, beneficiaireId: null, modeReglement: "AU_PRORATA", dateEffet: "2026-01-01", dateFin: null },
    });
  });
  it("signale ensemble les champs invalides et une fin avant le début", () => {
    expect(Object.keys(erreursDe(validerConventionCpt({ ...saisie, nature: "PRIME", taux: "x", base: "", dateEffet: "" }))).sort()).toEqual(["base", "dateEffet", "nature", "taux"]);
    expect(erreursDe(validerConventionCpt({ ...saisie, dateFin: "2025-12-31" })).dateFin).toMatch(/ne peut pas précéder/);
    expect(validerConventionCpt({ ...saisie, dateFin: "2026-12-31" })).toMatchObject({ ok: true, valeur: { dateFin: "2026-12-31" } });
  });
  it("fait générateur proposé pour les honoraires (C-4), rien pour les autres natures", () => {
    expect(faitGenerateurSuggereCpt("HONORAIRES", true)).toBe("ENCAISSEMENT");
    expect(faitGenerateurSuggereCpt("HONORAIRES", false)).toBe("EMISSION");
    expect(faitGenerateurSuggereCpt("COMMISSION", true)).toBeNull();
    expect(faitGenerateurSuggereCpt("ACCESSOIRES", false)).toBeNull();
  });
});

describe("conventions : chevauchement et convention en vigueur", () => {
  const conv = (id: string, dateEffet: string, dateFin: string | null, extra: Partial<ConventionLigne> = {}): ConventionLigne => ({
    id,
    partenaireId: "p-a",
    produitCode: null,
    nature: "COMMISSION",
    apporteurId: null,
    dateEffet,
    dateFin,
    ...extra,
  });

  it("périodes inclusives : le jour de fin compte, null = sans fin", () => {
    expect(periodesSeRecouvrentCpt({ dateEffet: "2026-01-01", dateFin: "2026-06-30" }, { dateEffet: "2026-06-30", dateFin: null })).toBe(true);
    expect(periodesSeRecouvrentCpt({ dateEffet: "2026-01-01", dateFin: "2026-06-30" }, { dateEffet: "2026-07-01", dateFin: null })).toBe(false);
    expect(periodesSeRecouvrentCpt({ dateEffet: "2026-01-01", dateFin: null }, { dateEffet: "2030-01-01", dateFin: null })).toBe(true);
    expect(periodesSeRecouvrentCpt({ dateEffet: "2026-03-01", dateFin: "2026-03-31" }, { dateEffet: "2026-01-01", dateFin: "2026-12-31" })).toBe(true);
  });

  const valide = (extra: Record<string, unknown>) => {
    const r = validerConventionCpt({ partenaireId: "p-a", nature: "COMMISSION", taux: "10", base: "TTC", faitGenerateur: "EMISSION", modeReglement: "EN_UNE_FOIS", dateEffet: "2026-07-01", ...extra });
    if (!r.ok) throw new Error(JSON.stringify(r.erreurs));
    return r.valeur;
  };

  it("une nouvelle convention qui commence pendant une convention ouverte est signalée", () => {
    expect(controlerChevauchementConventionCpt([conv("c1", "2026-01-01", null)], valide({}))).toMatch(/fixez d'abord sa date de fin/);
  });
  it("elle passe quand l'ancienne est close la veille", () => {
    expect(controlerChevauchementConventionCpt([conv("c1", "2026-01-01", "2026-06-30")], valide({}))).toBeNull();
  });
  it("le même jour compte comme un chevauchement", () => {
    expect(controlerChevauchementConventionCpt([conv("c1", "2026-01-01", "2026-07-01")], valide({}))).not.toBeNull();
  });
  it("une autre portée ne gêne pas : autre partenaire, autre nature, autre produit, autre apporteur", () => {
    const existantes = [conv("c1", "2026-01-01", null)];
    expect(controlerChevauchementConventionCpt(existantes, valide({ partenaireId: "p-b" }))).toBeNull();
    expect(controlerChevauchementConventionCpt(existantes, valide({ nature: "HONORAIRES" }))).toBeNull();
    expect(controlerChevauchementConventionCpt(existantes, valide({ produitCode: "P1" }))).toBeNull();
    expect(controlerChevauchementConventionCpt(existantes, valide({ apporteurId: "p-x" }))).toBeNull();
  });
  it("renvoie toutes les conventions en conflit", () => {
    const existantes = [conv("c1", "2026-01-01", "2026-12-31"), conv("c2", "2026-06-01", null), conv("c3", "2025-01-01", "2025-12-31")];
    expect(
      conventionsEnChevauchementCpt(existantes, { partenaireId: "p-a", produitCode: null, nature: "COMMISSION", apporteurId: null, dateEffet: "2026-08-01", dateFin: null }).map((c) => c.id)
    ).toEqual(["c1", "c2"]);
  });

  it("clôturer une convention : fin valable, avant le début, ou chevauchant une autre", () => {
    const c1 = conv("c1", "2026-01-01", null);
    const c2 = conv("c2", "2027-01-01", null);
    expect(controlerNouvelleFinConventionCpt(c1, "2026-12-31", [c2])).toBeNull();
    expect(controlerNouvelleFinConventionCpt(c1, "2025-12-31", [c2])).toMatch(/ne peut pas précéder/);
    expect(controlerNouvelleFinConventionCpt(c1, "2027-06-30", [c2])).toMatch(/ferait chevaucher/);
    expect(controlerNouvelleFinConventionCpt(c1, "30/06/2026", [c2])).toMatch(/invalide/);
    expect(controlerNouvelleFinConventionCpt(c1, null, [conv("c0", "2020-01-01", "2020-12-31")])).toBeNull();
  });

  it("convention en vigueur : période, spécificité produit puis apporteur, jamais devinée", () => {
    const toutes = [
      conv("tous", "2026-01-01", null),
      conv("p1", "2026-01-01", null, { produitCode: "P1" }),
      conv("p1-nov", "2026-01-01", null, { produitCode: "P1", apporteurId: "NOVELIA" }),
      conv("nov", "2026-01-01", null, { apporteurId: "NOVELIA" }),
      conv("close", "2025-01-01", "2025-12-31"),
    ];
    const id = (c: Partial<Parameters<typeof conventionEnVigueurCpt>[1]>) =>
      conventionEnVigueurCpt(toutes, { partenaireId: "p-a", nature: "COMMISSION", date: "2026-03-01", ...c })?.id ?? null;
    expect(id({})).toBe("tous");
    expect(id({ produitCode: "P1" })).toBe("p1");
    expect(id({ produitCode: "P1", apporteurId: "NOVELIA" })).toBe("p1-nov");
    expect(id({ produitCode: "P2", apporteurId: "NOVELIA" })).toBe("nov");
    expect(id({ date: "2025-06-01" })).toBe("close");
    expect(id({ date: "2024-12-31" })).toBeNull();
    expect(id({ nature: "HONORAIRES" })).toBeNull();
    expect(id({ partenaireId: "inconnu" })).toBeNull();
  });
  it("une convention close est appliquée le dernier jour, plus le lendemain", () => {
    const l = [conv("c1", "2026-01-01", "2026-06-30")];
    expect(conventionEnVigueurCpt(l, { partenaireId: "p-a", nature: "COMMISSION", date: "2026-06-30" })?.id).toBe("c1");
    expect(conventionEnVigueurCpt(l, { partenaireId: "p-a", nature: "COMMISSION", date: "2026-07-01" })).toBeNull();
  });
});
