'use client';

import { useEffect, useRef, useState } from 'react';
import { useChannelFiltersQuery } from '../hooks/useChannelFiltersQuery';

export interface FilterSelections {
  category: string;
  language: string;
  genre: string;
}

interface FilterDialogProps {
  open: boolean;
  current: FilterSelections;
  onClose: () => void;
  onApply: (next: FilterSelections) => void;
}

const EMPTY_SELECTIONS: FilterSelections = { category: '', language: '', genre: '' };

interface FilterGroupProps {
  label: string;
  options: string[];
  selected: string;
  onSelect: (value: string) => void;
  defaultOpen?: boolean;
}

function FilterGroup({ label, options, selected, onSelect, defaultOpen }: FilterGroupProps) {
  return (
    <details className="border-b border-border py-1" open={defaultOpen}>
      <summary className="cursor-pointer py-2 text-sm font-medium text-text select-none">{label}</summary>
      <div className="flex flex-wrap gap-2 pt-1 pb-3">
        {options.map((option) => {
          const isSelected = selected === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onSelect(isSelected ? '' : option)}
              aria-pressed={isSelected}
              className={`min-h-11 rounded-full border px-3 text-sm focus-visible:outline-2 focus-visible:outline-accent ${
                isSelected
                  ? 'border-accent bg-accent text-accent-text'
                  : 'border-border bg-surface text-text hover:bg-surface-muted'
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </details>
  );
}

/**
 * Native <dialog> with showModal(): the browser traps focus and Escape closes
 * it for free. Selections are staged locally; only Apply writes to the URL.
 */
export function FilterDialog({ open, current, onClose, onApply }: FilterDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { data } = useChannelFiltersQuery();
  const [staged, setStaged] = useState<FilterSelections>(current);
  const [prevOpen, setPrevOpen] = useState(open);

  // Reset the staged selections whenever the dialog freshly opens. Adjusted
  // during render, not in an effect, since this derives state from a prop.
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setStaged(current);
    }
  }

  // This effect only synchronizes the imperative <dialog> element with the
  // `open` prop — a legitimate external-system effect.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => onClose();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  function handleApply() {
    onApply(staged);
    dialogRef.current?.close();
  }

  function handleReset() {
    setStaged(EMPTY_SELECTIONS);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label="Filters"
      className="m-0 h-full w-full max-w-none rounded-none border-0 bg-surface p-0 text-text shadow-lg backdrop:bg-black/40 sm:m-auto sm:h-auto sm:max-h-[85vh] sm:w-[560px] sm:max-w-[560px] sm:rounded-[var(--radius-card)]"
    >
      <div className="flex h-full flex-col sm:max-h-[85vh]">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="text-base font-semibold">Filters</h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="Close filters"
            className="flex h-11 w-11 items-center justify-center rounded-full text-text hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <FilterGroup
            label="Category"
            options={data?.categories ?? []}
            selected={staged.category}
            onSelect={(value) => setStaged((s) => ({ ...s, category: value }))}
            defaultOpen
          />
          <FilterGroup
            label="Language"
            options={data?.languages ?? []}
            selected={staged.language}
            onSelect={(value) => setStaged((s) => ({ ...s, language: value }))}
          />
          <FilterGroup
            label="Genre"
            options={data?.genres ?? []}
            selected={staged.genre}
            onSelect={(value) => setStaged((s) => ({ ...s, genre: value }))}
          />
        </div>

        <div className="flex items-center justify-between border-t border-border p-4">
          <button
            type="button"
            onClick={handleReset}
            className="min-h-11 rounded-full border border-border px-4 text-sm font-medium text-text hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="min-h-11 rounded-full bg-accent px-4 text-sm font-semibold text-accent-text hover:opacity-90 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          >
            Apply
          </button>
        </div>
      </div>
    </dialog>
  );
}
