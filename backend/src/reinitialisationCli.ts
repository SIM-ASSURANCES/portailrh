import path from "node:path";

import { CONFIRMATION_REINITIALISATION } from "./reinitialisation";

/**
 * Logique PURE de la ligne de commande `prisma/reinitialiser-production.ts` (lot N) : lecture des arguments et décision
 * « simulation / purge réelle ». Aucun accès base ni fichier ici, pour pouvoir la tester.
 *
 * Règle : SANS `--appliquer`, c'est une SIMULATION (aucune écriture, pas même la sauvegarde). La purge réelle exige
 * `--appliquer`, un compte (`--utilisateur`) et la phrase exacte de confirmation (`--confirmation`, ou saisie au clavier).
 */
export interface ArgumentsReinitialisation {
  appliquer: boolean;
  utilisateur: string | null;
  confirmation: string | null;
  dossierSauvegarde: string;
  dossierUploads: string;
}

export const DOSSIER_SAUVEGARDE_PAR_DEFAUT = "sauvegardes-reinitialisation";

function valeurOption(argv: readonly string[], nom: string): string | null {
  const i = argv.indexOf(nom);
  if (i >= 0) return argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
  const avecEgal = argv.find((a) => a.startsWith(`${nom}=`));
  return avecEgal ? avecEgal.slice(nom.length + 1) : null;
}

export function analyserArguments(argv: readonly string[], env: Record<string, string | undefined>, cwd: string): ArgumentsReinitialisation {
  const dossierSauvegarde = valeurOption(argv, "--dossier-sauvegarde") ?? env.REINITIALISATION_DOSSIER_SAUVEGARDE ?? DOSSIER_SAUVEGARDE_PAR_DEFAUT;
  const dossierUploads = valeurOption(argv, "--uploads") ?? env.UPLOADS_DIR ?? "uploads";
  return {
    appliquer: argv.includes("--appliquer"),
    utilisateur: valeurOption(argv, "--utilisateur"),
    confirmation: valeurOption(argv, "--confirmation"),
    dossierSauvegarde: path.resolve(cwd, dossierSauvegarde),
    dossierUploads: path.resolve(cwd, dossierUploads),
  };
}

/** Phrase exacte, casse comprise (jamais « à peu près »). */
export function confirmationValide(saisie: string | null | undefined): boolean {
  return saisie === CONFIRMATION_REINITIALISATION;
}

/** Les problèmes qui empêchent une purge réelle (liste vide = on peut continuer). */
export function problemesAvantPurge(args: ArgumentsReinitialisation, etat: {
  verrouActif: boolean;
  utilisateurTrouve: boolean;
  utilisateurActif: boolean;
  utilisateurAPermission: boolean;
}): string[] {
  const problemes: string[] = [];
  if (etat.verrouActif) problemes.push("Le verrou de réinitialisation est actif : une purge a déjà eu lieu (voir docs/mise-en-production.md, § 10).");
  if (!args.utilisateur) problemes.push("--utilisateur <email> est obligatoire (compte du DG, qui détient systeme.reinitialiser).");
  else if (!etat.utilisateurTrouve) problemes.push(`Compte introuvable : ${args.utilisateur}.`);
  else if (!etat.utilisateurActif) problemes.push(`Le compte ${args.utilisateur} est désactivé.`);
  else if (!etat.utilisateurAPermission) problemes.push(`Le rôle du compte ${args.utilisateur} ne porte pas systeme.reinitialiser (réservée au DG, jamais déléguée).`);
  return problemes;
}
