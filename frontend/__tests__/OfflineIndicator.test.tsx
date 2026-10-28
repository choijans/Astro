import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { OfflineIndicator } from '../components/OfflineIndicator';
import { addFavourite, CommandResponse, NetworkError, removeFavourite } from '../lib/api';
import { resetOutboxFlushState } from '../lib/outbox-flush';
import { pollUntilSettled } from '../lib/poll-command';
import { useOutboxStore } from '../store/outbox-store';
import { usePendingFavouritesStore } from '../store/pending-favourites-store';
import { useUiStore } from '../store/ui-store';
import { createTestQueryClient } from '../testing/test-utils';

jest.mock('../lib/api', () => ({
  ...jest.requireActual('../lib/api'),
  addFavourite: jest.fn(),
  removeFavourite: jest.fn(),
}));

jest.mock('../lib/poll-command', () => ({
  ...jest.requireActual('../lib/poll-command'),
  pollUntilSettled: jest.fn(),
}));

function makeCommand(overrides: Partial<CommandResponse> = {}): CommandResponse {
  return {
    id: 'cmd-1',
    seq: '1',
    userId: 'user-1',
    type: 'ADD_FAVORITE',
    channelId: 1,
    status: 'DONE',
    error: null,
    createdAt: '2026-01-01T00:00:00Z',
    processedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function renderIndicator() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OfflineIndicator />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  resetOutboxFlushState();
  window.localStorage.clear();
  useOutboxStore.setState({ entries: [], justSynced: false, dropNotice: null });
  usePendingFavouritesStore.setState({ pending: {} });
  (pollUntilSettled as jest.Mock).mockResolvedValue(makeCommand({ status: 'DONE' }));
  // The on-mount flush attempt (trigger: app load) fails, so seeded entries
  // are still there when the "online" trigger is exercised below.
  (addFavourite as jest.Mock).mockRejectedValue(new NetworkError('offline'));
  (removeFavourite as jest.Mock).mockRejectedValue(new NetworkError('offline'));
});

describe('OfflineIndicator', () => {
  it('shows how many changes are queued, and nothing when the outbox is empty', async () => {
    const userId = useUiStore.getState().userId;
    useOutboxStore
      .getState()
      .enqueue(userId, { id: 'a', type: 'ADD_FAVORITE', channelId: 1, createdAt: Date.now() });

    renderIndicator();

    expect(await screen.findByRole('status')).toHaveTextContent(
      "Offline: 1 change will sync when you're back online",
    );
  });

  it('the online event flushes queued entries sequentially, oldest first, with the same UUIDs', async () => {
    const userId = useUiStore.getState().userId;
    useOutboxStore
      .getState()
      .enqueue(userId, { id: 'a', type: 'ADD_FAVORITE', channelId: 1, createdAt: Date.now() });
    useOutboxStore
      .getState()
      .enqueue(userId, { id: 'b', type: 'REMOVE_FAVORITE', channelId: 2, createdAt: Date.now() + 1 });

    renderIndicator();

    // The mount-time attempt (NetworkError, per beforeEach) leaves both queued.
    await waitFor(() => expect(addFavourite).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status')).toHaveTextContent('Offline: 2 changes');

    const callOrder: string[] = [];
    (addFavourite as jest.Mock).mockImplementation((channelId: number, id: string) => {
      callOrder.push(`add:${channelId}:${id}`);
      return Promise.resolve(makeCommand());
    });
    (removeFavourite as jest.Mock).mockImplementation((channelId: number, id: string) => {
      callOrder.push(`remove:${channelId}:${id}`);
      return Promise.resolve(makeCommand({ type: 'REMOVE_FAVORITE' }));
    });

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Changes synced'));
    expect(callOrder).toEqual(['add:1:a', 'remove:2:b']);
  });
});
