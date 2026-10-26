'use client';

import { MouseEvent, useEffect } from 'react';
import { useIsFavourite } from '../hooks/useFavouritesQuery';
import { useToggleFavourite } from '../hooks/useToggleFavourite';
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
          {mutation.error instanceof Error ? mutation.error.message : 'Something went wrong.'}
        </p>
      )}
    </span>
  );
}
