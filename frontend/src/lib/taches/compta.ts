/**
 * Gestion Compta, lot GC-1e (W9) : les trois tâches planifiées du module, enregistrées VIDES.
 *
 * Elles existent dès maintenant pour que le registre, le moniteur d'administration (`/admin/journal-technique`) et le
 * verrou par tâche soient en place avant que le module n'ait des données. Chacune sera remplie par son lot :
 *  - `COMPTA_CONTROLE_HEBDO` (lundi 07:30) : listes de contrôle encaissements / contrats — lot GC-9 ;
 *  - `COMPTA_RELANCES` (lundi à vendredi 08:00) : relance à 7 jours, alerte à 30, escalade à 60 — lots GC-6 / GC-7 ;
 *  - `COMPTA_RAPPEL_TCA` (les 10 et 17 de chaque mois) : rappel de déclarer et payer la taxe avant le 20 — lot GC-8.
 *
 * RÈGLE POUR CELUI QUI REMPLIRA CES FONCTIONS : une tâche jamais exécutée est « due » dès le premier passage du
 * planificateur (voir `tachesDues`). Avant tout envoi, vérifier que le module est mis en service (`CptMiseEnService`) et
 * ne traiter que ce qui relève de la période courante — sinon le premier passage notifierait tout l'arriéré.
 */

/** Bilan d'une tâche encore vide : `enAttenteDuModule` fait afficher « Aucun traitement pour l'instant » dans le moniteur. */
export interface BilanTacheComptaVide {
  traites: number;
  erreurs: number;
  enAttenteDuModule: true;
}

async function tacheVide(): Promise<BilanTacheComptaVide> {
  return { traites: 0, erreurs: 0, enAttenteDuModule: true };
}

export const executerComptaControleHebdo = tacheVide;
export const executerComptaRelances = tacheVide;
export const executerComptaRappelTca = tacheVide;
