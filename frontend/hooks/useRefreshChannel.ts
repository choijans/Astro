'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createCommand } from '../lib/api';
import { pollUntilSettled } from '../lib/poll-command';

/**
 * No optimistic change here (unlike favourites) — there's nothing to flip
 * ahead of the server, only a schedule to refetch once the command settles.
 * Reuses pollUntilSettled, the same polling logic FavouriteButton uses for
 * ADD_FAVORITE/REMOVE_FAVORITE commands.
 */
export function useRefreshChannel(channelId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const commandId = crypto.randomUUID();
      const command = await createCommand({
        id: commandId,
        type: 'REFRESH_CHANNEL',
        channelId,
      });

      if (command.status === 'DONE') {
        return command;
      }
      if (command.status === 'FAILED') {
        throw new Error(command.error ?? "Couldn't refresh the schedule. Try again.");
      }

      const settled = await pollUntilSettled(command.id);
      if (settled.status === 'FAILED') {
        throw new Error(settled.error ?? "Couldn't refresh the schedule. Try again.");
      }
      return settled;
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channel', channelId] });
      queryClient.invalidateQueries({ queryKey: ['channels'] });
    },
  });
}
