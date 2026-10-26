'use client';

import { useCallback, useMemo } from 'react';
import { ChannelCard } from './ChannelCard';
import { ChannelCardSkeleton } from './ChannelCardSkeleton';
import { ChannelGrid } from './ChannelGrid';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { FilterChips } from './FilterChips';
import { FilterDialog, FilterSelections } from './FilterDialog';
import { FiltersButton } from './FiltersButton';
import { SearchBar } from './SearchBar';
import { SortControl } from './SortControl';
import { useChannelUrlState } from '../hooks/useChannelUrlState';
import { useChannelsQuery } from '../hooks/useChannelsQuery';
import { useInfiniteScrollSentinel } from '../hooks/useInfiniteScrollSentinel';
import { ApiError } from '../lib/api';
import { useUiStore } from '../store/ui-store';

const SKELETON_COUNT = 8;

export function ChannelsPage() {
  const { state, setState } = useChannelUrlState();
  const isFilterDialogOpen = useUiStore((s) => s.isFilterDialogOpen);
  const openFilterDialog = useUiStore((s) => s.openFilterDialog);
  const closeFilterDialog = useUiStore((s) => s.closeFilterDialog);

  const filters = useMemo(
    () => ({
      q: state.q || undefined,
      sort: state.sort,
      order: state.order,
      category: state.category || undefined,
      language: state.language || undefined,
      genre: state.genre || undefined,
    }),
    [state],
  );

  const { data, status, error, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    useChannelsQuery(filters);

  const sentinelRef = useInfiniteScrollSentinel({
    hasNextPage: Boolean(hasNextPage),
    isFetchingNextPage,
    onLoadMore: fetchNextPage,
  });

  const channels = useMemo(() => data?.pages.flatMap((page) => page.data) ?? [], [data]);
  const total = data?.pages[0]?.total ?? 0;

  const currentFilterSelections: FilterSelections = useMemo(
    () => ({ category: state.category, language: state.language, genre: state.genre }),
    [state.category, state.language, state.genre],
  );
  const activeFilterCount = (['category', 'language', 'genre'] as const).filter(
    (key) => currentFilterSelections[key],
  ).length;

  const handleClearFilters = useCallback(() => {
    setState({ q: '', category: '', language: '', genre: '' });
  }, [setState]);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
      <h1 className="text-xl font-semibold text-text">Astro Channel Management Portal</h1>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchBar value={state.q} onChange={(q) => setState({ q })} />
        <div className="flex flex-wrap items-center gap-2">
          <SortControl sort={state.sort} order={state.order} onChange={setState} />
          <FiltersButton activeCount={activeFilterCount} onClick={openFilterDialog} />
        </div>
      </div>

      <FilterChips
        filters={currentFilterSelections}
        onRemove={(key) => setState({ [key]: '' })}
        total={total}
      />

      {status === 'pending' && (
        <ChannelGrid>
          {Array.from({ length: SKELETON_COUNT }).map((_, index) => (
            <ChannelCardSkeleton key={index} />
          ))}
        </ChannelGrid>
      )}

      {status === 'error' && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load channels.'}
          onRetry={() => refetch()}
        />
      )}

      {status === 'success' && channels.length === 0 && <EmptyState onClearFilters={handleClearFilters} />}

      {status === 'success' && channels.length > 0 && (
        <>
          <ChannelGrid>
            {channels.map((channel) => (
              <ChannelCard key={channel.id} channel={channel} />
            ))}
          </ChannelGrid>

          <div ref={sentinelRef} className="flex justify-center py-6">
            {isFetchingNextPage && (
              <span className="text-sm text-text-muted" role="status">
                Loading more&hellip;
              </span>
            )}
            {!hasNextPage && !isFetchingNextPage && (
              <span className="text-sm text-text-muted">You&rsquo;ve reached the end</span>
            )}
          </div>
        </>
      )}

      <FilterDialog
        open={isFilterDialogOpen}
        current={currentFilterSelections}
        onClose={closeFilterDialog}
        onApply={(next) => setState(next)}
      />
    </main>
  );
}
