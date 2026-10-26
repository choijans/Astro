import Link from 'next/link';

export function NotFoundChannel() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-4 py-16 text-center">
      <h1 className="text-lg font-semibold text-text">Channel not found</h1>
      <p className="text-sm text-text-muted">This channel doesn&rsquo;t exist, or the link is incorrect.</p>
      <Link
        href="/"
        className="min-h-11 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-text content-center hover:opacity-90 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
      >
        Back to channels
      </Link>
    </main>
  );
}
