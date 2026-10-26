'use client';

import { useQuery } from '@tanstack/react-query';
import { getChannel } from '../lib/api';

export function useChannelQuery(channelId: number | null) {
  return useQuery({
    queryKey: ['channel', channelId],
    queryFn: () => getChannel(channelId as number),
    enabled: channelId !== null,
  });
}
