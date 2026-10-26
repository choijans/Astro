'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { SortField, SortOrder } from '../lib/api';

export interface ChannelUrlState {
  q: string;
  sort: SortField;
  order: SortOrder;
  category: string;
  language: string;
  genre: string;
}

const DEFAULTS: ChannelUrlState = {
  q: '',
  sort: 'stbNumber',
  order: 'asc',
  category: '',
  language: '',
  genre: '',
};

const SORT_FIELDS: SortField[] = ['stbNumber', 'title', 'ranking'];
const SORT_ORDERS: SortOrder[] = ['asc', 'desc'];

function readSort(value: string | null): SortField {
  return SORT_FIELDS.includes(value as SortField) ? (value as SortField) : DEFAULTS.sort;
}

function readOrder(value: string | null): SortOrder {
  return SORT_ORDERS.includes(value as SortOrder) ? (value as SortOrder) : DEFAULTS.order;
}

/**
 * The URL query string is the single source of truth for search/sort/filter —
 * this hook is the only place that reads or writes it. Nothing here is
 * duplicated into Zustand or component state.
 */
export function useChannelUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state: ChannelUrlState = useMemo(
    () => ({
      q: searchParams.get('q') ?? DEFAULTS.q,
      sort: readSort(searchParams.get('sort')),
      order: readOrder(searchParams.get('order')),
      category: searchParams.get('category') ?? DEFAULTS.category,
      language: searchParams.get('language') ?? DEFAULTS.language,
      genre: searchParams.get('genre') ?? DEFAULTS.genre,
    }),
    [searchParams],
  );

  const setState = useCallback(
    (patch: Partial<ChannelUrlState>) => {
      const merged = { ...state, ...patch };
      const next = new URLSearchParams();
      for (const [key, value] of Object.entries(merged)) {
        if (value && value !== DEFAULTS[key as keyof ChannelUrlState]) {
          next.set(key, value);
        }
      }
      const queryString = next.toString();
      router.push(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    },
    [state, pathname, router],
  );

  return { state, setState };
}
