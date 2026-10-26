interface FiltersButtonProps {
  activeCount: number;
  onClick: () => void;
}

export function FiltersButton({ activeCount, onClick }: FiltersButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 min-w-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
    >
      Filters
      {activeCount > 0 && (
        <span
          className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-xs font-semibold text-accent-text"
          aria-label={`${activeCount} active filters`}
        >
          {activeCount}
        </span>
      )}
    </button>
  );
}
