import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FavouriteButton } from '../components/FavouriteButton';
import {
  addFavourite,
  ApiError,
  ChannelListItem,
  CommandResponse,
  getFavourites,
  NetworkError,
  removeFavourite,
} from '../lib/api';
import { getOutbox } from '../lib/outbox';
import { PollTimeoutError, pollUntilSettled } from '../lib/poll-command';
import { useOutboxStore } from '../store/outbox-store';
import { usePendingFavouritesStore } from '../store/pending-favourites-store';
import { useUiStore } from '../store/ui-store';
import { renderWithQueryClient } from '../testing/test-utils';

jest.mock('../lib/api', () => ({
  ...jest.requireActual('../lib/api'),
  getFavourites: jest.fn(),
  addFavourite: jest.fn(),
  removeFavourite: jest.fn(),
}));

// The timing/retry behavior of pollUntilSettled has its own dedicated unit
// test (lib/poll-command.test.ts, with fake timers). Here it's mocked
// outright so these component tests can drive each outcome (DONE, FAILED,
// timeout) directly and instantly, without waiting out real poll intervals.
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

function makeFavourite(overrides: Partial<ChannelListItem> = {}): ChannelListItem {
  return {
    id: 1,
    title: 'Astro30',
    subtitle: 'CH 30',
    stbNumber: 30,
    imageUrl: 'https://divign0fdw3sv.cloudfront.net/logo.png',
    category: 'News',
    genres: ['news'],
    languages: ['others'],
    rangeKey: '0_199',
    ranking: 1,
    scheduleUpdatedAt: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    now: null,
    next: null,
    ...overrides,
  };
}

// The real GET /favourites reflects a write as soon as the synchronous
// command resolves, so the mock must behave the same way: it reads from
// this mutable array rather than a value frozen at mock-setup time.
// Without this, onSettled's invalidateQueries refetch would overwrite the
// optimistic cache update with a stale `[]` before any assertion runs.
let favouritesState: ChannelListItem[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  favouritesState = [];
  (getFavourites as jest.Mock).mockImplementation(() => Promise.resolve(favouritesState));
  usePendingFavouritesStore.setState({ pending: {} });
  window.localStorage.clear();
  useOutboxStore.setState({ entries: [], justSynced: false, dropNotice: null });
});

describe('FavouriteButton', () => {
  it('flips immediately (optimistic) and calls POST /favourites with a UUID X-Command-Id', async () => {
    (addFavourite as jest.Mock).mockImplementation(async () => {
      favouritesState = [...favouritesState, makeFavourite()];
      return makeCommand();
    });
    const user = userEvent.setup();
    renderWithQueryClient(<FavouriteButton channelId={1} channelTitle="Astro30" />);

    const button = await screen.findByRole('button', { name: 'Add Astro30 to favourites' });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await user.click(button);

    // Flips optimistically — it ends up flipped well before the mocked
    // network call would ever resolve for real; findByRole/waitFor is used
    // instead of a synchronous assertion since React may commit this update
    // on a later microtask than the one `await user.click()` itself flushes.
    expect(
      await screen.findByRole('button', { name: 'Remove Astro30 from favourites' }),
    ).toHaveAttribute('aria-pressed', 'true');

    expect(addFavourite).toHaveBeenCalledTimes(1);
    const [calledChannelId, commandId] = (addFavourite as jest.Mock).mock.calls[0];
    expect(calledChannelId).toBe(1);
    expect(commandId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('sends a different X-Command-Id on every click', async () => {
    (addFavourite as jest.Mock).mockImplementation(async () => {
      favouritesState = [...favouritesState, makeFavourite()];
      return makeCommand();
    });
    (removeFavourite as jest.Mock).mockImplementation(async () => {
      favouritesState = favouritesState.filter((channel) => channel.id !== 1);
      return makeCommand({ type: 'REMOVE_FAVORITE' });
    });
    const user = userEvent.setup();
    renderWithQueryClient(<FavouriteButton channelId={1} channelTitle="Astro30" />);

    await user.click(await screen.findByRole('button', { name: 'Add Astro30 to favourites' }));
    await waitFor(() => expect(addFavourite).toHaveBeenCalledTimes(1));

    await user.click(await screen.findByRole('button', { name: 'Remove Astro30 from favourites' }));
    await waitFor(() => expect(removeFavourite).toHaveBeenCalledTimes(1));

    const addCommandId = (addFavourite as jest.Mock).mock.calls[0][1];
    const removeCommandId = (removeFavourite as jest.Mock).mock.calls[0][1];
    expect(addCommandId).not.toBe(removeCommandId);
  });

  it('rolls back and shows the friendly message (not the raw server text) on an HTTP error', async () => {
    (addFavourite as jest.Mock).mockRejectedValue(new ApiError('Internal server error', 500));
    const user = userEvent.setup();
    renderWithQueryClient(<FavouriteButton channelId={1} channelTitle="Astro30" />);

    await user.click(await screen.findByRole('button', { name: 'Add Astro30 to favourites' }));

    // The optimistic flip and the rollback both happen within this one click
    // (the mock rejects immediately), so only the settled end state — rolled
    // back to "Add" — is reliably observable here; the transient flip itself
    // is covered by the success-path test above and the in-flight test below.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add Astro30 to favourites' })).toBeInTheDocument(),
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('The request failed. Please try again.');
    expect(status).not.toHaveTextContent('Internal server error');
    expect(getOutbox(useUiStore.getState().userId)).toEqual([]);
  });

  it('a NetworkError does not roll back: it queues the command (same UUID) in the outbox and keeps the heart flipped, with no error message', async () => {
    (addFavourite as jest.Mock).mockRejectedValue(new NetworkError('offline'));
    const user = userEvent.setup();
    renderWithQueryClient(<FavouriteButton channelId={1} channelTitle="Astro30" />);

    await user.click(await screen.findByRole('button', { name: 'Add Astro30 to favourites' }));

    expect(
      await screen.findByRole('button', { name: 'Remove Astro30 from favourites' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    const [, sentCommandId] = (addFavourite as jest.Mock).mock.calls[0];
    const outbox = getOutbox(useUiStore.getState().userId);
    expect(outbox).toEqual([
      { id: sentCommandId, type: 'ADD_FAVORITE', channelId: 1, createdAt: expect.any(Number) },
    ]);
  });

  it('rolls back and shows the rate-limit message when the toggle is rejected with a 429', async () => {
    (addFavourite as jest.Mock).mockRejectedValue(
      new ApiError('Too many requests. Please wait a moment and try again.', 429, 30),
    );
    const user = userEvent.setup();
    renderWithQueryClient(<FavouriteButton channelId={1} channelTitle="Astro30" />);

    await user.click(await screen.findByRole('button', { name: 'Add Astro30 to favourites' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add Astro30 to favourites' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Too many requests. Please wait a moment and try again.',
    );
  });

  it('rolls back and shows the friendly message (not the raw FAILED reason) when the command settles as FAILED, even though the HTTP call itself succeeded', async () => {
    (addFavourite as jest.Mock).mockResolvedValue(
      makeCommand({ status: 'FAILED', error: 'Channel does not exist' }),
    );
    const user = userEvent.setup();
    renderWithQueryClient(<FavouriteButton channelId={1} channelTitle="Astro30" />);

    await user.click(await screen.findByRole('button', { name: 'Add Astro30 to favourites' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add Astro30 to favourites' })).toBeInTheDocument(),
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('The request failed. Please try again.');
    expect(status).not.toHaveTextContent('Channel does not exist');
  });

  it('ignores further clicks on the same channel while a mutation is in flight', async () => {
    let resolveAdd: (command: CommandResponse) => void = () => {};
    (addFavourite as jest.Mock).mockReturnValue(
      new Promise<CommandResponse>((resolve) => {
        resolveAdd = resolve;
      }),
    );
    const user = userEvent.setup();
    renderWithQueryClient(<FavouriteButton channelId={1} channelTitle="Astro30" />);

    const button = await screen.findByRole('button', { name: 'Add Astro30 to favourites' });
    await user.click(button);
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('button'));

    expect(addFavourite).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAdd(makeCommand());
    });
  });

  it('is keyboard operable and exposes aria-pressed', async () => {
    (addFavourite as jest.Mock).mockImplementation(async () => {
      favouritesState = [...favouritesState, makeFavourite()];
      return makeCommand();
    });
    const user = userEvent.setup();
    renderWithQueryClient(<FavouriteButton channelId={1} channelTitle="Astro30" />);

    const button = await screen.findByRole('button', { name: 'Add Astro30 to favourites' });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await user.tab(); // moves focus to the only focusable element: the button
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(addFavourite).toHaveBeenCalledTimes(1));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Remove Astro30 from favourites' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
  });

  it('a PENDING response keeps the optimistic heart flipped while polling, then settles DONE and refetches favourites', async () => {
    (addFavourite as jest.Mock).mockResolvedValue(makeCommand({ status: 'PENDING' }));
    (pollUntilSettled as jest.Mock).mockImplementation(async () => {
      favouritesState = [...favouritesState, makeFavourite()];
      return makeCommand({ status: 'DONE' });
    });
    const user = userEvent.setup();
    renderWithQueryClient(<FavouriteButton channelId={1} channelTitle="Astro30" />);

    await user.click(await screen.findByRole('button', { name: 'Add Astro30 to favourites' }));

    expect(
      await screen.findByRole('button', { name: 'Remove Astro30 from favourites' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(pollUntilSettled).toHaveBeenCalledWith('cmd-1');

    // Still flipped once favourites is refetched for real.
    await waitFor(() => expect(getFavourites).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Remove Astro30 from favourites' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('a PENDING response stays flipped through an intermediate favourites refetch that still returns stale (pre-mutation) data', async () => {
    (addFavourite as jest.Mock).mockResolvedValue(makeCommand({ status: 'PENDING' }));
    let resolvePoll: (command: CommandResponse) => void = () => {};
    (pollUntilSettled as jest.Mock).mockReturnValue(
      new Promise<CommandResponse>((resolve) => {
        resolvePoll = resolve;
      }),
    );
    const user = userEvent.setup();
    const { queryClient } = renderWithQueryClient(<FavouriteButton channelId={1} channelTitle="Astro30" />);

    await user.click(await screen.findByRole('button', { name: 'Add Astro30 to favourites' }));
    await screen.findByRole('button', { name: 'Remove Astro30 from favourites' });

    // Some unrelated trigger (e.g. window focus) refetches favourites while
    // the command is still mid-poll. favouritesState is still `[]` (the
    // server hasn't applied the mutation yet), so this is a stale read — the
    // heart must not revert because of it.
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['favourites'] });
    });
    expect(getFavourites).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Remove Astro30 from favourites' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await act(async () => {
      resolvePoll(makeCommand({ status: 'DONE' }));
    });
  });

  it('rolls back and shows the friendly message (not the raw FAILED reason) after polling resolves the command as FAILED', async () => {
    (addFavourite as jest.Mock).mockResolvedValue(makeCommand({ status: 'PENDING' }));
    (pollUntilSettled as jest.Mock).mockResolvedValue(
      makeCommand({ status: 'FAILED', error: 'Channel does not exist' }),
    );
    const user = userEvent.setup();
    renderWithQueryClient(<FavouriteButton channelId={1} channelTitle="Astro30" />);

    await user.click(await screen.findByRole('button', { name: 'Add Astro30 to favourites' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add Astro30 to favourites' })).toBeInTheDocument(),
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('The request failed. Please try again.');
    expect(status).not.toHaveTextContent('Channel does not exist');
  });

  it('a poll timeout keeps the heart flipped and shows a quiet "Still syncing" message instead of rolling back', async () => {
    (addFavourite as jest.Mock).mockResolvedValue(makeCommand({ status: 'PENDING' }));
    (pollUntilSettled as jest.Mock).mockRejectedValue(new PollTimeoutError());
    const user = userEvent.setup();
    renderWithQueryClient(<FavouriteButton channelId={1} channelTitle="Astro30" />);

    await user.click(await screen.findByRole('button', { name: 'Add Astro30 to favourites' }));

    const button = await screen.findByRole('button', { name: 'Remove Astro30 from favourites' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Still syncing'));
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not navigate: a click never reaches a wrapping link', async () => {
    (addFavourite as jest.Mock).mockResolvedValue(makeCommand());
    const user = userEvent.setup();
    const onLinkClick = jest.fn();

    renderWithQueryClient(
      // A plain anchor here only stands in for "any wrapping link", same shape as ChannelCard's.
      // eslint-disable-next-line @next/next/no-html-link-for-pages
      <a href="/channels/1" onClick={onLinkClick}>
        <FavouriteButton channelId={1} channelTitle="Astro30" />
      </a>,
    );

    await user.click(await screen.findByRole('button', { name: 'Add Astro30 to favourites' }));

    expect(onLinkClick).not.toHaveBeenCalled();
  });
});
