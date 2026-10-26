import { FilterSelections } from './FilterDialog';

interface FilterChipsProps {
  filters: FilterSelections;
  onRemove: (key: keyof FilterSelections) => void;
  total: number;
}

const LABELS: Record<keyof FilterSelections, string> = {
  category: 'Category',
  language: 'Language',
  genre: 'Genre',
};

export function FilterChips({ filters, onRemove, total }: FilterChipsProps) {
  const activeKeys = (Object.keys(filters) as (keyof FilterSelections)[]).filter((key) => filters[key]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {activeKeys.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onRemove(key)}
          className="flex min-h-11 items-center gap-1.5 rounded-full border border-accent bg-accent/10 px-3 text-sm text-text focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span>
            {LABELS[key]}: {filters[key]}
          </span>
          <span aria-hidden="true">&times;</span>
          <span className="sr-only">Remove {LABELS[key]} filter</span>
        </button>
      ))}
      <span className="text-sm text-text-muted">{total} channels</span>
    </div>
  );
}
