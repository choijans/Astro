export function ChannelDetailsSkeleton() {
  return (
    <main className="mx-auto max-w-3xl animate-pulse px-4 py-6" aria-hidden="true">
      <div className="h-5 w-32 rounded bg-surface-muted" />
      <div className="mt-6 aspect-video w-full rounded-[var(--radius-card)] bg-surface-muted" />
      <div className="mt-4 h-6 w-1/2 rounded bg-surface-muted" />
      <div className="mt-2 h-4 w-1/4 rounded bg-surface-muted" />
      <div className="mt-6 h-4 w-full rounded bg-surface-muted" />
      <div className="mt-2 h-4 w-5/6 rounded bg-surface-muted" />
    </main>
  );
}
