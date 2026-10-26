'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addFavourite, ChannelListItem, removeFavourite } from '../lib/api';
import { PollTimeoutError, pollUntilSettled } from '../lib/poll-command';
import { usePendingFavouritesStore } from '../store/pending-favourites-store';
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
 * The 202 response is only PENDING, not a finished result, so this does NOT
 * refetch favourites right away: it keeps the optimistic state and polls
 * GET /commands/:id (~500ms, up to ~15s) until the command settles. DONE
 * refetches favourites for real; FAILED (whether from the initial response or
 * from polling) rolls back and surfaces the error, same as any HTTP error.
 * A poll timeout is its own outcome — see PollTimeoutError — and is handled
 * by the pending-favourites overlay (store/pending-favourites-store.ts), not
 * by touching the favourites cache directly.
 */
export function useToggleFavourite(channelId: number, channelTitle: string) {
  const queryClient = useQueryClient();
  const userId = useUiStore((s) => s.userId);
  const queryKey = ['favourites', userId];
  const setPending = usePendingFavouritesStore((s) => s.setPending);
  const markTimedOut = usePendingFavouritesStore((s) => s.markTimedOut);
  const clearPending = usePendingFavouritesStore((s) => s.clearPending);

  return useMutation({
    mutationFn: async (action: FavouriteAction) => {
      const commandId = crypto.randomUUID();
      const command =
        action === 'add' ? await addFavourite(channelId, commandId) : await removeFavourite(channelId, commandId);

      if (command.status === 'DONE') {
        return command;
      }
      if (command.status === 'FAILED') {
        throw new Error(command.error ?? 'The request failed. Please try again.');
      }

      // PENDING (or PROCESSING, if it got there before this first poll): the
      // queue hasn't resolved it yet, so wait for it to.
      try {
        const settled = await pollUntilSettled(command.id);
        if (settled.status === 'FAILED') {
          throw new Error(settled.error ?? 'The request failed. Please try again.');
        }
        return settled;
      } catch (err) {
        if (err instanceof PollTimeoutError) {
          markTimedOut(channelId);
        }
        throw err;
      }
    },

    onMutate: (action) => {
      // Deliberately synchronous — no `await` before the cache write. An
      // earlier version awaited queryClient.cancelQueries() first, which
      // introduced a microtask gap between mutate() and the optimistic
      // setQueryData call; a query observer re-render could land in that gap
      // and briefly read stale data. Cancelling the in-flight initial
      // GET /favourites isn't needed here — the pending overlay keeps the
      // heart right regardless of what any in-flight fetch returns.
      setPending(channelId, action);
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

    onError: (error, _action, context) => {
      if (error instanceof PollTimeoutError) {
        // Unknown outcome, not a failure: keep the optimistic heart and the
        // pending overlay exactly as they are. The overlay itself decides
        // when a later GET /favourites refetch is fresh enough to trust.
        return;
      }
      clearPending(channelId);
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },

    onSuccess: () => {
      clearPending(channelId);
      queryClient.invalidateQueries({ queryKey });
    },
  });
}
