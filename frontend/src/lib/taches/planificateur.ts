import { cloturerEnAttenteInitiale, prisma, TOUTES_LES_TACHES, erreurCourte, tachesDues, type DernieresExecutions, type NomTache } from "backend";
import { journaliserIncident } from "@/lib/journalTechnique";
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

/** Vrai une fois la clôture initiale faite (ou inutile) par ce processus : plus aucune vérification ensuite. */
let clotureInitialeTraitee = false;

/**
 * Premier passage en PRODUCTION seulement (décision du 2026-10-14) : clôture sans aucun envoi les justifications et absences
 * en attente d'avant le jour courant (`cloturerEnAttenteInitiale`, marqueur unique en base). Doit précéder TOUTE tâche :
 * en cas d'échec, le passage s'arrête (les relances n'envoient rien sur l'arriéré) et le suivant réessaie.
 */
async function assurerClotureInitiale(): Promise<boolean> {
  if (clotureInitialeTraitee) return true;
  if (process.env.NODE_ENV !== "production") {
    clotureInitialeTraitee = true;
    return true;
  }
  try {
    await cloturerEnAttenteInitiale(prisma);
    clotureInitialeTraitee = true;
    return true;
  } catch (e) {
    console.error("[Planificateur] Clôture initiale en échec :", erreurCourte(e));
    await journaliserIncident({
      niveau: "ERREUR",
      source: "TACHE",
      code: "TACHE_ECHEC",
      message: `La clôture initiale a échoué : ${erreurCourte(e)}`,
      contexte: { tache: "CLOTURE_INITIALE" },
    });
    return false;
  }
}

async function passage(): Promise<void> {
  try {
    if (!(await assurerClotureInitiale())) return;
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
