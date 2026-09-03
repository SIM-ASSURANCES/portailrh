import { EventEmitter } from "events";

const globalForEvents = globalThis as unknown as {
  pointageEmitter: EventEmitter | undefined;
};

// Singleton pour que l'EventEmitter survive au rechargement à chaud (HMR) en développement
export const pointageEmitter =
  globalForEvents.pointageEmitter ?? new EventEmitter();

// On augmente la limite de listeners par sécurité s'il y a beaucoup de connexions simultanées
pointageEmitter.setMaxListeners(1000);

if (process.env.NODE_ENV !== "production") {
  globalForEvents.pointageEmitter = pointageEmitter;
}
