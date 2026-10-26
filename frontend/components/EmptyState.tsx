interface EmptyStateProps {
  onClearFilters: () => void;
}

export function EmptyState({ onClearFilters }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <p className="text-text">No channels found</p>
      <button
        type="button"
        onClick={onClearFilters}
        className="min-h-11 min-w-11 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-text hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
      >
        Clear filters
      </button>
    </div>
  );
}
