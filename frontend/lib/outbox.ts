export type OutboxCommandType = 'ADD_FAVORITE' | 'REMOVE_FAVORITE';

export interface OutboxEntry {
  /** The command's client-generated UUID — resending reuses this exact id,
   * so the server's idempotency rule (same id, same command) applies. */
  id: string;
  type: OutboxCommandType;
  channelId: number;
  /** Epoch ms, used only for the 24h expiry check. Insertion order (the
   * array's own order) is what determines send order, not this field. */
  createdAt: number;
}

const STORAGE_VERSION = 'v1';
const MAX_ENTRIES = 100;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function storageKey(userId: string): string {
  return `astro-portal:outbox:${STORAGE_VERSION}:${userId}`;
}

// Used when localStorage is unavailable (private mode, blocked, or during
// server rendering) — keyed by the same storage key, so different users'
// (or the same user's pre- and post-recovery) entries don't collide.
const memoryFallback = new Map<string, OutboxEntry[]>();

// Once a key has hit a localStorage error (quota, private mode, blocked
// storage), it stays on the memory fallback for the rest of the session —
// without this, a write that fails but a read that still happens to succeed
// (reading back the old, unchanged localStorage value) would silently lose
// the written entry instead of seeing it in memory.
const memoryOnlyKeys = new Set<string>();

function readRaw(userId: string): OutboxEntry[] {
  const key = storageKey(userId);
  if (typeof window === 'undefined' || memoryOnlyKeys.has(key)) {
    return memoryFallback.get(key) ?? [];
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : [];
  } catch {
    memoryOnlyKeys.add(key);
    return memoryFallback.get(key) ?? [];
  }
}

function writeRaw(userId: string, entries: OutboxEntry[]): void {
  const key = storageKey(userId);
  if (typeof window === 'undefined' || memoryOnlyKeys.has(key)) {
    memoryFallback.set(key, entries);
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(entries));
  } catch {
    memoryOnlyKeys.add(key);
    memoryFallback.set(key, entries);
  }
}

function isExpired(entry: OutboxEntry, now: number): boolean {
  return now - entry.createdAt > MAX_AGE_MS;
}

/** Reads the outbox in send order (oldest first), dropping anything older
 * than 24h and persisting that pruned result back. */
export function getOutbox(userId: string): OutboxEntry[] {
  const now = Date.now();
  const all = readRaw(userId);
  const pruned = all.filter((entry) => !isExpired(entry, now));
  if (pruned.length !== all.length) {
    writeRaw(userId, pruned);
  }
  return pruned;
}

/** Appends an entry, capping at MAX_ENTRIES by dropping the oldest. */
export function addToOutbox(userId: string, entry: OutboxEntry): void {
  let entries = [...getOutbox(userId), entry];
  if (entries.length > MAX_ENTRIES) {
    console.warn(
      `Offline outbox exceeded ${MAX_ENTRIES} entries; dropping the oldest to make room.`,
    );
    entries = entries.slice(entries.length - MAX_ENTRIES);
  }
  writeRaw(userId, entries);
}

export function removeFromOutbox(userId: string, id: string): void {
  writeRaw(
    userId,
    getOutbox(userId).filter((entry) => entry.id !== id),
  );
}
