'use client';

import { useEffect } from 'react';
import { useRefreshChannel } from '../hooks/useRefreshChannel';
import { ApiError } from '../lib/api';
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

  // Raw error text (a command's FAILED reason, a non-429 HTTP status, a
  // network failure) never reaches the user — only ever this fixed message,
  // or the fixed 429 one, which is itself not server-sourced text (apiFetch
  // replaces whatever the server sent with its own clear string).
  const message = mutation.isError
    ? mutation.error instanceof PollTimeoutError
      ? 'Still refreshing…'
      : mutation.error instanceof ApiError && mutation.error.statusCode === 429
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
