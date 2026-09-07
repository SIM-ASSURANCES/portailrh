export const rateLimitCache = new Map<string, { count: number; expiresAt: number }>();

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const record = rateLimitCache.get(key);

  if (!record) {
    rateLimitCache.set(key, { count: 1, expiresAt: now + windowMs });
    return true;
  }

  if (now > record.expiresAt) {
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
