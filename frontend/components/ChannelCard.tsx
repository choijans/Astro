import Link from 'next/link';
import { ChannelListItem } from '../lib/api';
import { formatTime, formatTimeRange } from '../lib/format-time';
import { ChannelLogo } from './ChannelLogo';
import { FavouriteButton } from './FavouriteButton';

interface ChannelCardProps {
  channel: ChannelListItem;
}

export function ChannelCard({ channel }: ChannelCardProps) {
  return (
    <div className="relative flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-sm transition-shadow hover:shadow-md">
      <div className="absolute top-2 right-2 z-10">
        <FavouriteButton channelId={channel.id} channelTitle={channel.title} />
      </div>

      {/* The heart above is a sibling, not nested inside this link — a
          <button> inside an <a> is invalid HTML and confusing for screen
          readers, since they'd be announced as one nested interactive
          control instead of two separate ones. */}
      <Link
        href={`/channels/${channel.id}`}
        className="flex flex-1 flex-col focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
      >
        <div className="relative aspect-square w-full bg-surface-muted">
          <ChannelLogo
            src={channel.imageUrl}
            alt={`${channel.title} logo`}
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
          />
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
      </Link>
    </div>
  );
}
