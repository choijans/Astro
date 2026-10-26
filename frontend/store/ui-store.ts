import { create } from 'zustand';
import { getOrCreateUserId } from '../lib/user-id';

interface UiState {
  isFilterDialogOpen: boolean;
  openFilterDialog: () => void;
  closeFilterDialog: () => void;
  userId: string;
}

/**
 * Zustand holds ONLY UI-only state and the anonymous user id — never
 * search/sort/filter, which live in the URL (see hooks/use-channel-filters.ts).
 */
export const useUiStore = create<UiState>((set) => ({
  isFilterDialogOpen: false,
  openFilterDialog: () => set({ isFilterDialogOpen: true }),
  closeFilterDialog: () => set({ isFilterDialogOpen: false }),
  userId: getOrCreateUserId(),
}));
