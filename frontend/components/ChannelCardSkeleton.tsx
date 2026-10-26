export function ChannelCardSkeleton() {
  return (
    <div
      className="flex animate-pulse flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface"
      aria-hidden="true"
      data-testid="channel-card-skeleton"
    >
      <div className="aspect-square w-full bg-surface-muted" />
      <div className="flex flex-col gap-2 p-3">
        <div className="h-4 w-3/4 rounded bg-surface-muted" />
        <div className="h-3 w-1/3 rounded bg-surface-muted" />
        <div className="mt-2 h-3 w-full rounded bg-surface-muted" />
        <div className="h-3 w-2/3 rounded bg-surface-muted" />
      </div>
    </div>
  );
}
