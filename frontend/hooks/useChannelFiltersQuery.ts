'use client';

import { useQuery } from '@tanstack/react-query';
import { getChannelFilters } from '../lib/api';

export function useChannelFiltersQuery() {
  return useQuery({
    queryKey: ['channel-filters'],
    queryFn: getChannelFilters,
    staleTime: Infinity,
  });
}
