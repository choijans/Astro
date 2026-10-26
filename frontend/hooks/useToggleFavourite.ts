'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addFavourite, ChannelListItem, removeFavourite } from '../lib/api';
import { useUiStore } from '../store/ui-store';

export type FavouriteAction = 'add' | 'remove';

function placeholderFavourite(id: number, title: string): ChannelListItem {
  return {
    id,
    title,
    subtitle: '',
    stbNumber: 0,
    imageUrl: '',
    category: '',
    genres: [],
    languages: [],
    rangeKey: '',
    ranking: 0,
    scheduleUpdatedAt: '',
    createdAt: '',
    updatedAt: '',
    now: null,
    next: null,
  };
}

/**
 * Optimistic add/remove against the shared `['favourites', userId]` cache —
 * the same cache useFavouritesQuery reads, so every consumer (cards, the
 * details page, the Favourites page) sees the update immediately.
 *
 * Rolls back on any HTTP error AND on a 202 response whose command settles as
 * FAILED (both funnel into the mutation's error state). Always refetches on
 * settle so the cache matches the server once the command has actually run.
 */
export function useToggleFavourite(channelId: number, channelTitle: string) {
  const queryClient = useQueryClient();
  const userId = useUiStore((s) => s.userId);
  const queryKey = ['favourites', userId];

  return useMutation({
    mutationFn: async (action: FavouriteAction) => {
      const commandId = crypto.randomUUID();
      const command =
        action === 'add' ? await addFavourite(channelId, commandId) : await removeFavourite(channelId, commandId);

      if (command.status === 'FAILED') {
        throw new Error(command.error ?? 'The request failed. Please try again.');
      }
      return command;
    },

    onMutate: (action) => {
      // Deliberately synchronous — no `await` before the cache write. An
      // earlier version awaited queryClient.cancelQueries() first, which
      // introduced a microtask gap between mutate() and the optimistic
      // setQueryData call; a query observer re-render could land in that gap
      // and briefly read stale data. Cancelling the in-flight initial
      // GET /favourites isn't needed here — invalidateQueries in onSettled
      // reconciles the cache regardless.
      const previous = queryClient.getQueryData<ChannelListItem[]>(queryKey);

      queryClient.setQueryData<ChannelListItem[]>(queryKey, (old = []) => {
        if (action === 'remove') {
          return old.filter((channel) => channel.id !== channelId);
        }
        if (old.some((channel) => channel.id === channelId)) {
          return old;
        }
        return [placeholderFavourite(channelId, channelTitle), ...old];
      });

      return { previous };
    },

    onError: (_error, _action, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
}
