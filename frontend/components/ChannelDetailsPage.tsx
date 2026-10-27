'use client';

import type { ReactNode } from 'react';
import { useChannelQuery } from '../hooks/useChannelQuery';
import { ApiError } from '../lib/api';
import { formatDateTime, formatTimeRange } from '../lib/format-time';
import { getUpcomingSchedule } from '../lib/schedule';
import { BackToChannelsLink } from './BackToChannelsLink';
import { ChannelDetailsSkeleton } from './ChannelDetailsSkeleton';
import { ChannelLogo } from './ChannelLogo';
import { ErrorState } from './ErrorState';
import { FavouriteButton } from './FavouriteButton';
import { NotFoundChannel } from './NotFoundChannel';
import { RefreshButton } from './RefreshButton';

function isValidChannelId(idParam: string): boolean {
  return /^[1-9]\d*$/.test(idParam);
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-text">{children}</span>
  );
}

export function ChannelDetailsPage({ idParam }: { idParam: string }) {
  const channelId = isValidChannelId(idParam) ? Number(idParam) : null;
  const query = useChannelQuery(channelId);

  if (channelId === null) {
    return <NotFoundChannel />;
  }

  if (query.status === 'pending') {
    return <ChannelDetailsSkeleton />;
  }

  if (query.status === 'error') {
    if (query.error instanceof ApiError && query.error.statusCode === 404) {
      return <NotFoundChannel />;
    }
    const message = query.error instanceof ApiError ? query.error.message : 'Could not load this channel.';
    return <ErrorState message={message} onRetry={() => query.refetch()} />;
  }

  const channel = query.data;
  const { entries, nowIndex } = getUpcomingSchedule(channel.schedule, new Date());

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <BackToChannelsLink />

      <div className="relative mt-6 aspect-video w-full overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface-muted">
        <ChannelLogo src={channel.imageUrl} alt={`${channel.title} logo`} sizes="(min-width: 768px) 672px, 100vw" />
      </div>

      <div className="mt-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text">{channel.title}</h1>
          <p className="text-sm text-text-muted">{channel.subtitle}</p>
        </div>
        <FavouriteButton channelId={channel.id} channelTitle={channel.title} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Chip>{channel.category}</Chip>
        {channel.genres.map((genre) => (
          <Chip key={genre}>{genre}</Chip>
        ))}
        {channel.languages.map((language) => (
          <Chip key={language}>{language}</Chip>
        ))}
      </div>

      <p className="mt-3 text-xs text-text-muted">
        Schedule updated: {formatDateTime(channel.scheduleUpdatedAt)}
      </p>

      <RefreshButton channelId={channel.id} />

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-text">Now and next</h2>
        {entries.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted italic">Schedule not available</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {entries.map((entry, index) => {
              const isNow = index === nowIndex;
              return (
                <li
                  key={`${entry.eventStartMyt}-${entry.title}`}
                  className={`rounded-md border p-2 text-sm ${isNow ? 'border-accent bg-accent/10' : 'border-border'}`}
                >
                  <span className={isNow ? 'font-semibold text-accent' : 'text-text'}>{entry.title}</span>
                  <span className="block text-xs text-text-muted">
                    {formatTimeRange(entry.eventStartMyt, entry.eventEndMyt)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
