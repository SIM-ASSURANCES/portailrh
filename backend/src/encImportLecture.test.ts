import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { EncImportLectureError, LIGNES_MAX, TAILLE_MAX_OCTETS, lireTableur, normaliserMode } from "./encImportLecture";

// En-têtes réels de Maquette_registre_paiements.html (symboles ▲/✦ inclus, exactement comme le vrai fichier) —
// prouve que la lecture les ignore bien, plutôt que de les retirer artificiellement dans les fixtures de test.
const ENTETES_SANS_BRANCHE = [
  "DateEnregistrement",
  "PaiementID ▲",
  "NumPolice ✦",
  "TypeDeContrat",
  "LibelléProduit",
  "CodeProduit",
  "TypeOpération",
  "ClientID",
  "NomClient/Souscripteur",
  "NomPartenaire",
  "DatePaiement ✦",
  "ModePaiement ✦",
  "RéférencePaiement",
  "DDF (jours)",
  "Date effet",
  "Date échéance",
  "StatutContrat",
  "N° Paiement",
  "PrimeTTC Contrat (FCFA)",
  "PrimeNetteHT",
  "AccessoiresHT",
  "TaxesMontant",
  "MontantCommission",
  "MontantGestion",
  "Type Police",
  "Montant reçu TTC",
  "Montant restant dû",
  "Prime nette reçue",
  "Accessoires reçus",
  "Taxe effective à payer",
  "Statut du paiement",
  "Observations",
  "SemaineAnnée",
  "Contrôle référence",
];

/** Fixture ANONYMISÉE construite en mémoire (jamais un fichier réel) : ligne d'en-têtes + lignes de données fournies. */
function construireClasseur(donnees: unknown[][], options?: { enTetes?: unknown[] }): Buffer {
  const enTetes = options?.enTetes ?? ENTETES_SANS_BRANCHE;
  const feuille = XLSX.utils.aoa_to_sheet([enTetes, ...donnees]);
  const classeur = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(classeur, feuille, "Production");
  return XLSX.write(classeur, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Une ligne complète et cohérente (police FICTIVE), dans l'ordre exact des 34 colonnes A à AH. */
function ligneComplete(overrides: Record<number, unknown> = {}): unknown[] {
  const ligne: unknown[] = [
    new Date(Date.UTC(2026, 8, 1)), // A DateEnregistrement
    "TECH-000123", // B PaiementID (fichier)
    "TST-2026-000001", // C NumPolice
    "Individuel", // D TypeDeContrat
    "Assurance Auto", // E LibelléProduit
    "AUTO01", // F CodeProduit
    "Nouvelle affaire", // G TypeOpération
    "CLI-001", // H ClientID
    "Client Test", // I NomClient
    "Partenaire Test", // J NomPartenaire
    new Date(Date.UTC(2026, 8, 10)), // K DatePaiement
    "Wave", // L ModePaiement (brut, sera normalisé)
    "T_ABCDEFGHIJKLMNOP", // M RéférencePaiement
    365, // N DDF (ignorée)
    new Date(Date.UTC(2026, 8, 1)), // O Date effet
    new Date(Date.UTC(2027, 8, 1)), // P Date échéance
    "En cours", // Q StatutContrat (ignorée)
    1, // R N° Paiement (ignorée)
    1500, // S PrimeTTC
    1398.6, // T PrimeNetteHT
    0, // U AccessoiresHT
    101.4, // V TaxesMontant
    251.75, // W MontantCommission
    34.97, // X MontantGestion
    "Standard", // Y Type Police
    500, // Z Montant reçu TTC
    1000, // AA Montant restant dû (ignorée)
    466.2, // AB Prime nette reçue (ignorée)
    0, // AC Accessoires reçus (ignorée)
    33.8, // AD Taxe effective à payer (ignorée)
    "à confirmer", // AE Statut du paiement (ignorée)
    "RAS", // AF Observations (ignorée)
    "S36-2026", // AG SemaineAnnée (ignorée)
    "OK", // AH Contrôle référence (ignorée)
  ];
  for (const [index, valeur] of Object.entries(overrides)) ligne[Number(index)] = valeur;
  return ligne;
}

describe("lireTableur — en-têtes", () => {
  it("lit un fichier sans colonne Branche, symboles ▲/✦ ignorés", () => {
    const resultat = lireTableur(construireClasseur([ligneComplete()]));
    expect(resultat.brancheColonnePresente).toBe(false);
    expect(resultat.lignes).toHaveLength(1);
    expect(resultat.lignes[0].brancheCode).toBeNull();
    expect(resultat.lignes[0].numPolice).toBe("TST-2026-000001");
  });

  it("reconnaît la colonne Branche insérée à n'importe quelle position (ici juste après NumPolice)", () => {
    const enTetes = [...ENTETES_SANS_BRANCHE.slice(0, 3), "Branche", ...ENTETES_SANS_BRANCHE.slice(3)];
    const ligne = ligneComplete();
    ligne.splice(3, 0, "AUTO");
    const resultat = lireTableur(construireClasseur([ligne], { enTetes }));
    expect(resultat.brancheColonnePresente).toBe(true);
    expect(resultat.lignes[0].brancheCode).toBe("AUTO");
    expect(resultat.lignes[0].numPolice).toBe("TST-2026-000001");
    expect(resultat.lignes[0].typeContrat).toBe("Individuel");
  });

  it("colonne « branche » reconnue insensible à la casse", () => {
    const enTetes = [...ENTETES_SANS_BRANCHE, "branche"];
    const ligne = [...ligneComplete(), "VIE"];
    const resultat = lireTableur(construireClasseur([ligne], { enTetes }));
    expect(resultat.brancheColonnePresente).toBe(true);
    expect(resultat.lignes[0].brancheCode).toBe("VIE");
  });

  it("refuse un en-tête renommé (position 3, NumPolice)", () => {
    const enTetes = [...ENTETES_SANS_BRANCHE];
    enTetes[2] = "Police";
    expect(() => lireTableur(construireClasseur([ligneComplete()], { enTetes }))).toThrow(EncImportLectureError);
  });

  it("refuse un nombre de colonnes incorrect (colonne manquante)", () => {
    const enTetes = ENTETES_SANS_BRANCHE.slice(0, -1);
    expect(() => lireTableur(construireClasseur([ligneComplete().slice(0, -1)], { enTetes }))).toThrow(EncImportLectureError);
  });
});

describe("lireTableur — lignes de données", () => {
  it("colonnes calculées (N, Q, R, AA à AH) jamais reprises dans le résultat", () => {
    const resultat = lireTableur(construireClasseur([ligneComplete()]));
    const ligne = resultat.lignes[0] as unknown as Record<string, unknown>;
    for (const cle of ["DDF", "StatutContrat", "N° Paiement", "AA", "AB", "AC", "AD", "observations", "SemaineAnnée"]) {
      expect(ligne[cle]).toBeUndefined();
    }
  });

  it("montants arrondis au centime via chaîne, sans résidu binaire (1398.5999999999998 -> 1398.60)", () => {
    const resultat = lireTableur(construireClasseur([ligneComplete({ 19: 1398.5999999999998 })]));
    expect(resultat.lignes[0].T?.toFixed(2)).toBe("1398.60");
  });

  it("mode normalisé (Wave -> WAVE)", () => {
    const resultat = lireTableur(construireClasseur([ligneComplete()]));
    expect(resultat.lignes[0].mode).toBe("WAVE");
  });

  it("ligne de paiement incomplète (date/mode/montant absents) : lue sans erreur, champs à null", () => {
    const resultat = lireTableur(construireClasseur([ligneComplete({ 10: null, 11: null, 12: null, 25: null })]));
    expect(resultat.lignes[0].datePaiement).toBeNull();
    expect(resultat.lignes[0].mode).toBeNull();
    expect(resultat.lignes[0].reference).toBeNull();
    expect(resultat.lignes[0].Z).toBeNull();
    // Les champs du CONTRAT restent lus normalement : une ligne de paiement incomplète n'invalide pas le contrat.
    expect(resultat.lignes[0].numPolice).toBe("TST-2026-000001");
    expect(resultat.lignes[0].S?.toFixed(2)).toBe("1500.00");
  });

  it("numéro de police manquant : lu comme null, jamais une exception (décision métier laissée à encImportRegles.ts)", () => {
    const resultat = lireTableur(construireClasseur([ligneComplete({ 2: null })]));
    expect(resultat.lignes[0].numPolice).toBeNull();
  });

  it("ligne entièrement vide ignorée et comptée, jamais incluse dans `lignes`", () => {
    const vide = new Array(ENTETES_SANS_BRANCHE.length).fill(null);
    const resultat = lireTableur(construireClasseur([ligneComplete(), vide, ligneComplete()]));
    expect(resultat.lignes).toHaveLength(2);
    expect(resultat.nbLignesVidesIgnorees).toBe(1);
  });

  it("numeroLigne reflète la position réelle dans le fichier (1 = première ligne de données)", () => {
    const resultat = lireTableur(construireClasseur([ligneComplete(), ligneComplete({ 2: "TST-2026-000002" })]));
    expect(resultat.lignes.map((l) => l.numeroLigne)).toEqual([1, 2]);
  });
});

describe("lireTableur — limites structurelles", () => {
  it("refuse un fichier vide (buffer vide)", () => {
    expect(() => lireTableur(Buffer.alloc(0))).toThrow(EncImportLectureError);
  });

  it("refuse un fichier dépassant la taille maximale, avant même de tenter de le lire", () => {
    expect(() => lireTableur(Buffer.alloc(TAILLE_MAX_OCTETS + 1))).toThrow(/volumineux/);
  });

  it("refuse un fichier dépassant le nombre de lignes maximal (mais pas la taille : lignes volontairement minimales)", () => {
    // Ligne réduite au strict nécessaire (peu de texte) pour que 20 001 lignes restent sous la limite de taille : la
    // limite de LIGNES doit être testée isolément de celle de TAILLE, qui peut légitimement se déclencher en premier
    // sur un fichier réaliste (les deux filets sont indépendants, l'ordre de déclenchement n'a pas d'importance).
    const ligneMinimale = (i: number): unknown[] => {
      const l = new Array(ENTETES_SANS_BRANCHE.length).fill(null);
      l[2] = `P${i}`; // NumPolice
      return l;
    };
    const lignes = Array.from({ length: LIGNES_MAX + 1 }, (_, i) => ligneMinimale(i));
    const buffer = construireClasseur(lignes);
    expect(buffer.length).toBeLessThan(TAILLE_MAX_OCTETS);
    expect(() => lireTableur(buffer)).toThrow(/lignes/);
  }, 20_000);

  it("refuse un contenu illisible (octets arbitraires non vides, sous la limite de taille)", () => {
    expect(() => lireTableur(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toThrow(EncImportLectureError);
  });
});

describe("normaliserMode", () => {
  it.each([
    ["Wave", "WAVE"],
    ["WAVE", "WAVE"],
    ["Orange Money", "OM"],
    ["OM", "OM"],
    ["MTN Money", "MTN"],
    ["Chèque", "CHQ"],
    ["CHQ", "CHQ"],
    ["Virement", "VIR"],
    ["Carte bancaire", "CB"],
    ["VISA", "CB"],
    ["Moov", "MOB"],
    ["", null],
    [null, null],
  ])("%s -> %s", (entree, attendu) => {
    expect(normaliserMode(entree)).toBe(attendu);
  });
});
