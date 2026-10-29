import {
  LIBELLE_TACHE,
  TOUTES_LES_TACHES,
  prisma,
  prochaineExecution,
  tacheEnRetard,
  type ExecutionTache,
  type NomTache,
} from "backend";

export interface EtatTache {
  tache: NomTache;
  libelle: string;
  derniere: ExecutionTache | null;
  derniereReussie: Date | null;
  prochaine: Date;
  enRetard: boolean;
  historique: ExecutionTache[];
}

/** État de chaque tâche planifiée pour le moniteur (lit `ExecutionTache`, calculs purs dans `backend/planificateur`). */
export async function chargerMoniteurTaches(now = new Date()): Promise<EtatTache[]> {
  return Promise.all(
    TOUTES_LES_TACHES.map(async (tache) => {
      const [historique, derniereReussie] = await Promise.all([
        prisma.executionTache.findMany({ where: { tache }, orderBy: { debut: "desc" }, take: 50 }),
        prisma.executionTache.findFirst({ where: { tache, statut: "SUCCES" }, orderBy: { debut: "desc" }, select: { debut: true } }),
      ]);
      const derniere = historique[0] ?? null;
      return {
        tache,
        libelle: LIBELLE_TACHE[tache],
        derniere,
        derniereReussie: derniereReussie?.debut ?? null,
        prochaine: prochaineExecution(tache, now, derniere?.debut ?? null),
        enRetard: tacheEnRetard(tache, now, derniereReussie?.debut ?? null),
        historique,
      };
    })
  );
}

/** Résumé de l'accueil `/admin` : erreurs des dernières 24 h et tâches en retard. */
export async function resumeJournalTechnique(now = new Date()): Promise<{ erreurs24h: number; tachesEnRetard: NomTache[] }> {
  const depuis = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [erreurs24h, etats] = await Promise.all([
    prisma.journalTechnique.count({ where: { niveau: "ERREUR", createdAt: { gte: depuis } } }),
    chargerMoniteurTaches(now),
  ]);
  return { erreurs24h, tachesEnRetard: etats.filter((e) => e.enRetard).map((e) => e.tache) };
}

export interface SanteConfiguration {
  smtp: boolean;
  firebaseServeur: boolean;
  firebaseNavigateur: boolean;
  authUrl: boolean;
  planificateur: boolean;
  critiquesSansEmail7j: number;
  pushSansEnvoi7j: number;
}

/**
 * Santé de la configuration : oui/non seulement, JAMAIS une valeur. Les clés `NEXT_PUBLIC_FIREBASE_*` sont lues par accès
 * direct (`process.env.NEXT_PUBLIC_…`) : Next les remplace au build, ce qui reflète bien ce que contient l'image.
 */
export async function chargerSanteConfiguration(fcmServeurDisponible: boolean, now = new Date()): Promise<SanteConfiguration> {
  const depuis = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [critiquesSansEmail7j, pushSansEnvoi7j] = await Promise.all([
    prisma.notification.count({ where: { priority: "CRITIQUE", emailSent: false, createdAt: { gte: depuis } } }),
    prisma.notification.count({ where: { priority: { in: ["IMPORTANT", "CRITIQUE"] }, pushSent: false, createdAt: { gte: depuis } } }),
  ]);
  return {
    smtp: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    firebaseServeur: fcmServeurDisponible,
    firebaseNavigateur: Boolean(
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY &&
        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN &&
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID &&
        process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID &&
        process.env.NEXT_PUBLIC_FIREBASE_APP_ID &&
        process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY
    ),
    authUrl: Boolean(process.env.AUTH_URL),
    planificateur: process.env.PLANIFICATEUR_ACTIF !== "false",
    critiquesSansEmail7j,
    pushSansEnvoi7j,
  };
}
