import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SauvegardeError, ecrireSauvegardeVerifiee, supprimerFichiersUploads } from "./reinitialisationFichiers";

let dossier: string;
beforeEach(async () => {
  dossier = await mkdtemp(path.join(os.tmpdir(), "reinit-test-"));
});
afterEach(async () => {
  await rm(dossier, { recursive: true, force: true });
});

describe("ecrireSauvegardeVerifiee", () => {
  it("écrit, relit et vérifie le fichier (dossier créé au besoin)", async () => {
    const contenu = JSON.stringify({ meta: { a: 1 }, tables: {} });
    const r = await ecrireSauvegardeVerifiee(path.join(dossier, "a", "b"), contenu, "2026-10-30T10-00-00-000Z");
    expect(r.chemin.endsWith("sauvegarde-reinitialisation-2026-10-30T10-00-00-000Z.json")).toBe(true);
    expect(await readFile(r.chemin, "utf8")).toBe(contenu);
    expect(r.octets).toBe(Buffer.byteLength(contenu));
  });
  it("refuse d'écraser une sauvegarde existante", async () => {
    await ecrireSauvegardeVerifiee(dossier, "{}", "t");
    await expect(ecrireSauvegardeVerifiee(dossier, "{}", "t")).rejects.toBeInstanceOf(SauvegardeError);
  });
  it("lève SauvegardeError si le dossier est inutilisable (un fichier à la place du dossier)", async () => {
    const fichier = path.join(dossier, "fichier");
    await writeFile(fichier, "x");
    await expect(ecrireSauvegardeVerifiee(path.join(fichier, "sous"), "{}")).rejects.toBeInstanceOf(SauvegardeError);
  });
  it("refuse un contenu qui n'est pas du JSON valide", async () => {
    await expect(ecrireSauvegardeVerifiee(dossier, "pas du json")).rejects.toBeInstanceOf(SauvegardeError);
  });
});

describe("supprimerFichiersUploads", () => {
  it("supprime les fichiers, compte les absents à part et refuse tout chemin hors du dossier", async () => {
    await mkdir(path.join(dossier, "uploads"));
    await writeFile(path.join(dossier, "uploads", "a.pdf"), "x");
    await writeFile(path.join(dossier, "hors.txt"), "x");
    const r = await supprimerFichiersUploads(["a.pdf", "absent.pdf", "../hors.txt"], path.join(dossier, "uploads"));
    expect(r).toEqual({ supprimes: 1, echecs: 1, absents: 1 }); // « absent.pdf » absent, « ../hors.txt » refusé
    expect(existsSync(path.join(dossier, "hors.txt"))).toBe(true); // path traversal refusé
    expect(existsSync(path.join(dossier, "uploads", "a.pdf"))).toBe(false);
  });
});
