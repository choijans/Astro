'use client';

import { useEffect, useState } from 'react';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

const DEBOUNCE_MS = 300;

export function SearchBar({ value, onChange }: SearchBarProps) {
  const [draft, setDraft] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  const debounced = useDebouncedValue(draft, DEBOUNCE_MS);

  // Stay in sync if the URL changes from outside this input (e.g. Clear
  // filters). Adjusted during render (React's recommended pattern), not in
  // an effect, since this derives state from a prop rather than
  // synchronizing with an external system.
  if (value !== prevValue) {
    setPrevValue(value);
    setDraft(value);
  }

  useEffect(() => {
    if (debounced !== value) {
      onChange(debounced);
    }
    // Only the debounced value should trigger this; onChange/value intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className="relative w-full sm:max-w-xs">
      <label htmlFor="channel-search" className="sr-only">
        Search channels by title or channel number
      </label>
      <input
        id="channel-search"
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Search by title or channel number"
        className="h-11 w-full rounded-full border border-border bg-surface px-4 pr-10 text-sm text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-accent"
      />
      {draft && (
        <button
          type="button"
          onClick={() => {
            setDraft('');
            onChange('');
          }}
          aria-label="Clear search"
          className="absolute top-1/2 right-1 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-text-muted hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span aria-hidden="true">&times;</span>
        </button>
      )}
    </div>
  );
}
