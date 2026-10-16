import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_PIECES_PAR_DEMANDE,
  MESSAGE_PIECE_INVALIDE,
  cheminPieceConge,
  estNomPieceCongeValide,
  nomAffichagePiece,
  validerPieces,
} from "./congesPieces";

const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("nom de pièce (B1)", () => {
  it("accepte uniquement UUID + extension autorisée", () => {
    expect(estNomPieceCongeValide(`${UUID}.pdf`)).toBe(true);
    expect(estNomPieceCongeValide(`${UUID}.jpg`)).toBe(true);
    expect(estNomPieceCongeValide(`${UUID}.jpeg`)).toBe(true);
    expect(estNomPieceCongeValide(`${UUID}.png`)).toBe(true);
  });

  it.each([
    "../../../../proc/self/environ",
    `../${UUID}.pdf`,
    `${UUID}.pdf/../../x`,
    `/etc/passwd`,
    `${UUID}.exe`,
    `${UUID}.PDF`,
    `${UUID}`,
    `conges/${UUID}.pdf`,
    `${UUID}.pdf\u0000.png`,
    "",
  ])("refuse %j", (nom) => {
    expect(estNomPieceCongeValide(nom)).toBe(false);
  });

  it("refuse un non-texte", () => {
    expect(estNomPieceCongeValide(undefined)).toBe(false);
    expect(estNomPieceCongeValide(42)).toBe(false);
    expect(estNomPieceCongeValide(null)).toBe(false);
  });
});

describe("chemin résolu", () => {
  it("reste dans le dossier", () => {
    expect(cheminPieceConge("/app/uploads/conges", `${UUID}.pdf`)).toBe(path.resolve("/app/uploads/conges", `${UUID}.pdf`));
  });
  it("renvoie null pour un nom piégé", () => {
    expect(cheminPieceConge("/app/uploads/conges", "../../etc/passwd")).toBeNull();
  });
});

describe("liste de pièces", () => {
  it("accepte une liste vide ou absente", () => {
    expect(validerPieces(undefined)).toEqual({ ok: true, pieces: [] });
    expect(validerPieces([])).toEqual({ ok: true, pieces: [] });
  });

  it("refuse la liste entière si un nom est piégé", () => {
    const r = validerPieces([{ url: `${UUID}.pdf` }, { url: "../../x" }]);
    expect(r).toEqual({ ok: false, erreur: MESSAGE_PIECE_INVALIDE });
  });

  it("dédoublonne et nettoie les noms d'affichage", () => {
    const r = validerPieces([
      { url: `${UUID}.pdf`, nomFichier: "C:\\docs\\certificat.pdf" },
      { url: `${UUID}.pdf`, nomFichier: "autre" },
    ]);
    expect(r).toEqual({ ok: true, pieces: [{ url: `${UUID}.pdf`, nomFichier: "certificat.pdf" }] });
  });

  it("limite le nombre de pièces", () => {
    const pieces = Array.from({ length: MAX_PIECES_PAR_DEMANDE + 1 }, (_, i) => ({
      url: `123e4567-e89b-12d3-a456-42661417400${i}.pdf`,
    }));
    expect(validerPieces(pieces).ok).toBe(false);
  });

  it("nom d'affichage par défaut", () => {
    expect(nomAffichagePiece(undefined)).toBe("Justificatif");
    expect(nomAffichagePiece("")).toBe("Justificatif");
  });
});
