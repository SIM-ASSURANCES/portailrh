// SEC-04 : Map en mémoire — entrées nettoyées périodiquement pour éviter
// la fuite mémoire (les entrées expirées ne sont jamais effacées si on se
// contente de les ignorer à l'accès). Taille plafonnée à MAX_ENTRIES pour
// garantir une empreinte mémoire bornée même en cas de pic de trafic.
export const rateLimitCache = new Map<string, { count: number; expiresAt: number }>();

const MAX_ENTRIES = 10_000;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/** Supprime toutes les entrées dont le TTL est expiré. */
function pruneExpiredEntries(): void {
  const now = Date.now();
  for (const [key, record] of rateLimitCache) {
    if (now > record.expiresAt) {
      rateLimitCache.delete(key);
    }
  }
}

// Nettoyage planifié — `unref()` garantit que ce timer ne maintient pas
// le process Node en vie s'il n'y a plus d'autre activité (ex: tests).
const _cleanupTimer = setInterval(pruneExpiredEntries, CLEANUP_INTERVAL_MS);
if (typeof _cleanupTimer.unref === "function") {
  _cleanupTimer.unref();
}

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const record = rateLimitCache.get(key);

  if (!record || now > record.expiresAt) {
    // SEC-04 : Cap pour éviter l'OOM si la Map grossit trop vite
    if (rateLimitCache.size >= MAX_ENTRIES) {
      pruneExpiredEntries();
    }
    rateLimitCache.set(key, { count: 1, expiresAt: now + windowMs });
    return true;
  }

  if (record.count >= limit) {
    return false;
  }

  record.count += 1;
  return true;
}

export function clearRateLimit(key: string) {
  rateLimitCache.delete(key);
}
