import { prisma, TOUTES_LES_TACHES, erreurCourte, tachesDues, type DernieresExecutions, type NomTache } from "backend";
import { executerTache } from "./executer";

/** Un passage par minute ; `tachesDues` (pure) décide ce qui est dû. */
const PERIODE_MS = 60_000;
/** Premier passage peu après le démarrage : rattrape une exécution manquée pendant que le serveur était arrêté. */
const PREMIER_PASSAGE_MS = 15_000;

const CLE_MINUTERIE = Symbol.for("sim-portail.planificateur.minuterie");
const enCours = new Set<NomTache>();

async function lireDernieresExecutions(): Promise<DernieresExecutions> {
  const lignes = await prisma.executionTache.groupBy({ by: ["tache"], _max: { debut: true } });
  const dernieres: DernieresExecutions = {};
  for (const t of TOUTES_LES_TACHES) dernieres[t] = null;
  for (const l of lignes) dernieres[l.tache] = l._max.debut;
  return dernieres;
}

async function passage(): Promise<void> {
  try {
    const dues = tachesDues(new Date(), await lireDernieresExecutions());
    for (const tache of dues) {
      // Une tâche encore en cours dans ce processus (envois lents) n'est pas relancée par le passage suivant.
      if (enCours.has(tache)) continue;
      enCours.add(tache);
      void executerTache(tache, "PLANIFICATEUR")
        .catch((e) => console.error(`[Planificateur] ${tache} :`, erreurCourte(e)))
        .finally(() => enCours.delete(tache));
    }
  } catch (e) {
    // Jamais d'exception hors de la minuterie : base indisponible, table absente avant migration, etc.
    console.error("[Planificateur] Passage en échec :", erreurCourte(e));
  }
}

/**
 * Démarre le planificateur intégré (appelé par `instrumentation.ts`, runtime Node uniquement). Désactivable par
 * `PLANIFICATEUR_ACTIF=false`. Une seule minuterie par processus : la garde sur `globalThis` évite d'en empiler une à
 * chaque rechargement à chaud en développement.
 */
export function demarrerPlanificateur(): void {
  if (process.env.PLANIFICATEUR_ACTIF === "false") {
    console.info("[Planificateur] Désactivé (PLANIFICATEUR_ACTIF=false).");
    return;
  }
  const g = globalThis as unknown as Record<symbol, NodeJS.Timeout | undefined>;
  if (g[CLE_MINUTERIE]) return;
  g[CLE_MINUTERIE] = setInterval(() => void passage(), PERIODE_MS);
  g[CLE_MINUTERIE]?.unref?.();
  setTimeout(() => void passage(), PREMIER_PASSAGE_MS).unref?.();
  console.info("[Planificateur] Démarré (relances toutes les 5 min ; absences lun-ven 17:30 et 20:00 ; purge 03:00).");
}
