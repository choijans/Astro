'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getFavourites } from '../lib/api';
import { usePendingFavouriteAction, usePendingFavouritesStore } from '../store/pending-favourites-store';
import { useUiStore } from '../store/ui-store';

/**
 * The single source of truth for which channels are favourited. Cards, the
 * details page and the Favourites page all derive membership from this one
 * query — never from Zustand (the pending-favourites overlay is the one
 * deliberate exception, and only while a toggle is still in flight or just
 * timed out — see useIsFavourite).
 */
export function useFavouritesQuery() {
  const userId = useUiStore((s) => s.userId);
  const reconcile = usePendingFavouritesStore((s) => s.reconcile);
  const query = useQuery({
    queryKey: ['favourites', userId],
    queryFn: getFavourites,
  });

  // Drops any pending overlay entry a fresh-enough refetch now supersedes —
  // see the store's `reconcile` for what "fresh enough" means.
  useEffect(() => {
    if (query.dataUpdatedAt) {
      reconcile(query.dataUpdatedAt);
    }
  }, [query.dataUpdatedAt, reconcile]);

  return query;
}

export function useIsFavourite(channelId: number): boolean {
  const pendingAction = usePendingFavouriteAction(channelId);
  const { data } = useFavouritesQuery();
  if (pendingAction) {
    return pendingAction === 'add';
  }
  return data?.some((channel) => channel.id === channelId) ?? false;
}
