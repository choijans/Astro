'use client';

import { useQuery } from '@tanstack/react-query';
import { getFavourites } from '../lib/api';
import { useUiStore } from '../store/ui-store';

/**
 * The single source of truth for which channels are favourited. Cards, the
 * details page and the Favourites page all derive membership from this one
 * query — never from Zustand.
 */
export function useFavouritesQuery() {
  const userId = useUiStore((s) => s.userId);
  return useQuery({
    queryKey: ['favourites', userId],
    queryFn: getFavourites,
  });
}

export function useIsFavourite(channelId: number): boolean {
  const { data } = useFavouritesQuery();
  return data?.some((channel) => channel.id === channelId) ?? false;
}
