import { createHash } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

/**
 * Fichiers de la réinitialisation (lot N) : écriture VÉRIFIÉE de la sauvegarde JSON, et suppression des fichiers de
 * `uploads/` après le commit. Utilisé par le script `reinitialiser-production.ts` (le chemin web écrit la sauvegarde dans le
 * navigateur de l'utilisateur et supprime les fichiers dans son action serveur, avec la même garde anti path traversal).
 */

export class SauvegardeError extends Error {}

/**
 * Écrit la sauvegarde dans `dossier` (créé au besoin), force l'écriture sur disque (`fsync`), la RELIT et compare son
 * empreinte SHA-256 au contenu écrit. Lève `SauvegardeError` au moindre écart : l'appelant ne doit alors PAS purger.
 */
export async function ecrireSauvegardeVerifiee(
  dossier: string,
  contenu: string,
  horodatage: string = new Date().toISOString().replace(/[:.]/g, "-")
): Promise<{ chemin: string; octets: number; sha256Fichier: string }> {
  try {
    await mkdir(dossier, { recursive: true });
    const chemin = path.join(dossier, `sauvegarde-reinitialisation-${horodatage}.json`);
    const handle = await open(chemin, "wx", 0o600); // refuse d'écraser une sauvegarde existante
    try {
      await handle.writeFile(contenu, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    const relu = await readFile(chemin, "utf8");
    const attendu = createHash("sha256").update(contenu, "utf8").digest("hex");
    const obtenu = createHash("sha256").update(relu, "utf8").digest("hex");
    if (attendu !== obtenu || Buffer.byteLength(relu, "utf8") === 0) {
      throw new SauvegardeError("La sauvegarde relue ne correspond pas à ce qui a été écrit.");
    }
    JSON.parse(relu); // doit rester un JSON valide
    return { chemin, octets: Buffer.byteLength(relu, "utf8"), sha256Fichier: obtenu };
  } catch (e) {
    if (e instanceof SauvegardeError) throw e;
    throw new SauvegardeError(`Écriture de la sauvegarde impossible : ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Supprime les fichiers d'`uploads/` (garde anti path traversal) ; un échec n'annule rien, il est compté. Un fichier déjà absent
 * (`ENOENT`) n'est pas un échec : le résultat voulu est atteint, il est compté à part (`absents`).
 */
export async function supprimerFichiersUploads(
  urls: readonly string[],
  dossierUploads: string
): Promise<{ supprimes: number; echecs: number; absents: number }> {
  const racine = path.resolve(dossierUploads);
  let supprimes = 0;
  let echecs = 0;
  let absents = 0;
  for (const url of urls) {
    const chemin = path.resolve(racine, url);
    if (!chemin.startsWith(racine + path.sep)) {
      echecs++;
      continue;
    }
    try {
      await unlink(chemin);
      supprimes++;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") absents++;
      else echecs++;
    }
  }
  return { supprimes, echecs, absents };
}
