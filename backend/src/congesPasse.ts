// Pas de congé dans le passé (art. 12 du règlement : « autorisation préalable »). Fonction PURE, sans dépendance Node ni
// Prisma : importée par le serveur (`preparerConge`) ET par le formulaire (`backend/client`), pour que les deux disent la
// même phrase. Exception côté serveur : le congé d'office (RH, régularisation). La force majeure (justificatif fourni après
// coup) reste hors périmètre, en attente de la RH.

// Type seul (effacé à la compilation) : ce fichier n'importe rien d'exécutable, il reste sûr pour le navigateur.
import type { JourCivil } from "./congesCalcul";

export const MESSAGE_CONGE_DANS_LE_PASSE =
  "La date de début ne peut pas être dans le passé : un congé exige une autorisation préalable (art. 12 du règlement).";

/** Le message du refus si `dateDebut` est antérieure à `aujourdhui`, sinon `null`. */
export function refusDateDebutPassee(dateDebut: JourCivil, aujourdhui: JourCivil): string | null {
  // Jours civils « AAAA-MM-JJ » : l'ordre alphabétique est l'ordre chronologique.
  return dateDebut < aujourdhui ? MESSAGE_CONGE_DANS_LE_PASSE : null;
}
