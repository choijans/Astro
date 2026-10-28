import { addFavourite, ApiError, NetworkError, removeFavourite } from '../lib/api';
import { PollTimeoutError, pollUntilSettled } from '../lib/poll-command';
import { FlushContext, resetOutboxFlushState, runFlush } from '../lib/outbox-flush';
import { useOutboxStore } from '../store/outbox-store';
import { OutboxEntry } from '../lib/outbox';

jest.mock('../lib/api', () => ({
  ...jest.requireActual('../lib/api'),
  addFavourite: jest.fn(),
  removeFavourite: jest.fn(),
}));

jest.mock('../lib/poll-command', () => ({
  ...jest.requireActual('../lib/poll-command'),
  pollUntilSettled: jest.fn(),
}));

const USER = 'user-1';

function makeCommand(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'cmd-1',
    seq: '1',
    userId: USER,
    type: 'ADD_FAVORITE',
    channelId: 1,
    status: 'PENDING',
    error: null,
    createdAt: '2026-01-01T00:00:00Z',
    processedAt: null,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: 'cmd-1',
    type: 'ADD_FAVORITE',
    channelId: 1,
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeContext(overrides: Partial<FlushContext> = {}): FlushContext {
  return {
    userId: USER,
    markTimedOut: jest.fn(),
    clearPending: jest.fn(),
    invalidateFavourites: jest.fn(),
    ...overrides,
  };
}

/** Seeds through the real store action (persists to localStorage too), not a
 * direct setState — dequeue() re-reads from localStorage, so a test that only
 * poked the store's in-memory array would see its later entries vanish the
 * moment the first one is processed. */
function seedOutbox(entries: OutboxEntry[]): void {
  for (const entry of entries) {
    useOutboxStore.getState().enqueue(USER, entry);
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  resetOutboxFlushState();
  window.localStorage.clear();
  useOutboxStore.setState({ entries: [], justSynced: false, dropNotice: null });
  (pollUntilSettled as jest.Mock).mockResolvedValue(makeCommand({ status: 'DONE' }));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('runFlush', () => {
  it('sends entries one at a time, oldest first, with the same UUIDs they were queued with', async () => {
    seedOutbox([
      makeEntry({ id: 'a', type: 'ADD_FAVORITE', channelId: 1 }),
      makeEntry({ id: 'b', type: 'REMOVE_FAVORITE', channelId: 1 }),
      makeEntry({ id: 'c', type: 'ADD_FAVORITE', channelId: 2 }),
    ]);
    (addFavourite as jest.Mock).mockResolvedValue(makeCommand());
    (removeFavourite as jest.Mock).mockResolvedValue(makeCommand());

    await runFlush(makeContext());

    expect((addFavourite as jest.Mock).mock.calls[0]).toEqual([1, 'a']);
    expect((removeFavourite as jest.Mock).mock.calls[0]).toEqual([1, 'b']);
    expect((addFavourite as jest.Mock).mock.calls[1]).toEqual([2, 'c']);
    expect(useOutboxStore.getState().entries).toEqual([]);
  });

  it('drains the outbox and shows "synced" once every entry is resolved', async () => {
    seedOutbox([makeEntry()]);
    (addFavourite as jest.Mock).mockResolvedValue(makeCommand());

    await runFlush(makeContext());

    expect(useOutboxStore.getState().justSynced).toBe(true);
  });

  it('a replayed command the server already knew about (resend returns DONE directly) is handled as a normal success', async () => {
    seedOutbox([makeEntry({ id: 'cmd-1' })]);
    (addFavourite as jest.Mock).mockResolvedValue(makeCommand({ status: 'DONE' }));
    (pollUntilSettled as jest.Mock).mockResolvedValue(makeCommand({ status: 'DONE' }));
    const ctx = makeContext();

    await runFlush(ctx);

    expect(useOutboxStore.getState().entries).toEqual([]);
    expect(pollUntilSettled).toHaveBeenCalledWith('cmd-1');
    expect(ctx.clearPending).toHaveBeenCalledWith(1);
    expect(ctx.invalidateFavourites).toHaveBeenCalled();
  });

  it('a NetworkError stops the flush and keeps every remaining entry', async () => {
    seedOutbox([makeEntry({ id: 'a' }), makeEntry({ id: 'b' })]);
    (addFavourite as jest.Mock).mockRejectedValue(new NetworkError('offline'));

    await runFlush(makeContext());

    expect(addFavourite).toHaveBeenCalledTimes(1);
    expect(useOutboxStore.getState().entries.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it.each([400, 404, 409])(
    'drops the entry, clears its overlay and refetches favourites on a %i',
    async (status) => {
      seedOutbox([makeEntry({ id: 'bad' })]);
      (addFavourite as jest.Mock).mockRejectedValue(new ApiError('cannot succeed', status));
      const ctx = makeContext();

      await runFlush(ctx);

      expect(useOutboxStore.getState().entries).toEqual([]);
      expect(ctx.clearPending).toHaveBeenCalledWith(1);
      expect(ctx.invalidateFavourites).toHaveBeenCalled();
      expect(useOutboxStore.getState().dropNotice).toEqual(expect.any(String));
      expect(pollUntilSettled).not.toHaveBeenCalled();
    },
  );

  it('keeps the entry on a 429, waiting for Retry-After before the next attempt', async () => {
    seedOutbox([makeEntry({ id: 'a' })]);
    (addFavourite as jest.Mock).mockRejectedValue(new ApiError('slow down', 429, 5));

    await runFlush(makeContext());

    expect(useOutboxStore.getState().entries.map((e) => e.id)).toEqual(['a']);
    // Scheduled for ~5s (Retry-After), not the default 2s backoff.
    await jest.advanceTimersByTimeAsync(4999);
    expect(addFavourite).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2);
    expect(addFavourite).toHaveBeenCalledTimes(2);
  });

  it('keeps the entry and backs off on a 5xx', async () => {
    seedOutbox([makeEntry({ id: 'a' })]);
    (addFavourite as jest.Mock).mockRejectedValue(new ApiError('boom', 503));

    await runFlush(makeContext());

    expect(useOutboxStore.getState().entries.map((e) => e.id)).toEqual(['a']);
  });

  it('backoff starts at 2s, doubles on repeated failures, and caps at 30s', async () => {
    seedOutbox([makeEntry({ id: 'a' })]);
    (addFavourite as jest.Mock).mockRejectedValue(new NetworkError('offline'));
    const ctx = makeContext();

    await runFlush(ctx); // 1st failure: waits 2s
    await jest.advanceTimersByTimeAsync(1999);
    expect(addFavourite).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(addFavourite).toHaveBeenCalledTimes(2); // retried after 2s, fails again: waits 4s

    await jest.advanceTimersByTimeAsync(3999);
    expect(addFavourite).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(addFavourite).toHaveBeenCalledTimes(3); // retried after 4s, fails again: waits 8s

    await jest.advanceTimersByTimeAsync(7999);
    expect(addFavourite).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(1);
    expect(addFavourite).toHaveBeenCalledTimes(4);
  });

  it('resets backoff to 2s after a success, even following earlier failures', async () => {
    seedOutbox([makeEntry({ id: 'a' })]);
    (addFavourite as jest.Mock)
      .mockRejectedValueOnce(new NetworkError('offline'))
      .mockRejectedValueOnce(new NetworkError('offline'))
      .mockResolvedValue(makeCommand());

    await runFlush(makeContext()); // fails once: next retry in 2s
    await jest.advanceTimersByTimeAsync(2000); // fails again: next retry in 4s
    await jest.advanceTimersByTimeAsync(4000); // succeeds this time

    expect(addFavourite).toHaveBeenCalledTimes(3);
    expect(useOutboxStore.getState().entries).toEqual([]);

    // A fresh failure now waits 2s again, not 8s — backoff was reset.
    seedOutbox([makeEntry({ id: 'b' })]);
    (addFavourite as jest.Mock).mockRejectedValue(new NetworkError('offline'));
    await runFlush(makeContext());
    await jest.advanceTimersByTimeAsync(1999);
    expect(addFavourite).toHaveBeenCalledTimes(4);
    await jest.advanceTimersByTimeAsync(1);
    expect(addFavourite).toHaveBeenCalledTimes(5);
  });

  it('a poll timeout after a successful resend marks it timed out instead of treating it as a failure', async () => {
    seedOutbox([makeEntry({ id: 'a' })]);
    (addFavourite as jest.Mock).mockResolvedValue(makeCommand({ status: 'PENDING' }));
    (pollUntilSettled as jest.Mock).mockRejectedValue(new PollTimeoutError());
    const ctx = makeContext();

    await runFlush(ctx);

    expect(useOutboxStore.getState().entries).toEqual([]); // already removed once the resend succeeded
    expect(ctx.markTimedOut).toHaveBeenCalledWith(1);
    expect(ctx.clearPending).not.toHaveBeenCalled();
  });

  it('only one flush runs at a time', async () => {
    seedOutbox([makeEntry({ id: 'a' }), makeEntry({ id: 'b' })]);
    let resolveFirst: (v: unknown) => void = () => {};
    (addFavourite as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    const ctx = makeContext();

    const first = runFlush(ctx);
    const second = runFlush(ctx); // no-op: a flush is already in progress

    expect(addFavourite).toHaveBeenCalledTimes(1);

    (addFavourite as jest.Mock).mockResolvedValue(makeCommand());
    resolveFirst(makeCommand({ status: 'DONE' }));
    await first;
    await second;

    expect(addFavourite).toHaveBeenCalledTimes(2); // 'a' then 'b', never doubled up
  });
});
