'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo } from 'react';
import { SortField, SortOrder } from '../lib/api';

/** Read by BackToChannelsLink, so "back" lands on this exact list URL rather
 * than relying on browser history (which may leave the app entirely if the
 * details page was opened from an external referrer). */
export const LAST_CHANNELS_URL_KEY = 'astro:lastChannelsUrl';

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

  useEffect(() => {
    const queryString = searchParams.toString();
    const url = queryString ? `${pathname}?${queryString}` : pathname;
    try {
      sessionStorage.setItem(LAST_CHANNELS_URL_KEY, url);
    } catch {
      // Private browsing / storage disabled — BackToChannelsLink just falls
      // back to "/" in that case.
    }
  }, [pathname, searchParams]);

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
