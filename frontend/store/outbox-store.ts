import { create } from 'zustand';
import { addToOutbox, getOutbox, OutboxEntry, removeFromOutbox } from '../lib/outbox';

interface OutboxState {
  entries: OutboxEntry[];
  /** True briefly right after the outbox drains, to show "Changes synced". */
  justSynced: boolean;
  /** A one-line message for a dropped (never-can-succeed) resend, or null. */
  dropNotice: string | null;
  hydrate: (userId: string) => void;
  enqueue: (userId: string, entry: OutboxEntry) => void;
  dequeue: (userId: string, id: string) => void;
  notifySynced: () => void;
  clearSyncedNotice: () => void;
  setDropNotice: (message: string) => void;
  clearDropNotice: () => void;
}

/**
 * The reactive mirror of lib/outbox.ts's persisted queue — components read
 * `entries` to render the offline indicator; the flush engine
 * (lib/outbox-flush.ts) and useToggleFavourite call enqueue/dequeue so the
 * UI updates immediately alongside the localStorage write.
 */
export const useOutboxStore = create<OutboxState>((set) => ({
  entries: [],
  justSynced: false,
  dropNotice: null,

  hydrate: (userId) => set({ entries: getOutbox(userId) }),

  enqueue: (userId, entry) => {
    addToOutbox(userId, entry);
    set({ entries: getOutbox(userId) });
  },

  dequeue: (userId, id) => {
    removeFromOutbox(userId, id);
    set({ entries: getOutbox(userId) });
  },

  notifySynced: () => set({ justSynced: true }),
  clearSyncedNotice: () => set({ justSynced: false }),
  setDropNotice: (message) => set({ dropNotice: message }),
  clearDropNotice: () => set({ dropNotice: null }),
}));
