import { describe, expect, it } from "vitest";

import {
  ENTITES_MOTS_CPT,
  RECHERCHE_MOTS_MAX_CPT,
  decouperRechercheCpt,
  echapperLikeCpt,
  indexerMotsCpt,
  motsIndexesCpt,
  normaliserTexteRechercheCpt,
  rechercherCpt,
  supprimerMotsCpt,
  textesIndexClientCpt,
  textesIndexPartenaireCpt,
  textesIndexProduitCpt,
} from "./cptRecherche";

describe("normalisation de la recherche", () => {
  it("minuscules, accents français retirés, apostrophes et tirets ignorés", () => {
    expect(normaliserTexteRechercheCpt("N'Guessan")).toBe("nguessan");
    expect(normaliserTexteRechercheCpt("Aïssatou Koné")).toBe("aissatou kone");
    expect(normaliserTexteRechercheCpt("Jean-Marc")).toBe("jeanmarc");
    expect(normaliserTexteRechercheCpt("D’Almeida")).toBe("dalmeida");
  });

  it("une saisie est découpée en mots sans doublon, au plus six", () => {
    expect(decouperRechercheCpt("  Koné   kone  Aya ")).toEqual(["kone", "aya"]);
    expect(decouperRechercheCpt("a b c d e f g h")).toHaveLength(RECHERCHE_MOTS_MAX_CPT);
    expect(decouperRechercheCpt("   ")).toEqual([]);
    expect(decouperRechercheCpt("'-")).toEqual([]);
  });

  it("les jokers de LIKE sont cherchés tels quels", () => {
    expect(echapperLikeCpt("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
});

describe("mots indexés", () => {
  it("le jeton normalisé ET ses parties sont indexés", () => {
    const mots = motsIndexesCpt(["N'Guessan Aya", "POL-0031337"]);
    expect(mots).toEqual(expect.arrayContaining(["nguessan", "n", "guessan", "aya", "pol0031337", "pol", "0031337"]));
  });

  it("sans doublon, textes vides ignorés", () => {
    const mots = motsIndexesCpt(["Aya Aya", null, undefined, "", "aya"]);
    expect(mots).toEqual(["aya"]);
  });

  it("un fragment au milieu d'un mot n'est pas indexé (limite assumée)", () => {
    expect(motsIndexesCpt(["N'Guessan"])).not.toContain("uessan");
  });
});

describe("textes indexés par fiche", () => {
  it("client : nom, téléphone sans le « + », pièce, tiers Odoo et partenaire d'origine", () => {
    const mots = motsIndexesCpt(
      textesIndexClientCpt({ nom: "Aya Koné", telephone: "+2250700000001", pieceIdentite: "CNI-123", tiersOdoo: "T-9", partenaireOrigineNom: "Courtier Alpha" })
    );
    expect(mots).toEqual(expect.arrayContaining(["aya", "kone", "2250700000001", "cni123", "cni", "123", "t9", "courtier", "alpha"]));
    // Le « + » initial n'est jamais un mot : on retrouve le numéro en tapant son début.
    expect(mots.some((m) => m.startsWith("+"))).toBe(false);
  });

  it("partenaire : nom, coordonnées, tiers Odoo", () => {
    const mots = motsIndexesCpt(textesIndexPartenaireCpt({ nom: "Courtier Alpha", coordonnees: "Plateau, Abidjan", tiersOdoo: "T-ALPHA" }));
    expect(mots).toEqual(expect.arrayContaining(["courtier", "alpha", "plateau,", "abidjan", "talpha"]));
  });

  it("produit : code, libellé, branche et compte Odoo", () => {
    const mots = motsIndexesCpt(textesIndexProduitCpt({ code: "SECUR-PRO", libelle: "Sécurité Pro", libelleBranche: "Décès", compteOdoo: "411100" }));
    expect(mots).toEqual(expect.arrayContaining(["securpro", "secur", "pro", "securite", "deces", "411100"]));
  });

  it("trois entités indexées pour le moment", () => {
    expect([...ENTITES_MOTS_CPT]).toEqual(["CLIENT", "PARTENAIRE", "PRODUIT", "CONTRAT"]);
  });
});

describe("écriture de l'index", () => {
  function faussePrisma() {
    const appels: { op: string; arg: unknown }[] = [];
    const cptMot = {
      deleteMany: async (arg: unknown) => void appels.push({ op: "deleteMany", arg }),
      createMany: async (arg: unknown) => void appels.push({ op: "createMany", arg }),
    };
    return { appels, db: { cptMot } as never };
  }

  it("une fiche existante : ses anciens mots sont effacés avant d'écrire les nouveaux", async () => {
    const { appels, db } = faussePrisma();
    await indexerMotsCpt(db, "CLIENT", "c1", ["Aya Koné"]);
    expect(appels.map((a) => a.op)).toEqual(["deleteMany", "createMany"]);
    expect(appels[0].arg).toEqual({ where: { entite: "CLIENT", entiteId: "c1" } });
    expect((appels[1].arg as { data: unknown[]; skipDuplicates: boolean }).skipDuplicates).toBe(true);
    expect((appels[1].arg as { data: { mot: string }[] }).data.map((d) => d.mot)).toEqual(["aya", "kone"]);
  });

  it("une fiche nouvelle : rien à effacer", async () => {
    const { appels, db } = faussePrisma();
    await indexerMotsCpt(db, "PRODUIT", "p1", ["SECUR"], true);
    expect(appels.map((a) => a.op)).toEqual(["createMany"]);
  });

  it("aucun mot : aucune écriture (mais les anciens mots sont tout de même effacés)", async () => {
    const { appels, db } = faussePrisma();
    await indexerMotsCpt(db, "PARTENAIRE", "x", [null, ""]);
    expect(appels.map((a) => a.op)).toEqual(["deleteMany"]);
  });

  it("supprimer une fiche efface ses mots", async () => {
    const { appels, db } = faussePrisma();
    await supprimerMotsCpt(db, "CLIENT", "c9");
    expect(appels).toEqual([{ op: "deleteMany", arg: { where: { entite: "CLIENT", entiteId: "c9" } } }]);
  });
});

describe("lecture", () => {
  it("une saisie sans mot exploitable ne cherche rien et ne renvoie jamais « tout »", async () => {
    let appele = false;
    const db = {
      $queryRaw: async () => {
        appele = true;
        return [];
      },
    } as never;
    expect(await rechercherCpt(db, "   ")).toEqual([]);
    expect(await rechercherCpt(db, "'-")).toEqual([]);
    expect(appele).toBe(false);
  });

  it("une requête par recherche, résultats renvoyés dans l'ordre reçu avec leur entité", async () => {
    let appels = 0;
    const db = {
      $queryRaw: async () => {
        appels += 1;
        return [
          { entite: "CLIENT", entiteId: "c1" },
          { entite: "PRODUIT", entiteId: "p1" },
        ];
      },
    } as never;
    const r = await rechercherCpt(db, "Aya Koné", { limite: 10 });
    expect(appels).toBe(1);
    expect(r).toEqual([
      { entite: "CLIENT", entiteId: "c1" },
      { entite: "PRODUIT", entiteId: "p1" },
    ]);
  });

  it("un seul mot, plusieurs mots, une entité précise : la requête se construit sans erreur", async () => {
    const db = { $queryRaw: async () => [] } as never;
    await expect(rechercherCpt(db, "aya")).resolves.toEqual([]);
    await expect(rechercherCpt(db, "aya kone", { entite: "CLIENT" })).resolves.toEqual([]);
    await expect(rechercherCpt(db, "a b c d e f g", { limite: 100000 })).resolves.toEqual([]);
  });

  it("plusieurs types à la fois (`entites`) : un filtre ANY sur la liste, jamais sur un seul type", async () => {
    const appels: string[] = [];
    const db = {
      $queryRaw: async (...args: unknown[]) => {
        appels.push(JSON.stringify(args));
        return [];
      },
    } as never;
    await rechercherCpt(db, "kone", { entites: ["CLIENT", "PARTENAIRE", "PRODUIT"] });
    await rechercherCpt(db, "kone", { entite: "CONTRAT", entites: ["CLIENT"] });
    await rechercherCpt(db, "kone");
    expect(appels[0]).toContain("ANY(");
    expect(appels[0]).toContain("PARTENAIRE");
    expect(appels[0]).not.toContain("CONTRAT");
    // `entite` (un seul type) l'emporte sur `entites` ; sans option, aucun filtre de type.
    expect(appels[1]).toContain("CONTRAT");
    expect(appels[1]).not.toContain("ANY(");
    expect(appels[2]).not.toContain("ANY(");
    expect(appels[2]).not.toContain("CONTRAT");
  });
});
