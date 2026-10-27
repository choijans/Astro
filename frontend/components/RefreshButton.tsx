'use client';

import { useEffect } from 'react';
import { useRefreshChannel } from '../hooks/useRefreshChannel';
import { PollTimeoutError } from '../lib/poll-command';

interface RefreshButtonProps {
  channelId: number;
}

export function RefreshButton({ channelId }: RefreshButtonProps) {
  const mutation = useRefreshChannel(channelId);

  // Non-blocking message clears itself, same pattern as FavouriteButton.
  useEffect(() => {
    if (!mutation.isError) return;
    const timer = setTimeout(() => mutation.reset(), 4000);
    return () => clearTimeout(timer);
  }, [mutation.isError, mutation]);

  function handleClick() {
    if (mutation.isPending) return;
    mutation.mutate();
  }

  const message = mutation.isError
    ? mutation.error instanceof PollTimeoutError
      ? 'Still refreshing…'
      : mutation.error instanceof Error
        ? mutation.error.message
        : "Couldn't refresh the schedule. Try again."
    : null;

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={handleClick}
        disabled={mutation.isPending}
        aria-busy={mutation.isPending}
        className="h-11 rounded-full border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
      >
        {mutation.isPending ? 'Refreshing…' : 'Refresh'}
      </button>
      {message && (
        <p role="status" className="mt-1 text-xs text-text-muted">
          {message}
        </p>
      )}
    </div>
  );
}
