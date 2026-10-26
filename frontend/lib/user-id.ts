const STORAGE_KEY = 'astro-portal:user-id';

// Used when localStorage is unavailable (private mode, blocked, or during
// server rendering), so the app still works, just without persistence.
let memoryFallback: string | null = null;

/**
 * Returns the anonymous user id, creating it once on first call. Never
 * regenerated afterwards: the same id is read back from localStorage (or the
 * in-memory fallback) on every later call. Safe to call during server
 * rendering — it just won't persist there.
 */
export function getOrCreateUserId(): string {
  if (typeof window === 'undefined') {
    return (memoryFallback ??= crypto.randomUUID());
  }

  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) {
      return existing;
    }
    const created = crypto.randomUUID();
    window.localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    return (memoryFallback ??= crypto.randomUUID());
  }
}
