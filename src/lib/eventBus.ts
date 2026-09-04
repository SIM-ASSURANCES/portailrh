import { EventEmitter } from "node:events";

const DATA_CHANGED_EVENT = "data-changed";

// Même précaution que le singleton Prisma (`src/lib/prisma.ts`) : en dev, le
// hot-reload de Next.js réexécute ce module à chaque changement de fichier.
// Sans le conserver sur `globalThis`, chaque rechargement créerait un nouvel
// `EventEmitter` — les flux SSE déjà ouverts (`src/app/api/events/route.ts`)
// resteraient abonnés à l'ancienne instance, et plus aucune Server Action
// rechargée ensuite ne les atteindrait.
const globalForEventBus = globalThis as unknown as {
  simPortailEventBus: EventEmitter | undefined;
};

const eventBus = globalForEventBus.simPortailEventBus ?? new EventEmitter();
// Un abonné par connexion SSE ouverte (un onglet = un abonné) : pas de
// limite arbitraire (EventEmitter avertit par défaut au-delà de 10).
eventBus.setMaxListeners(0);

if (process.env.NODE_ENV !== "production") {
  globalForEventBus.simPortailEventBus = eventBus;
}

/**
 * Notifie tous les clients connectés (flux SSE, voir
 * `src/app/api/events/route.ts`) qu'une donnée pertinente pour l'affichage a
 * changé quelque part dans l'application — signal générique, ne transporte
 * aucune donnée métier ("quelque chose a changé, redemande la page
 * courante"). Appelée par les Server Actions qui modifient une donnée
 * affichée quelque part (voir CLAUDE.md "Rafraîchissement en temps réel"),
 * en complément de leurs `revalidatePath` existants — jamais à leur place.
 *
 * **Limite documentée** : bus en mémoire du process Node courant, ne
 * fonctionne que pour une seule instance de serveur (le déploiement actuel
 * du portail, voir DEPLOIEMENT.md — un seul conteneur `app`). Si
 * l'application est un jour déployée derrière plusieurs instances (scaling
 * horizontal), un évènement publié sur l'instance A ne notifiera jamais un
 * client connecté à l'instance B — il faudrait alors un bus partagé entre
 * process (ex: Redis pub/sub). Hors périmètre tant qu'une seule instance
 * est prévue.
 */
export function publishDataChanged(): void {
  eventBus.emit(DATA_CHANGED_EVENT);
}

/** S'abonne aux notifications de changement ; retourne la fonction de désabonnement. */
export function subscribeDataChanged(listener: () => void): () => void {
  eventBus.on(DATA_CHANGED_EVENT, listener);
  return () => {
    eventBus.off(DATA_CHANGED_EVENT, listener);
  };
}
