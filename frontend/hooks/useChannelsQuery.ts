'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { getChannels, GetChannelsParams } from '../lib/api';

const PAGE_SIZE = 24;

export type ChannelListFilters = Omit<GetChannelsParams, 'page' | 'limit'>;

/**
 * Filters are the query key, so changing search/sort/filter is a brand new
 * query — infinite scroll always restarts at page 1, never carrying over the
 * previous filter's pages.
 */
export function useChannelsQuery(filters: ChannelListFilters) {
  return useInfiniteQuery({
    queryKey: ['channels', filters],
    queryFn: ({ pageParam }) => getChannels({ ...filters, page: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasNextPage ? lastPage.page + 1 : undefined),
  });
}
