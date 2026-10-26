'use client';

import Link from 'next/link';
import { useFavouritesQuery } from '../hooks/useFavouritesQuery';
import { ApiError } from '../lib/api';
import { ChannelCard } from './ChannelCard';
import { ChannelCardSkeleton } from './ChannelCardSkeleton';
import { ChannelGrid } from './ChannelGrid';
import { ErrorState } from './ErrorState';

const SKELETON_COUNT = 4;

export function FavouritesPage() {
  const query = useFavouritesQuery();

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
      <h1 className="text-xl font-semibold text-text">Favourites</h1>

      {query.status === 'pending' && (
        <ChannelGrid>
          {Array.from({ length: SKELETON_COUNT }).map((_, index) => (
            <ChannelCardSkeleton key={index} />
          ))}
        </ChannelGrid>
      )}

      {query.status === 'error' && (
        <ErrorState
          message={query.error instanceof ApiError ? query.error.message : 'Could not load your favourites.'}
          onRetry={() => query.refetch()}
        />
      )}

      {query.status === 'success' && query.data.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-text">No favourites yet</p>
          <Link
            href="/"
            className="min-h-11 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-text content-center hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
          >
            Browse channels
          </Link>
        </div>
      )}

      {query.status === 'success' && query.data.length > 0 && (
        <ChannelGrid>
          {query.data.map((channel) => (
            <ChannelCard key={channel.id} channel={channel} />
          ))}
        </ChannelGrid>
      )}
    </main>
  );
}
