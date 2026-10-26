import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-surface">
      <nav className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3" aria-label="Main">
        <Link
          href="/"
          className="min-h-11 content-center text-sm font-medium text-text hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
        >
          Channels
        </Link>
        <Link
          href="/favourites"
          className="min-h-11 content-center text-sm font-medium text-text hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
        >
          Favourites
        </Link>
      </nav>
    </header>
  );
}
