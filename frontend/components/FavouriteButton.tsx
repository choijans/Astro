'use client';

import { MouseEvent, useEffect } from 'react';
import { useIsFavourite } from '../hooks/useFavouritesQuery';
import { useToggleFavourite } from '../hooks/useToggleFavourite';
import { ApiError } from '../lib/api';
import { PollTimeoutError } from '../lib/poll-command';
import { HeartIcon } from './HeartIcon';

interface FavouriteButtonProps {
  channelId: number;
  channelTitle: string;
}

export function FavouriteButton({ channelId, channelTitle }: FavouriteButtonProps) {
  const isFavourite = useIsFavourite(channelId);
  const mutation = useToggleFavourite(channelId, channelTitle);

  // The failure message is non-blocking: it clears itself.
  useEffect(() => {
    if (!mutation.isError) return;
    const timer = setTimeout(() => mutation.reset(), 4000);
    return () => clearTimeout(timer);
  }, [mutation.isError, mutation]);

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    // Must not navigate — the button normally sits inside the card's link.
    event.preventDefault();
    event.stopPropagation();
    if (mutation.isPending) return;
    mutation.mutate(isFavourite ? 'remove' : 'add');
  }

  const actionLabel = isFavourite ? 'Remove' : 'Add';
  const preposition = isFavourite ? 'from' : 'to';

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={handleClick}
        disabled={mutation.isPending}
        aria-pressed={isFavourite}
        aria-label={`${actionLabel} ${channelTitle} ${preposition} favourites`}
        className="flex h-11 w-11 items-center justify-center rounded-full bg-surface/90 text-accent shadow-sm hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 disabled:opacity-60"
      >
        <HeartIcon filled={isFavourite} />
      </button>
      {mutation.isError && (
        <p
          role="status"
          className="absolute top-full right-0 z-20 mt-1 w-max max-w-[180px] rounded-md bg-text px-2 py-1 text-xs text-surface shadow-md"
        >
          {/* Raw error text (a command's FAILED reason, a non-429 HTTP
              status, a network failure) never reaches the user — only ever
              this fixed message, or the fixed 429 one. */}
          {mutation.error instanceof PollTimeoutError
            ? 'Still syncing…'
            : mutation.error instanceof ApiError && mutation.error.statusCode === 429
              ? mutation.error.message
              : 'The request failed. Please try again.'}
        </p>
      )}
    </span>
  );
}
