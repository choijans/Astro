'use client';

import Image from 'next/image';
import { useState } from 'react';
import { ChannelListItem } from '../lib/api';
import { formatTime, formatTimeRange } from '../lib/format-time';

interface ChannelCardProps {
  channel: ChannelListItem;
}

function LogoFallback() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-10 w-10 text-text-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M8 19h8M12 15v4" />
    </svg>
  );
}

export function ChannelCard({ channel }: ChannelCardProps) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <article className="relative flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-sm transition-shadow hover:shadow-md">
      {/* Reserved for the Task 8 favourite button — same spot, same size. */}
      <div className="absolute top-2 right-2 z-10 h-11 w-11" aria-hidden="true" />

      <div className="relative aspect-square w-full bg-surface-muted">
        {imageFailed ? (
          <div className="flex h-full w-full items-center justify-center">
            <LogoFallback />
          </div>
        ) : (
          <Image
            src={channel.imageUrl}
            alt={`${channel.title} logo`}
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
            className="object-contain p-3"
            onError={() => setImageFailed(true)}
          />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-sm font-medium text-text" title={channel.title}>
          {channel.title}
        </h3>
        <p className="text-xs text-text-muted">{channel.subtitle}</p>

        {channel.now || channel.next ? (
          <div className="mt-2 space-y-1 text-xs">
            {channel.now && (
              <p>
                <span className="text-text-muted">Now: </span>
                <span className="font-semibold text-accent">{channel.now.title}</span>
                <span className="block text-text-muted">
                  {formatTimeRange(channel.now.start, channel.now.end)}
                </span>
              </p>
            )}
            {channel.next && (
              <p className="text-text-muted">
                <span>Next: </span>
                <span>
                  {formatTime(channel.next.start)} &middot; {channel.next.title}
                </span>
              </p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-text-muted italic">Schedule not available</p>
        )}
      </div>
    </article>
  );
}
