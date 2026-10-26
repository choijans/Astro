'use client';

import { useRouter } from 'next/navigation';
import { LAST_CHANNELS_URL_KEY } from '../hooks/useChannelUrlState';

/**
 * Navigates to the list's own last-seen URL (search/sort/filters included),
 * captured by useChannelUrlState in sessionStorage, rather than using
 * router.back(). history.length alone can't tell whether the previous entry
 * is even inside this app — if the details page was opened from an external
 * link, window.history.length is still > 1, so router.back() would leave the
 * app entirely instead of going to the channel list. Falls back to a plain
 * "/" (no filters) when nothing was recorded, e.g. the details page was
 * opened directly or in a new tab. Scroll position is not restored either
 * way.
 */
export function BackToChannelsLink() {
  const router = useRouter();

  function handleClick() {
    let lastChannelsUrl: string | null = null;
    try {
      lastChannelsUrl = sessionStorage.getItem(LAST_CHANNELS_URL_KEY);
    } catch {
      // Private browsing / storage disabled — fall back to "/" below.
    }
    router.push(lastChannelsUrl ?? '/');
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex min-h-11 items-center text-sm font-medium text-text hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
    >
      &larr; Back to channels
    </button>
  );
}
