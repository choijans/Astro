import { addFavourite, ApiError, NetworkError, removeFavourite } from './api';
import { PollTimeoutError, pollUntilSettled } from './poll-command';
import { useOutboxStore } from '../store/outbox-store';
import { OutboxEntry } from './outbox';

const INITIAL_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 30000;

/** HTTP statuses the command can never succeed with — resending identically
 * will always fail the same way, so the entry is dropped rather than retried. */
const UNRECOVERABLE_STATUSES = new Set([400, 404, 409]);

export interface FlushContext {
  userId: string;
  markTimedOut: (channelId: number) => void;
  clearPending: (channelId: number) => void;
  invalidateFavourites: () => void;
}

let backoffMs = INITIAL_BACKOFF_MS;
let flushing = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function nextBackoff(): number {
  const delay = backoffMs;
  backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  return delay;
}

function resetBackoff(): void {
  backoffMs = INITIAL_BACKOFF_MS;
}

/** Test-only: resets the module-level backoff/single-flight/timer state so
 * one test's outcome can't leak into the next. */
export function resetOutboxFlushState(): void {
  backoffMs = INITIAL_BACKOFF_MS;
  flushing = false;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function sendCommand(entry: OutboxEntry) {
  return entry.type === 'ADD_FAVORITE'
    ? addFavourite(entry.channelId, entry.id)
    : removeFavourite(entry.channelId, entry.id);
}

type SendOutcome = { stop: false } | { stop: true; delayMs: number };

/** Sends one outbox entry and decides what happens next. Only ever removes
 * the entry from the outbox once the server has actually acknowledged it
 * (a successful resend, or one of the "can never succeed" statuses) —
 * NetworkError, 429 and 5xx all leave it exactly where it was. */
async function sendOne(entry: OutboxEntry, ctx: FlushContext): Promise<SendOutcome> {
  try {
    await sendCommand(entry);
  } catch (err) {
    if (err instanceof NetworkError) {
      return { stop: true, delayMs: nextBackoff() };
    }
    if (err instanceof ApiError) {
      if (UNRECOVERABLE_STATUSES.has(err.statusCode)) {
        useOutboxStore.getState().dequeue(ctx.userId, entry.id);
        ctx.clearPending(entry.channelId);
        ctx.invalidateFavourites();
        useOutboxStore
          .getState()
          .setDropNotice("Couldn't sync one of your changes, so it was removed.");
        return { stop: false };
      }
      if (err.statusCode === 429) {
        const delayMs = err.retryAfterSeconds
          ? err.retryAfterSeconds * 1000
          : nextBackoff();
        return { stop: true, delayMs };
      }
      // 5xx, or any other unlisted status: keep it and back off.
      return { stop: true, delayMs: nextBackoff() };
    }
    throw err;
  }

  // The server accepted the command (202) — it now exists server-side
  // regardless of what status its body reported, so the outbox's job is
  // done; the normal status poll takes over from here (reusing
  // pollUntilSettled also means a command the server already knew about,
  // e.g. a resend of one that quietly succeeded the first time, settles
  // immediately on its first check instead of needing special-casing here).
  useOutboxStore.getState().dequeue(ctx.userId, entry.id);
  resetBackoff();

  try {
    await pollUntilSettled(entry.id);
  } catch (err) {
    if (err instanceof PollTimeoutError) {
      // Unknown outcome, not a failure: leave the pending overlay as-is —
      // the next GET /favourites to land fresh enough will reconcile it,
      // same as the interactive toggle's own timeout handling.
      ctx.markTimedOut(entry.channelId);
      return { stop: false };
    }
    throw err;
  }

  ctx.clearPending(entry.channelId);
  ctx.invalidateFavourites();
  return { stop: false };
}

function scheduleRetry(ctx: FlushContext, delayMs: number): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void runFlush(ctx);
  }, delayMs);
}

/**
 * Drains the outbox one entry at a time, oldest first, waiting for each to
 * resolve before sending the next. Single-flight: a call while one is
 * already running is a no-op — the in-flight run already reads the outbox
 * fresh on every iteration, so it naturally covers anything added meanwhile.
 */
export async function runFlush(ctx: FlushContext): Promise<void> {
  if (flushing) return;
  flushing = true;
  let processedAny = false;

  try {
    for (;;) {
      const [next] = useOutboxStore.getState().entries;
      if (!next) break;
      processedAny = true;

      const outcome = await sendOne(next, ctx);
      if (outcome.stop) {
        scheduleRetry(ctx, outcome.delayMs);
        return;
      }
    }

    resetBackoff();
    if (processedAny) {
      useOutboxStore.getState().notifySynced();
    }
  } finally {
    flushing = false;
  }
}
