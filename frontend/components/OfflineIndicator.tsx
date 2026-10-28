'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { runFlush } from '../lib/outbox-flush';
import { useOutboxStore } from '../store/outbox-store';
import { usePendingFavouritesStore } from '../store/pending-favourites-store';
import { useUiStore } from '../store/ui-store';

const SYNCED_MESSAGE_MS = 3000;
const DROP_NOTICE_MS = 4000;

/**
 * No visible markup of its own beyond the status text — this is also where
 * the outbox's flush triggers are wired (app load, the `online` event, the
 * tab becoming visible, and the flush engine's own backoff retry timer).
 * Deliberately does NOT use `navigator.onLine` to decide anything: it's
 * unreliable, so it's only ever a trigger to try a flush, never a condition.
 */
export function OfflineIndicator() {
  const queryClient = useQueryClient();
  const userId = useUiStore((s) => s.userId);
  const entries = useOutboxStore((s) => s.entries);
  const justSynced = useOutboxStore((s) => s.justSynced);
  const dropNotice = useOutboxStore((s) => s.dropNotice);
  const hydrate = useOutboxStore((s) => s.hydrate);
  const clearSyncedNotice = useOutboxStore((s) => s.clearSyncedNotice);
  const clearDropNotice = useOutboxStore((s) => s.clearDropNotice);
  const setPending = usePendingFavouritesStore((s) => s.setPending);

  useEffect(() => {
    hydrate(userId);
    // Rebuilds the pending overlay from whatever survived a reload, so a
    // queued heart still shows its desired state immediately.
    for (const entry of useOutboxStore.getState().entries) {
      setPending(entry.channelId, entry.type === 'ADD_FAVORITE' ? 'add' : 'remove');
    }

    const ctx = {
      userId,
      markTimedOut: usePendingFavouritesStore.getState().markTimedOut,
      clearPending: usePendingFavouritesStore.getState().clearPending,
      invalidateFavourites: () =>
        queryClient.invalidateQueries({ queryKey: ['favourites', userId] }),
    };

    void runFlush(ctx); // trigger: app load

    function handleOnline() {
      void runFlush(ctx);
    }
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        void runFlush(ctx);
      }
    }

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (!justSynced) return;
    const timer = setTimeout(clearSyncedNotice, SYNCED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [justSynced, clearSyncedNotice]);

  useEffect(() => {
    if (!dropNotice) return;
    const timer = setTimeout(clearDropNotice, DROP_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [dropNotice, clearDropNotice]);

  if (entries.length === 0 && !justSynced && !dropNotice) {
    return null;
  }

  return (
    <p role="status" aria-live="polite" className="text-xs text-text-muted">
      {dropNotice
        ? dropNotice
        : entries.length > 0
          ? `Offline: ${entries.length} change${entries.length === 1 ? '' : 's'} will sync when you're back online`
          : 'Changes synced'}
    </p>
  );
}
