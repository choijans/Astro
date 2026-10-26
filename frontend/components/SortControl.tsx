import { SortField, SortOrder } from '../lib/api';

interface SortControlProps {
  sort: SortField;
  order: SortOrder;
  onChange: (next: { sort: SortField; order: SortOrder }) => void;
}

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'stbNumber', label: 'Channel number' },
  { value: 'title', label: 'Title' },
  { value: 'ranking', label: 'Ranking' },
];

export function SortControl({ sort, order, onChange }: SortControlProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="sort-field" className="text-sm text-text-muted whitespace-nowrap">
        Sort by
      </label>
      <select
        id="sort-field"
        value={sort}
        onChange={(event) => onChange({ sort: event.target.value as SortField, order })}
        className="h-11 rounded-full border border-border bg-surface px-3 text-sm text-text focus-visible:outline-2 focus-visible:outline-accent"
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <label htmlFor="sort-order" className="sr-only">
        Sort order
      </label>
      <select
        id="sort-order"
        value={order}
        onChange={(event) => onChange({ sort, order: event.target.value as SortOrder })}
        className="h-11 rounded-full border border-border bg-surface px-3 text-sm text-text focus-visible:outline-2 focus-visible:outline-accent"
      >
        <option value="asc">Ascending</option>
        <option value="desc">Descending</option>
      </select>
    </div>
  );
}
