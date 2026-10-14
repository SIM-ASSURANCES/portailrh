import { cleVerrouTache, erreurCourte, prisma, type DeclenchementTache, type NomTache, type StatutExecutionTache } from "backend";
import { executerAbsences } from "./absences";
import { executerPurge } from "./purge";
import { executerRelancesJustification } from "./relancesJustification";

export interface ResultatExecution {
  statut: StatutExecutionTache;
  bilan: unknown;
  erreur: string | null;
}

const FONCTIONS: Record<NomTache, () => Promise<unknown>> = {
  RELANCES_JUSTIFICATION: executerRelancesJustification,
  ABSENCES: executerAbsences,
  PURGE: executerPurge,
};

/**
 * SEUL point d'exécution d'une tâche planifiée (planificateur intégré ET routes `/api/cron/*` en déclenchement manuel) :
 * - une seule exécution à la fois, même avec deux instances de l'application — verrou consultatif PostgreSQL
 *   `pg_try_advisory_xact_lock(hashtext('tache:<nom>'))` tenu par une transaction ouverte pendant toute l'exécution (le
 *   travail de la tâche passe par des connexions distinctes de la réserve ; seule cette transaction porte le verrou).
 *   Verrou déjà pris : l'exécution est enregistrée `IGNOREE`, rien n'est lancé ;
 * - une ligne `ExecutionTache` par exécution (réussie, en échec ou ignorée), source du moniteur d'administration ;
 * - ne lève jamais : une erreur devient `ECHEC` avec un texte court sans donnée personnelle.
 * Les tâches restent idempotentes (réservations conditionnelles déjà en place) : le verrou évite le travail en double,
 * il n'est pas la seule protection.
 */
export async function executerTache(tache: NomTache, declenchement: DeclenchementTache): Promise<ResultatExecution> {
  const debut = new Date();
  let resultat: ResultatExecution;
  try {
    resultat = await prisma.$transaction(
      async (tx) => {
        const verrou = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${cleVerrouTache(tache)})) AS ok`;
        if (!verrou[0]?.ok) return { statut: "IGNOREE", bilan: null, erreur: null } satisfies ResultatExecution;
        try {
          return { statut: "SUCCES", bilan: await FONCTIONS[tache](), erreur: null } satisfies ResultatExecution;
        } catch (e) {
          console.error(`[Tâche ${tache}] Échec de l'exécution :`, erreurCourte(e));
          return { statut: "ECHEC", bilan: null, erreur: erreurCourte(e) } satisfies ResultatExecution;
        }
      },
      // Une exécution peut durer plusieurs minutes (envois d'e-mails) : le délai par défaut (5 s) ne convient pas.
      { timeout: 15 * 60 * 1000, maxWait: 10_000 }
    );
  } catch (e) {
    // Base injoignable ou transaction annulée : la ligne d'exécution tentera quand même d'être écrite ci-dessous.
    console.error(`[Tâche ${tache}] Verrou ou transaction en échec :`, erreurCourte(e));
    resultat = { statut: "ECHEC", bilan: null, erreur: erreurCourte(e) };
  }

  try {
    await prisma.executionTache.create({
      data: {
        tache,
        declenchement,
        debut,
        fin: new Date(),
        statut: resultat.statut,
        bilan: resultat.bilan === null || resultat.bilan === undefined ? undefined : (resultat.bilan as object),
        erreur: resultat.erreur,
      },
    });
  } catch (e) {
    console.error(`[Tâche ${tache}] Impossible d'enregistrer l'exécution :`, erreurCourte(e));
  }
  return resultat;
}
