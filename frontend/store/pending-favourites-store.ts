import { create } from 'zustand';

export type FavouriteIntent = 'add' | 'remove';

interface PendingEntry {
  action: FavouriteIntent;
  /**
   * While actively polling, null: never trust a GET /favourites refetch, the
   * overlay always wins. Once polling times out, set to the timeout moment:
   * a refetch that resolved before giving up might just be the same stale
   * read that made us start polling in the first place, so it's ignored;
   * only a refetch landing after we stopped is treated as fresh enough to
   * reflect what actually happened.
   */
  trustRefetchesAfter: number | null;
}

interface PendingFavouritesState {
  pending: Record<number, PendingEntry>;
  setPending: (channelId: number, action: FavouriteIntent) => void;
  markTimedOut: (channelId: number) => void;
  clearPending: (channelId: number) => void;
  /** Called whenever GET /favourites resolves; drops any entry a fresher-than-timeout fetch now supersedes. */
  reconcile: (dataUpdatedAt: number) => void;
}

export const usePendingFavouritesStore = create<PendingFavouritesState>((set) => ({
  pending: {},

  setPending: (channelId, action) =>
    set((state) => ({
      pending: { ...state.pending, [channelId]: { action, trustRefetchesAfter: null } },
    })),

  markTimedOut: (channelId) =>
    set((state) => {
      const entry = state.pending[channelId];
      if (!entry) return state;
      return {
        pending: { ...state.pending, [channelId]: { ...entry, trustRefetchesAfter: Date.now() } },
      };
    }),

  clearPending: (channelId) =>
    set((state) => {
      if (!(channelId in state.pending)) return state;
      const next = { ...state.pending };
      delete next[channelId];
      return { pending: next };
    }),

  reconcile: (dataUpdatedAt) =>
    set((state) => {
      const next = { ...state.pending };
      let changed = false;
      for (const [channelId, entry] of Object.entries(next)) {
        if (entry.trustRefetchesAfter !== null && dataUpdatedAt >= entry.trustRefetchesAfter) {
          delete next[Number(channelId)];
          changed = true;
        }
      }
      return changed ? { pending: next } : state;
    }),
}));

export function usePendingFavouriteAction(channelId: number): FavouriteIntent | undefined {
  return usePendingFavouritesStore((s) => s.pending[channelId]?.action);
}
